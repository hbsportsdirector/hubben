// Hamtar hem Google-kalendrarna.
//
// singleEvents=true later Google expandera de aterkommande serierna at oss, sa
// tisdagstraningen kommer fardigutlagd i stallet for som en upprepningsregel
// vi sjalva skulle behova tolka.
//
// Forsta gangen gors en full hamtning inom ett rullande fonster. Google lamnar
// da en nextSyncToken, och darefter fragar vi bara efter det som andrats.
// Gar tokenet ut svarar Google 410, och da borjar vi om fran borjan.
//
// Tva sorters anropare slapps in: en inloggad anvandare, eller schemalaggaren
// i databasen som visar upp den delade cron-nyckeln. Darfor ar verify_jwt
// avstangd - kontrollen sker har nere, for bakgrundsjobbet har ingen inloggad
// anvandare att lana en token av.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-hub-cron",
};
const U = Deno.env.get("SUPABASE_URL")!;
const S = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const A = Deno.env.get("SUPABASE_ANON_KEY")!;
const API = "https://www.googleapis.com/calendar/v3";
const BAKAT_DAGAR = 92;
const FRAMAT_DAGAR = 365;
const admin = createClient(U, S);

/** Stammer nyckeln schemalaggaren visar upp? Jamforelsen tar lika lang tid
 *  oavsett var den forsta skillnaden sitter. */
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

/** Googles elva handelsefarger. Satter man colorId pa en handelse visar Google
 *  den fargen i stallet for kalenderns - och det ar den vi ska spegla.
 *
 *  Forut skrev synken tillbaka kalenderfargen pa VARJE handelse vid varje varv,
 *  sa en egen farg overlevde aldrig. 5914 rader hade exakt kalenderfarg. */
const GOOGLE_FARGER: Record<string, string> = {
  "1": "#7986cb", "2": "#33b679", "3": "#8e24aa", "4": "#e67c73",
  "5": "#f6bf26", "6": "#f4511e", "7": "#039be5", "8": "#616161",
  "9": "#3f51b5", "10": "#0b8043", "11": "#d50000",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tillRad(userId: string, kalenderId: string, e: any, farg: string) {
  const heldag = !!e.start?.date;
  const start = e.start?.dateTime ?? (e.start?.date ? e.start.date + "T00:00:00Z" : null);
  const slut = e.end?.dateTime ?? (e.end?.date ? e.end.date + "T00:00:00Z" : null);
  return {
    user_id: userId,
    calendar_id: kalenderId,
    external_id: e.id as string,
    etag: e.etag ?? null,
    title: (e.summary ?? "(utan titel)") as string,
    description: e.description ?? null,
    location: e.location ?? null,
    starts_at: start,
    ends_at: slut,
    all_day: heldag,
    // Handelsens egen farg om den har en, annars kalenderns
    color: (e.colorId && GOOGLE_FARGER[String(e.colorId)]) || farg,
    series_master_id: e.recurringEventId ?? null,
    organizer: e.organizer?.email ?? null,
    installd: e.status === "cancelled",
  };
}

/** Hela synken for en anvandare. Returnerar samma form som forr. */
async function synkaAnvandare(userId: string) {
  const { data: rader } = await admin.rpc("hub_hamta_oauth", { p_user: userId, p_provider: "google" });
  const klient = Array.isArray(rader) ? rader[0] : rader;
  if (!klient?.refresh_token) return { fel: "Google ar inte anslutet an", status: 400 };

  let token: string;
  try {
    token = await nyttAccessToken(klient.client_id, klient.hemlighet, klient.refresh_token);
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e);
    await admin.from("hub_oauth_klienter").update({ sista_fel: text })
      .eq("user_id", userId).eq("provider", "google");
    return { fel: text, behoverAnslutaOm: true, status: 400 };
  }
  const huvud = { Authorization: "Bearer " + token };

  // ---- 1. Vilka kalendrar finns? ----
  const lista = await fetch(API + "/users/me/calendarList?minAccessRole=writer", { headers: huvud });
  const listaJson = await lista.json().catch(() => ({}));
  if (!lista.ok) return { fel: "Kunde inte lista kalendrarna: " + JSON.stringify(listaJson).slice(0, 200), status: 502 };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const c of (listaJson.items ?? []) as any[]) {
    await admin.from("hub_calendars").upsert({
      user_id: userId, provider: "google", external_id: c.id,
      namn: c.summaryOverride ?? c.summary ?? c.id,
      color: c.backgroundColor ?? "#6366f1",
      // Google kraver en uttalad tidszon nar vi skapar aterkommande handelser.
      // Kalenderns egen ar ratt svar - att gissa ger fel efter sommartid.
      tidszon: c.timeZone ?? "Europe/Stockholm",
    }, { onConflict: "user_id,provider,external_id", ignoreDuplicates: false });
  }

  const { data: mina } = await admin.from("hub_calendars")
    .select("id, external_id, namn, color, delta_link, aktiv")
    .eq("user_id", userId).eq("provider", "google").eq("aktiv", true);

  // ---- 2. Hamta handelserna ----
  const nu = Date.now();
  const resultat: {
    kalender: string; franGoogle: number; sparade: number; borttagna: number;
    fickSynktoken: boolean; fel?: string;
  }[] = [];

  for (const kal of mina ?? []) {
    let franGoogle = 0, sparade = 0, borttagna = 0;
    try {
      let sida: string | null = null;
      let syncToken: string | null = kal.delta_link;
      let nyttSyncToken: string | null = null;

      for (let varv = 0; varv < 40; varv++) {
        const u = new URL(API + "/calendars/" + encodeURIComponent(kal.external_id) + "/events");
        u.searchParams.set("singleEvents", "true");
        u.searchParams.set("maxResults", "250");
        u.searchParams.set("showDeleted", "true");
        if (sida) u.searchParams.set("pageToken", sida);
        else if (syncToken) u.searchParams.set("syncToken", syncToken);
        else {
          u.searchParams.set("timeMin", new Date(nu - BAKAT_DAGAR * 864e5).toISOString());
          u.searchParams.set("timeMax", new Date(nu + FRAMAT_DAGAR * 864e5).toISOString());
        }

        const r = await fetch(u.toString(), { headers: huvud });
        if (r.status === 410) {
          await admin.from("hub_calendars").update({ delta_link: null }).eq("id", kal.id);
          syncToken = null; sida = null;
          continue;
        }
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(String(j.error?.message ?? JSON.stringify(j)).slice(0, 200));

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const poster = (j.items ?? []) as any[];
        franGoogle += poster.length;

        const attSpara = [];
        for (const e of poster) {
          if (e.status === "cancelled") {
            // En flytt till en annan kalender ser ut som en avbokning HAR, i
            // kallkalendern. Ligger det nagot i kon for raden har vi sjalva
            // bett om flytten och Google har redan gjort den - da ar en
            // radering fel svar. Utan de tva villkoren forsvann handelsen helt:
            // malkalendern hamtas fore kallkalendern, sa dess ankomst hann
            // konsumeras ur synkstrommen innan raden pekade dit, och sedan
            // strok kallkalendern raden. Bada synktoken var da forbrukade, sa
            // den kom aldrig tillbaka utan en full omhamtning.
            await admin.from("hub_events").delete()
              .eq("calendar_id", kal.id).eq("external_id", e.id)
              .is("pending_op", null).is("pending_till_kalender", null);
            borttagna++;
            continue;
          }
          const rad = tillRad(userId, kal.id, e, kal.color);
          if (!rad.starts_at) continue;
          attSpara.push(rad);
        }
        if (attSpara.length) {
          const { error } = await admin.from("hub_events")
            .upsert(attSpara, { onConflict: "calendar_id,external_id" });
          if (error) throw new Error(error.message.slice(0, 200));
          sparade += attSpara.length;
        }

        sida = j.nextPageToken ?? null;
        if (j.nextSyncToken) nyttSyncToken = j.nextSyncToken;
        if (!sida) break;
      }

      await admin.from("hub_calendars").update({
        delta_link: nyttSyncToken,
        senast_synkad: new Date().toISOString(),
        fonster_fran: new Date(nu - BAKAT_DAGAR * 864e5).toISOString(),
        fonster_till: new Date(nu + FRAMAT_DAGAR * 864e5).toISOString(),
        sista_fel: null,
      }).eq("id", kal.id);

      resultat.push({ kalender: kal.namn, franGoogle, sparade, borttagna, fickSynktoken: !!nyttSyncToken });
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      await admin.from("hub_calendars").update({ sista_fel: text }).eq("id", kal.id);
      resultat.push({ kalender: kal.namn, franGoogle, sparade, borttagna, fickSynktoken: false, fel: text });
    }
  }

  return { kalendrar: (mina ?? []).length, resultat };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const svar = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

  // Bakgrundsjobbet synkar alla som anslutit Google; en inloggad anvandare
  // bara sig sjalv.
  if (await arBakgrundsjobb(req)) {
    const { data: anvandare } = await admin.from("hub_oauth_klienter")
      .select("user_id").eq("provider", "google");
    const alla = [];
    for (const a of anvandare ?? []) {
      alla.push({ user_id: a.user_id, ...(await synkaAnvandare(a.user_id as string)) });
    }
    return svar({ bakgrund: true, anvandare: alla });
  }

  const anv = createClient(U, A, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: { user } } = await anv.auth.getUser();
  if (!user) return svar({ fel: "Inte inloggad" }, 401);

  const ut = await synkaAnvandare(user.id) as Record<string, unknown>;
  const status = typeof ut.status === "number" ? ut.status as number : 200;
  delete ut.status;
  return svar(ut, status);
});
