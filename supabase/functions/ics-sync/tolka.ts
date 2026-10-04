// Tolkar en iCalendar-fil (.ics) till Hubbens handelserader.
//
// Ligger i en egen fil for att kunna provas utan Supabase runt omkring: den
// tar text in och ger rader ut, och ror varken natet eller databasen.
import ICAL from "npm:ical.js@2.2.1";

export type Rad = {
  external_id: string;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  series_master_id: string | null;
};

export type Tolkat = {
  namn: string | null;
  tidszon: string | null;
  rader: Rad[];
  /** Fler an TAK tillfallen i fonstret - resten slapps. */
  kapat: boolean;
};

/** Hur manga rader en enda prenumeration far bli. En hel serietabell for
 *  en sasong ar nagra hundra; det har ar bara ett skydd mot en trasig fil. */
const TAK = 5000;

/** Ar namnet en tidszon som Intl kanner till, typ "Europe/Stockholm"? */
function arIanaZon(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Hur manga millisekunder zonen ligger fore UTC vid en viss tidpunkt. */
function zonforskjutning(ms: number, tz: string) {
  const d = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(ms));
  const p = (t: string) => Number(d.find((x) => x.type === t)?.value ?? 0);
  return Date.UTC(p("year"), p("month") - 1, p("day"), p("hour"), p("minute"), p("second")) - ms;
}

/** Ett klockslag sa som det star pa vaggen i en zon, till en tidpunkt.
 *
 *  Forsta gissningen anvander zonens forskjutning vid UTC-tiden, och raknas
 *  om en gang: ligger tidpunkten pa andra sidan ett sommartidsskifte an
 *  gissningen blir det annars en timme fel. */
function vaggklocka(y: number, m: number, d: number, h: number, mi: number, s: number, tz: string) {
  const naiv = Date.UTC(y, m - 1, d, h, mi, s);
  const forsta = naiv - zonforskjutning(naiv, tz);
  return naiv - zonforskjutning(forsta, tz);
}

const tvaSiffror = (n: number) => String(n).padStart(2, "0");

/** En ICAL.Time till millisekunder.
 *
 *  ical.js raknar bara om korrekt nar filen sjalv har med en VTIMEZONE for
 *  zonen. Manga exporter skriver TZID=Europe/Stockholm utan nagon - da blir
 *  tiden "flytande" och tolkas som UTC, alltsa en eller tva timmar fel.
 *  Darfor gors omrakningen har nar zonen ar ett IANA-namn, och ical.js far
 *  bara ta de udda fallen (Windows-namn och liknande) dar filen har med sin
 *  egen definition. Saknas zon helt galler kalenderns. */
// deno-lint-ignore no-explicit-any
function tillMs(t: any, reserv: string): number {
  const tzid: string | undefined = t.timezone || t.zone?.tzid;
  if (tzid === "UTC" || tzid === "Z" || t.zone === ICAL.Timezone.utcTimezone) {
    return Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);
  }
  if (arIanaZon(tzid)) {
    return vaggklocka(t.year, t.month, t.day, t.hour, t.minute, t.second, tzid);
  }
  if (tzid && tzid !== "floating" && t.zone && t.zone.tzid !== "floating") {
    return t.toUnixTime() * 1000;
  }
  return vaggklocka(t.year, t.month, t.day, t.hour, t.minute, t.second, reserv);
}

// deno-lint-ignore no-explicit-any
function heldagsdatum(t: any) {
  return `${t.year}-${tvaSiffror(t.month)}-${tvaSiffror(t.day)}T00:00:00Z`;
}

function text(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

export function tolkaIcs(
  innehall: string,
  fonster: { fran: number; till: number },
  reservzon = "Europe/Stockholm",
): Tolkat {
  const rot = new ICAL.Component(ICAL.parse(innehall));
  const kalNamn = text(rot.getFirstPropertyValue("x-wr-calname"));
  const kalZon = text(rot.getFirstPropertyValue("x-wr-timezone"));
  const zon = arIanaZon(kalZon) ? kalZon : reservzon;

  // Filens egna zondefinitioner, for de zoner som inte ar IANA-namn
  for (const vtz of rot.getAllSubcomponents("vtimezone")) {
    try {
      ICAL.TimezoneService.register(vtz);
    } catch { /* en trasig zon far inte falla hela filen */ }
  }

  // Ett UID kan forekomma flera ganger: en gang som serie och en gang per
  // tillfalle som andrats (RECURRENCE-ID). Undantagen kopplas till serien sa
  // att de ersatter sitt tillfalle i stallet for att dyka upp dubbelt.
  // deno-lint-ignore no-explicit-any
  const serier = new Map<string, any>();
  // deno-lint-ignore no-explicit-any
  const undantag: any[] = [];
  // deno-lint-ignore no-explicit-any
  const enstaka: any[] = [];
  for (const vevent of rot.getAllSubcomponents("vevent")) {
    const e = new ICAL.Event(vevent);
    if (!e.uid || !e.startDate) continue;
    if (vevent.hasProperty("recurrence-id")) undantag.push(e);
    else if (e.isRecurring()) serier.set(e.uid, e);
    else enstaka.push(e);
  }
  const forvaldaUndantag: typeof undantag = [];
  for (const u of undantag) {
    const serie = serier.get(u.uid);
    if (serie) serie.relateException(u);
    else forvaldaUndantag.push(u);
  }

  const rader = new Map<string, Rad>();
  let kapat = false;

  // deno-lint-ignore no-explicit-any
  const lagg = (item: any, start: any, slut: any, externtId: string, serieId: string | null) => {
    if (String(item.component.getFirstPropertyValue("status") ?? "").toUpperCase() === "CANCELLED") return;
    const heldag = !!start.isDate;
    const startMs = heldag ? Date.parse(heldagsdatum(start)) : tillMs(start, zon);
    const slutMs = slut ? (heldag ? Date.parse(heldagsdatum(slut)) : tillMs(slut, zon)) : null;
    // Bada andar raknas: en flerdagarscup som borjade fore fonstret ar
    // fortfarande pagaende.
    if ((slutMs ?? startMs) < fonster.fran || startMs > fonster.till) return;
    if (rader.size >= TAK) { kapat = true; return; }
    rader.set(externtId, {
      external_id: externtId,
      title: text(item.summary) ?? "(utan titel)",
      description: text(item.description),
      location: text(item.location),
      starts_at: heldag ? heldagsdatum(start) : new Date(startMs).toISOString(),
      ends_at: slutMs != null && slutMs > startMs
        ? (heldag ? heldagsdatum(slut) : new Date(slutMs).toISOString())
        : (heldag ? new Date(startMs + 86400000).toISOString() : null),
      all_day: heldag,
      series_master_id: serieId,
    });
  };

  for (const e of [...enstaka, ...forvaldaUndantag]) {
    // Ett undantag utan sin serie far ett eget id, sa att det inte krockar
    // med en vanlig handelse som delar UID (det hander i hemmasnickrade filer).
    const id = e.isRecurrenceException()
      ? e.uid + "_" + e.recurrenceId.toString()
      : e.uid;
    lagg(e, e.startDate, e.endDate, id, null);
  }

  for (const [uid, serie] of serier) {
    const it = serie.iterator();
    // Serier utan slut finns, och ett trasigt UNTIL kan peka tusen ar fram.
    // Gransen ar langt over vad ett fonster pa femton manader rymmer.
    for (let varv = 0; varv < 3000; varv++) {
      const nasta = it.next();
      if (!nasta) break;
      const ms = nasta.isDate ? Date.parse(heldagsdatum(nasta)) : tillMs(nasta, zon);
      if (ms > fonster.till) break;
      const d = serie.getOccurrenceDetails(nasta);
      // Id:t bygger pa det URSPRUNGLIGA tillfallet, inte den flyttade tiden,
      // sa att en flytt i kallan blir en uppdatering och inte en ny rad.
      const nyckel = nasta.isDate
        ? heldagsdatum(nasta).slice(0, 10).replace(/-/g, "")
        : new Date(ms).toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
      lagg(d.item, d.startDate, d.endDate, uid + "_" + nyckel, uid);
    }
  }

  return { namn: kalNamn, tidszon: arIanaZon(kalZon) ? kalZon : null, rader: [...rader.values()], kapat };
}
