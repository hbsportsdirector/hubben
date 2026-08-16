// Hamtar en enskild Drive-fil sa den kan bifogas i ett mejl.
//
// Innehallet passerar bara igenom - ingenting lagras. hub_drive_filer har
// bara namn och lank, och det ska det fortsatta ha.
//
// Googles egna dokumentformat har inget innehall att ladda ner; de maste
// exporteras till nagot en mottagare kan oppna. Kalkylark blir xlsx eftersom
// mottagaren oftast vill rakna vidare i det, dokument och presentationer blir
// pdf eftersom de oftast bara ska lasas - och en pdf ser likadan ut hos alla.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const U = Deno.env.get("SUPABASE_URL")!;
const S = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const A = Deno.env.get("SUPABASE_ANON_KEY")!;
const API = "https://www.googleapis.com/drive/v3";
const admin = createClient(U, S);

// Taket ar mejlets, inte Drives. Over det blir base64-strangen sa stor att
// bade funktionen och mottagarens server borjar saga ifran - da ar en lank
// battre an en bilaga, och det sager granssnittet till om.
const MAX_BYTE = 10 * 1024 * 1024;

const EXPORT: Record<string, { mime: string; and: string }> = {
  "application/vnd.google-apps.document":
    { mime: "application/pdf", and: ".pdf" },
  "application/vnd.google-apps.presentation":
    { mime: "application/pdf", and: ".pdf" },
  "application/vnd.google-apps.drawing":
    { mime: "application/pdf", and: ".pdf" },
  "application/vnd.google-apps.spreadsheet":
    { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", and: ".xlsx" },
};

async function nyttAccessToken(clientId: string, hemlighet: string, refresh: string) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId, client_secret: hemlighet,
      refresh_token: refresh, grant_type: "refresh_token",
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    throw new Error(String(j.error_description ?? j.error ?? "Kunde inte fornya atkomsten").slice(0, 200));
  }
  return j.access_token as string;
}

/** btoa pa en hel fil spranger anropsstacken - String.fromCharCode(...bytes)
 *  skickar varje byte som ett eget argument. Darfor i bitar. */
function tillBas64(buf: ArrayBuffer) {
  const b = new Uint8Array(buf);
  let bin = "";
  const steg = 0x8000;
  for (let i = 0; i < b.length; i += steg) {
    bin += String.fromCharCode(...b.subarray(i, i + steg));
  }
  return btoa(bin);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const svar = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

  const anv = createClient(U, A, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: { user } } = await anv.auth.getUser();
  if (!user) return svar({ fel: "Inte inloggad" }, 401);

  const { fileId } = await req.json().catch(() => ({}));
  if (!fileId) return svar({ fel: "fileId saknas" }, 400);

  // Filen maste finnas i Pers eget register. Det hindrar att funktionen blir
  // ett satt att hamta godtycklig fil ur Drive med bara ett id.
  const { data: rad } = await admin.from("hub_drive_filer")
    .select("namn, mime, storlek").eq("user_id", user.id).eq("file_id", fileId).maybeSingle();
  if (!rad) return svar({ fel: "Filen finns inte i registret. Synka Drive och forsok igen." }, 404);

  const exp = rad.mime ? EXPORT[rad.mime] : undefined;
  if (!exp && rad.storlek && rad.storlek > MAX_BYTE) {
    return svar({ fel: "Filen ar storre an 10 MB. Skicka en lank i stallet." }, 413);
  }

  const { data: rader } = await admin.rpc("hub_hamta_oauth", { p_user: user.id, p_provider: "google" });
  const klient = Array.isArray(rader) ? rader[0] : rader;
  if (!klient?.refresh_token) return svar({ fel: "Google ar inte anslutet an" }, 400);

  let token: string;
  try {
    token = await nyttAccessToken(klient.client_id, klient.hemlighet, klient.refresh_token);
  } catch (e) {
    return svar({ fel: e instanceof Error ? e.message : String(e), behoverAnslutaOm: true }, 400);
  }

  const url = exp
    ? `${API}/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exp.mime)}`
    : `${API}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;

  const r = await fetch(url, { headers: { Authorization: "Bearer " + token } });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    return svar({ fel: "Drive nekade: " + t.slice(0, 200) }, 502);
  }

  const buf = await r.arrayBuffer();
  // Exporterade filer har ingen kand storlek i forvag, sa taket provas har.
  if (buf.byteLength > MAX_BYTE) {
    return svar({ fel: "Filen blev storre an 10 MB. Skicka en lank i stallet." }, 413);
  }

  const namn = exp && !rad.namn.endsWith(exp.and) ? rad.namn + exp.and : rad.namn;
  return svar({
    filename: namn,
    mimeType: exp ? exp.mime : (rad.mime ?? "application/octet-stream"),
    dataBase64: tillBas64(buf),
    bytes: buf.byteLength,
  });
});
