// Betar av kon av vantande flyttar mot IMAP. Databasen har redan flyttat
// mejlet at anvandaren - det har ar bara att fa mejlservern att halla med.
//
// Misslyckas en flytt star mejlet kvar i sin nya lada med en markering, och
// kon forsoker igen senare. Inget hoppar tillbaka i granssnittet.
//
// Tva sorters anropare: en inloggad anvandare, eller schemalaggaren i
// databasen med cron-nyckeln. Och tva sorters inloggning mot mejlservern:
// losenord ur valvet, eller XOAUTH2 for Outlook.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-hub-cron",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const U = Deno.env.get("SUPABASE_URL")!;
const S = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const A = Deno.env.get("SUPABASE_ANON_KEY")!;
const MAX = 30 * 1024 * 1024;
const PER_OMGANG = 25;
const dec = new TextDecoder();
const enc = new TextEncoder();
const admin = createClient(U, S);

const MS_TOKEN = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const MS_SCOPE = "https://outlook.office.com/IMAP.AccessAsUser.All offline_access";

async function arBakgrundsjobb(req: Request) {
  const given = req.headers.get("x-hub-cron");
  if (!given) return false;
  const { data } = await admin.from("hub_cron_nyckel").select("nyckel").maybeSingle();
  const ratt = data?.nyckel as string | undefined;
  if (!ratt || given.length !== ratt.length) return false;
  let diff = 0;
  for (let i = 0; i < ratt.length; i++) diff |= given.charCodeAt(i) ^ ratt.charCodeAt(i);
  return diff === 0;
}

async function msAccessToken(userId: string): Promise<string> {
  const { data: rader } = await admin.rpc("hub_hamta_oauth", { p_user: userId, p_provider: "microsoft" });
  const k = Array.isArray(rader) ? rader[0] : rader;
  if (!k?.refresh_token) throw new Error("Outlook ar inte anslutet an");
  const r = await fetch(MS_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: k.client_id, client_secret: k.hemlighet,
      refresh_token: k.refresh_token, grant_type: "refresh_token", scope: MS_SCOPE,
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    throw new Error(String(j.error_description ?? j.error ?? "Kunde inte fornya Outlook-atkomsten").slice(0, 200));
  }
  if (j.refresh_token && j.refresh_token !== k.refresh_token) {
    await admin.rpc("hub_spara_oauth_token", {
      p_user: userId, p_provider: "microsoft", p_token: j.refresh_token, p_konto: null,
    });
  }
  return j.access_token as string;
}

/** Bygger AUTHENTICATE-raden for ett konto. */
async function inloggningsrad(k: Record<string, unknown>): Promise<string> {
  if (k.provider === "outlook") {
    const token = await msAccessToken(k.user_id as string);
    return "AUTHENTICATE XOAUTH2 " + btoa(`user=${k.email}\x01auth=Bearer ${token}\x01\x01`);
  }
  const { data: p } = await admin.rpc("hub_get_mail_secret", { p_account_id: k.id });
  if (!p) throw new Error("Losenord saknas for kontot");
  return "AUTHENTICATE PLAIN " + btoa(`\0${k.email}\0${String(p).trim()}`);
}

/** Deno.TlsConn.write() lovar INTE att skriva allt - den returnerar hur manga
 *  byte som gick ivag. Ett helt mejl ryms sallan i ett svep, och da vantar
 *  servern i evighet pa resten. */
async function skrivAllt(c: Deno.TlsConn, data: Uint8Array) {
  let skrivet = 0;
  while (skrivet < data.length) {
    const n = await c.write(data.subarray(skrivet));
    if (n <= 0) throw new Error("Anslutningen tog inte emot mer data");
    skrivet += n;
  }
}

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
async function las(c: Deno.TlsConn, tag: string, ms = 40000): Promise<Uint8Array> {
  const bitar: Uint8Array[] = []; let total = 0;
  const slut = Date.now() + ms; const buf = new Uint8Array(65536);
  const hop = () => { const h = new Uint8Array(total); let o = 0; for (const b of bitar) { h.set(b, o); o += b.length; } return h; };
  while (Date.now() < slut) {
    let t: number | undefined;
    const n = await Promise.race([c.read(buf), new Promise<null>((r) => { t = setTimeout(() => r(null), Math.max(400, slut - Date.now())); })]);
    if (t !== undefined) clearTimeout(t);
    if (n === null || n === 0) break;
    bitar.push(buf.slice(0, n as number)); total += n as number;
    if (total > MAX) break;
    if (tag === "+") { if (/^\+/m.test(dec.decode(hop().subarray(0, 200)))) break; }
    else if (klart(hop(), tag)) break;
  }
  return hop();
}
async function cmd(c: Deno.TlsConn, tag: string, k: string) {
  await skrivAllt(c, enc.encode(tag + " " + k + "\r\n"));
  const b = await las(c, tag);
  const s = dec.decode(b);
  return { bytes: b, text: s, ok: new RegExp("^" + tag + " OK", "mi").test(s) };
}
function utf7(s: string) {
  return s.replace(/&/g, "&-").replace(/[^\x20-\x7e]+/g, (bit) => {
    let bin = "";
    for (const t of bit) { const k = t.charCodeAt(0); bin += String.fromCharCode(k >> 8, k & 255); }
    return "&" + btoa(bin).replace(/=+$/, "").replace(/\//g, ",") + "-";
  });
}
const cit = (s: string) => '"' + utf7(s).replace(/"/g, '\\"') + '"';
const sistaRad = (s: string) => s.split(/\r?\n/).filter(Boolean).pop()?.slice(0, 140) ?? "inget svar";

async function loggaIn(host: string, port: number, authRad: string, tag: string) {
  const c = await Deno.connectTls({ hostname: host, port });
  await las(c, "\\*", 5000);
  const r = await cmd(c, tag, authRad);
  if (!r.ok) { try { c.close(); } catch { /* */ } return null; }
  return c;
}

/** Flyttar inom samma konto. Kallmappen maste redan vara vald. */
async function flyttaHar(c: Deno.TlsConn, nyTag: () => string, uid: number, malPath: string, harMove: boolean, harUidplus: boolean) {
  if (harMove) {
    const r = await cmd(c, nyTag(), "UID MOVE " + uid + " " + cit(malPath));
    if (!r.ok) return { fel: "MOVE nekades: " + sistaRad(r.text) };
    const cu = r.text.match(/COPYUID (\d+) (\d+) (\d+)/i);
    return { uid: cu ? Number(cu[3]) : null };
  }
  const kop = await cmd(c, nyTag(), "UID COPY " + uid + " " + cit(malPath));
  if (!kop.ok) return { fel: "COPY nekades: " + sistaRad(kop.text) };
  const flagga = await cmd(c, nyTag(), "UID STORE " + uid + " +FLAGS (\\Deleted)");
  if (!flagga.ok) return { fel: "Kunde inte markera originalet som raderat" };
  let rensat = false;
  if (harUidplus) rensat = (await cmd(c, nyTag(), "UID EXPUNGE " + uid)).ok;
  if (!rensat) rensat = (await cmd(c, nyTag(), "EXPUNGE")).ok;
  if (!rensat) return { fel: "Kopian skapades men originalet gick inte att ta bort - mejlet finns nu pa bada stallen" };
  const cu = kop.text.match(/COPYUID (\d+) (\d+) (\d+)/i);
  return { uid: cu ? Number(cu[3]) : null };
}

/** Servrar utan UIDPLUS beratter inte vilket UID kopian fick. Da letar vi
 *  upp den pa Message-ID i stallet for att tappa bort mejlet. */
async function sokUid(c: Deno.TlsConn, nyTag: () => string, malPath: string, rfcId: string | null) {
  if (!rfcId) return null;
  const ren = rfcId.replace(/^<|>$/g, "");
  const sel = await cmd(c, nyTag(), "SELECT " + cit(malPath));
  if (!sel.ok) return null;
  const r = await cmd(c, nyTag(), 'UID SEARCH HEADER Message-ID "<' + ren.replace(/"/g, "") + '>"');
  const m = r.text.match(/^\* SEARCH([\d ]*)/mi);
  const nr = m?.[1]?.trim().split(/\s+/).filter(Boolean).map(Number) ?? [];
  return nr.length ? nr[nr.length - 1] : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const svar = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

  const bakgrund = await arBakgrundsjobb(req);
  let userId: string | null = null;
  if (!bakgrund) {
    const anv = createClient(U, A, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: { user } } = await anv.auth.getUser();
    if (!user) return svar({ fel: "Inte inloggad" }, 401);
    userId = user.id;
  }

  let koFraga = admin.from("hub_pending_ops")
    .select("id, msg_id, fran_folder_id, fran_uid, till_folder_id, forsok")
    .lte("nasta_forsok", new Date().toISOString());
  if (userId) koFraga = koFraga.eq("user_id", userId);
  const { data: ops } = await koFraga.order("skapad").limit(PER_OMGANG);
  if (!ops?.length) return svar({ utforda: 0, misslyckade: 0, kvar: 0, klart: true, problem: [] });

  const mappIds = [...new Set(ops.flatMap((o) => [o.fran_folder_id, o.till_folder_id]))];
  const { data: mappRader } = await admin.from("hub_folders").select("id, path, account_id").in("id", mappIds);
  const mapp = new Map((mappRader ?? []).map((f) => [f.id, f]));

  const { data: mejlRader } = await admin.from("hub_messages").select("id, seen, flagged, rfc_message_id").in("id", ops.map((o) => o.msg_id));
  const mejl = new Map((mejlRader ?? []).map((m) => [m.id, m]));

  const kontoIds = [...new Set((mappRader ?? []).map((f) => f.account_id))];
  const { data: kontoRader } = await admin.from("hub_mail_accounts")
    .select("id, user_id, label, email, provider, imap_host, imap_port").in("id", kontoIds);
  const konto = new Map((kontoRader ?? []).map((k) => [k.id, k]));

  // En inloggningsrad per konto: losenord ur valvet, eller ett farskt
  // Microsoft-token for Outlook.
  const authRader = new Map<string, string>();
  for (const id of kontoIds) {
    const k = konto.get(id);
    if (!k) continue;
    try { authRader.set(id, await inloggningsrad(k as Record<string, unknown>)); } catch { /* kontot far falla nedan */ }
  }

  const { data: papperRader } = await admin.from("hub_folders").select("path, account_id").in("account_id", kontoIds).eq("role", "trash");
  const papper = new Map((papperRader ?? []).map((f) => [f.account_id, f.path]));

  const problem: { mejl: string; fel: string }[] = [];
  let utforda = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const misslyckades = async (o: any, fel: string) => {
    const n = (o.forsok ?? 0) + 1;
    const minuter = [1, 5, 15, 60][Math.min(n - 1, 3)];
    await admin.from("hub_pending_ops").update({
      forsok: n,
      sista_fel: String(fel).slice(0, 300),
      nasta_forsok: new Date(Date.now() + minuter * 60000).toISOString(),
    }).eq("id", o.id);
    problem.push({ mejl: o.msg_id, fel: String(fel).slice(0, 200) });
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lyckades = async (o: any, patch: Record<string, unknown>) => {
    await admin.from("hub_messages").update({ ...patch, pending_folder_id: null }).eq("id", o.msg_id);
    await admin.from("hub_pending_ops").delete().eq("id", o.id);
    utforda++;
  };
  // Vi vet att flytten gick igenom men inte vilket UID kopian fick och hittar
  // den inte heller. Da ar det arligare att slappa raden och lata nasta synk
  // av malmappen hamta hem mejlet igen an att peka pa ett UID som inte finns.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tappadeSpar = async (o: any) => {
    await admin.from("hub_messages").delete().eq("id", o.msg_id);
    await admin.from("hub_pending_ops").delete().eq("id", o.id);
    utforda++;
  };

  const sammaKonto = ops.filter((o) => mapp.get(o.fran_folder_id)?.account_id === mapp.get(o.till_folder_id)?.account_id);
  const korsKonto = ops.filter((o) => !sammaKonto.includes(o));

  // ---- Flyttar inom ett konto: en uppkoppling per konto ----
  const perKonto = new Map<string, typeof ops>();
  for (const o of sammaKonto) {
    const a = mapp.get(o.fran_folder_id)?.account_id;
    if (!a) { await misslyckades(o, "Kallmappen finns inte langre"); continue; }
    const lista = perKonto.get(a) ?? [];
    lista.push(o); perKonto.set(a, lista);
  }

  for (const [kontoId, lista] of perKonto) {
    const k = konto.get(kontoId); const rad = authRader.get(kontoId);
    if (!k || !rad) { for (const o of lista) await misslyckades(o, "Ingen inloggning for kontot"); continue; }
    let c: Deno.TlsConn | null = null;
    let n = 0;
    const nyTag = () => "d" + (++n);
    try {
      c = await loggaIn(k.imap_host, k.imap_port ?? 993, rad, nyTag());
      if (!c) { for (const o of lista) await misslyckades(o, "Inloggning nekad pa " + k.label); continue; }
      const kap = await cmd(c, nyTag(), "CAPABILITY");
      const harMove = /\bMOVE\b/i.test(kap.text);
      const harUidplus = /UIDPLUS/i.test(kap.text);

      const perMapp = new Map<string, typeof ops>();
      for (const o of lista) { const l = perMapp.get(o.fran_folder_id) ?? []; l.push(o); perMapp.set(o.fran_folder_id, l); }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const behoverUid: { o: any; malPath: string }[] = [];

      for (const [franId, opsHar] of perMapp) {
        const fran = mapp.get(franId);
        const sel = await cmd(c, nyTag(), "SELECT " + cit(String(fran?.path ?? "INBOX")));
        if (!sel.ok) { for (const o of opsHar) await misslyckades(o, "Kunde inte oppna " + fran?.path); continue; }
        for (const o of opsHar) {
          const mal = mapp.get(o.till_folder_id);
          if (!mal) { await misslyckades(o, "Malmappen finns inte langre"); continue; }
          try {
            const r = await flyttaHar(c, nyTag, o.fran_uid, mal.path, harMove, harUidplus);
            if (r.fel) { await misslyckades(o, r.fel); continue; }
            if (r.uid) await lyckades(o, { folder_id: o.till_folder_id, uid: r.uid });
            // UID-sokningen valjer om mapp, sa den maste vanta tills alla
            // flyttar ur den har kallmappen ar gjorda.
            else behoverUid.push({ o, malPath: mal.path });
          } catch (e) { await misslyckades(o, String(e).slice(0, 150)); }
        }
      }

      for (const { o, malPath } of behoverUid) {
        try {
          const nytt = await sokUid(c, nyTag, malPath, mejl.get(o.msg_id)?.rfc_message_id ?? null);
          if (nytt) await lyckades(o, { folder_id: o.till_folder_id, uid: nytt });
          else await tappadeSpar(o);
        } catch { await tappadeSpar(o); }
      }

      await cmd(c, "d999", "LOGOUT");
    } catch (e) {
      for (const o of lista) await misslyckades(o, String(e).slice(0, 150));
    } finally { try { c?.close(); } catch { /* */ } }
  }

  // ---- Flyttar mellan konton: ner, upp, sedan originalet undan ----
  for (const o of korsKonto) {
    const fran = mapp.get(o.fran_folder_id); const mal = mapp.get(o.till_folder_id);
    if (!fran || !mal) { await misslyckades(o, "Mappen finns inte langre"); continue; }
    const kk = konto.get(fran.account_id); const mk = konto.get(mal.account_id);
    const kr = authRader.get(fran.account_id); const mr = authRader.get(mal.account_id);
    if (!kk || !mk || !kr || !mr) { await misslyckades(o, "Ingen inloggning for ett av kontona"); continue; }

    let kc: Deno.TlsConn | null = null, mc: Deno.TlsConn | null = null;
    try {
      kc = await loggaIn(kk.imap_host, kk.imap_port ?? 993, kr, "k1");
      if (!kc) { await misslyckades(o, "Kunde inte logga in pa " + kk.label); continue; }
      const kap = await cmd(kc, "k2", "CAPABILITY");
      const harMove = /\bMOVE\b/i.test(kap.text);
      const harUidplus = /UIDPLUS/i.test(kap.text);
      const sel = await cmd(kc, "k3", "SELECT " + cit(fran.path));
      if (!sel.ok) { await misslyckades(o, "Kunde inte oppna " + fran.path); continue; }

      const raatt = await cmd(kc, "k4", "UID FETCH " + o.fran_uid + " (BODY.PEEK[])");
      const slutRad = eol(raatt.bytes, 0);
      const forsta = dec.decode(raatt.bytes.subarray(0, slutRad < 0 ? 200 : slutRad));
      const lit = forsta.match(/\{(\d+)\}$/);
      if (!lit) { await misslyckades(o, "Servern gav inget meddelandeinnehall"); continue; }
      const langd = Number(lit[1]);
      if (langd > MAX) { await misslyckades(o, "Mejlet ar for stort (" + Math.round(langd / 1048576) + " MB)"); continue; }
      const kropp = raatt.bytes.subarray(slutRad + 2, slutRad + 2 + langd);
      if (kropp.length < langd) { await misslyckades(o, "Ofullstandig nerladdning"); continue; }

      mc = await loggaIn(mk.imap_host, mk.imap_port ?? 993, mr, "m1");
      if (!mc) { await misslyckades(o, "Kunde inte logga in pa " + mk.label); continue; }

      const rad = mejl.get(o.msg_id);
      const flaggor = [rad?.seen ? "\\Seen" : "", rad?.flagged ? "\\Flagged" : ""].filter(Boolean).join(" ");
      await skrivAllt(mc, enc.encode("m2 APPEND " + cit(mal.path) + " (" + flaggor + ") {" + langd + "}\r\n"));
      const fortsatt = dec.decode(await las(mc, "+", 15000));
      if (!/^\+/m.test(fortsatt)) { await misslyckades(o, mk.label + " nekade uppladdning: " + sistaRad(fortsatt)); continue; }
      await skrivAllt(mc, kropp);
      await skrivAllt(mc, enc.encode("\r\n"));
      const app = dec.decode(await las(mc, "m2", 120000));
      if (!/^m2 OK/mi.test(app)) { await misslyckades(o, "Uppladdning misslyckades: " + sistaRad(app)); continue; }

      // Kopian ar pa plats. Nu - och forst nu - originalet undan.
      const papperPath = papper.get(fran.account_id);
      let undan = false;
      if (papperPath) {
        const r = await flyttaHar(kc, (() => { let i = 4; return () => "k" + (++i); })(), o.fran_uid, papperPath, harMove, harUidplus);
        undan = !r.fel;
      }
      if (!undan) {
        await misslyckades(o, "Kopian ligger i " + mal.path + " pa " + mk.label +
          " men originalet gick inte att ta bort fran " + kk.label + " - mejlet finns nu pa bada stallen");
        continue;
      }

      const nyttUid = app.match(/APPENDUID (\d+) (\d+)/i);
      if (nyttUid) await lyckades(o, { folder_id: mal.id, account_id: mal.account_id, uid: Number(nyttUid[2]) });
      else {
        const hittat = await sokUid(mc, (() => { let i = 2; return () => "m" + (++i); })(), mal.path, rad?.rfc_message_id ?? null);
        if (hittat) await lyckades(o, { folder_id: mal.id, account_id: mal.account_id, uid: hittat });
        else await tappadeSpar(o);
      }
      await cmd(kc, "k99", "LOGOUT");
      await cmd(mc, "m99", "LOGOUT");
    } catch (e) {
      await misslyckades(o, String(e).slice(0, 150));
    } finally {
      try { kc?.close(); } catch { /* */ }
      try { mc?.close(); } catch { /* */ }
    }
  }

  let kvarFraga = admin.from("hub_pending_ops").select("*", { count: "exact", head: true });
  if (userId) kvarFraga = kvarFraga.eq("user_id", userId);
  const { count: kvar } = await kvarFraga;

  return svar({
    bakgrund,
    utforda,
    misslyckade: problem.length,
    kvar: kvar ?? 0,
    // klart betyder "inget mer att gora just nu" - poster med backoff raknas kvar
    klart: ops.length < PER_OMGANG,
    problem,
  });
});
