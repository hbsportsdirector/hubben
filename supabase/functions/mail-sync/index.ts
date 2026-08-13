// Hubben: IMAP-synk. Utan argument synkas INBOX på alla konton.
// Med { folderId } synkas den mappen (lat synk när man öppnar den första gången).
//
// Två sorters anropare släpps in, och ingen tredje:
//   * en inloggad användare, som får synka sina egna konton
//   * schemaläggaren i databasen, som visar upp den delade cron-nyckeln
//     och då synkar samtliga konton
// Därför är verify_jwt avstängd — kontrollen sker här nere i stället, för
// bakgrundsjobbet har ingen inloggad användare att låna en token av.
//
// Två sorters inloggning mot mejlservern också: lösenord ur valvet för
// vanliga IMAP-konton, och XOAUTH2 för Outlook. Microsoft stängde av
// lösenordsinloggning för privata outlook.com-konton hösten 2024.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-hub-cron",
};
const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const MAX_FORSTA = 120;
const dec = new TextDecoder();
const enc = new TextEncoder();
const admin = createClient(URL_, SERVICE);

const MS_TOKEN = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const MS_SCOPE = "https://outlook.office.com/IMAP.AccessAsUser.All offline_access";

/** Stämmer nyckeln schemaläggaren visar upp? Jämförelsen tar lika lång tid
 *  oavsett var den första skillnaden sitter. */
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

/** Färskt access-token ur det sparade refresh-tokenet. Access-token lever en
 *  timme, så det hämtas vid varje synk i stället för att lagras. */
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
  // Microsoft roterar refresh-tokenet ibland. Sparas det inte slutar
  // anslutningen fungera nagon vecka senare, utan uppenbar anledning.
  if (j.refresh_token && j.refresh_token !== k.refresh_token) {
    await admin.rpc("hub_spara_oauth_token", {
      p_user: userId, p_provider: "microsoft", p_token: j.refresh_token, p_konto: null,
    });
  }
  return j.access_token as string;
}

/** Bygger AUTHENTICATE-raden for ett konto. */
async function inloggningsrad(konto: Record<string, unknown>): Promise<string> {
  if (konto.provider === "outlook") {
    const token = await msAccessToken(konto.user_id as string);
    const xo = `user=${konto.email}\x01auth=Bearer ${token}\x01\x01`;
    return "AUTHENTICATE XOAUTH2 " + btoa(xo);
  }
  const { data: losen } = await admin.rpc("hub_get_mail_secret", { p_account_id: konto.id });
  if (!losen) throw new Error("Inget losenord");
  return "AUTHENTICATE PLAIN " + btoa(`\0${konto.email}\0${String(losen).trim()}`);
}

function radslut(b: Uint8Array, from: number) {
  for (let i = from; i < b.length - 1; i++) if (b[i] === 13 && b[i + 1] === 10) return i;
  return -1;
}
function arKlart(buf: Uint8Array, tag: string) {
  const klar = new RegExp("^" + tag + " (OK|NO|BAD)", "i");
  let i = 0;
  while (i < buf.length) {
    const eol = radslut(buf, i);
    if (eol < 0) return false;
    const rad = dec.decode(buf.subarray(i, eol));
    const lit = rad.match(/\{(\d+)\}$/);
    if (lit) { i = eol + 2 + Number(lit[1]); continue; }
    if (klar.test(rad)) return true;
    i = eol + 2;
  }
  return false;
}
async function las(conn: Deno.TlsConn, tag: string, timeoutMs = 45000) {
  const bitar: Uint8Array[] = []; let total = 0;
  const slut = Date.now() + timeoutMs; const buf = new Uint8Array(65536);
  while (Date.now() < slut) {
    let t: number | undefined;
    const n = await Promise.race([conn.read(buf), new Promise<null>((r) => { t = setTimeout(() => r(null), Math.max(500, slut - Date.now())); })]);
    if (t !== undefined) clearTimeout(t);
    if (n === null || n === 0) break;
    bitar.push(buf.slice(0, n as number)); total += n as number;
    const hela = new Uint8Array(total); let o = 0; for (const b of bitar) { hela.set(b, o); o += b.length; }
    if (arKlart(hela, tag)) return hela;
  }
  const hela = new Uint8Array(total); let o = 0; for (const b of bitar) { hela.set(b, o); o += b.length; }
  return hela;
}
async function cmd(conn: Deno.TlsConn, tag: string, k: string) {
  await conn.write(enc.encode(`${tag} ${k}\r\n`));
  return await las(conn, tag);
}
function parseFetch(buf: Uint8Array) {
  const poster: { meta: string; literaler: string[] }[] = [];
  let i = 0; let nu: { meta: string; literaler: string[] } | null = null;
  while (i < buf.length) {
    const eol = radslut(buf, i);
    if (eol < 0) break;
    const rad = dec.decode(buf.subarray(i, eol));
    if (/^\* \d+ FETCH \(/i.test(rad)) { nu = { meta: rad, literaler: [] }; poster.push(nu); }
    const lit = rad.match(/\{(\d+)\}$/);
    if (lit) {
      const n = Number(lit[1]); const start = eol + 2;
      nu?.literaler.push(dec.decode(buf.subarray(start, start + n)));
      i = start + n; continue;
    }
    i = eol + 2;
  }
  return poster;
}
function avkodaOrd(text: string): string {
  return text.replace(/=\?([^?]+)\?([BQbq])\?([^?]*)\?=/g, (_, tu, typ, data) => {
    try {
      const td = new TextDecoder(String(tu).toLowerCase());
      if (String(typ).toUpperCase() === "B") {
        const bin = atob(data);
        return td.decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
      }
      const s = String(data).replace(/_/g, " "); const bytes: number[] = [];
      for (let i = 0; i < s.length; i++) {
        if (s[i] === "=" && i + 2 < s.length) { bytes.push(parseInt(s.substr(i + 1, 2), 16)); i += 2; }
        else bytes.push(s.charCodeAt(i));
      }
      return td.decode(new Uint8Array(bytes));
    } catch { return data; }
  }).replace(/\?=\s+=\?/g, "");
}
function parseHeaders(text: string) {
  const ihop = text.replace(/\r\n[ \t]+/g, " ");
  const ut: Record<string, string> = {};
  for (const rad of ihop.split(/\r?\n/)) {
    const m = rad.match(/^([A-Za-z-]+):\s*(.*)$/);
    if (m) ut[m[1].toLowerCase()] = avkodaOrd(m[2].trim());
  }
  return ut;
}
function adresser(v?: string) {
  if (!v) return [];
  return v.split(/,(?![^<]*>)/).map((d) => {
    const m = d.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>/) || d.match(/^\s*()(\S+@\S+)/);
    return m ? { namn: (m[1] || "").trim() || null, epost: m[2].trim().toLowerCase() } : null;
  }).filter(Boolean) as { namn: string | null; epost: string }[];
}
function plockUt(t: string, n: string) {
  const m = t.match(new RegExp(`\\[${n} ([^\\]]+)\\]`, "i"));
  return m ? m[1].trim() : null;
}
/** Kodar mappnamn till modifierad UTF-7 för IMAP-kommandon. */
function kodaUtf7(s: string): string {
  return s.replace(/&/g, "&-").replace(/[^\x20-\x7e]+/g, (bit) => {
    let bin = "";
    for (const tecken of bit) {
      const kod = tecken.charCodeAt(0);
      bin += String.fromCharCode(kod >> 8, kod & 0xff);
    }
    return "&" + btoa(bin).replace(/=+$/, "").replace(/\//g, ",") + "-";
  });
}

async function synkaMapp(
  admin: ReturnType<typeof createClient>,
  konto: Record<string, unknown>,
  authRad: string,
  mappPath: string,
  mappId: string | null,
) {
  const logg: Record<string, unknown> = { konto: konto.label, mapp: mappPath };
  let conn: Deno.TlsConn | null = null;
  const t0 = Date.now();
  try {
    conn = await Deno.connectTls({ hostname: konto.imap_host as string, port: (konto.imap_port as number) ?? 993 });
    await las(conn, "\\*", 5000);
    const inl = await cmd(conn, "a1", authRad);
    if (!/^a1 OK/mi.test(dec.decode(inl))) {
      logg.fel = "Inloggning nekad";
      return logg;
    }

    const selText = dec.decode(await cmd(conn, "a2", `SELECT "${kodaUtf7(mappPath).replace(/"/g, '\\"')}"`));
    if (!/^a2 OK/mi.test(selText)) { logg.fel = "Kunde inte öppna mappen"; return logg; }
    const exists = Number(selText.match(/^\* (\d+) EXISTS/mi)?.[1] ?? 0);
    const uidvalidity = Number(plockUt(selText, "UIDVALIDITY") ?? 0);
    logg.iMappen = exists;

    let folderId = mappId;
    let lastUid = 0;
    if (folderId) {
      const { data: f } = await admin.from("hub_folders").select("uidvalidity, last_uid").eq("id", folderId).single();
      lastUid = Number(f?.last_uid ?? 0);
      if (f && Number(f.uidvalidity) !== uidvalidity) { lastUid = 0; logg.uidvalidityBytt = true; }
    } else {
      const { data: ny } = await admin.from("hub_folders").insert({
        user_id: konto.user_id, account_id: konto.id, path: mappPath,
        name: mappPath.split(/[./]/).pop() || mappPath,
        role: mappPath.toUpperCase() === "INBOX" ? "inbox" : null,
        uidvalidity, total_count: exists,
      }).select("id").single();
      folderId = ny?.id as string;
    }

    if (exists === 0) {
      await admin.from("hub_folders").update({ uidvalidity, total_count: 0, last_synced_at: new Date().toISOString() }).eq("id", folderId);
      logg.nya = 0; return logg;
    }

    const anvandUid = lastUid > 0;
    const spann = anvandUid ? `${lastUid + 1}:*` : `${Math.max(1, exists - MAX_FORSTA + 1)}:${exists}`;
    const svar = await cmd(conn, "a3", `${anvandUid ? "UID " : ""}FETCH ${spann} (UID FLAGS INTERNALDATE RFC822.SIZE BODY.PEEK[HEADER.FIELDS (FROM TO CC SUBJECT DATE MESSAGE-ID IN-REPLY-TO REFERENCES)])`);

    const rader = parseFetch(svar).map((p) => {
      const uid = Number(p.meta.match(/UID (\d+)/i)?.[1] ?? 0);
      if (!uid) return null;
      const fl = (p.meta.match(/FLAGS \(([^)]*)\)/i)?.[1] ?? "").toLowerCase();
      const h = parseHeaders(p.literaler[0] ?? "");
      const fran = adresser(h.from)[0];
      const refs = (h.references ?? "").split(/\s+/).filter((x) => x.startsWith("<"));
      const d = h.date ? new Date(h.date) : null;
      return {
        user_id: konto.user_id, account_id: konto.id, folder_id: folderId, uid,
        rfc_message_id: h["message-id"] ?? null,
        in_reply_to: h["in-reply-to"] ?? null,
        references_ids: refs,
        thread_key: refs[0] ?? h["in-reply-to"] ?? h["message-id"] ?? null,
        from_name: fran?.namn ?? null, from_email: fran?.epost ?? null,
        to_emails: adresser(h.to).map((a) => a.epost),
        cc_emails: adresser(h.cc).map((a) => a.epost),
        subject: h.subject ?? "",
        sent_at: d && !isNaN(d.getTime()) ? d.toISOString() : null,
        seen: fl.includes("\\seen"), flagged: fl.includes("\\flagged"),
        answered: fl.includes("\\answered"), draft: fl.includes("\\draft"),
        size_bytes: Number(p.meta.match(/RFC822\.SIZE (\d+)/i)?.[1] ?? 0),
      };
    }).filter(Boolean) as Record<string, unknown>[];

    if (rader.length) {
      const { error } = await admin.from("hub_messages").upsert(rader, { onConflict: "folder_id,uid" });
      if (error) logg.skrivfel = error.message;
      const hogsta = Math.max(...rader.map((r) => Number(r.uid)));
      await admin.from("hub_folders").update({
        uidvalidity, last_uid: hogsta, total_count: exists, last_synced_at: new Date().toISOString(),
      }).eq("id", folderId);
    } else {
      await admin.from("hub_folders").update({ uidvalidity, total_count: exists, last_synced_at: new Date().toISOString() }).eq("id", folderId);
    }
    logg.nya = rader.length;
    logg.msTotalt = Date.now() - t0;
    await cmd(conn, "a9", "LOGOUT");
  } catch (e) {
    logg.fel = String(e).slice(0, 250);
  } finally {
    try { conn?.close(); } catch { /* redan stängd */ }
  }
  return logg;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const svara = (kropp: unknown, status = 200) =>
    new Response(JSON.stringify(kropp, null, 2), { status, headers: { ...CORS, "Content-Type": "application/json" } });

  const { folderId } = await req.json().catch(() => ({ folderId: null }));

  // Bakgrundsjobbet synkar allt; en inloggad användare bara sitt eget.
  const bakgrund = await arBakgrundsjobb(req);
  let userId: string | null = null;
  if (!bakgrund) {
    const auth = req.headers.get("Authorization") ?? "";
    const somAnv = createClient(URL_, ANON, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await somAnv.auth.getUser();
    if (!user) return svara({ fel: "Inte inloggad" }, 401);
    userId = user.id;
  }

  const resultat = [];

  if (folderId) {
    let q = admin.from("hub_folders")
      .select("id, path, account_id, hub_mail_accounts(id, user_id, email, label, provider, imap_host, imap_port)")
      .eq("id", folderId);
    if (userId) q = q.eq("user_id", userId);
    const { data: f } = await q.single();
    if (!f) return svara({ fel: "Mappen hittades inte" }, 404);
    const konto = (f as Record<string, unknown>).hub_mail_accounts as Record<string, unknown>;
    try {
      const rad = await inloggningsrad(konto);
      resultat.push(await synkaMapp(admin, konto, rad, f.path as string, f.id as string));
    } catch (e) {
      resultat.push({ konto: konto.label, fel: String(e).slice(0, 200) });
    }
  } else {
    let q = admin.from("hub_mail_accounts")
      .select("id, user_id, email, label, provider, imap_host, imap_port, secret_id")
      .in("provider", ["imap", "outlook"]).eq("active", true);
    if (userId) q = q.eq("user_id", userId);
    const { data: konton } = await q.order("sort_order");
    for (const k of konton ?? []) {
      // Vanliga IMAP-konton utan lösenord är inte uppsatta än; Outlook har
      // aldrig något lösenord och ska inte hoppas över av det skälet.
      if (k.provider !== "outlook" && !k.secret_id) continue;
      try {
        const rad = await inloggningsrad(k as Record<string, unknown>);
        const { data: inbox } = await admin.from("hub_folders").select("id").eq("account_id", k.id).eq("path", "INBOX").maybeSingle();
        resultat.push(await synkaMapp(admin, k as Record<string, unknown>, rad, "INBOX", inbox?.id ?? null));
      } catch (e) {
        resultat.push({ konto: k.label, fel: String(e).slice(0, 200) });
      }
    }
  }
  return svara({ bakgrund, resultat });
});
