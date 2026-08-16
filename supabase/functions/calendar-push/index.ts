// Betar av kon av andringar som ska upp till Google.
//
// Samma modell som mejlflyttarna: andringen ar redan gjord i databasen och
// syns for Per direkt. Det har ar bara att fa Google att halla med. Gar det
// fel star handelsen kvar som han lamnade den, med en markering, och kon
// forsoker igen. Ingenting hoppar tillbaka.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const U = Deno.env.get("SUPABASE_URL")!;
const S = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const A = Deno.env.get("SUPABASE_ANON_KEY")!;
const API = "https://www.googleapis.com/calendar/v3";
const PER_OMGANG = 50;
const DYGN = 86400000;

/** Fel som aldrig kan lyckas hur manga gangar vi an forsoker. Kastas de gar
 *  kon vidare i stallet for att mala samma omojlighet var femtonde minut. */
class Omojligt extends Error {}

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

const datumdel = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Googles elva handelsefarger. Utan colorId visar Google kalenderns farg, och
 *  synken skriver da tillbaka den - vilket ar precis varfor fargvaljaren aldrig
 *  gjorde nagot: 5914 rader hade exakt kalenderfarg. */
const GOOGLE_FARGER: Record<string, string> = {
  "1": "#7986cb", "2": "#33b679", "3": "#8e24aa", "4": "#e67c73",
  "5": "#f6bf26", "6": "#f4511e", "7": "#039be5", "8": "#616161",
  "9": "#3f51b5", "10": "#0b8043", "11": "#d50000",
};

/** Narmaste Google-farg, matt som avstand i RGB.
 *
 *  Valjaren erbjuder numera Googles egna farger, sa det blir nastan alltid en
 *  exakt traff. Narmaste-matchningen finns for de gamla handelserna som lagts
 *  in med Hubbens forra palett - de ska ocksa kunna fa en farg som overlever. */
function fargId(hex: string | null | undefined): string | null {
  if (!hex) return null;
  const rgb = (h: string) => {
    const v = h.replace("#", "");
    if (!/^[0-9a-fA-F]{6}$/.test(v)) return null;
    return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
  };
  const mal = rgb(hex);
  if (!mal) return null;
  let bast: string | null = null;
  let minsta = Infinity;
  for (const [id, kandidat] of Object.entries(GOOGLE_FARGER)) {
    const c = rgb(kandidat)!;
    const d = (c[0] - mal[0]) ** 2 + (c[1] - mal[1]) ** 2 + (c[2] - mal[2]) ** 2;
    if (d < minsta) { minsta = d; bast = id; }
  }
  return bast;
}

/** Klockslag och datum sett i en viss tidszon.
 *
 *  Behovs for att andra tiden pa en HEL serie. Rakna i UTC gar bra tills
 *  serien passerar sommartidsskiftet - da hamnar hostens traningar en timme
 *  fel. Google lagrar seriens tidszon, sa vi rattar oss efter den. */
function iZon(ms: number, tz: string) {
  const d = new Intl.DateTimeFormat("sv-SE", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(ms));
  const p = (t: string) => d.find((x) => x.type === t)?.value ?? "00";
  return { datum: `${p("year")}-${p("month")}-${p("day")}`, tid: `${p("hour")}:${p("minute")}` };
}

/** Heldagar ar det knepiga.
 *
 *  Google vill ha rena datum, och SLUTDATUMET AR EXKLUSIVT - en endagshandelse
 *  den 10:e ar start 2026-08-10, slut 2026-08-11.
 *
 *  Tidsatta handelser far ALLTID med sig en tidszon. Utan den avvisar Google
 *  aterkommande handelser rakt av - "Missing time zone definition for start
 *  time" - eftersom en serie inte kan expanderas utan att veta i vilken zon
 *  klockslaget galler over sommartidsskiftet.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tillGoogle(e: any, tz: string) {
  const start = Date.parse(e.starts_at);
  const gemensamt = {
    summary: e.title ?? "",
    description: e.description ?? undefined,
    location: e.location ?? undefined,
    // Utan colorId visar Google kalenderns farg och synken skriver tillbaka den
    colorId: fargId(e.color) ?? undefined,
  };
  if (e.all_day) {
    const slutRaa = e.ends_at ? Date.parse(e.ends_at) : start;
    const slut = slutRaa > start ? slutRaa : start + DYGN;
    return { ...gemensamt, start: { date: datumdel(start) }, end: { date: datumdel(slut) } };
  }
  const slutRaa = e.ends_at ? Date.parse(e.ends_at) : start + 3600000;
  const slut = slutRaa > start ? slutRaa : start + 3600000;
  return {
    ...gemensamt,
    start: { dateTime: new Date(start).toISOString(), timeZone: tz },
    end: { dateTime: new Date(slut).toISOString(), timeZone: tz },
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const svar = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

  const anv = createClient(U, A, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: { user } } = await anv.auth.getUser();
  if (!user) return svar({ fel: "Inte inloggad" }, 401);

  const admin = createClient(U, S);

  const { data: koade } = await admin.from("hub_events")
    .select("id, calendar_id, pending_till_kalender, external_id, series_master_id, rrule, title, description, location, starts_at, ends_at, all_day, color, pending_op, pending_scope, pending_forsok")
    .eq("user_id", user.id)
    .not("pending_op", "is", null)
    .lte("pending_nasta", new Date().toISOString())
    .order("pending_nasta")
    .limit(PER_OMGANG);

  if (!koade?.length) return svar({ utforda: 0, misslyckade: 0, kvar: 0, klart: true, nyaSerier: 0, flyttade: 0, problem: [] });

  const { data: rader } = await admin.rpc("hub_hamta_oauth", { p_user: user.id, p_provider: "google" });
  const klient = Array.isArray(rader) ? rader[0] : rader;
  if (!klient?.refresh_token) return svar({ fel: "Google ar inte anslutet" }, 400);

  let token: string;
  try {
    token = await nyttAccessToken(klient.client_id, klient.hemlighet, klient.refresh_token);
  } catch (e) {
    return svar({ fel: e instanceof Error ? e.message : String(e), behoverAnslutaOm: true }, 400);
  }
  const huvud = { Authorization: "Bearer " + token, "Content-Type": "application/json" };

  // Bada andarna av en flytt behovs: den kalender handelsen ligger i hos
  // Google, och den Per vill ha den i.
  const kalIds = [...new Set(koade.flatMap((e) => [e.calendar_id, e.pending_till_kalender]).filter(Boolean))];
  const { data: kalendrar } = await admin.from("hub_calendars")
    .select("id, external_id, namn, color, tidszon").in("id", kalIds as string[]);
  const kalender = new Map((kalendrar ?? []).map((k) => [k.id, k]));

  let utforda = 0;
  let nyaSerier = 0;
  let flyttade = 0;
  const problem: { handelse: string; fel: string }[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const misslyckades = async (e: any, fel: string) => {
    const n = (e.pending_forsok ?? 0) + 1;
    const minuter = [1, 5, 15, 60][Math.min(n - 1, 3)];
    await admin.from("hub_events").update({
      pending_forsok: n,
      pending_fel: String(fel).slice(0, 300),
      pending_nasta: new Date(Date.now() + minuter * 60000).toISOString(),
    }).eq("id", e.id);
    problem.push({ handelse: e.title ?? e.id, fel: String(fel).slice(0, 200) });
  };
  /** Slapper en onskan Google aldrig kan uppfylla. Kon toms, felet star kvar
   *  pa raden sa Per kan se varfor, och handelsen ligger dar den faktiskt
   *  ligger - inte dar vi hoppades att den skulle hamna. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gerUpp = async (e: any, fel: string) => {
    await admin.from("hub_events").update({
      pending_op: null, pending_scope: null, pending_till_kalender: null,
      pending_forsok: 0, pending_nasta: null, pending_fel: String(fel).slice(0, 300),
    }).eq("id", e.id);
    problem.push({ handelse: e.title ?? e.id, fel: String(fel).slice(0, 200) });
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const klar = async (e: any, patch: Record<string, unknown> = {}) => {
    await admin.from("hub_events").update({
      ...patch, pending_op: null, pending_scope: null, pending_till_kalender: null,
      pending_fel: null, pending_forsok: 0, pending_nasta: null,
    }).eq("id", e.id);
    utforda++;
  };

  for (const e of koade) {
    const kal = e.calendar_id ? kalender.get(e.calendar_id) : null;
    if (!kal) {
      await admin.from("hub_events").update({ pending_op: null, pending_scope: null, pending_till_kalender: null, pending_fel: null, pending_forsok: 0 }).eq("id", e.id);
      continue;
    }
    // Kalendern handelsen ligger i hos Google just nu. Efter en lyckad flytt
    // pekar den om, sa att andringarna i samma sparning gar till ratt adress.
    let nuvarande = kal;
    const adressen = () => API + "/calendars/" + encodeURIComponent(nuvarande.external_id) + "/events";
    const helaSerien = e.pending_scope === "serie" && !!e.series_master_id;
    const malId = helaSerien ? e.series_master_id : e.external_id;

    try {
      /* ---- Radera ---- */
      if (e.pending_op === "radera") {
        if (malId) {
          const r = await fetch(adressen() + "/" + encodeURIComponent(malId), { method: "DELETE", headers: huvud });
          if (!r.ok && r.status !== 404 && r.status !== 410) {
            const j = await r.json().catch(() => ({}));
            throw new Error(String(j.error?.message ?? r.status).slice(0, 200));
          }
        }
        if (helaSerien) {
          await admin.from("hub_events").delete()
            .eq("calendar_id", e.calendar_id).eq("series_master_id", e.series_master_id);
        } else {
          await admin.from("hub_events").delete().eq("id", e.id);
        }
        utforda++;
        continue;
      }

      /* ---- Skapa ---- */
      if (e.pending_op === "skapa" || !e.external_id) {
        const kropp: Record<string, unknown> = tillGoogle(e, nuvarande.tidszon || "Europe/Stockholm");
        if (e.rrule) kropp.recurrence = ["RRULE:" + e.rrule];
        const r = await fetch(adressen(), { method: "POST", headers: huvud, body: JSON.stringify(kropp) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.id) throw new Error(String(j.error?.message ?? r.status).slice(0, 200));

        if (e.rrule) {
          // En serie: Google svarar med MODERHANDELSEN, inte tillfallena.
          // Behaller vi den raden far vi forsta tillfallet dubbelt sa fort
          // synken hamtar hem de expanderade tillfallena. Battre att slappa
          // raden och lata synken vara enda kalla till serien.
          await admin.from("hub_events").delete().eq("id", e.id);
          nyaSerier++;
          utforda++;
        } else {
          // Fargen Google faktiskt kommer visa - inte kalenderns, som forr skrevs
          // hit och gjorde valet meningslost.
          const satt = fargId(e.color);
          await klar(e, {
            external_id: j.id, etag: j.etag ?? null,
            color: (satt && GOOGLE_FARGER[satt]) || nuvarande.color,
          });
        }
        continue;
      }

      /* ---- Byte av kalender ----
       *
       *  Det har ar INTE en vanlig andring for Google. Skickar man en PATCH
       *  med den nya kalendern i adressen traffar den ingenting alls -
       *  handelsen star kvar dar den lag, och nasta synk skriver tillbaka den
       *  gamla kalendern over Pers val. Google har ett eget anrop for saken:
       *  POST .../events/{id}/move?destination={ny}. Handelsens id foljer med
       *  oforandrat, sa etag ar det enda som behover skrivas om.
       */
      if (e.pending_till_kalender && e.pending_till_kalender !== e.calendar_id) {
        const mal = kalender.get(e.pending_till_kalender);
        if (!mal) throw new Omojligt("Malkalendern finns inte langre");
        // Google flyttar bara hela handelser. Ett enskilt tillfalle gar inte
        // att lyfta ur sin serie - hela serien maste med, eller ingen alls.
        if (e.series_master_id && !helaSerien) {
          throw new Omojligt("Google kan inte flytta ett enskilt tillfalle ur en serie till en annan kalender - valj hela serien.");
        }
        if (!malId) throw new Omojligt("Handelsen finns inte hos Google an");

        const u = adressen() + "/" + encodeURIComponent(malId) + "/move?destination=" + encodeURIComponent(mal.external_id);
        const r = await fetch(u, { method: "POST", headers: huvud });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(String(j.error?.message ?? r.status).slice(0, 200));

        // Flytten ar gjord. Skrivs calendar_id om redan har star raden ratt
        // aven om andringarna nedanfor skulle falla - och synken hittar den
        // pa ratt plats i stallet for att skapa en dubblett.
        await admin.from("hub_events").update({
          calendar_id: mal.id, pending_till_kalender: null,
          etag: j.etag ?? null, color: mal.color,
        }).eq("id", e.id);
        nuvarande = mal;
        flyttade++;

        // Serien flyttades i sin helhet - dess ovriga tillfallen ligger nu
        // ocksa i den nya kalendern hos Google.
        if (helaSerien) {
          await admin.from("hub_events").update({ calendar_id: mal.id, color: mal.color })
            .eq("calendar_id", e.calendar_id).eq("series_master_id", e.series_master_id);
        }
      }

      const tz = nuvarande.tidszon || "Europe/Stockholm";
      const bas = adressen();

      /* ---- Andra ---- */
      if (!helaSerien) {
        const r = await fetch(bas + "/" + encodeURIComponent(malId), {
          method: "PATCH", headers: huvud, body: JSON.stringify(tillGoogle(e, tz)),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(String(j.error?.message ?? r.status).slice(0, 200));
        await klar(e, { etag: j.etag ?? null });
        continue;
      }

      // Hela serien: moderhandelsen behaller SITT datum, men far det nya
      // klockslaget. Skickade vi tillfallets datum rakt in skulle hela serien
      // flytta dit i stallet for att bara byta tid.
      const mr = await fetch(bas + "/" + encodeURIComponent(malId), { headers: huvud });
      const master = await mr.json().catch(() => ({}));
      if (!mr.ok) throw new Error(String(master.error?.message ?? mr.status).slice(0, 200));

      const kropp: Record<string, unknown> = {
        summary: e.title ?? "",
        description: e.description ?? undefined,
        location: e.location ?? undefined,
      };

      if (!e.all_day && !master.start?.date) {
        const serieZon = master.start?.timeZone ?? tz;
        const masterStart = Date.parse(master.start.dateTime);
        const nyStart = Date.parse(e.starts_at);
        const langd = (e.ends_at ? Date.parse(e.ends_at) : nyStart + 3600000) - nyStart;

        const masterDel = iZon(masterStart, serieZon);
        const nyDel = iZon(nyStart, serieZon);
        kropp.start = { dateTime: `${masterDel.datum}T${nyDel.tid}:00`, timeZone: serieZon };
        const slutMs = Date.parse(`${masterDel.datum}T${nyDel.tid}:00Z`) + langd;
        const slutDel = iZon(slutMs, "UTC");
        kropp.end = { dateTime: `${slutDel.datum}T${slutDel.tid}:00`, timeZone: serieZon };
      }

      const r = await fetch(bas + "/" + encodeURIComponent(malId), {
        method: "PATCH", headers: huvud, body: JSON.stringify(kropp),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(String(j.error?.message ?? r.status).slice(0, 200));
      await klar(e, { etag: j.etag ?? null });
    } catch (fel) {
      const text = fel instanceof Error ? fel.message : String(fel);
      if (fel instanceof Omojligt) await gerUpp(e, text);
      else await misslyckades(e, text);
    }
  }

  const { count: kvar } = await admin.from("hub_events")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id).not("pending_op", "is", null);

  // nyaSerier signalerar till klienten att en hamtning behovs for att fa hem
  // de expanderade tillfallena
  return svar({ utforda, misslyckade: problem.length, kvar: kvar ?? 0, nyaSerier, flyttade, klart: koade.length < PER_OMGANG, problem });
});
