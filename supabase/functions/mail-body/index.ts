// Hamtar brodtext OCH kartlagger bilagor for ETT mejl. Varje MIME-del far
// sitt avsnittsnummer (1, 2, 2.1...) sa en enskild bilaga kan hamtas senare.
//
// Tva sorters inloggning mot mejlservern: losenord ur valvet for vanliga
// IMAP-konton, XOAUTH2 for Outlook.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const U = Deno.env.get("SUPABASE_URL")!;
const S = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const A = Deno.env.get("SUPABASE_ANON_KEY")!;
const dec = new TextDecoder();
const enc = new TextEncoder();
const admin = createClient(U, S);

const MS_TOKEN = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const MS_SCOPE = "https://outlook.office.com/IMAP.AccessAsUser.All offline_access";

/** Farskt access-token ur det sparade refresh-tokenet. */
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
async function inloggningsrad(konto: Record<string, unknown>, kontoId: string, userId: string): Promise<string> {
  if (konto.provider === "outlook") {
    const token = await msAccessToken(userId);
    return "AUTHENTICATE XOAUTH2 " + btoa(`user=${konto.email}\x01auth=Bearer ${token}\x01\x01`);
  }
  const { data: losen } = await admin.rpc("hub_get_mail_secret", { p_account_id: kontoId });
  if (!losen) throw new Error("Inget losenord");
  return "AUTHENTICATE PLAIN " + btoa(`\0${konto.email}\0${String(losen).trim()}`);
}

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
    if (klart(hop(), tag)) break;
  }
  return hop();
}
async function cmd(c: Deno.TlsConn, tag: string, k: string) {
  await c.write(enc.encode(tag + " " + k + "\r\n"));
  return await las(c, tag);
}
function utf7(s: string) {
  return s.replace(/&/g, "&-").replace(/[^\x20-\x7e]+/g, (bit) => {
    let bin = "";
    for (const t of bit) { const k = t.charCodeAt(0); bin += String.fromCharCode(k >> 8, k & 255); }
    return "&" + btoa(bin).replace(/=+$/, "").replace(/\//g, ",") + "-";
  });
}
function avkodaQP(s: string) {
  return s.replace(/=\r?\n/g, "").replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}
function tillText(raa: string, kodning: string, tecken: string) {
  const k = (kodning || "").toLowerCase();
  try {
    let bytes: Uint8Array;
    if (k === "base64") {
      const bin = atob(raa.replace(/\s+/g, ""));
      bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    } else if (k === "quoted-printable") {
      bytes = Uint8Array.from(avkodaQP(raa), (c) => c.charCodeAt(0));
    } else return raa;
    return new TextDecoder(tecken || "utf-8").decode(bytes);
  } catch { return raa; }
}
/** RFC 2047 for filnamn med aao */
function avkodaOrd(t: string) {
  return t.replace(/=\?([^?]+)\?([BQbq])\?([^?]*)\?=/g, (_, tu, typ, data) => {
    try {
      const td = new TextDecoder(String(tu).toLowerCase());
      if (String(typ).toUpperCase() === "B") {
        const bin = atob(data);
        return td.decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
      }
      const s = String(data).replace(/_/g, " "); const by: number[] = [];
      for (let i = 0; i < s.length; i++) {
        if (s[i] === "=" && i + 2 < s.length) { by.push(parseInt(s.substr(i + 1, 2), 16)); i += 2; }
        else by.push(s.charCodeAt(i));
      }
      return td.decode(new Uint8Array(by));
    } catch { return data; }
  });
}
function filnamnUr(huvud: string): string | null {
  const cd = huvud.match(/^content-disposition:\s*(.+)$/mi)?.[1] ?? "";
  const ct = huvud.match(/^content-type:\s*(.+)$/mi)?.[1] ?? "";
  const utokad = (cd + " " + ct).match(/(?:filename|name)\*=(?:UTF-8|utf-8)''([^\s;]+)/);
  if (utokad) { try { return decodeURIComponent(utokad[1]); } catch { /* */ } }
  const enkel = (cd + " " + ct).match(/(?:filename|name)="([^"]+)"|(?:filename|name)=([^\s;]+)/);
  return enkel ? avkodaOrd(enkel[1] ?? enkel[2]) : null;
}

interface Bilaga { part_id: string; filename: string; content_type: string; size_bytes: number; inline: boolean; content_id: string | null }

/** Gar igenom MIME-tradet och numrerar delarna enligt IMAP-standarden. */
function gaIgenom(raatt: string, prefix: string, ut: { text: string | null; html: string | null; bilagor: Bilaga[] }) {
  const d = raatt.indexOf("\r\n\r\n");
  if (d < 0) return;
  const huvud = raatt.slice(0, d).replace(/\r\n[ \t]+/g, " ");
  const kropp = raatt.slice(d + 4);
  const ct = huvud.match(/^content-type:\s*(.+)$/mi)?.[1] ?? "text/plain";
  const cte = huvud.match(/^content-transfer-encoding:\s*(\S+)/mi)?.[1] ?? "";
  const charset = ct.match(/charset="?([^";\s]+)"?/i)?.[1] ?? "utf-8";
  const cd = huvud.match(/^content-disposition:\s*(\w+)/mi)?.[1]?.toLowerCase() ?? "";
  const cid = huvud.match(/^content-id:\s*<?([^>\s]+)>?/mi)?.[1] ?? null;
  const g = ct.match(/boundary="?([^";\s]+)"?/i);

  if (/multipart\//i.test(ct) && g) {
    const delar = kropp.split("--" + g[1]);
    let nr = 1;
    for (const del of delar.slice(1, -1)) {
      const barn = prefix ? `${prefix}.${nr}` : String(nr);
      gaIgenom(del.replace(/^\r\n/, ""), barn, ut);
      nr++;
    }
    return;
  }

  const avsnitt = prefix || "1";
  const filnamn = filnamnUr(huvud);
  const arBilaga = cd === "attachment" || (!!filnamn && !/text\/(plain|html)/i.test(ct));

  if (arBilaga || (cd === "inline" && filnamn)) {
    const base64 = /base64/i.test(cte);
    // Base64 blaser upp innehallet 4/3, och radbrytningarna raknas inte med.
    const nyttolast = base64 ? kropp.replace(/\s+/g, "").length * 0.75 : kropp.length;
    ut.bilagor.push({
      part_id: avsnitt,
      filename: filnamn ?? "bilaga",
      content_type: ct.split(";")[0].trim().toLowerCase(),
      size_bytes: Math.round(nyttolast),
      inline: cd === "inline",
      content_id: cid,
    });
    return;
  }

  const innehall = tillText(kropp, cte, charset);
  if (/text\/html/i.test(ct) && !ut.html) ut.html = innehall;
  else if (/text\/plain/i.test(ct) && !ut.text) ut.text = innehall;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const svar = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

  const anv = createClient(U, A, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: { user } } = await anv.auth.getUser();
  if (!user) return svar({ fel: "Inte inloggad" }, 401);

  const { messageId } = await req.json().catch(() => ({}));
  if (!messageId) return svar({ fel: "messageId saknas" }, 400);

  const { data: fanns } = await admin.from("hub_message_bodies")
    .select("text_body, html_body, bilagor_lasta").eq("msg_id", messageId).maybeSingle();

  // Kroppar som hamtades av en aldre version har ingen bilagekartlaggning.
  // Da racker det inte att de finns - mejlet maste hamtas och gas igenom igen.
  if (fanns?.bilagor_lasta) {
    const { data: bilagorFanns } = await admin.from("hub_attachments")
      .select("id, part_id, filename, content_type, size_bytes, inline").eq("msg_id", messageId).order("part_id");
    return svar({ text_body: fanns.text_body, html_body: fanns.html_body, bilagor: bilagorFanns ?? [] });
  }

  // Fragan gors som den inloggade, inte som service_role, sa radsakerheten i
  // databasen avgor vem som far lasa mejlet.
  const { data: m } = await anv.from("hub_messages")
    .select("id, uid, user_id, account_id, folder_id, hub_mail_accounts(email, provider, imap_host, imap_port)")
    .eq("id", messageId).single();
  if (!m) return svar({ fel: "Hittades inte" }, 404);

  const { data: mapp } = await admin.from("hub_folders").select("path").eq("id", m.folder_id).single();
  const konto = (m as Record<string, unknown>).hub_mail_accounts as Record<string, unknown>;

  let authRad: string;
  try {
    authRad = await inloggningsrad(konto, m.account_id as string, m.user_id as string);
  } catch (e) {
    return svar({ fel: String(e).slice(0, 200) }, 400);
  }

  let c: Deno.TlsConn | null = null;
  try {
    c = await Deno.connectTls({ hostname: konto.imap_host as string, port: (konto.imap_port as number) ?? 993 });
    await las(c, "\\*", 5000);
    const inl = dec.decode(await cmd(c, "b1", authRad));
    if (!/^b1 OK/mi.test(inl)) throw new Error("Inloggning nekad");
    await cmd(c, "b2", 'SELECT "' + utf7(String(mapp?.path ?? "INBOX")).replace(/"/g, '\\"') + '"');
    const raa = await cmd(c, "b3", "UID FETCH " + m.uid + " (BODY.PEEK[])");

    const slut = eol(raa, 0);
    const forsta = dec.decode(raa.subarray(0, slut < 0 ? 200 : slut));
    const lit = forsta.match(/\{(\d+)\}$/);
    const innehall = lit ? dec.decode(raa.subarray(slut + 2, slut + 2 + Number(lit[1]))) : "";

    const ut = { text: null as string | null, html: null as string | null, bilagor: [] as Bilaga[] };
    gaIgenom(innehall, "", ut);

    await admin.from("hub_message_bodies").upsert({
      msg_id: messageId, text_body: ut.text, html_body: ut.html, bilagor_lasta: true,
    });
    if (ut.bilagor.length) {
      await admin.from("hub_attachments").upsert(
        ut.bilagor.map((b) => ({ ...b, user_id: m.user_id, msg_id: messageId })),
        { onConflict: "msg_id,part_id" },
      );
      await admin.rpc("hub_satt_bilageflagga", { p_msg: messageId });
    }

    await cmd(c, "b9", "LOGOUT");
    // Klienten laser bilagorna ur tabellen, men de skickas med sa att
    // forsta oppningen slipper vanta pa ytterligare en fraga.
    return svar({ text_body: ut.text, html_body: ut.html, bilagor: ut.bilagor });
  } catch (e) {
    return svar({ fel: String(e).slice(0, 200) }, 500);
  } finally {
    try { c?.close(); } catch { /* */ }
  }
});
