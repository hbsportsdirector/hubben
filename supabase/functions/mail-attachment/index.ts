// Hamtar EN bilaga och returnerar den som fil. Hamtar bara den MIME-del
// som behovs, inte hela mejlet.
//
// Tva sorters inloggning: losenord ur valvet, eller XOAUTH2 for Outlook.
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
const MAX = 25 * 1024 * 1024;
const dec = new TextDecoder();
const enc = new TextEncoder();
const admin = createClient(U, S);

const MS_TOKEN = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const MS_SCOPE = "https://outlook.office.com/IMAP.AccessAsUser.All offline_access";

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

async function inloggningsrad(konto: Record<string, unknown>, kontoId: string, userId: string): Promise<string> {
  if (konto.provider === "outlook") {
    const token = await msAccessToken(userId);
    return "AUTHENTICATE XOAUTH2 " + btoa(`user=${konto.email}\x01auth=Bearer ${token}\x01\x01`);
  }
  const { data: p } = await admin.rpc("hub_get_mail_secret", { p_account_id: kontoId });
  if (!p) throw new Error("Inget losenord");
  return "AUTHENTICATE PLAIN " + btoa(`\0${konto.email}\0${String(p).trim()}`);
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
async function las(c: Deno.TlsConn, tag: string, ms = 45000) {
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const fel = (o: unknown, s = 400) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

  const anv = createClient(U, A, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: { user } } = await anv.auth.getUser();
  if (!user) return fel({ fel: "Inte inloggad" }, 401);

  const { attachmentId } = await req.json().catch(() => ({}));
  if (!attachmentId) return fel({ fel: "attachmentId kravs" });

  const { data: b } = await admin.from("hub_attachments")
    .select("part_id, filename, content_type, msg_id").eq("id", attachmentId).eq("user_id", user.id).single();
  if (!b) return fel({ fel: "Bilagan hittades inte" }, 404);

  const { data: m } = await admin.from("hub_messages")
    .select("uid, user_id, account_id, folder_id, hub_mail_accounts(email, provider, imap_host, imap_port)")
    .eq("id", b.msg_id).single();
  if (!m) return fel({ fel: "Mejlet hittades inte" }, 404);

  const { data: mapp } = await admin.from("hub_folders").select("path").eq("id", m.folder_id).single();
  const konto = (m as Record<string, unknown>).hub_mail_accounts as Record<string, unknown>;

  let authRad: string;
  try {
    authRad = await inloggningsrad(konto, m.account_id as string, m.user_id as string);
  } catch (e) {
    return fel({ fel: String(e instanceof Error ? e.message : e).slice(0, 200) });
  }

  let c: Deno.TlsConn | null = null;
  try {
    c = await Deno.connectTls({ hostname: konto.imap_host as string, port: (konto.imap_port as number) ?? 993 });
    await las(c, "\\*", 5000);
    const inl = dec.decode(await cmd(c, "f1", authRad));
    if (!/^f1 OK/mi.test(inl)) return fel({ fel: "Inloggning nekad" }, 502);
    await cmd(c, "f2", 'SELECT "' + utf7(String(mapp?.path ?? "INBOX")).replace(/"/g, '\\"') + '"');

    // Hamta kodningen for just den har delen och sedan innehallet
    const huvudSvar = dec.decode(await cmd(c, "f3", `UID FETCH ${m.uid} (BODY.PEEK[${b.part_id}.MIME])`));
    const kodning = huvudSvar.match(/content-transfer-encoding:\s*(\S+)/i)?.[1]?.toLowerCase() ?? "";

    const raa = await cmd(c, "f4", `UID FETCH ${m.uid} (BODY.PEEK[${b.part_id}])`);
    const slut = eol(raa, 0);
    const forsta = dec.decode(raa.subarray(0, slut < 0 ? 200 : slut));
    const lit = forsta.match(/\{(\d+)\}$/);
    if (!lit) return fel({ fel: "Servern gav inget innehall" }, 502);
    const kodat = dec.decode(raa.subarray(slut + 2, slut + 2 + Number(lit[1])));

    let bytes: Uint8Array;
    if (kodning === "base64") {
      const bin = atob(kodat.replace(/\s+/g, ""));
      bytes = Uint8Array.from(bin, (x) => x.charCodeAt(0));
    } else if (kodning === "quoted-printable") {
      const s = kodat.replace(/=\r?\n/g, "").replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
      bytes = Uint8Array.from(s, (x) => x.charCodeAt(0));
    } else {
      bytes = enc.encode(kodat);
    }

    await cmd(c, "f9", "LOGOUT");
    const filnamn = encodeURIComponent(b.filename);
    return new Response(bytes, {
      headers: {
        ...CORS,
        // Alltid nedladdning, aldrig visning direkt fran vart ursprung
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${filnamn}`,
        "X-Content-Type-Options": "nosniff",
        "X-Faktisk-Typ": b.content_type,
      },
    });
  } catch (e) {
    return fel({ fel: String(e).slice(0, 200) }, 500);
  } finally {
    try { c?.close(); } catch { /* */ }
  }
});
