/** Tolkar fritext på svenska till datum, tid och en titel.
 *
 *  Deterministisk med flit — ingen modell, inga gissningar. Allt den hittar
 *  visas i paletten innan man trycker Enter, så man ser vad den förstod och
 *  kan skriva om. En tolk som ibland har rätt är värre än ingen tolk alls:
 *  då måste man kontrollera varenda gång ändå.
 *
 *  Regeln genom hela filen: hellre missa en tid än hitta på en. Ett ensamt
 *  tal ("10 lag") blir därför aldrig ett klockslag om det inte står "kl"
 *  framför eller direkt efter ett datumord.
 */

export interface Tolkning {
  /** Texten med datum- och tidsorden bortplockade */
  titel: string
  /** yyyy-MM-dd, satt bara om texten faktiskt innehöll ett datum */
  datum: string | null
  /** HH:mm */
  start: string | null
  slut: string | null
  /** Det som tolken kände igen, så användaren kan se vad den tog */
  hittat: string[]
}

const VECKODAGAR = [
  ['söndag', 'sondag', 'sön', 'son'],
  ['måndag', 'mandag', 'mån', 'man'],
  ['tisdag', 'tis'],
  ['onsdag', 'ons'],
  ['torsdag', 'tors', 'tor'],
  ['fredag', 'fre'],
  ['lördag', 'lordag', 'lör', 'lor'],
]

const MANADER = [
  ['januari', 'jan'], ['februari', 'feb'], ['mars', 'mar'], ['april', 'apr'],
  ['maj'], ['juni', 'jun'], ['juli', 'jul'], ['augusti', 'aug'],
  ['september', 'sep', 'sept'], ['oktober', 'okt'], ['november', 'nov'], ['december', 'dec'],
]

const tvasiffrigt = (n: number) => String(n).padStart(2, '0')
const somDatum = (d: Date) => `${d.getFullYear()}-${tvasiffrigt(d.getMonth() + 1)}-${tvasiffrigt(d.getDate())}`

function laggTillDagar(bas: Date, dagar: number) {
  const d = new Date(bas)
  d.setDate(d.getDate() + dagar)
  return d
}

/** Nästa förekomst av en veckodag. "på fredag" en fredag betyder nästa fredag,
 *  inte i dag — säger man dagens namn menar man nästan alltid nästa vecka. */
function nastaVeckodag(bas: Date, veckodag: number) {
  const steg = (veckodag - bas.getDay() + 7) % 7
  return laggTillDagar(bas, steg === 0 ? 7 : steg)
}

export function tolkaText(raa: string, nu: Date = new Date()): Tolkning {
  let text = ' ' + raa.trim() + ' '
  const hittat: string[] = []
  let datum: string | null = null
  let start: string | null = null
  let slut: string | null = null

  /** Plockar bort den träffade biten ur titeln och antecknar vad som togs. */
  const ta = (re: RegExp, etikett: string) => {
    const m = text.match(re)
    if (!m) return null
    text = text.replace(re, ' ')
    hittat.push(etikett)
    return m
  }

  // ---- Datum ----
  // Ordningen spelar roll: "övermorgon" innehåller inte "imorgon", men
  // "i morgon" med mellanslag måste testas före det lösa "morgon".
  if (ta(/\s(i\s?dag|idag)\s/i, 'idag')) {
    datum = somDatum(nu)
  } else if (ta(/\s(i\s?övermorgon|övermorgon|overmorgon)\s/i, 'i övermorgon')) {
    datum = somDatum(laggTillDagar(nu, 2))
  } else if (ta(/\s(i\s?morgon|imorgon|imorron|i\s?morron)\s/i, 'imorgon')) {
    datum = somDatum(laggTillDagar(nu, 1))
  } else if (ta(/\snästa\s+vecka\s/i, 'nästa vecka')) {
    datum = somDatum(laggTillDagar(nu, 7))
  }

  if (!datum) {
    for (let i = 0; i < VECKODAGAR.length && !datum; i++) {
      for (const form of VECKODAGAR[i]) {
        const m = ta(new RegExp(`\\s(på\\s+|nästa\\s+)?${form}(en)?\\s`, 'i'), form)
        if (m) {
          const nasta = /nästa/i.test(m[0])
          const d = nastaVeckodag(nu, i)
          datum = somDatum(nasta ? laggTillDagar(d, 7) : d)
          break
        }
      }
    }
  }

  // 2026-09-15
  if (!datum) {
    const m = ta(/\s(\d{4})-(\d{1,2})-(\d{1,2})\s/, 'datum')
    if (m) datum = `${m[1]}-${tvasiffrigt(+m[2])}-${tvasiffrigt(+m[3])}`
  }

  // 15/9 eller 15/9-26. Inte 15/9 mitt i ett ord.
  if (!datum) {
    const m = ta(/\s(\d{1,2})\/(\d{1,2})(?:[-\s](\d{2,4}))?\s/, 'datum')
    if (m) {
      const ar = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : nu.getFullYear()
      const kandidat = new Date(ar, +m[2] - 1, +m[1])
      // Datum utan år som redan passerat menas nästan alltid nästa år
      if (!m[3] && kandidat < new Date(nu.getFullYear(), nu.getMonth(), nu.getDate())) {
        kandidat.setFullYear(ar + 1)
      }
      datum = somDatum(kandidat)
    }
  }

  // "3 oktober", "15 sep"
  if (!datum) {
    for (let i = 0; i < MANADER.length && !datum; i++) {
      for (const namn of MANADER[i]) {
        const m = ta(new RegExp(`\\s(\\d{1,2})\\s+${namn}\\.?\\s`, 'i'), 'datum')
        if (m) {
          const kandidat = new Date(nu.getFullYear(), i, +m[1])
          if (kandidat < new Date(nu.getFullYear(), nu.getMonth(), nu.getDate())) {
            kandidat.setFullYear(nu.getFullYear() + 1)
          }
          datum = somDatum(kandidat)
          break
        }
      }
    }
  }

  // ---- Tid ----
  const giltig = (h: number, m: number) => h >= 0 && h <= 23 && m >= 0 && m <= 59
  const klockslag = (h: string, m?: string) => `${tvasiffrigt(+h)}:${tvasiffrigt(m ? +m : 0)}`

  // Spann först: 10-11, kl 10:00–11.30
  const spann = ta(
    /\s(?:kl\.?\s*|klockan\s*)?(\d{1,2})(?:[:.](\d{2}))?\s*[-–—]\s*(\d{1,2})(?:[:.](\d{2}))?\s/i,
    'tid',
  )
  if (spann && giltig(+spann[1], +(spann[2] ?? 0)) && giltig(+spann[3], +(spann[4] ?? 0))) {
    start = klockslag(spann[1], spann[2])
    slut = klockslag(spann[3], spann[4])
  } else if (spann) {
    // Såg ut som ett spann men var det inte — lägg tillbaka texten
    text = ' ' + (raa.trim()) + ' '
    hittat.pop()
  }

  if (!start) {
    // "kl 14", "klockan 14.30"
    const m = ta(/\s(?:kl\.?\s*|klockan\s+)(\d{1,2})(?:[:.](\d{2}))?\s/i, 'tid')
    if (m && giltig(+m[1], +(m[2] ?? 0))) start = klockslag(m[1], m[2])
  }

  if (!start) {
    // "14:30" — kolon eller punkt gör det entydigt
    const m = ta(/\s(\d{1,2})[:.](\d{2})\s/, 'tid')
    if (m && giltig(+m[1], +m[2])) start = klockslag(m[1], m[2])
  }

  if (!start && datum) {
    // Ett ensamt tal räknas som klockslag BARA när ett datum redan hittats,
    // annars blir "ring 3 leverantörer" ett möte klockan tre.
    const m = ta(/\s(\d{1,2})\s/, 'tid')
    if (m && +m[1] >= 0 && +m[1] <= 23) start = klockslag(m[1])
  }

  const titel = text.replace(/\s+/g, ' ').replace(/^[\s,;:–-]+|[\s,;:–-]+$/g, '')
  return { titel, datum, start, slut, hittat }
}

/** Kort beskrivning av det tolken förstod, för att visas bredvid förslaget. */
export function beskrivTolkning(t: Tolkning): string | null {
  if (!t.datum && !t.start) return null
  const delar: string[] = []
  if (t.datum) {
    const d = new Date(t.datum + 'T12:00:00')
    delar.push(new Intl.DateTimeFormat('sv-SE', { weekday: 'short', day: 'numeric', month: 'short' }).format(d))
  }
  if (t.start) delar.push(t.slut ? `${t.start}–${t.slut}` : t.start)
  return delar.join(' · ')
}
