// Steg 1: bygger adressen dit Per ska skickas for att godkanna kalendern.
// Atervandandet tas emot av google-oauth-callback, som inte kan krava JWT -
// Google skickar tillbaka en vanlig webblasarredirect utan var session.
// Skyddet dar ar state-strangen som signeras har.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const U = Deno.env.get("SUPABASE_URL")!;
const S = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const A = Deno.env.get("SUPABASE_ANON_KEY")!;
const enc = new TextEncoder();

const AUKTORITET = "https://accounts.google.com/o/oauth2/v2/auth";
// drive.readonly ar ett "restricted" scope. En verifierad app maste ga igenom
// en betald tredjepartsgranskning (CASA) for att fa anvanda det. Hubben ar
// inte verifierad, och behover inte bli det: appen star som In production med
// User type External, och da racker det att Per klickar forbi rutan om
// ogranskad app. Kontrollerat i Google Auth Platform 2026-08-17.
//
// Tva sifferbegransningar foljer med, och bada ar irrelevanta har: hogst 100
// anvandare far nagonsin godkanna appen (det ar 1 nu), och rutan om ogranskad
// app visas varje gang. Den sjudagarssparr pa refresh-tokens som ofta namns
// galler bara appar i Testing - INTE den har. Byt darfor aldrig tillbaka till
// Testing; det skulle gora att bade Drive och kalendern slutar fungera efter
// en vecka.
//
// Alternativet, drive.file, slipper det restricted-scopet helt men later
// Hubben se bara filer Per plockat fram i Googles egen valjare. Da vore den
// egna sokningen meningslos, och den var hela poangen.
const SCOPE = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/drive.readonly",
].join(" ");

function bas64url(b: Uint8Array) {
  let bin = "";
  for (const x of b) bin += String.fromCharCode(x);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function signera(data: string, nyckel: string) {
  const k = await crypto.subtle.importKey("raw", enc.encode(nyckel), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return bas64url(new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data))));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const svar = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

  const anv = createClient(U, A, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: { user } } = await anv.auth.getUser();
  if (!user) return svar({ fel: "Inte inloggad" }, 401);

  const admin = createClient(U, S);
  const { data: klient } = await admin.from("hub_oauth_klienter")
    .select("client_id, hemlighet_id").eq("user_id", user.id).eq("provider", "google").maybeSingle();

  if (!klient?.client_id) return svar({ fel: "Klient-ID saknas." }, 400);
  if (!klient.hemlighet_id) return svar({ fel: "Klienthemligheten saknas. Klistra in den harintill forst." }, 400);

  const nyttolast = bas64url(enc.encode(JSON.stringify({ u: user.id, e: Date.now() + 10 * 60_000 })));
  const state = nyttolast + "." + await signera(nyttolast, S);

  const url = new URL(AUKTORITET);
  url.searchParams.set("client_id", klient.client_id);
  url.searchParams.set("redirect_uri", U + "/functions/v1/google-oauth-callback");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPE);
  // access_type=offline ar det som ger ett refresh-token overhuvudtaget, och
  // prompt=consent tvingar fram ett nytt aven om Per godkant appen forr.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);

  return svar({ url: url.toString() });
});
