// Steg 2: Google skickar tillbaka Per hit med en engangskod.
//
// DEN HAR FUNKTIONEN AR ENSAM OM ATT SAKNA JWT-KRAV, och det ar tvunget:
// atervandandet ar en webblasarredirect fran Google, utan var session.
// Skyddet ar state-strangen som google-oauth-start signerade med
// tjanstenyckeln. Utan giltig signatur, och innan den gatt ut, hander
// ingenting - sa adressen ar varderos for den som inte startat flodet.
//
// Funktionen ritar ingen egen sida. Supabase serverar inte var HTML som HTML,
// och en halvtrasig sida mitt i ett inloggningsflode ar det sista man vill se.
// I stallet skickas anvandaren tillbaka in i Hubben med utfallet i adressen.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const U = Deno.env.get("SUPABASE_URL")!;
const S = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOKEN = "https://oauth2.googleapis.com/token";
const HUBBEN = "https://hbsportsdirector.github.io/hubben/installningar";
const enc = new TextEncoder();

function tillbaka(status: "ok" | "fel", text?: string) {
  const u = new URL(HUBBEN);
  u.searchParams.set("kalender", status);
  if (text) u.searchParams.set("text", text.slice(0, 300));
  return new Response(null, { status: 302, headers: { Location: u.toString() } });
}

function bas64url(b: Uint8Array) {
  let bin = "";
  for (const x of b) bin += String.fromCharCode(x);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function franBas64url(s: string) {
  const p = s.replace(/-/g, "+").replace(/_/g, "/");
  return atob(p + "=".repeat((4 - (p.length % 4)) % 4));
}
async function signera(data: string, nyckel: string) {
  const k = await crypto.subtle.importKey("raw", enc.encode(nyckel), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return bas64url(new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data))));
}
/** Jamforelse som inte lacker hur langt man kom via tidtagning. */
function likaTid(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const kod = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";
  const felkod = url.searchParams.get("error");

  if (felkod) return tillbaka("fel", "Google nekade: " + felkod);
  if (!kod) return tillbaka("fel", "Google skickade tillbaka dig utan kod");

  // ---- Verifiera state innan nagot annat gors ----
  const [nyttolast, signatur] = state.split(".");
  if (!nyttolast || !signatur) return tillbaka("fel", "Atervandandet saknar giltig identifiering");
  if (!likaTid(signatur, await signera(nyttolast, S))) {
    return tillbaka("fel", "Identifieringen stammer inte. Borja om harifran.");
  }
  let userId: string;
  try {
    const p = JSON.parse(franBas64url(nyttolast));
    if (typeof p.e !== "number" || Date.now() > p.e) {
      return tillbaka("fel", "Det tog for lang tid. Anslutningen maste slutforas inom tio minuter.");
    }
    userId = String(p.u);
  } catch {
    return tillbaka("fel", "Kunde inte lasa identifieringen");
  }

  const admin = createClient(U, S);
  const { data: rader } = await admin.rpc("hub_hamta_oauth", { p_user: userId, p_provider: "google" });
  const klient = Array.isArray(rader) ? rader[0] : rader;
  if (!klient?.client_id || !klient?.hemlighet) {
    return tillbaka("fel", "Klient-ID eller hemlighet gick inte att hamta");
  }

  try {
    const svar = await fetch(TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: klient.client_id,
        client_secret: klient.hemlighet,
        code: kod,
        redirect_uri: U + "/functions/v1/google-oauth-callback",
        grant_type: "authorization_code",
      }),
    });
    const json = await svar.json().catch(() => ({}));
    if (!svar.ok || !json.refresh_token) {
      // Utan refresh_token ar anslutningen vardelos - da har access_type eller
      // prompt inte gatt fram, och det ska sagas rakt ut.
      const detalj = String(json.error_description ?? json.error ??
        (svar.ok ? "Google gav ett access-token men inget refresh-token" : svar.status)).slice(0, 300);
      await admin.from("hub_oauth_klienter").update({ sista_fel: detalj })
        .eq("user_id", userId).eq("provider", "google");
      return tillbaka("fel", detalj);
    }

    // Primarkalenderns id ar sjalva mejladressen - vi behover inget extra scope
    let konto: string | null = null;
    try {
      const r = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary", {
        headers: { Authorization: "Bearer " + json.access_token },
      });
      const c = await r.json();
      konto = c.id ?? null;
    } catch { /* inte avgorande */ }

    const { error } = await admin.rpc("hub_spara_oauth_token", {
      p_user: userId, p_provider: "google", p_token: json.refresh_token, p_konto: konto,
    });
    if (error) return tillbaka("fel", "Kunde inte spara: " + error.message);

    return tillbaka("ok", konto ?? "");
  } catch (e) {
    return tillbaka("fel", String(e).slice(0, 300));
  }
});
