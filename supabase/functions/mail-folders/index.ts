// Speglar mappstrukturen och raknar mejl per mapp.
// Rollen (papperskorg, skickat...) tas fran serverns markning om den finns,
// annars fran mappnamnet - alla servrar markerar inte ut sina systemmappar.
//
// Tva sorters inloggning: losenord ur valvet, eller XOAUTH2 for Outlook.
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

async function inloggningsrad(k: Record<string, unknown>): Promise<string> {
  if (k.provider === "outlook") {
    const token = await msAccessToken(k.user_id as string);
    return "AUTHENTICATE XOAUTH2 " + btoa(`user=${k.email}\x01auth=Bearer ${token}\x01\x01`);
  }
  const { data: p } = await admin.rpc("hub_get_mail_secret", { p_account_id: k.id });
  if (!p) throw new Error("Inget losenord");
  return "AUTHENTICATE PLAIN " + btoa(`\0${k.email}\0${String(p).trim()}`);
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
async function las(c: Deno.TlsConn, tag: string, ms = 25000) {
  let ut = "";
  const slut = Date.now() + ms;
  const buf = new Uint8Array(65536);
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
  return await las(c, tag);
}
function avkodaUtf7(s: string): string {
  return s.replace(/&([A-Za-z0-9+,]*)-/g, (hela, b64) => {
    if (b64 === "") return "&";
    try {
      const bin = atob(b64.replace(/,/g, "/") + "===".slice((b64.length + 3) % 4));
      let ut = "";
      for (let i = 0; i + 1 < bin.length; i += 2) ut += String.fromCharCode((bin.charCodeAt(i) << 8) | bin.charCodeAt(i + 1));
      return ut;
    } catch { return hela; }
  });
}
function utf7(s: string) {
  return s.replace(/&/g, "&-").replace(/[^\x20-\x7e]+/g, (bit) => {
    let bin = "";
    for (const t of bit) { const k = t.charCodeAt(0); bin += String.fromCharCode(k >> 8, k & 255); }
    return "&" + btoa(bin).replace(/=+$/, "").replace(/\//g, ",") + "-";
  });
}

const MARKNING: Record<string, string> = {
  "\\inbox": "inbox", "\\sent": "sent", "\\drafts": "drafts",
  "\\trash": "trash", "\\junk": "junk", "\\archive": "archive", "\\all": "all",
};
const NAMN: Record<string, string> = {
  trash: "trash", papperskorg: "trash", papperskorgen: "trash", "deleted items": "trash", borttaget: "trash",
  sent: "sent", skickat: "sent", "sent items": "sent", "skickat items": "sent",
  drafts: "drafts", utkast: "drafts",
  spam: "junk", junk: "junk", "skräppost": "junk",
  archive: "archive", arkiv: "archive",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const anv = createClient(U, A, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: { user } } = await anv.auth.getUser();
  if (!user) return new Response(JSON.stringify({ fel: "Inte inloggad" }), { status: 401, headers: { ...CORS, "Content-Type": "application/json" } });

  const { data: konton } = await admin.from("hub_mail_accounts")
    .select("id, user_id, email, label, provider, imap_host, imap_port, secret_id")
    .eq("user_id", user.id).in("provider", ["imap", "outlook"]).eq("active", true).order("sort_order");

  const resultat = [];
  for (const k of konton ?? []) {
    // Outlook har aldrig nagot losenord och ska inte hoppas over av det skalet
    if (k.provider !== "outlook" && !k.secret_id) continue;
    const logg: Record<string, unknown> = { konto: k.label };
    let c: Deno.TlsConn | null = null;
    try {
      const authRad = await inloggningsrad(k as Record<string, unknown>);
      c = await Deno.connectTls({ hostname: k.imap_host as string, port: (k.imap_port as number) ?? 993 });
      await las(c, "\\*", 5000);
      const inl = await cmd(c, "c1", authRad);
      if (!/^c1 OK/mi.test(inl)) { logg.fel = "Inloggning nekad"; resultat.push(logg); continue; }

      const text = await cmd(c, "c2", 'LIST "" "*"');
      const mappar: { raa: string; path: string; name: string; role: string | null; valjbar: boolean }[] = [];
      const tagnaRoller = new Set<string>();
      for (const rad of text.split(/\r?\n/)) {
        const m = rad.match(/^\* LIST \(([^)]*)\) "?([^" ]*)"? (?:"(.+)"|(\S+))\s*$/i);
        if (!m) continue;
        const attr = (m[1] || "").toLowerCase();
        const avgr = m[2] || "/";
        const raa = m[3] ?? m[4] ?? "";
        if (!raa) continue;
        const path = avkodaUtf7(raa);
        const namn = path.split(avgr).pop() || path;
        let roll = Object.entries(MARKNING).find(([a]) => attr.includes(a))?.[1] ?? null;
        if (!roll && path.toUpperCase() === "INBOX") roll = "inbox";
        if (roll) tagnaRoller.add(roll);
        mappar.push({ raa, path, name: namn, role: roll, valjbar: !attr.includes("\\noselect") });
      }
      // Namnbaserad reserv for servrar som inte markerar ut systemmappar
      for (const mp of mappar) {
        if (mp.role) continue;
        const gissad = NAMN[mp.name.toLowerCase()];
        if (gissad && !tagnaRoller.has(gissad)) { mp.role = gissad; tagnaRoller.add(gissad); }
      }

      const rader: { path: string; antal: number | null }[] = [];
      let i = 0;
      for (const mp of mappar) {
        let antal: number | null = null, olasta: number | null = null;
        if (mp.valjbar) {
          const sv = await cmd(c, `s${i++}`, `STATUS "${utf7(mp.raa).replace(/"/g, '\\"')}" (MESSAGES UNSEEN)`);
          antal = Number(sv.match(/MESSAGES (\d+)/i)?.[1] ?? "") || 0;
          olasta = Number(sv.match(/UNSEEN (\d+)/i)?.[1] ?? "") || 0;
        }
        await admin.from("hub_folders").upsert({
          user_id: k.user_id, account_id: k.id, path: mp.path, name: mp.name,
          role: mp.role, total_count: antal, unseen_count: olasta,
        }, { onConflict: "account_id,path" });
        rader.push({ path: mp.path, antal });
      }

      logg.antal = mappar.length;
      logg.mappar = rader.map((r) => `${r.path} (${r.antal ?? "–"})`);
      logg.roller = mappar.filter((m) => m.role).map((m) => `${m.role}: ${m.path}`);
      await cmd(c, "c9", "LOGOUT");
    } catch (e) {
      logg.fel = String(e).slice(0, 200);
    } finally {
      try { c?.close(); } catch { /* */ }
    }
    resultat.push(logg);
  }
  return new Response(JSON.stringify({ resultat }, null, 2), { headers: { ...CORS, "Content-Type": "application/json" } });
});
