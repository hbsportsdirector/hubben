// Flyttar FLERA mejl. Sager ALLTID varfor nagot inte flyttades.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const U = Deno.env.get("SUPABASE_URL")!;
const S = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const A = Deno.env.get("SUPABASE_ANON_KEY")!;
const dec = new TextDecoder();
const enc = new TextEncoder();

function eol(b: Uint8Array, f: number) {
  for (let i = f; i < b.length - 1; i++) if (b[i] === 13 && b[i + 1] === 10) return i;
  return -1;
}
function klart(b: Uint8Array, tag: string) {
  const re = new RegExp("^" + tag + " (OK|NO|BAD)", "i");
  let i = 0;
  while (i < b.length) {
    const e = eol(b, i);
    if (e < 0) return false;
    const rad = dec.decode(b.subarray(i, e));
    const lit = rad.match(/\{(\d+)\}$/);
    if (lit) { i = e + 2 + Number(lit[1]); continue; }
    if (re.test(rad)) return true;
    i = e + 2;
  }
  return false;
}
async function las(c: Deno.TlsConn, tag: string, ms = 30000) {
  let ut = "";
  const slut = Date.now() + ms;
  const buf = new Uint8Array(32768);
  while (Date.now() < slut) {
    let t: number | undefined;
    const n = await Promise.race([c.read(buf), new Promise<null>((r) => { t = setTimeout(() => r(null), Math.max(400, slut - Date.now())); })]);
    if (t !== undefined) clearTimeout(t);
    if (n === null || n === 0) break;
    ut += dec.decode(buf.subarray(0, n as number));
    if (klart(enc.encode(ut), tag)) break;
  }
  return ut;
}
async function cmd(c: Deno.TlsConn, tag: string, k: string) {
  await c.write(enc.encode(tag + " " + k + "\r\n"));
  const s = await las(c, tag);
  return { text: s, ok: new RegExp("^" + tag + " OK", "mi").test(s) };
}
function utf7(s: string) {
  return s.replace(/&/g, "&-").replace(/[^\x20-\x7e]+/g, (bit) => {
    let bin = "";
    for (const t of bit) { const k = t.charCodeAt(0); bin += String.fromCharCode(k >> 8, k & 255); }
    return "&" + btoa(bin).replace(/=+$/, "").replace(/\//g, ",") + "-";
  });
}
const cit = (s: string) => '"' + utf7(s).replace(/"/g, '\\"') + '"';
function expandera(s: string): number[] {
  const ut: number[] = [];
  for (const del of s.split(",")) {
    const m = del.match(/^(\d+):(\d+)$/);
    if (m) { const a = Number(m[1]), b = Number(m[2]); for (let i = Math.min(a, b); i <= Math.max(a, b); i++) ut.push(i); }
    else if (/^\d+$/.test(del)) ut.push(Number(del));
  }
  return ut;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const svar = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

  const anv = createClient(U, A, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: { user } } = await anv.auth.getUser();
  if (!user) return svar({ fel: "Inte inloggad" }, 401);

  const { messageIds, targetFolderId } = await req.json().catch(() => ({}));
  if (!Array.isArray(messageIds) || !messageIds.length || !targetFolderId) return svar({ fel: "messageIds och targetFolderId kravs" }, 400);

  const admin = createClient(U, S);
  const { data: mal } = await admin.from("hub_folders").select("id, path, account_id").eq("id", targetFolderId).eq("user_id", user.id).single();
  if (!mal) return svar({ fel: "Malmappen hittades inte" }, 404);
  const { data: malKonto } = await admin.from("hub_mail_accounts").select("label, email, imap_host, imap_port").eq("id", mal.account_id).single();

  const { data: mejl } = await admin.from("hub_messages").select("id, uid, account_id, folder_id").in("id", messageIds).eq("user_id", user.id);
  if (!mejl?.length) return svar({ fel: "Inga mejl hittades" }, 404);

  const redanDar = mejl.filter((m) => m.folder_id === mal.id);
  const annatKonto = mejl.filter((m) => m.account_id !== mal.account_id);
  const sammaKonto = mejl.filter((m) => m.account_id === mal.account_id && m.folder_id !== mal.id);

  const problem: string[] = [];
  if (redanDar.length) problem.push(`${redanDar.length} lag redan i ${mal.path}`);
  if (annatKonto.length) {
    const { data: franKonto } = await admin.from("hub_mail_accounts").select("label").eq("id", annatKonto[0].account_id).single();
    problem.push(`${annatKonto.length} ligger pa ${franKonto?.label ?? "annat konto"} men ${mal.path} tillhor ${malKonto?.label ?? "ett annat konto"} - flyttas en i taget`);
  }

  if (!sammaKonto.length) {
    return svar({ ok: true, flyttade: 0, problem, kraverKontobyte: annatKonto.map((m) => m.id), mapp: mal.path });
  }

  const { data: losen } = await admin.rpc("hub_get_mail_secret", { p_account_id: mal.account_id });
  if (!losen) return svar({ fel: "Inget losenord for " + (malKonto?.label ?? "kontot") }, 400);

  const grupper = new Map<string, typeof sammaKonto>();
  for (const m of sammaKonto) {
    const g = grupper.get(m.folder_id) ?? [];
    g.push(m); grupper.set(m.folder_id, g);
  }

  let c: Deno.TlsConn | null = null;
  let flyttade = 0;
  let metod = "";
  try {
    c = await Deno.connectTls({ hostname: malKonto!.imap_host, port: malKonto!.imap_port ?? 993 });
    await las(c, "\\*", 5000);
    const inl = await cmd(c, "b1", "AUTHENTICATE PLAIN " + btoa("\0" + malKonto!.email + "\0" + String(losen).trim()));
    if (!inl.ok) return svar({ fel: "Inloggning nekad" }, 502);

    const kap = await cmd(c, "b2", "CAPABILITY");
    const harMove = /\bMOVE\b/i.test(kap.text);
    const harUidplus = /UIDPLUS/i.test(kap.text);
    metod = harMove ? "MOVE" : (harUidplus ? "COPY+UID EXPUNGE" : "COPY+EXPUNGE");

    let tagg = 3;
    for (const [kallId, grupp] of grupper) {
      const { data: kalla } = await admin.from("hub_folders").select("path").eq("id", kallId).single();
      const sel = await cmd(c, "b" + tagg++, "SELECT " + cit(String(kalla?.path ?? "INBOX")));
      if (!sel.ok) { problem.push(`Kunde inte oppna ${kalla?.path}: ${sel.text.split(/\r?\n/).filter(Boolean).pop()?.slice(0, 90)}`); continue; }

      const uidSet = grupp.map((m) => m.uid).sort((a, b) => a - b).join(",");
      let res = "";
      if (harMove) {
        const r = await cmd(c, "b" + tagg++, "UID MOVE " + uidSet + " " + cit(mal.path as string));
        if (!r.ok) { problem.push(`Servern nekade flytt till ${mal.path}: ${r.text.split(/\r?\n/).filter(Boolean).pop()?.slice(0, 120)}`); continue; }
        res = r.text;
      } else {
        const kop = await cmd(c, "b" + tagg++, "UID COPY " + uidSet + " " + cit(mal.path as string));
        if (!kop.ok) { problem.push(`Servern nekade kopiering till ${mal.path}: ${kop.text.split(/\r?\n/).filter(Boolean).pop()?.slice(0, 120)}`); continue; }
        const fl = await cmd(c, "b" + tagg++, "UID STORE " + uidSet + " +FLAGS (\\Deleted)");
        if (!fl.ok) { problem.push("Kunde inte markera originalen som raderade"); continue; }
        let rensat = false;
        if (harUidplus) rensat = (await cmd(c, "b" + tagg++, "UID EXPUNGE " + uidSet)).ok;
        if (!rensat) rensat = (await cmd(c, "b" + tagg++, "EXPUNGE")).ok;
        if (!rensat) { problem.push(`Kopior skapades i ${mal.path} men originalen gick inte att ta bort`); continue; }
        res = kop.text;
      }

      const cu = res.match(/COPYUID (\d+) (\S+) (\S+)/i);
      const fran = cu ? expandera(cu[2]) : [];
      const till = cu ? expandera(cu[3]) : [];
      if (fran.length === till.length && fran.length) {
        for (let i = 0; i < fran.length; i++) {
          const mm = grupp.find((x) => x.uid === fran[i]);
          if (mm) await admin.from("hub_messages").update({ folder_id: mal.id, uid: till[i] }).eq("id", mm.id);
        }
      } else {
        await admin.from("hub_messages").delete().in("id", grupp.map((m) => m.id));
      }
      flyttade += grupp.length;
    }

    await cmd(c, "b99", "LOGOUT");
    return svar({ ok: true, flyttade, mapp: mal.path, metod, problem, kraverKontobyte: annatKonto.map((m) => m.id) });
  } catch (e) {
    problem.push(String(e).slice(0, 150));
    return svar({ ok: true, flyttade, problem, kraverKontobyte: annatKonto.map((m) => m.id) });
  } finally {
    try { c?.close(); } catch { /* */ }
  }
});
