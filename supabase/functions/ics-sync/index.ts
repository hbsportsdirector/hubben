// Prenumerationer: kalendrar som bara finns som en lank till en .ics-fil.
//
// Lagkalendrar fran Profixio, laget.se, SportAdmin och liknande delar ut en
// webcal- eller https-lank. Hubben hamtar filen sjalv i stallet for att ga
// via Google, som uppdaterar sadana prenumerationer bara ett par ganger per
// dygn - en flyttad matchtid skulle synas forst nasta dag.
//
// Kalendern ar en vanlig rad i hub_calendars med provider "ics" och lanken
// som external_id. Den ar skrivskyddad: kallan ar sanningen, och varje
// hamtning ersatter allt som fanns. calendar-sync och calendar-push ror den
// aldrig, de fragar bara efter provider "google".
//
// Tre sorters anrop:
//   { lank, namn? }   lagg till en prenumeration och hamta den direkt
//   { kalender_id }   hamta om en
//   {}                hamta om alla (schemalaggaren gor det for alla anvandare)
//
// verify_jwt ar avstangd av samma skal som calendar-sync: schemalaggaren har
// ingen inloggning, bara cron-nyckeln. Kontrollen sker har nere.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { tolkaIcs } from "./tolka.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-hub-cron",
};
const U = Deno.env.get("SUPABASE_URL")!;
const S = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const A = Deno.env.get("SUPABASE_ANON_KEY")!;
// Samma fonster som Google-kalendrarna, sa att allt i vyn har samma djup
const BAKAT_DAGAR = 92;
const FRAMAT_DAGAR = 365;
const MAX_STORLEK = 8 * 1024 * 1024;
const admin = createClient(U, S);

/** Googles farger, i den ordning nya prenumerationer far dem. Grafit och
 *  lavendel sist - de ar for lika "Bara i Hubben" och standardfargen. */
const FARGER = ["#0b8043", "#f4511e", "#8e24aa", "#039be5", "#e67c73", "#f6bf26", "#3f51b5", "#33b679", "#d50000", "#7986cb", "#616161"];

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

/** webcal:// ar bara https:// med ett annat namn, sa att telefonen ska
 *  forsta att lanken ar en kalender. Allt annat an http(s) avvisas. */
function normaliseraLank(rå: string): string | null {
  const s = rå.trim().replace(/^webcals?:\/\//i, "https://");
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

async function hamtaFil(lank: string): Promise<string> {
  const r = await fetch(lank, {
    headers: { Accept: "text/calendar, */*;q=0.5", "User-Agent": "Hubben-kalender/1.0" },
    redirect: "follow",
    signal: AbortSignal.timeout(25000),
  });
  if (!r.ok) throw new Error(`Kallan svarade ${r.status}${r.status === 404 ? " - lanken finns inte langre" : ""}`);
  const langd = Number(r.headers.get("content-length") ?? 0);
  if (langd > MAX_STORLEK) throw new Error("Filen ar for stor");
  const text = await r.text();
  if (text.length > MAX_STORLEK) throw new Error("Filen ar for stor");
  if (!/BEGIN:VCALENDAR/i.test(text)) {
    throw new Error("Lanken ger ingen kalenderfil. Kopiera lanken som heter iCal, ics eller \"prenumerera\".");
  }
  return text;
}

type Kal = { id: string; user_id: string; external_id: string; namn: string; color: string; tidszon: string };

/** Hamtar en prenumeration och ersatter dess handelser med det filen sager. */
async function synka(kal: Kal) {
  const nu = Date.now();
  const fonster = { fran: nu - BAKAT_DAGAR * 864e5, till: nu + FRAMAT_DAGAR * 864e5 };
  try {
    const tolkat = tolkaIcs(await hamtaFil(kal.external_id), fonster, kal.tidszon || "Europe/Stockholm");

    const rader = tolkat.rader.map((r) => ({
      ...r,
      user_id: kal.user_id,
      calendar_id: kal.id,
      color: kal.color,
      installd: false,
    }));
    for (let i = 0; i < rader.length; i += 500) {
      const { error } = await admin.from("hub_events")
        .upsert(rader.slice(i, i + 500), { onConflict: "calendar_id,external_id" });
      if (error) throw new Error(error.message.slice(0, 200));
    }

    // Det som inte langre finns i filen ar struket i kallan - eller har glidit
    // ut ur fonstret. Bada ska bort har.
    const kvar = new Set(rader.map((r) => r.external_id));
    const { data: befintliga } = await admin.from("hub_events")
      .select("id, external_id").eq("calendar_id", kal.id);
    const bort = (befintliga ?? []).filter((b) => !kvar.has(b.external_id as string)).map((b) => b.id as string);
    for (let i = 0; i < bort.length; i += 200) {
      await admin.from("hub_events").delete().in("id", bort.slice(i, i + 200));
    }

    await admin.from("hub_calendars").update({
      senast_synkad: new Date().toISOString(),
      fonster_fran: new Date(fonster.fran).toISOString(),
      fonster_till: new Date(fonster.till).toISOString(),
      sista_fel: tolkat.kapat ? `Filen har fler an ${rader.length} tillfallen - resten visas inte` : null,
      ...(tolkat.tidszon ? { tidszon: tolkat.tidszon } : {}),
    }).eq("id", kal.id);
    return { kalender: kal.namn, handelser: rader.length, borttagna: bort.length, namnIFilen: tolkat.namn };
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e);
    // Handelserna fran forra lyckade hamtningen far ligga kvar. Ar kallan nere
    // en stund ar gamla matchtider battre an en tom kalender.
    await admin.from("hub_calendars").update({ sista_fel: text.slice(0, 300) }).eq("id", kal.id);
    return { kalender: kal.namn, fel: text };
  }
}

async function laggTill(userId: string, rå: string, namn: string | undefined) {
  const lank = normaliseraLank(rå);
  if (!lank) return { fel: "Det dar ser inte ut som en lank. Den ska borja med https:// eller webcal://", status: 400 };

  // Provhamta innan nagot sparas: en felklistrad lank ska ge besked direkt,
  // inte bli en tom kalender med ett fel man hittar forst senare.
  let text: string;
  try {
    text = await hamtaFil(lank);
  } catch (e) {
    return { fel: e instanceof Error ? e.message : String(e), status: 400 };
  }
  let filnamn: string | null = null;
  try {
    filnamn = tolkaIcs(text, { fran: 0, till: 0 }).namn;
  } catch {
    return { fel: "Filen gick inte att lasa som en kalender", status: 400 };
  }

  const { count } = await admin.from("hub_calendars")
    .select("id", { count: "exact", head: true }).eq("user_id", userId).eq("provider", "ics");
  const { data: kal, error } = await admin.from("hub_calendars").upsert({
    user_id: userId, provider: "ics", external_id: lank,
    namn: (namn?.trim() || filnamn || new URL(lank).hostname).slice(0, 80),
    color: FARGER[(count ?? 0) % FARGER.length],
    aktiv: true, synlig: true,
    // En lagkalender ar information, inte ett ataggande. Matcher i en hel
    // serie ska inte stanga bokningssidan - det slas pa per kalender.
    blockerar: false,
  }, { onConflict: "user_id,provider,external_id" })
    .select("id, user_id, external_id, namn, color, tidszon").single();
  if (error || !kal) return { fel: error?.message ?? "Kunde inte spara", status: 500 };

  return { tillagd: kal.id, ...(await synka(kal as Kal)) };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const svar = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
  const kropp = await req.json().catch(() => ({})) as { lank?: string; namn?: string; kalender_id?: string };

  const falt = "id, user_id, external_id, namn, color, tidszon";

  if (await arBakgrundsjobb(req)) {
    const { data } = await admin.from("hub_calendars").select(falt).eq("provider", "ics").eq("aktiv", true);
    const resultat = [];
    for (const k of (data ?? []) as Kal[]) resultat.push(await synka(k));
    return svar({ bakgrund: true, resultat });
  }

  const anv = createClient(U, A, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: { user } } = await anv.auth.getUser();
  if (!user) return svar({ fel: "Inte inloggad" }, 401);

  if (kropp.lank) {
    const ut = await laggTill(user.id, kropp.lank, kropp.namn) as Record<string, unknown>;
    const status = typeof ut.status === "number" ? ut.status as number : 200;
    delete ut.status;
    return svar(ut, status);
  }

  let fraga = admin.from("hub_calendars").select(falt)
    .eq("user_id", user.id).eq("provider", "ics").eq("aktiv", true);
  if (kropp.kalender_id) fraga = fraga.eq("id", kropp.kalender_id);
  const { data } = await fraga;
  const resultat = [];
  for (const k of (data ?? []) as Kal[]) resultat.push(await synka(k));
  return svar({ resultat });
});
