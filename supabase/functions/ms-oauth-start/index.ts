// Steg 1: bygger adressen dit Per skickas for att slappa in Hubben i sin
// Outlook-lada. Tvillingen till google-oauth-start.
//
// Myndigheten ar /consumers och inte /common med flit. Pers adress ar gast i
// fyra arbetsgivarkataloger, och /common later Microsoft valja vilken
// identitet inloggningen ska galla -- vilket ar precis det som gatt fel varje
// gang han forsokt. /consumers betyder "det personliga kontot, punkt".
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

const AUKTORITET = "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize";
// De delegerade behorigheterna. Per godkanner dem sjalv i inloggningsrutan --
// ingen katalogadministrator behover blandas in. Behorigheterna behover darfor
// inte heller forhandsregistreras i portalen.
const SCOPE = [
  "https://outlook.office.com/IMAP.AccessAsUser.All",
  "https://outlook.office.com/SMTP.Send",
  "offline_access",
  "openid",
  "email",
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
    .select("client_id, hemlighet_id").eq("user_id", user.id).eq("provider", "microsoft").maybeSingle();

  if (!klient?.client_id) return svar({ fel: "Klient-ID saknas." }, 400);
  if (!klient.hemlighet_id) return svar({ fel: "Klienthemligheten saknas. Klistra in den harintill forst." }, 400);

  const nyttolast = bas64url(enc.encode(JSON.stringify({ u: user.id, e: Date.now() + 10 * 60_000 })));
  const state = nyttolast + "." + await signera(nyttolast, S);

  const url = new URL(AUKTORITET);
  url.searchParams.set("client_id", klient.client_id);
  url.searchParams.set("redirect_uri", U + "/functions/v1/ms-oauth-callback");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", SCOPE);
  // Tvingar fram en ny fraga aven om appen godkants forr, sa vi sakert far
  // ett refresh-token tillbaka.
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);

  return svar({ url: url.toString() });
});
