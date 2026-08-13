// Flyttar ETT mejl. Valjer metod efter vad servern FAKTISKT stodjer:
// MOVE om det finns, annars COPY + markera raderad + UID EXPUNGE (kraver UIDPLUS)
// och som sista utvag vanlig EXPUNGE. Databasen rors forst nar servern bekraftat.
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
function klart(buf: Uint8Array, tag: string) {
  const re = new RegExp("^" + tag + " (OK|NO|BAD)", "i");
  let i = 0;
  while (i < buf.length) {
    const e = eol(buf, i);
    if (e < 0) return false;
    const rad = dec.decode(buf.subarray(i, e));
    const lit = rad.match(/\{(\d+)\}$/);
    if (lit) { i = e + 2 + Number(lit[1]); continue; }
    if (re.test(rad)) return true;
    i = e + 2;
  }
  return false;
}
async function las(c: Deno.TlsConn, tag: string, ms = 20000) {
  let ut = "";
  const slut = Date.now() + ms;
  const buf = new Uint8Array(32768);
  while (Date.now() < slut) {
    let t: number | undefined;
    const n = await Promise.race([c.read(buf), new Promise<null>((r) => { t = setTimeout(() => r(null), Math.max(300, slut - Date.now())); })]);
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const svar = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

  const anv = createClient(U, A, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: { user } } = await anv.auth.getUser();
  if (!user) return svar({ fel: "Inte inloggad" }, 401);

  const { messageId, targetFolderId, targetRole } = await req.json().catch(() => ({}));
  if (!messageId) return svar({ fel: "messageId kravs" }, 400);

  const admin = createClient(U, S);
  const { data: m } = await admin.from("hub_messages")
    .select("id, uid, account_id, folder_id, hub_mail_accounts(email, imap_host, imap_port)")
    .eq("id", messageId).eq("user_id", user.id).single();
  if (!m) return svar({ fel: "Mejlet hittades inte" }, 404);

  let mal;
  if (targetFolderId) {
    const { data } = await admin.from("hub_folders").select("id, path, account_id").eq("id", targetFolderId).eq("user_id", user.id).single();
    mal = data;
  } else if (targetRole) {
    const { data } = await admin.from("hub_folders").select("id, path, account_id")
      .eq("account_id", m.account_id).eq("role", targetRole).limit(1);
    mal = data?.[0];
  }
  if (!mal) return svar({ fel: "Malmappen hittades inte" }, 404);
  if (mal.account_id !== m.account_id) return svar({ fel: "Kan inte flytta mellan konton har" }, 400);
  if (mal.id === m.folder_id) return svar({ ok: true, redanDar: true });

  const { data: kalla } = await admin.from("hub_folders").select("path").eq("id", m.folder_id).single();
  const konto = (m as Record<string, unknown>).hub_mail_accounts as Record<string, unknown>;
  const { data: losen } = await admin.rpc("hub_get_mail_secret", { p_account_id: m.account_id });
  if (!losen) return svar({ fel: "Inget losenord" }, 400);

  let c: Deno.TlsConn | null = null;
  try {
    c = await Deno.connectTls({ hostname: konto.imap_host as string, port: (konto.imap_port as number) ?? 993 });
    await las(c, "\\*", 5000);
    const inl = await cmd(c, "m1", "AUTHENTICATE PLAIN " + btoa("\0" + konto.email + "\0" + String(losen).trim()));
    if (!inl.ok) return svar({ fel: "Inloggning nekad" }, 502);

    // Kapaciteter EFTER inloggning - servrar visar ofta mer da
    const kap = await cmd(c, "m2", "CAPABILITY");
    const harMove = /\bMOVE\b/i.test(kap.text);
    const harUidplus = /UIDPLUS/i.test(kap.text);

    const sel = await cmd(c, "m3", "SELECT " + cit(String(kalla?.path ?? "INBOX")));
    if (!sel.ok) return svar({ fel: "Kunde inte oppna kallmappen" }, 502);

    const malNamn = cit(mal.path as string);
    let metod = "";
    let resultat = "";

    if (harMove) {
      const r = await cmd(c, "m4", "UID MOVE " + m.uid + " " + malNamn);
      if (!r.ok) return svar({ fel: "MOVE nekades: " + r.text.slice(0, 150) }, 502);
      metod = "MOVE"; resultat = r.text;
    } else {
      const kop = await cmd(c, "m5", "UID COPY " + m.uid + " " + malNamn);
      if (!kop.ok) return svar({ fel: "COPY nekades: " + kop.text.slice(0, 150) }, 502);
      const flagga = await cmd(c, "m6", "UID STORE " + m.uid + " +FLAGS (\\Deleted)");
      if (!flagga.ok) return svar({ fel: "Kunde inte markera originalet som raderat" }, 502);

      // UID EXPUNGE kraver UIDPLUS. Saknas det anvands vanlig EXPUNGE,
      // som bara tar bort det vi precis markerat i denna mapp.
      let rensat = false;
      if (harUidplus) {
        const ue = await cmd(c, "m7", "UID EXPUNGE " + m.uid);
        rensat = ue.ok;
      }
      if (!rensat) {
        const ex = await cmd(c, "m8", "EXPUNGE");
        rensat = ex.ok;
      }
      if (!rensat) {
        return svar({ fel: "Kopian skapades men originalet gick inte att ta bort - mejlet finns nu pa bada stallen" }, 502);
      }
      metod = harUidplus ? "COPY+UID EXPUNGE" : "COPY+EXPUNGE";
      resultat = kop.text;
    }

    const cu = resultat.match(/COPYUID (\d+) (\d+) (\d+)/i);
    if (cu) {
      await admin.from("hub_messages").update({ folder_id: mal.id, uid: Number(cu[3]) }).eq("id", messageId);
    } else {
      await admin.from("hub_messages").delete().eq("id", messageId);
    }

    await cmd(c, "m9", "LOGOUT");
    return svar({ ok: true, mapp: mal.path, metod, harMove, harUidplus, nyttUid: cu ? Number(cu[3]) : null });
  } catch (e) {
    return svar({ fel: String(e).slice(0, 200) }, 500);
  } finally {
    try { c?.close(); } catch { /* */ }
  }
});
