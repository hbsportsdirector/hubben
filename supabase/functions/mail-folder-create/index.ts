// Skapar en ny mapp pa mejlservern och lagger in den i hub_folders direkt,
// sa att den gar att flytta till utan att vanta pa nasta mail-folders.
//
// Var mappen hamnar bestams av servern, inte av oss: avgransaren (punkt pa
// one.com, snedstreck pa Gmail) och prefixet for egna mappar (INBOX. pa
// Courier och vissa Dovecot) lases ur LIST och NAMESPACE. Gissade vi pa
// snedstreck skulle "Kvitton/2026" bli en mapp med snedstreck i namnet pa
// one.com i stallet for en undermapp.
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
const cit = (s: string) => '"' + utf7(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const svar = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

  const anv = createClient(U, A, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: { user } } = await anv.auth.getUser();
  if (!user) return svar({ fel: "Inte inloggad" }, 401);

  const { accountId, name, parentId } = await req.json().catch(() => ({}));
  const namn = String(name ?? "").replace(/\s+/g, " ").trim();
  if (!accountId) return svar({ fel: "Konto saknas" }, 400);
  if (!namn) return svar({ fel: "Mappen behöver ett namn" }, 400);
  if (namn.length > 100) return svar({ fel: "Namnet är för långt" }, 400);
  // Styrtecken och * % ar jokertecken i LIST - de ger bara konstiga mappar
  if (/[\x00-\x1f\x7f*%]/.test(namn)) return svar({ fel: "Namnet innehåller tecken som mejlservern inte tål" }, 400);

  const { data: k } = await admin.from("hub_mail_accounts")
    .select("id, user_id, email, label, provider, imap_host, imap_port, secret_id")
    .eq("id", accountId).eq("user_id", user.id).eq("active", true).single();
  if (!k) return svar({ fel: "Kontot hittades inte" }, 404);
  if (k.provider !== "imap" && k.provider !== "outlook") return svar({ fel: "Kontot har ingen IMAP" }, 400);

  let foralder: { path: string } | null = null;
  if (parentId) {
    const { data } = await admin.from("hub_folders").select("path, account_id")
      .eq("id", parentId).eq("user_id", user.id).single();
    if (!data || data.account_id !== k.id) return svar({ fel: "Föräldermappen hittades inte" }, 404);
    foralder = data;
  }

  let c: Deno.TlsConn | null = null;
  try {
    const authRad = await inloggningsrad(k as Record<string, unknown>);
    c = await Deno.connectTls({ hostname: k.imap_host as string, port: (k.imap_port as number) ?? 993 });
    await las(c, "\\*", 5000);
    const inl = await cmd(c, "f1", authRad);
    if (!inl.ok) return svar({ fel: "Inloggning nekad" }, 502);

    // Avgransaren. LIST "" "" svarar med roten och dess avgransare utan att
    // rada upp en enda mapp.
    const rot = await cmd(c, "f2", 'LIST "" ""');
    const avgr = rot.text.match(/^\* LIST \([^)]*\) "(.)"/mi)?.[1] ?? "/";

    // Prefixet for egna mappar. Saknas NAMESPACE-stod blir det tomt, vilket
    // ar ratt for de flesta servrar.
    let prefix = "";
    if (!foralder) {
      const ns = await cmd(c, "f3", "NAMESPACE");
      if (ns.ok) prefix = ns.text.match(/^\* NAMESPACE \(\("([^"]*)"/mi)?.[1] ?? "";
    }

    if (namn.includes(avgr)) {
      return svar({ fel: `Namnet kan inte innehålla "${avgr}" på den här servern — gör en undermapp i stället` }, 400);
    }

    const path = foralder ? foralder.path + avgr + namn : prefix + namn;

    const { data: finns } = await admin.from("hub_folders").select("id")
      .eq("account_id", k.id).eq("path", path).maybeSingle();

    const skapa = await cmd(c, "f4", "CREATE " + cit(path));
    if (!skapa.ok && !/ALREADYEXISTS|already exists/i.test(skapa.text)) {
      const skal = skapa.text.match(/^f4 (?:NO|BAD) (.*)$/mi)?.[1]?.trim();
      return svar({ fel: "Servern sa nej: " + (skal || "okänt fel").slice(0, 150) }, 502);
    }
    // Utan prenumeration syns mappen inte i vissa klienter (Apple Mail,
    // Thunderbird med standardinstallning). Misslyckas det spelar det ingen
    // roll for Hubben.
    await cmd(c, "f5", "SUBSCRIBE " + cit(path));

    // UIDVALIDITY fran start, sa att forsta synken inte tror att mappen
    // bytt identitet och laser om allt fran borjan.
    const st = await cmd(c, "f6", "STATUS " + cit(path) + " (MESSAGES UNSEEN UIDVALIDITY)");
    const tal = (n: string) => { const m = st.text.match(new RegExp(n + " (\\d+)", "i")); return m ? Number(m[1]) : null; };

    const { data: rad, error } = await admin.from("hub_folders").upsert({
      user_id: k.user_id, account_id: k.id, path, name: namn,
      total_count: tal("MESSAGES") ?? 0, unseen_count: tal("UNSEEN") ?? 0,
      uidvalidity: tal("UIDVALIDITY"),
      // Skapar man en mapp som ar dold i Hubben vill man se den igen
      hidden: false,
      ...(finns ? {} : { last_uid: 0, last_synced_at: new Date().toISOString() }),
    }, { onConflict: "account_id,path" })
      .select("id, path, name, role, account_id, total_count, unseen_count, last_synced_at, hidden")
      .single();
    if (error) return svar({ fel: "Mappen skapades men kunde inte sparas: " + error.message }, 500);

    await cmd(c, "f9", "LOGOUT");
    return svar({ ok: true, mapp: rad, fanns: !!finns || !skapa.ok });
  } catch (e) {
    return svar({ fel: String(e).slice(0, 200) }, 500);
  } finally {
    try { c?.close(); } catch { /* */ }
  }
});
