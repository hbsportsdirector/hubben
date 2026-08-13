import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { format, parseISO, isToday, isYesterday } from 'date-fns'
import { sv } from 'date-fns/locale'
import { Link } from 'react-router-dom'
import { supabase, supabaseUrl, supabaseKey } from '../lib/supabase'
import { Spinner, EmptyState } from '../components/ui'
import { Bilagor, Bifoga, MAX_UTGAENDE, type UtgaendeBilaga } from '../components/Bilagor'
import { MejlTillHubben, DagensSchema } from '../components/MejlTillHubben'

/** Bygger en tsquery av det man skrivit i sökrutan.
 *
 *  Varje ord får `:*`, och det är inte en detalj — svenskan sätter ihop ord.
 *  Stammaren lämnar "träningslägret" som det är i texten men gör
 *  "träningsläg" av sökordet "träningsläger", så utan prefixmatchning möts de
 *  aldrig. Allt som kan tolkas som operator (& | ! parenteser) plockas bort;
 *  annars blir en frustrerad sökning på "!!!" ett databasfel. */
function sokTermer(rå: string): string[] {
  return rå
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s@._-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
    .map((ord) => `${ord}:*`)
}

/** Lådorna spänner över alla konton.
 *
 *  Flödet och Kvitton fanns här förut, från HEY-modellen. De togs bort
 *  2026-08-10: det som får den modellen att fungera är att posten sorteras
 *  dit automatiskt, och den sorteringen byggdes aldrig. Två tomma fack och
 *  ett moment till att göra för hand är sämre än inget.
 *
 *  Skickat och Papperskorgen är inte triage-lådor utan mappar, men de hör
 *  hemma här ändå: de har en roll som alla konton delar, så lådan kan samla
 *  ihop dem i stället för att man ska leta upp varje kontos mapp för sig. */
type Lada = 'imbox' | 'betala' | 'gallring' | 'reply_later' | 'sent' | 'trash'

const LADOR: { id: Lada; namn: string; ikon: string; tangent: string; roll?: string }[] = [
  { id: 'imbox', namn: 'Inkorg', ikon: '📥', tangent: '1' },
  { id: 'betala', namn: 'Att betala', ikon: '💳', tangent: '2' },
  { id: 'gallring', namn: 'Gallring', ikon: '🚦', tangent: '3' },
  { id: 'reply_later', namn: 'Svara senare', ikon: '↩️', tangent: '4' },
  { id: 'sent', namn: 'Skickat', ikon: '📤', tangent: '5', roll: 'sent' },
  { id: 'trash', namn: 'Papperskorgen', ikon: '🗑', tangent: '6', roll: 'trash' },
]

/** Mappar som inte är mappar. Gmail visar sina systemvyer som IMAP-mappar,
 *  men All e-post, Viktigt och Stjärnmärkta är olika sätt att titta på SAMMA
 *  post — inte separata brevlådor. [Gmail] självt är bara ett namnutrymme.
 *  Egna Gmail-etiketter ligger på toppnivå och berörs inte. */
function arVymapp(path: string, role: string | null) {
  return path === '[Gmail]' || (path.startsWith('[Gmail]/') && (role === null || role === 'all'))
}

/** Vem raden handlar om. I Skickat är avsändaren alltid en själv — där är det
 *  mottagaren som skiljer ett mejl från ett annat. */
function motpart(m: Mejl): { namn: string; adress: string; prefix: string } {
  if (m.visad_roll !== 'sent') {
    return { namn: m.from_name || m.from_email || '(okänd)', adress: m.from_email ?? '', prefix: '' }
  }
  const till = (m.to_emails ?? []).filter(Boolean)
  if (!till.length) return { namn: '(ingen mottagare)', adress: '', prefix: 'Till ' }
  const fler = till.length > 1 ? ` +${till.length - 1}` : ''
  return { namn: till[0] + fler, adress: till.slice(1).join(', '), prefix: 'Till ' }
}

interface Mejl {
  id: string
  account_id: string
  folder_id: string
  subject: string
  from_name: string | null
  from_email: string | null
  sent_at: string | null
  seen: boolean
  flagged: boolean
  reply_later: boolean
  has_attachments: boolean
  rfc_message_id: string | null
  to_emails: string[] | null
  /** Mappen mejlet visas i — köad flytt medräknad */
  visad_mapp_id: string
  /** Mappens roll: inbox, sent, trash …  */
  visad_roll: string | null
  /** Flytten ligger i kön men mejlservern vet inte om den än */
  vantar: boolean
}

interface Konto {
  id: string; label: string; color: string; email: string; signature: string
  /** Satt om kopian till Skickat misslyckades efter senaste sandningen */
  sent_kopia_fel: string | null
}
interface Mapp {
  id: string
  path: string
  name: string
  role: string | null
  account_id: string
  total_count: number | null
  unseen_count: number | null
  last_synced_at: string | null
  hidden: boolean
}

const AVATARFARGER = ['#3987e5', '#199e70', '#c98500', '#9085e9', '#e66767', '#d55181', '#d95926', '#0ea5e9']
function avatarFarg(n: string) {
  let h = 0
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0
  return AVATARFARGER[h % AVATARFARGER.length]
}
function initialer(n: string) {
  return n.split(/[\s@.]+/).filter(Boolean).map((d) => d[0]).slice(0, 2).join('').toUpperCase()
}
/** Rensar bort Outlook-villkorskommentarer och vinkelparenteser runt länkar
 *  som ofta ligger kvar i autogenererade textversioner. */
function stada(text: string | null): string {
  if (!text) return ''
  return text
    .replace(/\r\n/g, '\n')
    .replace(/<!--\[if[^\]]*\]>(<!-->)?/gi, '')
    .replace(/<!\[endif\]-->/gi, '')
    .replace(/<(https?:\/\/[^>\s]+)>/g, '$1')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Citerar originalet som i vilken mejlklient som helst. Textversionen om
 *  den finns, annars en avskalad html-version. */
function byggCitat(m: Mejl, kropp: { text_body: string | null; html_body: string | null }) {
  const raa = kropp.text_body?.trim() || (kropp.html_body ?? '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  const text = stada(raa).slice(0, 10000)
  const nar = m.sent_at ? format(parseISO(m.sent_at), "d MMMM yyyy 'kl.' HH:mm", { locale: sv }) : 'tidigare'
  const vem = m.from_name ? `${m.from_name} <${m.from_email ?? ''}>` : (m.from_email ?? 'okänd avsändare')
  const citerat = text.split('\n').map((r) => `> ${r}`).join('\n')
  return `\n\nDen ${nar} skrev ${vem}:\n${citerat}`
}

/** Vidarebefordran återger originalet med sina rubriker i stället för att
 *  citera det med `>`. Mottagaren har inte sett mejlet förut och behöver veta
 *  vem det kom från och när — det gör citatstreck till fel form. */
function byggVidare(m: Mejl, kropp: { text_body: string | null; html_body: string | null }) {
  const raa = kropp.text_body?.trim() || (kropp.html_body ?? '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  const text = stada(raa).slice(0, 20000)
  const nar = m.sent_at ? format(parseISO(m.sent_at), "d MMMM yyyy 'kl.' HH:mm", { locale: sv }) : ''
  const vem = m.from_name ? `${m.from_name} <${m.from_email ?? ''}>` : (m.from_email ?? 'okänd avsändare')
  const till = (m.to_emails ?? []).filter(Boolean).join(', ')
  const rubriker = [
    `Från: ${vem}`,
    nar && `Datum: ${nar}`,
    `Ämne: ${m.subject || '(inget ämne)'}`,
    till && `Till: ${till}`,
  ].filter(Boolean).join('\n')
  return `\n\n---------- Vidarebefordrat meddelande ----------\n${rubriker}\n\n${text}`
}

/** Draghandtaget mellan två kolumner.
 *
 *  Pekarfångst gör att draget följer med även när pekaren hamnar utanför det
 *  smala handtaget — utan den tappar man greppet så fort man rör sig snabbt. */
function Delare({ onDra }: { onDra: (dx: number) => void }) {
  const forra = useRef(0)
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onPointerDown={(e) => {
        forra.current = e.clientX
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
        onDra(e.clientX - forra.current)
        forra.current = e.clientX
      }}
      onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
      className="hidden w-1.5 shrink-0 cursor-col-resize rounded-full transition-colors hover:bg-accent/40 xl:block"
    />
  )
}

const klam = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

function visaTid(iso: string | null) {
  if (!iso) return ''
  const d = parseISO(iso)
  if (isToday(d)) return format(d, 'HH:mm')
  if (isYesterday(d)) return 'Igår'
  return format(d, 'd MMM', { locale: sv })
}

export default function Mail() {
  const [lada, setLada] = useState<Lada>('imbox')
  const [kontoFilter, setKontoFilter] = useState<string>('alla')
  const [mappFilter, setMappFilter] = useState<string | null>(null)
  // Bumpas när något utanför filtren har ändrat datan och listan måste läsas
  // om — utan att någon gammal closure får bestämma vilka filter som gäller.
  const [dataVersion, setDataVersion] = useState(0)
  const [mappSok, setMappSok] = useState('')
  const [sok, setSok] = useState('')
  const [mejl, setMejl] = useState<Mejl[]>([])
  const [konton, setKonton] = useState<Konto[]>([])
  const [mappar, setMappar] = useState<Mapp[]>([])
  const [valdId, setValdId] = useState<string | null>(null)
  const [laddar, setLaddar] = useState(true)
  const [antal, setAntal] = useState<Record<string, number>>({})
  const [synkarMapp, setSynkarMapp] = useState<string | null>(null)
  const [visaFlytt, setVisaFlytt] = useState(false)
  const [flyttar, setFlyttar] = useState(false)
  const [valda, setValda] = useState<Set<string>>(new Set())
  const [sistKlickad, setSistKlickad] = useState<number | null>(null)
  const [visaBulkFlytt, setVisaBulkFlytt] = useState(false)
  const [bulkSok, setBulkSok] = useState('')
  const [visaNytt, setVisaNytt] = useState(false)
  const [misslyckades, setMisslyckades] = useState<string | null>(null)
  const [enkelFlytt, setEnkelFlytt] = useState<Mejl | null>(null)
  const [synkar, setSynkar] = useState(false)
  const [senastSynk, setSenastSynk] = useState<string | null>(null)
  const [nyaSenast, setNyaSenast] = useState<number | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // Bara en avbetning i taget — annars slåss två omgångar om samma köposter
  const koarbetar = useRef(false)

  async function anropaFunktion(namn: string, kropp: Record<string, unknown>) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return { fel: 'Ingen session' }
    let res: Response
    try {
      res = await fetch(`${supabaseUrl}/functions/v1/${namn}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, apikey: supabaseKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(kropp),
      })
    } catch (e) {
      return { fel: `Nådde inte servern: ${e instanceof Error ? e.message : e}` }
    }
    // Ett svar som inte är JSON — timeout, för stor kropp, gateway-fel — ska
    // bli ett felmeddelande, inte ett kastat undantag som låser knappen.
    const rå = await res.text()
    try {
      return JSON.parse(rå)
    } catch {
      return { fel: `Servern svarade ${res.status} utan giltigt svar${rå.trim() ? ': ' + rå.trim().slice(0, 200) : ''}` }
    }
  }

  /** Betar av förhämtningskön omgång för omgång. Tyst i bakgrunden — går
   *  något fel får nästa synk försöka igen i stället för att störa. */
  async function forhamtaAllt() {
    for (let omgang = 0; omgang < 20; omgang++) {
      try {
        const r = await anropaFunktion('mail-prefetch', {})
        if (r?.fel || r?.klart) return
      } catch { return }
      // En omgång håller en IMAP-anslutning uppe i tiotals sekunder. Pausen
      // gör att flytt och sändning kommer fram emellan i stället för att
      // trängas med förhämtningen om kontots anslutningar.
      await new Promise((r) => setTimeout(r, 3000))
    }
  }

  /** Skickat och Papperskorgen kan innehålla mappar som aldrig hämtats — utan
   *  det här ser lådan tom ut fast servern har massor. */
  async function synkaOhamtade(roll: string) {
    const ohamtade = mappar.filter((m) => m.role === roll && !m.last_synced_at)
    if (!ohamtade.length) return
    setSynkarMapp(ohamtade[0].id)
    try {
      for (const m of ohamtade) await anropaFunktion('mail-sync', { folderId: m.id })
      await laddaMeta()
      // Inte laddaMejl() — den här funktionen har lådan från renderingen där
      // klicket skedde. Räknaren låter effekten köra om med aktuellt val.
      setDataVersion((v) => v + 1)
    } finally {
      setSynkarMapp(null)
    }
  }

  const laddaMeta = useCallback(async () => {
    const [k, m] = await Promise.all([
      supabase.from('hub_mail_accounts').select('id, label, color, email, signature, sent_kopia_fel').eq('active', true).order('sort_order'),
      supabase.from('hub_folders').select('id, path, name, role, account_id, total_count, unseen_count, last_synced_at, hidden').order('path'),
    ])
    setKonton(k.data ?? [])
    setMappar(m.data ?? [])
  }, [])

  const laddaAntal = useCallback(async () => {
    // Samma vy som listan — en definition av var ett mejl hör hemma
    const [imbox, senare, oavgjorda, betala] = await Promise.all([
      supabase.from('hub_mejl').select('*', { count: 'exact', head: true })
        .eq('seen', false).eq('reply_later', false).eq('visad_roll', 'inbox')
        .or('avsandarbeslut.eq.in,betalning.is.true'),
      supabase.from('hub_mejl').select('*', { count: 'exact', head: true }).eq('reply_later', true),
      // Gallringen räknar alla, inte bara olästa — poängen är hur mycket som
      // väntar på ett beslut, inte hur mycket du hunnit titta på
      supabase.from('hub_mejl').select('*', { count: 'exact', head: true })
        .eq('visad_roll', 'inbox').eq('avsandarbeslut', 'oavgjord').eq('betalning', false),
      supabase.from('hub_mejl').select('*', { count: 'exact', head: true })
        .eq('visad_roll', 'inbox').eq('betalning', true),
    ])
    setAntal({
      imbox: imbox.count ?? 0,
      reply_later: senare.count ?? 0,
      gallring: oavgjorda.count ?? 0,
      betala: betala.count ?? 0,
    })
  }, [])

    /** Djupet i mapphierarkin.
   *
   *  IMAP-servrar använder olika avgränsare — one.com har punkt, Gmail
   *  snedstreck — så båda räknas. INBOX-prefixet är ingen egen nivå, det är
   *  bara var mapparna råkar bo, så det plockas bort först. Annars hamnar
   *  hela Täby-trädet ett steg in i onödan. */
  const mappdjup = (path: string) =>
    (path.replace(/^INBOX[./]/, '').replace(/^\[Gmail\][./]/, '').match(/[./]/g) ?? []).length

  /** Sökvägen till mappen ovanför, eller null om det inte finns någon. */
  const foraldern = (path: string): string | null => {
    const i = Math.max(path.lastIndexOf('.'), path.lastIndexOf('/'))
    return i > 0 ? path.slice(0, i) : null
  }

  // Trädet börjar hopfällt. Trettiosju mappar utfällda är samma brus som den
  // platta listan var — poängen med nivåer är att slippa se dem alla.
  const [oppnaMappar, setOppnaMappar] = useState<Set<string>>(new Set())
  const [visaDolda, setVisaDolda] = useState(false)

  /** Döljer eller tar tillbaka en mapp. Bara i Hubben — mappen och dess mejl
   *  ligger orörda kvar på mejlservern. */
  async function vaxlaDold(m: Mapp) {
    await supabase.from('hub_folders').update({ hidden: !m.hidden }).eq('id', m.id)
    if (mappFilter === m.id) setMappFilter(null)
    await laddaMeta()
  }

  // Kolumnbredder. Sparas per webbläsare — en bredd man dragit till rätta ska
  // inte behöva dras igen imorgon.
  const [sidoBredd, setSidoBredd] = useState(() => Number(localStorage.getItem('hubben.mejl.sido')) || 208)
  const [listBredd, setListBredd] = useState(() => Number(localStorage.getItem('hubben.mejl.lista')) || 384)
  useEffect(() => { localStorage.setItem('hubben.mejl.sido', String(sidoBredd)) }, [sidoBredd])
  useEffect(() => { localStorage.setItem('hubben.mejl.lista', String(listBredd)) }, [listBredd])

  // Handtagen finns bara där trekolumnaren finns. På smalare skärmar byter
  // vyerna av varandra i stället, och då finns ingenting att dra i.
  const [brett, setBrett] = useState(() => window.matchMedia('(min-width: 1280px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1280px)')
    const lyssna = () => setBrett(mq.matches)
    mq.addEventListener('change', lyssna)
    return () => mq.removeEventListener('change', lyssna)
  }, [])

  /** Mapplistan ska visa mappar man faktiskt navigerar till. Bort med Gmails
   *  vy-mappar, och bort med dem som redan har en egen låda — annars är
   *  fyrtiosju rader mest brus runt de tio man använder. */
  const synligaMappar = useMemo(() => {
    const q = mappSok.trim().toLowerCase()
    const lador = new Set(LADOR.map((l) => l.roll).filter(Boolean))
    return mappar.filter((m) => {
      if (m.hidden && !visaDolda) return false
      if (arVymapp(m.path, m.role)) return false
      if (m.role === 'inbox' || (m.role && lador.has(m.role))) return false
      if (kontoFilter !== 'alla' && m.account_id !== kontoFilter) return false
      if (q && !m.name.toLowerCase().includes(q) && !m.path.toLowerCase().includes(q)) return false
      return true
    })
  }, [mappar, mappSok, kontoFilter, visaDolda])

  const laddaMejl = useCallback(async () => {
    // hub_mejl vet vilken mapp ett mejl visas i — även när flytten ligger kvar
    // i kön. Klienten sätter inte ihop det filtret själv längre.
    let q = supabase.from('hub_mejl')
      .select('id, account_id, folder_id, visad_mapp_id, visad_roll, subject, from_name, from_email, sent_at, seen, flagged, reply_later, has_attachments, rfc_message_id, vantar, to_emails')
      .order('sent_at', { ascending: false })
      .limit(200)

    const fraga = sok.trim()
    const rollLada = LADOR.find((l) => l.id === lada)?.roll
    if (fraga) {
      // En sökning ska hitta mejlet, inte lådan man råkar stå i. Kontofiltret
      // får däremot vara kvar — det är ett medvetet val man gjort.
    } else if (mappFilter) {
      // En vald mapp är ett eget urval. Lades lådans filter ovanpå blev
      // papperskorgen alltid tom, eftersom lådorna bara visar inkorgsmappar.
      q = q.eq('visad_mapp_id', mappFilter)
    } else if (rollLada) {
      // Skickat och Papperskorgen: alla kontons mappar med den rollen
      q = q.eq('visad_roll', rollLada)
    } else if (lada === 'reply_later') q = q.eq('reply_later', true)
    else if (lada === 'betala') {
      q = q.eq('visad_roll', 'inbox').eq('betalning', true)
    } else if (lada === 'gallring') {
      // Avsändare du aldrig tagit ställning till. Det som vill ha betalt är
      // redan förbi gallringen och ska inte ligga kvar här också.
      q = q.eq('visad_roll', 'inbox').eq('avsandarbeslut', 'oavgjord').eq('betalning', false)
    } else {
      // Inkorgen är allt som ligger i en inkorgsmapp och inte väntar på svar
      // — från någon du släppt in, ELLER något som vill ha betalt. Det andra
      // ledet är skyddsnätet: en faktura från en okänd avsändare ska aldrig
      // tystas av gallringen.
      q = q.eq('reply_later', false).eq('visad_roll', 'inbox')
        .or('avsandarbeslut.eq.in,betalning.is.true')
    }
    if (kontoFilter !== 'alla') q = q.eq('account_id', kontoFilter)

    if (fraga) {
      const termer = sokTermer(fraga)
      if (termer.length === 1) {
        // Ett ord: fritextträffen kompletteras med delsträngsökning på ämne
        // och avsändare, så "hus" hittar "Åhus" och halva adresser funkar.
        q = q.or(
          `sok.fts(swedish).${termer[0]},` +
          `subject.ilike.*${fraga}*,from_name.ilike.*${fraga}*,from_email.ilike.*${fraga}*`,
        )
      } else if (termer.length > 1) {
        q = q.textSearch('sok', termer.join(' & '), { config: 'swedish' })
      }
    }

    const { data } = await q
    // Listan byts ut på plats — ingen spinner, inget hopp
    setMejl((data ?? []) as Mejl[])
    setLaddar(false)
  }, [lada, kontoFilter, mappFilter, sok, dataVersion])

  // Länk från en uppgift: ?mejl=<id>. Mejlet kan ligga i en annan låda eller
  // mapp än den man står i, så det hämtas separat och läggs till i listan —
  // annars leder länken till en tom läsruta.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('mejl')
    if (!id) return
    window.history.replaceState({}, '', window.location.pathname)
    ;(async () => {
      const { data } = await supabase.from('hub_mejl')
        .select('id, account_id, folder_id, visad_mapp_id, visad_roll, subject, from_name, from_email, sent_at, seen, flagged, reply_later, has_attachments, rfc_message_id, vantar, to_emails')
        .eq('id', id).maybeSingle()
      if (!data) return
      setMejl((prev) => (prev.some((m) => m.id === id) ? prev : [data as Mejl, ...prev]))
      setValdId(id)
    })()
  }, [])

  useEffect(() => { laddaMeta() }, [laddaMeta])
  useEffect(() => { laddaMejl(); laddaAntal() }, [laddaMejl, laddaAntal])

  const synkaNu = useCallback(async (tyst = false) => {
    if (synkar) return
    setSynkar(true)
    if (!tyst) setNyaSenast(null)
    try {
      // Skicka upp våra egna flyttar innan vi hämtar hem något — annars kan
      // synken hinna visa mejlet i den gamla mappen igen.
      await betaAvKon()
      const res = await anropaFunktion('mail-sync', {})
      const nya = (res?.resultat ?? []).reduce((s: number, r: { nya?: number }) => s + (r.nya ?? 0), 0)
      setNyaSenast(nya)
      setSenastSynk(new Date().toISOString())
      await laddaMejl()
      await laddaAntal()
      await laddaMeta()
      // Hämta brödtexter och kartlägg bilagor i bakgrunden, så att öppna ett
      // mejl blir en databasläsning. Funktionen tar 25 åt gången och säger
      // till när den är klar — kör vidare tills kön är tom.
      forhamtaAllt()
    } finally {
      setSynkar(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [synkar, laddaMejl, laddaAntal, laddaMeta])

  // Hämta vid öppning om det var ett tag sedan, och sedan varannan minut
  useEffect(() => {
    let stoppad = false
    ;(async () => {
      const { data } = await supabase.from('hub_folders')
        .select('last_synced_at').eq('role', 'inbox').order('last_synced_at', { ascending: false }).limit(1)
      const senast = data?.[0]?.last_synced_at ?? null
      if (stoppad) return
      setSenastSynk(senast)
      const gammalt = !senast || Date.now() - new Date(senast).getTime() > 120_000
      if (gammalt) synkaNu(true)
    })()
    const timer = setInterval(() => synkaNu(true), 120_000)
    return () => { stoppad = true; clearInterval(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const vald = mejl.find((m) => m.id === valdId) ?? null

  async function uppdatera(id: string, patch: Partial<Mejl>) {
    setMejl((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)))
    await supabase.from('hub_messages').update(patch).eq('id', id)
    laddaAntal()
  }

  async function svaraSenare(m: Mejl) {
    await uppdatera(m.id, { reply_later: !m.reply_later, reply_later_at: m.reply_later ? null : new Date().toISOString() } as Partial<Mejl>)
    if (lada !== 'reply_later') setMejl((prev) => prev.filter((x) => x.id !== m.id))
  }

  // Tangentbordstriage
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || e.metaKey || e.ctrlKey) return
      const siffra = LADOR.find((l) => l.tangent === e.key)
      if (siffra) {
        setLada(siffra.id); setMappFilter(null); setValdId(null)
        if (siffra.roll) synkaOhamtade(siffra.roll)
        return
      }
      if (!mejl.length) return
      const i = mejl.findIndex((m) => m.id === valdId)
      if (e.key === 'j') { e.preventDefault(); setValdId(mejl[Math.min(i + 1, mejl.length - 1)]?.id ?? mejl[0].id) }
      if (e.key === 'k') { e.preventDefault(); setValdId(mejl[Math.max(i - 1, 0)]?.id ?? mejl[0].id) }
      if (!vald) return
      if (e.key === 'l') { e.preventDefault(); svaraSenare(vald) }
      if (e.key === '#' || e.key === 'Delete') { e.preventDefault(); flytta([vald.id], undefined, 'trash') }
      if (e.key === 'u') { e.preventDefault(); uppdatera(vald.id, { seen: !vald.seen }) }
      if (e.key === 's') { e.preventDefault(); uppdatera(vald.id, { flagged: !vald.flagged }) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const kontoAv = (id: string) => konton.find((k) => k.id === id)

  /** Klick på kryssrutan. Shift markerar hela spannet från förra klicket. */
  function vaxlaVald(index: number, shift: boolean) {
    const ny = new Set(valda)
    if (shift && sistKlickad !== null) {
      const [a, b] = [Math.min(sistKlickad, index), Math.max(sistKlickad, index)]
      const paSatt = !ny.has(mejl[index].id)
      for (let i = a; i <= b; i++) {
        if (paSatt) ny.add(mejl[i].id)
        else ny.delete(mejl[i].id)
      }
    } else {
      const id = mejl[index].id
      if (ny.has(id)) ny.delete(id)
      else ny.add(id)
    }
    setValda(ny)
    setSistKlickad(index)
  }

  /** Flytten ÄR databasskrivningen. Ett mejl, hundra mejl, samma väg — och
   *  samma väg oavsett om det korsar konton eller inte.
   *
   *  Mejlservern får veta av kön efteråt. Därför finns här inget att ångra,
   *  ingen sparad lista att lägga tillbaka och ingen väntan på IMAP. */
  async function flytta(ids: string[], mappId?: string, roll?: string) {
    if (!ids.length) return
    const { data, error } = await supabase.rpc('hub_flytta', {
      p_msg_ids: ids,
      p_mal_mapp: mappId ?? null,
      p_mal_roll: roll ?? null,
    })
    if (error) {
      setMisslyckades(error.message)
      setTimeout(() => setMisslyckades(null), 8000)
      return
    }

    if (valdId && ids.includes(valdId)) {
      const i = mejl.findIndex((x) => x.id === valdId)
      setValdId(mejl.slice(i + 1).find((x) => !ids.includes(x.id))?.id ?? null)
    }
    setValda(new Set())
    await laddaMejl()
    await laddaAntal()

    const hoppade = (data as { hoppade?: number } | null)?.hoppade ?? 0
    if (hoppade) {
      setMisslyckades(hoppade === ids.length ? 'Låg redan där.' : `${hoppade} låg redan där.`)
      setTimeout(() => setMisslyckades(null), 5000)
    }
    betaAvKon()
  }

  /** Skickar kön vidare till mejlservern. Går det fel står mejlen kvar där
   *  du lade dem, med en markering — kön försöker igen av sig själv. */
  async function betaAvKon() {
    if (koarbetar.current) return
    koarbetar.current = true
    try {
      for (let omgang = 0; omgang < 10; omgang++) {
        const r = await anropaFunktion('mail-drain', {})
        await laddaMejl()
        if (r?.problem?.length) {
          setMisslyckades(r.problem.map((p: { fel: string }) => p.fel).join(' · '))
          setTimeout(() => setMisslyckades(null), 12000)
        }
        if (r?.fel || r?.klart) return
      }
    } catch { /* nästa gång */ } finally {
      koarbetar.current = false
    }
  }

  async function bulkUppdatera(patch: Partial<Mejl>) {
    const ids = [...valda]
    setMejl((prev) => prev.map((m) => (valda.has(m.id) ? { ...m, ...patch } : m)))
    await supabase.from('hub_messages').update(patch).in('id', ids)
    setValda(new Set())
    laddaMejl(); laddaAntal()
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold tracking-tight">Mejl</h1>

        <button
          onClick={() => setVisaNytt(true)}
          className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-soft"
        >
          ✏️ Skriv nytt
        </button>

        <button
          onClick={() => synkaNu(false)}
          disabled={synkar}
          className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-card-hover hover:text-ink disabled:opacity-60"
          title={senastSynk ? `Senast hämtat ${format(parseISO(senastSynk), 'HH:mm', { locale: sv })}` : 'Aldrig hämtat'}
        >
          <span className={synkar ? 'inline-block animate-spin' : ''} aria-hidden>↻</span>
          {synkar ? 'Hämtar…' : 'Hämta nya'}
        </button>

        {nyaSenast !== null && !synkar && (
          <span className={`text-xs ${nyaSenast > 0 ? 'text-good' : 'text-muted'}`}>
            {nyaSenast > 0 ? `+${nyaSenast} nya` : 'Inget nytt'}
          </span>
        )}

        <div className="relative min-w-56 flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">🔍</span>
          <input
            value={sok}
            onChange={(e) => setSok(e.target.value)}
            placeholder="Sök i ämne, avsändare och innehåll…"
            className="w-full rounded-xl border border-border bg-surface py-2 pl-9 pr-3 text-sm text-ink outline-none transition-colors placeholder:text-muted/60 focus:border-accent"
          />
        </div>

        {antal.gallring > 0 && (
          <Link
            to="/gallring"
            className="flex items-center gap-1.5 rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-sm font-medium text-warn transition-colors hover:bg-warn/20"
          >
            🚦 Städa avsändare
            <span className="rounded-full bg-warn/20 px-1.5 text-xs">{antal.gallring}</span>
          </Link>
        )}
      </div>

      {/* Kontovalet på egen rad högst upp. Det låg i sidokolumnen, men den
          finns bara från xl — och vilket konto man tittar i är ett val man
          gör ofta, inte något man letar rätt på. */}
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
        <button
          onClick={() => { setKontoFilter('alla'); setValdId(null) }}
          className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] transition-colors ${
            kontoFilter === 'alla'
              ? 'border-accent bg-accent/15 font-medium text-accent-soft'
              : 'border-border text-muted hover:bg-card-hover hover:text-ink'
          }`}
        >
          <span className="h-2 w-2 shrink-0 rounded-full bg-muted" />
          Alla konton
        </button>
        {konton.map((k) => (
          <button
            key={k.id}
            onClick={() => { setKontoFilter(k.id); setValdId(null) }}
            className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] transition-colors ${
              kontoFilter === k.id
                ? 'border-accent bg-accent/15 font-medium text-accent-soft'
                : 'border-border text-muted hover:bg-card-hover hover:text-ink'
            }`}
          >
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: k.color }} />
            {k.label}
          </button>
        ))}
      </div>

      {/* Sidokolumnen finns först från xl. På smalare skärmar flyttar dagens
          schema och lådorna upp hit, så man kommer åt dem i telefonen. */}
      <div className="space-y-2 xl:hidden">
        <DagensSchema />
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
          {LADOR.map((l) => (
            <button
              key={l.id}
              onClick={() => {
                setLada(l.id); setMappFilter(null); setValdId(null)
                if (l.roll) synkaOhamtade(l.roll)
              }}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] transition-colors ${
                lada === l.id && !mappFilter
                  ? 'border-accent bg-accent/15 font-medium text-accent-soft'
                  : 'border-border text-muted hover:bg-card-hover hover:text-ink'
              }`}
            >
              <span aria-hidden>{l.ikon}</span>
              {l.namn}
              {antal[l.id] > 0 && <span className="text-[11px] font-semibold">{antal[l.id]}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="flex h-[calc(100dvh-22rem)] gap-3 sm:h-[calc(100dvh-20rem)] xl:h-[calc(100vh-11.5rem)]">
        {/* Lådor, konton och mappar */}
        <aside
          style={brett ? { width: sidoBredd } : undefined}
          className="hidden shrink-0 flex-col gap-4 overflow-y-auto rounded-2xl border border-border bg-card p-3 xl:flex"
        >
          <DagensSchema />

          <div>
            <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted">Lådor</p>
            {LADOR.map((l) => (
              <button
                key={l.id}
                onClick={() => {
                  setLada(l.id); setMappFilter(null); setValdId(null)
                  if (l.roll) synkaOhamtade(l.roll)
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors ${
                  lada === l.id && !mappFilter ? 'bg-accent/15 font-medium text-accent-soft' : 'text-muted hover:bg-card-hover hover:text-ink'
                }`}
              >
                <span aria-hidden>{l.ikon}</span>
                <span className="flex-1 truncate">{l.namn}</span>
                {antal[l.id] > 0 && <span className="text-[11px] font-semibold">{antal[l.id]}</span>}
                <kbd className="text-[9px] text-muted/50">{l.tangent}</kbd>
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1">
            <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
              Mappar ({synligaMappar.length})
            </p>
            {mappar.length > 12 && (
              <input
                value={mappSok}
                onChange={(e) => setMappSok(e.target.value)}
                placeholder="Filtrera mappar…"
                className="mb-1.5 w-full rounded-lg border border-border bg-surface px-2 py-1 text-[12px] text-ink outline-none placeholder:text-muted/60 focus:border-accent"
              />
            )}
            <div className="max-h-[46vh] overflow-y-auto">
              {konton.map((k) => {
                const kontotsMappar = synligaMappar.filter((m) => m.account_id === k.id)
                if (!kontotsMappar.length) return null
                const vagar = new Set(kontotsMappar.map((x) => x.path))
                return (
                  <div key={k.id} className="mb-2">
                    {/* Kontot syns med sin färg, så man vet vems mapp man väljer */}
                    <p className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-medium text-muted">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: k.color }} />
                      {k.label}
                    </p>
                    {kontotsMappar.map((m) => {
                      // Djupet räknas bara på förfäder som faktiskt syns. En
                      // mapp vars förälder är dold — Deleted ligger i en låda —
                      // hör hemma längst ut, annars ser den ut att tillhöra
                      // grannen ovanför.
                      const djup = (() => {
                        let d = 0
                        let p = foraldern(m.path)
                        while (p) { if (vagar.has(p)) d++; p = foraldern(p) }
                        return d
                      })()
                      const harBarn = kontotsMappar.some((x) => foraldern(x.path) === m.path)
                      const oppen = oppnaMappar.has(m.path)
                      // En mapp göms om någon förälder är hopfälld. Söker man
                      // visas allt — då är det träffarna man vill åt, inte
                      // trädet.
                      if (!mappSok.trim()) {
                        let p = foraldern(m.path)
                        let dold = false
                        while (p && !dold) {
                          if (vagar.has(p) && !oppnaMappar.has(p)) dold = true
                          p = foraldern(p)
                        }
                        if (dold) return null
                      }
                      return (
                        <div
                          key={m.id}
                          style={{ paddingLeft: `${0.25 + djup * 0.8}rem` }}
                          className={`group/mapp flex items-center rounded-lg pr-1 text-[12px] transition-colors ${
                            mappFilter === m.id ? 'bg-accent/15 font-medium text-accent-soft' : 'text-muted hover:bg-card-hover hover:text-ink'
                          }`}
                        >
                          {/* Pilen fäller ut och väljer inte mappen. Två saker
                              på samma rad behöver två träffytor. */}
                          {harBarn ? (
                            <button
                              onClick={() => setOppnaMappar((f) => {
                                const n = new Set(f)
                                if (n.has(m.path)) n.delete(m.path); else n.add(m.path)
                                return n
                              })}
                              aria-label={oppen ? `Fäll ihop ${m.name}` : `Fäll ut ${m.name}`}
                              aria-expanded={oppen}
                              className="shrink-0 px-1 py-1 text-[10px] text-muted/70 hover:text-ink"
                            >
                              {oppen ? '▾' : '▸'}
                            </button>
                          ) : (
                            <span className="w-[1.1rem] shrink-0" aria-hidden />
                          )}
                          <button
                            onClick={async () => {
                              setMappFilter(m.id); setValdId(null)
                              // Lat synk: hämta mappen första gången den öppnas
                              if (!m.last_synced_at) {
                                setSynkarMapp(m.id)
                                await anropaFunktion('mail-sync', { folderId: m.id })
                                await laddaMeta()
                                // Inte laddaMejl() här: den funktionen kommer från
                                // renderingen där klicket skedde och har fortfarande
                                // det FÖRRA mappvalet, så den skulle skriva över
                                // listan med fel mapps innehåll. Räknaren får effekten
                                // att köra om frågan med aktuellt val i stället.
                                setDataVersion((v) => v + 1)
                                setSynkarMapp(null)
                              }
                            }}
                            title={m.path}
                            className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left"
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate">{m.name}</span>
                              {/* Drar man ut kolumnen ska den extra bredden
                                  användas till något. Här: var mappen hör
                                  hemma, så man ser skillnad på två som heter
                                  samma sak i olika grenar. */}
                              {brett && sidoBredd > 300 && foraldern(m.path) && (
                                <span className="block truncate text-[10px] text-muted/50">
                                  {m.path
                                    .replace(/^INBOX[./]/, '')
                                    .split(/[./]/)
                                    .slice(0, -1)
                                    .join(' › ')}
                                </span>
                              )}
                            </span>
                            {synkarMapp === m.id
                              ? <span className="ml-auto shrink-0 text-[10px] text-accent-soft">hämtar…</span>
                              : (m.total_count ?? 0) > 0 && <span className="ml-auto shrink-0 text-[10px] text-muted/70">{m.total_count}</span>}
                          </button>
                          {/* Döljer bara i Hubben. Mappen och mejlen ligger
                              orörda kvar på mejlservern. */}
                          <button
                            onClick={() => vaxlaDold(m)}
                            title={m.hidden ? 'Visa igen' : 'Dölj i Hubben'}
                            aria-label={m.hidden ? `Visa ${m.name}` : `Dölj ${m.name}`}
                            className="shrink-0 px-1 py-1 text-[11px] text-muted/0 transition-colors group-hover/mapp:text-muted/60 hover:!text-ink"
                          >
                            {m.hidden ? '↩' : '✕'}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
              {synligaMappar.length === 0 && (
                <p className="px-2 py-3 text-[11px] text-muted">Inga mappar matchar.</p>
              )}
              {(visaDolda || mappar.some((m) => m.hidden)) && (
                <button
                  onClick={() => setVisaDolda((v) => !v)}
                  className="mt-1 w-full px-2 py-1.5 text-left text-[11px] text-muted/70 transition-colors hover:text-ink"
                >
                  {visaDolda
                    ? '▾ Döljer de dolda igen'
                    : `▸ ${mappar.filter((m) => m.hidden).length} dolda mappar`}
                </button>
              )}
            </div>
          </div>
        </aside>

        {/* Lista. Ryms bara en kolumn åt gången lämnar listan plats åt
            läsrutan när man öppnat ett mejl — som i vilken telefonklient
            som helst. */}
        <Delare onDra={(dx) => setSidoBredd((b) => klam(b + dx, 150, 460))} />

        <div
          style={brett ? { width: listBredd } : undefined}
          className={`w-full shrink-0 flex-col overflow-hidden rounded-2xl border border-border bg-card lg:flex lg:w-88 ${
            vald ? 'hidden' : 'flex'
          }`}
        >
          {/* Åtgärdsrad när något är markerat */}
          {valda.size > 0 && (
            <div className="relative flex flex-wrap items-center gap-1 border-b border-border bg-accent/10 px-2 py-2">
              <span className="px-1 text-xs font-semibold text-accent-soft">{valda.size} markerade</span>
              <button
                onClick={() => { setVisaBulkFlytt(!visaBulkFlytt); setBulkSok('') }}
                className="rounded-lg px-2 py-1 text-xs font-medium text-muted hover:bg-card-hover hover:text-ink"
              >
                📁 Flytta
              </button>
              <button
                onClick={() => bulkUppdatera({ reply_later: true, reply_later_at: new Date().toISOString() } as Partial<Mejl>)}
                className="rounded-lg px-2 py-1 text-xs font-medium text-muted hover:bg-card-hover hover:text-ink"
              >
                ↩️ Svara senare
              </button>
              <button
                onClick={() => bulkUppdatera({ seen: true })}
                className="rounded-lg px-2 py-1 text-xs font-medium text-muted hover:bg-card-hover hover:text-ink"
              >
                Markera läst
              </button>
              <button onClick={() => setValda(new Set())} className="ml-auto rounded-lg px-2 py-1 text-xs text-muted hover:text-ink">
                Avmarkera
              </button>

              {/* Dialogen ligger utanför listan — se FlyttaDialog nedan */}
            </div>
          )}

          <div ref={listRef} className="flex-1 overflow-y-auto">
            {laddar ? <Spinner /> : mejl.length === 0 ? (
              <EmptyState emoji="✨" text={sok ? 'Inga träffar.' : 'Tomt här.'} />
            ) : (
              mejl.map((m, index) => {
                // I Skickat ar det mottagaren som ska sta har, inte jag sjalv
                const part = motpart(m)
                const namn = part.namn
                const konto = kontoAv(m.account_id)
                const markerad = valda.has(m.id)
                return (
                  <div
                    key={m.id}
                    className={`group/rad flex w-full items-start gap-2 border-l-2 border-b border-b-border/50 pl-2 pr-3 py-3 transition-colors ${
                      markerad ? 'border-l-accent bg-accent/15'
                        : valdId === m.id ? 'border-l-accent bg-accent/10' : 'border-l-transparent hover:bg-card-hover'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={markerad}
                      onChange={() => { /* hanteras i onClick för att fånga shift */ }}
                      onClick={(e) => { e.stopPropagation(); vaxlaVald(index, e.shiftKey) }}
                      aria-label={`Markera mejl från ${namn}`}
                      className={`mt-3 h-3.5 w-3.5 shrink-0 cursor-pointer accent-(--color-accent) transition-opacity ${
                        valda.size > 0 ? 'opacity-100' : 'opacity-0 group-hover/rad:opacity-100'
                      }`}
                    />
                  <button
                    onClick={() => { setValdId(m.id); if (!m.seen) uppdatera(m.id, { seen: true }) }}
                    className="flex min-w-0 flex-1 gap-3 text-left"
                  >
                    <span className="relative shrink-0">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ background: avatarFarg(namn) }}>
                        {initialer(namn)}
                      </span>
                      {konto && (
                        <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card" style={{ background: konto.color }} title={konto.label} />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={`truncate text-[13px] ${!m.seen ? 'font-semibold text-ink' : 'text-muted'}`}>
                          {part.prefix && <span className="text-muted/60">{part.prefix}</span>}
                          {namn}
                        </span>
                        <span className="shrink-0 text-[11px] text-muted">{visaTid(m.sent_at)}</span>
                      </span>
                      <span className={`mt-0.5 flex items-center gap-1.5 truncate text-[13px] ${!m.seen ? 'font-medium text-ink' : 'text-muted'}`}>
                        {m.flagged && <span className="shrink-0 text-[11px]">⭐</span>}
                        {m.reply_later && <span className="shrink-0 text-[11px]">↩️</span>}
                        <span className="truncate">{m.subject || '(inget ämne)'}</span>
                        {m.vantar && (
                          <span className="ml-auto shrink-0 text-[11px] text-warn" title="Flyttad — väntar på mejlservern">⏱</span>
                        )}
                        {m.has_attachments && <span className={`shrink-0 text-[11px] text-muted ${m.vantar ? '' : 'ml-auto'}`} title="Har bilagor">📎</span>}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted/70">{part.adress || (part.prefix ? '' : m.from_email)}</span>
                    </span>
                  </button>
                  </div>
                )
              })
            )}
          </div>
          <p className="hidden border-t border-border px-3 py-2 text-[10px] text-muted lg:block">
            <kbd className="rounded border border-border bg-surface px-1">J</kbd>/<kbd className="rounded border border-border bg-surface px-1">K</kbd> bläddra ·
            <kbd className="ml-1 rounded border border-border bg-surface px-1">L</kbd> svara senare ·
            <kbd className="ml-1 rounded border border-border bg-surface px-1">Z</kbd> skjut upp ·
            <kbd className="ml-1 rounded border border-border bg-surface px-1">S</kbd> stjärna
          </p>
        </div>

        <Delare onDra={(dx) => setListBredd((b) => klam(b + dx, 260, 760))} />

        {/* Läsruta */}
        <div className={`min-w-0 flex-1 overflow-hidden rounded-2xl border border-border bg-card lg:block ${
          vald ? 'block' : 'hidden'
        }`}>
          {vald ? (
            <Lasruta
              onTillbaka={() => setValdId(null)}
              mejl={vald}
              konto={kontoAv(vald.account_id)}
              mappar={mappar.filter((m) => m.id !== vald.folder_id)}
              konton={konton}
              visaFlytt={visaFlytt}
              setVisaFlytt={(v) => { setVisaFlytt(false); if (v) setEnkelFlytt(vald) }}
              flyttar={flyttar}
              onFlytta={(mappId) => { setVisaFlytt(false); flytta([vald.id], mappId) }}
              onRadera={() => flytta([vald.id], undefined, 'trash')}
              onSkicka={async (kropp) => {
                // inReplyToId sätter In-Reply-To och References. Det hör hemma
                // i ett svar, inte i en vidarebefordran.
                const { vidarebefordran, ...rest } = kropp as Record<string, unknown>
                const svar = await anropaFunktion('mail-send',
                  vidarebefordran ? rest : { ...rest, inReplyToId: vald.id })
                if (svar?.fel) return { fel: svar.fel as string }
                uppdatera(vald.id, { reply_later: false } as Partial<Mejl>)
                setTimeout(() => laddaMeta(), 8000) // kopian till Skickat gors i bakgrunden
                return { ok: true }
              }}
              onSvaraSenare={() => svaraSenare(vald)}
              onStjarna={() => uppdatera(vald.id, { flagged: !vald.flagged })}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <EmptyState emoji="✉️" text="Välj ett mejl" />
            </div>
          )}
        </div>
      </div>

      <FlyttaDialog
        open={visaBulkFlytt}
        onClose={() => setVisaBulkFlytt(false)}
        antal={valda.size}
        mappar={mappar}
        konton={konton}
        msgIds={[...valda]}
        franKonto={mejl.find((m) => valda.has(m.id))?.account_id}
        onValj={(mappId) => { setVisaBulkFlytt(false); flytta([...valda], mappId) }}
      />

      <FlyttaDialog
        open={!!enkelFlytt}
        onClose={() => setEnkelFlytt(null)}
        antal={1}
        mappar={mappar.filter((m) => m.id !== enkelFlytt?.visad_mapp_id)}
        konton={konton}
        msgIds={enkelFlytt ? [enkelFlytt.id] : []}
        franKonto={enkelFlytt?.account_id}
        onValj={(mappId) => {
          const m = enkelFlytt
          setEnkelFlytt(null)
          if (m) flytta([m.id], mappId)
        }}
      />

      {misslyckades && (
        <div className="fixed bottom-4 right-4 z-50 max-w-sm rounded-xl border border-bad/40 bg-card px-4 py-3 shadow-2xl">
          <p className="text-sm font-medium text-bad">Mejlservern krånglade</p>
          <p className="mt-1 text-xs text-muted">{misslyckades}</p>
          <p className="mt-1 text-xs text-muted">
            Mejlet ligger kvar där du lade det och kön försöker igen av sig själv.
          </p>
        </div>
      )}

      <NyttMejl
        open={visaNytt}
        onClose={() => setVisaNytt(false)}
        konton={konton}
        forvaltKonto={kontoFilter !== 'alla' ? kontoFilter : konton[0]?.id}
        onSkicka={async (kropp) => {
          const svar = await anropaFunktion('mail-send', kropp)
          // Kopian till Skickat görs efter svaret — kolla utfallet strax efteråt
          if (!svar?.fel) setTimeout(() => laddaMeta(), 8000)
          return svar
        }}
      />

      {/* Kopian till Skickat gjordes i bakgrunden och gick fel. Ingen väntade
          på den, så den får säga till här i stället. */}
      {konton.filter((k) => k.sent_kopia_fel).map((k) => (
        <div key={k.id} className="fixed bottom-4 left-4 z-50 max-w-sm rounded-xl border border-warn/40 bg-card px-4 py-3 shadow-2xl">
          <p className="text-sm font-medium text-warn">Mejlet skickades, men inte kopian</p>
          <p className="mt-1 text-xs text-muted">
            {k.label}: {k.sent_kopia_fel}
          </p>
          <p className="mt-1 text-xs text-muted">
            Mottagaren har fått mejlet — det saknas bara i din Skickat-mapp.
          </p>
          <button
            onClick={async () => {
              await supabase.from('hub_mail_accounts').update({ sent_kopia_fel: null }).eq('id', k.id)
              laddaMeta()
            }}
            className="mt-2 rounded-lg border border-border px-2 py-1 text-xs text-muted hover:text-ink"
          >
            Uppfattat
          </button>
        </div>
      ))}
    </div>
  )
}

interface Forslag { folder_id: string; path: string; name: string; account_id: string; traffar: number; anledning: string }

/** Flyttdialog: stor yta, förslag överst, tangentbordsnavigering. */
function FlyttaDialog({ open, onClose, antal, mappar, konton, msgIds, franKonto, onValj }: {
  open: boolean
  onClose: () => void
  antal: number
  mappar: Mapp[]
  konton: Konto[]
  msgIds: string[]
  franKonto?: string
  onValj: (mappId: string) => void
}) {
  const [sok, setSok] = useState('')
  const [forslag, setForslag] = useState<Forslag[]>([])
  const [markerad, setMarkerad] = useState(0)

  useEffect(() => {
    if (!open) return
    setSok(''); setMarkerad(0); setForslag([])
    supabase.rpc('hub_forslag_mapp', { p_msg_ids: msgIds }).then(({ data }) => setForslag((data ?? []) as Forslag[]))
  }, [open, msgIds])

  const traffar = mappar.filter((m) => {
    const q = sok.toLowerCase().trim()
    return !q || m.path.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)
  })

  if (!open) return null

  const kortNamn = (p: string) => p.replace(/^INBOX[./]/, '').replace(/^\[Gmail\]\//, '')
  // Kontot mejlen ligger på hamnar först — flytt dit är den snabba, enkla vägen
  const perKonto = konton
    .map((k) => ({ konto: k, mappar: traffar.filter((m) => m.account_id === k.id) }))
    .filter((g) => g.mappar.length)
    .sort((a, b) => Number(b.konto.id === franKonto) - Number(a.konto.id === franKonto))

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[6vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="relative z-10 flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h3 className="font-semibold">Flytta {antal} {antal === 1 ? 'mejl' : 'mejl'} till…</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-muted hover:bg-card-hover hover:text-ink" aria-label="Stäng">✕</button>
        </div>

        <input
          autoFocus
          value={sok}
          onChange={(e) => { setSok(e.target.value); setMarkerad(0) }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setMarkerad((i) => Math.min(i + 1, traffar.length - 1)) }
            if (e.key === 'ArrowUp') { e.preventDefault(); setMarkerad((i) => Math.max(i - 1, 0)) }
            if (e.key === 'Enter' && traffar[markerad]) onValj(traffar[markerad].id)
            if (e.key === 'Escape') onClose()
          }}
          placeholder="Skriv för att söka bland dina mappar…"
          className="w-full border-b border-border bg-transparent px-5 py-3 text-sm text-ink outline-none placeholder:text-muted/60"
        />

        <div className="flex-1 overflow-y-auto p-4">
          {forslag.length > 0 && !sok && (
            <div className="mb-5">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">Föreslagna</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {forslag.map((f) => {
                  const mk = konton.find((k) => k.id === f.account_id)
                  return (
                    <button
                      key={f.folder_id}
                      onClick={() => onValj(f.folder_id)}
                      className="flex items-start gap-2.5 rounded-xl border border-accent/30 bg-accent/10 px-3 py-2.5 text-left transition-colors hover:bg-accent/20"
                    >
                      <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: mk?.color ?? '#8b95ad' }} />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-ink">{kortNamn(f.path)}</span>
                        <span className="block truncate text-[11px] text-muted">{f.anledning}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {perKonto.map((g) => (
            <div key={g.konto.id} className="mb-5">
              <p className="mb-2 flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
                <span className="h-2 w-2 rounded-full" style={{ background: g.konto.color }} />
                {g.konto.label}
                {franKonto && g.konto.id !== franKonto && (
                  <span className="rounded-full bg-warn/15 px-2 py-0.5 normal-case tracking-normal text-warn">
                    ⚠ Annat konto — mejlet laddas upp på nytt och originalet hamnar i papperskorgen
                  </span>
                )}
              </p>
              <div className="grid gap-1 sm:grid-cols-2">
                {g.mappar.map((m) => {
                  const i = traffar.indexOf(m)
                  return (
                    <button
                      key={m.id}
                      onMouseEnter={() => setMarkerad(i)}
                      onClick={() => onValj(m.id)}
                      className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                        i === markerad ? 'bg-accent/15 text-ink' : 'text-muted hover:bg-card-hover hover:text-ink'
                      }`}
                    >
                      <span aria-hidden>📁</span>
                      <span className="truncate">{kortNamn(m.path)}</span>
                      {(m.total_count ?? 0) > 0 && <span className="ml-auto text-[10px] text-muted/60">{m.total_count}</span>}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}

          {traffar.length === 0 && <p className="py-8 text-center text-sm text-muted">Inga mappar matchar "{sok}"</p>}
        </div>

        <p className="border-t border-border px-5 py-2 text-[10px] text-muted">
          ↑↓ bläddra · Enter välj · Esc stäng
        </p>
      </div>
    </div>
  )
}

function NyttMejl({ open, onClose, konton, forvaltKonto, onSkicka }: {
  open: boolean
  onClose: () => void
  konton: Konto[]
  forvaltKonto?: string
  onSkicka: (kropp: Record<string, unknown>) => Promise<{ fel?: string }>
}) {
  const [fran, setFran] = useState('')
  const [till, setTill] = useState('')
  const [amne, setAmne] = useState('')
  const [text, setText] = useState('')
  const [skickar, setSkickar] = useState(false)
  const [resultat, setResultat] = useState<{ ok?: boolean; fel?: string } | null>(null)
  const [bilagor, setBilagor] = useState<UtgaendeBilaga[]>([])

  useEffect(() => {
    if (!open) return
    setFran(forvaltKonto ?? konton[0]?.id ?? '')
    setTill(''); setAmne(''); setText(''); setResultat(null); setBilagor([])
  }, [open, forvaltKonto, konton])

  if (!open) return null
  const valtKonto = konton.find((k) => k.id === fran)

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[8vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative z-10 w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h3 className="font-semibold">Nytt mejl</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-muted hover:bg-card-hover hover:text-ink" aria-label="Stäng">✕</button>
        </div>

        <div className="space-y-2 p-5">
          <div className="flex items-center gap-2 text-xs">
            <span className="w-12 shrink-0 text-muted">Från</span>
            <select
              value={fran}
              onChange={(e) => setFran(e.target.value)}
              className="flex-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
            >
              {konton.map((k) => <option key={k.id} value={k.id}>{k.label} — {k.email}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="w-12 shrink-0 text-muted">Till</span>
            <input
              value={till}
              onChange={(e) => setTill(e.target.value)}
              placeholder="mottagare@exempel.se"
              className="flex-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent"
            />
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="w-12 shrink-0 text-muted">Ämne</span>
            <input
              value={amne}
              onChange={(e) => setAmne(e.target.value)}
              className="flex-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent"
            />
          </div>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Skriv ditt meddelande…"
            className="min-h-56 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          />

          <Bifoga bilagor={bilagor} setBilagor={setBilagor} />

          {valtKonto?.signature?.trim() && (
            <div className="rounded-lg border border-dashed border-border px-3 py-2">
              <p className="mb-1 text-[10px] uppercase tracking-wider text-muted">Signatur läggs till</p>
              <pre className="whitespace-pre-wrap font-sans text-[11px] text-muted">{valtKonto.signature.trim()}</pre>
            </div>
          )}

          {resultat?.fel && <p className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad">{resultat.fel}</p>}
          {resultat?.ok && (
            <p className="rounded-lg border border-good/40 bg-good/10 px-3 py-2 text-xs text-good">✓ Skickat</p>
          )}

          <div className="flex items-center justify-between pt-1">
            <button onClick={onClose} className="text-xs text-muted hover:text-ink">Avbryt</button>
            <button
              disabled={skickar || !till.trim() || !text.trim() || bilagor.reduce((a, b) => a + b.storlek, 0) > MAX_UTGAENDE}
              onClick={async () => {
                setSkickar(true); setResultat(null)
                try {
                  const r = await onSkicka({
                    fromAccountId: fran, to: till.trim(), subject: amne, body: text,
                    attachments: bilagor.map(({ filename, contentType, dataBase64 }) => ({ filename, contentType, dataBase64 })),
                  })
                  if (r?.fel) setResultat({ fel: r.fel })
                  else { setResultat({ ok: true }); setTimeout(onClose, 1400) }
                } catch (e) {
                  setResultat({ fel: e instanceof Error ? e.message : String(e) })
                } finally {
                  // Alltid — annars står knappen kvar och säger Skickar för evigt
                  setSkickar(false)
                }
              }}
              className="rounded-xl bg-accent px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-soft disabled:opacity-50"
            >
              {skickar ? 'Skickar…' : 'Skicka'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Lasruta({ mejl, konto, mappar, konton, visaFlytt, setVisaFlytt, flyttar, onFlytta, onRadera, onSkicka, onSvaraSenare, onStjarna, onTillbaka }: {
  onTillbaka?: () => void
  mejl: Mejl
  konto?: Konto
  mappar: Mapp[]
  konton: Konto[]
  visaFlytt: boolean
  setVisaFlytt: (v: boolean) => void
  flyttar: boolean
  onFlytta: (mappId: string) => void
  onRadera: () => void
  onSkicka: (kropp: Record<string, unknown>) => Promise<{ ok?: boolean; fel?: string }>
  onSvaraSenare: () => void
  onStjarna: () => void
}) {
  const [flyttSok, setFlyttSok] = useState('')
  const [kvitto, setKvitto] = useState<string | null>(null)
  const traffar = mappar.filter((m) => m.path.toLowerCase().includes(flyttSok.toLowerCase())).slice(0, 40)

  // Svarsruta — avsändaren förvald till kontot mejlet kom till.
  // Samma ruta används för att svara och för att vidarebefordra; det som
  // skiljer är mottagare, ämnesrad och hur originalet återges.
  const [lage, setLage] = useState<'svar' | 'vidare' | null>(null)
  const visaSvar = lage !== null
  const [franKonto, setFranKonto] = useState(mejl.account_id)
  const [till, setTill] = useState('')
  const [amne, setAmne] = useState('')
  const [text, setText] = useState('')
  const [skickar, setSkickar] = useState(false)
  const [resultat, setResultat] = useState<{ ok?: boolean; fel?: string } | null>(null)
  const [bilagor, setBilagor] = useState<UtgaendeBilaga[]>([])

  useEffect(() => {
    setLage(null); setResultat(null); setBilagor([])
    setFranKonto(mejl.account_id)
    setTill(mejl.from_email ?? '')
    setAmne(/^re:/i.test(mejl.subject) ? mejl.subject : `Re: ${mejl.subject}`)
    setText('')
  }, [mejl.id, mejl.account_id, mejl.from_email, mejl.subject])

  /** Öppnar rutan i rätt läge och fyller i det som skiljer de två åt. */
  function oppnaRuta(nyttLage: 'svar' | 'vidare') {
    setResultat(null)
    if (nyttLage === 'vidare') {
      // Tom mottagare med flit — vidarebefordran utan adressat är det
      // vanligaste sättet att skicka ett mejl till fel person.
      setTill('')
      setAmne(/^(vb|fwd?):/i.test(mejl.subject) ? mejl.subject : `VB: ${mejl.subject}`)
    } else {
      setTill(mejl.from_email ?? '')
      setAmne(/^re:/i.test(mejl.subject) ? mejl.subject : `Re: ${mejl.subject}`)
    }
    setText('')
    setLage(nyttLage)
  }
  const [kropp, setKropp] = useState<{ text_body: string | null; html_body: string | null } | null>(null)
  const [hamtar, setHamtar] = useState(false)
  const [fel, setFel] = useState<string | null>(null)
  const [visaHtml, setVisaHtml] = useState(false)
  // Mejl är formgivna för vitt papper, och vitt papper mitt i ett mörkt
  // gränssnitt lyser. Dämpningen sänker ljusstyrkan utan att vända färgerna —
  // inverterade nyhetsbrev blir oläsliga.
  //
  // Lite värme och något mindre kontrast utöver nedsläckningen: rent nedtonat
  // vitt blir blågrått och kallt, och det är just den kylan som skaver mot ett
  // mörkt gränssnitt på kvällen.
  const [dampad, setDampad] = useState(() => localStorage.getItem('hubben.mejl.ljus') !== 'fullt')

  useEffect(() => {
    let avbruten = false
    setKropp(null); setFel(null); setHamtar(true); setVisaHtml(false)
    ;(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return
        const res = await fetch(`${supabaseUrl}/functions/v1/mail-body`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.access_token}`, apikey: supabaseKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ messageId: mejl.id }),
        })
        const json = await res.json()
        if (avbruten) return
        if (json.fel) setFel(json.fel)
        // Formaterad version är förstahandsval, precis som i andra klienter —
        // textversionen är ofta autogenererad och full av skräp.
        else { setKropp(json); setVisaHtml(!!json.html_body) }
      } catch (e) {
        if (!avbruten) setFel(String(e))
      } finally {
        if (!avbruten) setHamtar(false)
      }
    })()
    return () => { avbruten = true }
  }, [mejl.id])

  // Citatet läggs in när svarsrutan öppnas och brödtexten finns. Bara om
  // rutan är tom, så att ingen förlorar det den redan skrivit.
  const svarsRuta = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (!lage || !kropp || text.trim()) return
    setText(lage === 'vidare' ? byggVidare(mejl, kropp) : byggCitat(mejl, kropp))
    // Citatet skrivs in efter att rutan fått fokus, så markören måste
    // flyttas tillbaka — annars börjar man skriva under citatet.
    setTimeout(() => svarsRuta.current?.setSelectionRange(0, 0), 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lage, kropp])

  const part = motpart(mejl)
  const namn = part.namn
  const allaMottagare = (mejl.to_emails ?? []).filter(Boolean).join(', ')

  return (
    <div className="flex h-full flex-col">
      <div className="relative flex flex-wrap items-center gap-0.5 border-b border-border px-2 py-1">
        {/* På telefonen har läsrutan tagit listans plats — den här tar en tillbaka */}
        {onTillbaka && (
          <button
            onClick={onTillbaka}
            className="mr-1 flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-card-hover hover:text-ink lg:hidden"
          >
            <span aria-hidden>←</span>
            Listan
          </button>
        )}
        <Verktyg ikon="✏️" text="Svara" aktiv={lage === 'svar'} onClick={() => (lage === 'svar' ? setLage(null) : oppnaRuta('svar'))} />
        <Verktyg ikon="↪️" text="Vidarebefordra" aktiv={lage === 'vidare'} onClick={() => (lage === 'vidare' ? setLage(null) : oppnaRuta('vidare'))} />
        <Verktyg ikon="↩️" text={mejl.reply_later ? 'I svarshögen' : 'Svara senare'} aktiv={mejl.reply_later} onClick={onSvaraSenare} />
        <Verktyg ikon="📁" text={flyttar ? 'Flyttar…' : 'Flytta till…'} aktiv={visaFlytt} onClick={() => { if (!flyttar) { setVisaFlytt(!visaFlytt); setFlyttSok('') } }} />
        <Verktyg ikon="🗑" text="Radera" onClick={onRadera} />
        <span className="mx-1 h-4 w-px bg-border" />
        <MejlTillHubben
          msgId={mejl.id}
          amne={mejl.subject}
          franEpost={mejl.from_email}
          onKlart={(t) => { setKvitto(t); setTimeout(() => setKvitto(null), 4000) }}
        />
        <Verktyg ikon={mejl.flagged ? '⭐' : '☆'} text="" onClick={onStjarna} />

        {visaFlytt && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setVisaFlytt(false)} />
            <div className="absolute left-3 top-full z-30 mt-1 w-80 overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
              <input
                autoFocus
                value={flyttSok}
                onChange={(e) => setFlyttSok(e.target.value)}
                placeholder="Sök mapp…"
                className="w-full border-b border-border bg-transparent px-3 py-2.5 text-sm text-ink outline-none placeholder:text-muted/60"
              />
              <ul className="max-h-72 overflow-y-auto p-1">
                {traffar.length === 0 && <li className="px-3 py-4 text-center text-xs text-muted">Inga mappar matchar</li>}
                {traffar.map((m) => {
                  const mk = konton.find((k) => k.id === m.account_id)
                  const annatKonto = m.account_id !== mejl.account_id
                  return (
                    <li key={m.id}>
                      <button
                        onClick={() => onFlytta(m.id)}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-muted transition-colors hover:bg-accent/15 hover:text-ink"
                      >
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: mk?.color ?? '#8b95ad' }} title={mk?.label} />
                        <span className="truncate">{m.path.replace(/^INBOX[./]/, '').replace(/^\[Gmail\]\//, '')}</span>
                        {annatKonto && (
                          <span className="shrink-0 rounded-full bg-warn/15 px-1.5 text-[9px] font-medium text-warn">
                            {mk?.label}
                          </span>
                        )}
                        {(m.total_count ?? 0) > 0 && <span className="ml-auto text-[10px] text-muted/60">{m.total_count}</span>}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          </>
        )}
      </div>

      {kvitto && (
        <p className="shrink-0 border-b border-good/30 bg-good/10 px-6 py-1.5 text-xs text-good">
          ✓ {kvitto}
        </p>
      )}

      {/* Rubrikblocket står still — bara innehållet scrollar. Hålls smalt
          med flit: det är mejlet man öppnat rutan för, inte ramen runt. */}
      <div className="shrink-0 border-b border-border">
        <div className="px-4 pb-2.5 pt-2.5">
          <div className="flex items-start gap-2">
            {konto && (
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: konto.color }} title={konto.label} />
            )}
            <h2 className="min-w-0 flex-1 text-base font-semibold leading-snug">{mejl.subject || '(inget ämne)'}</h2>
          </div>

          <div className="mt-1.5 flex items-center gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white" style={{ background: avatarFarg(namn) }}>
              {initialer(namn)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium">
                {part.prefix && <span className="font-normal text-muted">{part.prefix}</span>}
                {namn}
              </p>
              {/* I Skickat är avsändaren jag själv — då är hela mottagarlistan
                  det intressanta, inte min egen adress igen. */}
              <p className="truncate text-xs text-muted">
                {mejl.visad_roll === 'sent' ? allaMottagare : mejl.from_email}
              </p>
            </div>
            <span className="shrink-0 text-xs text-muted">
              {mejl.sent_at && format(parseISO(mejl.sent_at), 'd MMM yyyy HH:mm', { locale: sv })}
            </span>
          </div>
        </div>
      </div>

      {/* Bilagelisten ligger utanför det som scrollar — den ska alltid synas */}
      <Bilagor msgId={mejl.id} aktiv={!hamtar} />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col px-4 py-3">
          {hamtar && <Spinner />}
          {fel && <p className="rounded-xl border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">Kunde inte hämta brödtexten: {fel}</p>}
          {kropp && (
            <>
              <div className="mb-2 flex shrink-0 items-center gap-3">
                {kropp.text_body && kropp.html_body && (
                  <button onClick={() => setVisaHtml(!visaHtml)} className="text-xs text-accent-soft hover:underline">
                    {visaHtml ? 'Visa som text' : 'Visa formaterad'}
                  </button>
                )}
                {visaHtml && kropp.html_body && (
                  <button
                    onClick={() => {
                      const nytt = !dampad
                      setDampad(nytt)
                      localStorage.setItem('hubben.mejl.ljus', nytt ? 'dampat' : 'fullt')
                    }}
                    className="ml-auto text-xs text-muted transition-colors hover:text-ink"
                    title={dampad ? 'Visa mejlet i sina riktiga färger' : 'Dämpa ljusstyrkan'}
                  >
                    {dampad ? '☀️ Full ljusstyrka' : '🌙 Dämpa'}
                  </button>
                )}
              </div>
              {visaHtml && kropp.html_body ? (
                // Låst iframe: inga skript, inga formulär, ingen navigering.
                // Vitt "papper" — mejl är formgivna för ljus bakgrund, och att
                // tvinga ljus text gör dem oläsbara när de har egen ljus bakgrund.
                // sandbox="" blockerade all navigering, så länkar gjorde
                // ingenting alls när man klickade. allow-popups släpper fram
                // dem; escape-sandbox gör att den nya fliken blir en vanlig
                // flik och inte ärver låsningen. Skript är fortfarande
                // förbjudna — det är allow-scripts som vore farligt, inte det
                // här. <base target="_blank"> gör att allt öppnas i ny flik i
                // stället för att försöka ersätta läsrutan.
                <iframe
                  sandbox="allow-popups allow-popups-to-escape-sandbox"
                  referrerPolicy="no-referrer"
                  srcDoc={`<base target="_blank" rel="noopener noreferrer"><style>html,body{background:#eeece7;color:#1f2937;margin:0}body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:14px;line-height:1.6;padding:16px;word-wrap:break-word}img{max-width:100%;height:auto}table{max-width:100%}a{color:#1d4ed8}</style>${kropp.html_body}`}
                  style={dampad ? { filter: 'brightness(0.68) sepia(0.12) contrast(0.96)' } : undefined}
                  className="min-h-0 w-full flex-1 rounded-xl border border-border bg-white"
                  title="Mejlinnehåll"
                />
              ) : (
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <pre className="max-w-prose whitespace-pre-wrap font-sans text-[14px] leading-relaxed text-ink/90">
                    {stada(kropp.text_body) || '(ingen textversion)'}
                  </pre>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Svarsruta */}
      <div className="border-t border-border p-3">
        {!visaSvar ? (
          <button
            onClick={() => oppnaRuta('svar')}
            className="flex w-full items-center gap-2.5 rounded-xl border border-border bg-surface px-3 py-2.5 text-left transition-colors hover:bg-card-hover"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: konto?.color ?? '#6366f1' }}>
              {initialer(konto?.email ?? 'du')}
            </span>
            <span className="text-sm text-muted">Svara {(mejl.from_name || mejl.from_email || '').split(' ')[0]}…</span>
          </button>
        ) : (
          <div className="space-y-2 rounded-xl border border-border bg-surface p-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted">Från</span>
              <select
                value={franKonto}
                onChange={(e) => setFranKonto(e.target.value)}
                className="rounded-lg border border-border bg-card px-2 py-1 text-xs text-ink outline-none focus:border-accent"
              >
                {konton.map((k) => (
                  <option key={k.id} value={k.id}>{k.email}</option>
                ))}
              </select>
              {franKonto !== mejl.account_id && (
                <span className="rounded-full bg-warn/15 px-2 py-0.5 text-[10px] font-medium text-warn">
                  Skickas via ett annat konto än mejlet kom till
                </span>
              )}
            </div>

            <input
              value={till}
              onChange={(e) => setTill(e.target.value)}
              placeholder="Till"
              className="w-full rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent"
            />
            <input
              value={amne}
              onChange={(e) => setAmne(e.target.value)}
              placeholder="Ämne"
              className="w-full rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent"
            />
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              ref={svarsRuta}
              placeholder={lage === 'vidare' ? 'Skriv en rad innan du skickar vidare…' : 'Skriv ditt svar…'}
              autoFocus
              // Citatet ligger redan i rutan — markören hör hemma överst
              onFocus={(e) => e.currentTarget.setSelectionRange(0, 0)}
              className="min-h-40 w-full rounded-lg border border-border bg-card px-2.5 py-2 text-sm text-ink outline-none focus:border-accent"
            />

            <Bifoga bilagor={bilagor} setBilagor={setBilagor} />

            {konton.find((k) => k.id === franKonto)?.signature?.trim() && (
              <div className="rounded-lg border border-dashed border-border px-2.5 py-1.5">
                <p className="mb-1 text-[10px] uppercase tracking-wider text-muted">Signatur läggs till</p>
                <pre className="whitespace-pre-wrap font-sans text-[11px] text-muted">
                  {konton.find((k) => k.id === franKonto)?.signature.trim()}
                </pre>
              </div>
            )}

            {resultat?.fel && (
              <p className="rounded-lg border border-bad/40 bg-bad/10 px-2.5 py-1.5 text-xs text-bad">{resultat.fel}</p>
            )}
            {resultat?.ok && (
              <p className="rounded-lg border border-good/40 bg-good/10 px-2.5 py-1.5 text-xs text-good">✓ Skickat</p>
            )}

            <div className="flex items-center justify-between">
              <button onClick={() => setLage(null)} className="text-xs text-muted hover:text-ink">Avbryt</button>
              <button
                disabled={skickar || !till.trim() || !text.trim() || bilagor.reduce((a, b) => a + b.storlek, 0) > MAX_UTGAENDE}
                onClick={async () => {
                  setSkickar(true); setResultat(null)
                  try {
                    const r = await onSkicka({
                      fromAccountId: franKonto, to: till.trim(), subject: amne, body: text,
                      attachments: bilagor.map(({ filename, contentType, dataBase64 }) => ({ filename, contentType, dataBase64 })),
                      // Ett vidarebefordrat mejl är inte ett svar. Sätts
                      // In-Reply-To hamnar det i mottagarens tråd med någon
                      // hen aldrig mejlat.
                      vidarebefordran: lage === 'vidare',
                    })
                    setResultat(r)
                    if (r.ok) { setText(''); setTimeout(() => setLage(null), 1200) }
                  } catch (e) {
                    setResultat({ fel: e instanceof Error ? e.message : String(e) })
                  } finally {
                    setSkickar(false)
                  }
                }}
                className="rounded-xl bg-accent px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-soft disabled:opacity-50"
              >
                {skickar ? 'Skickar…' : 'Skicka'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Verktyg({ ikon, text, onClick, aktiv, title }: { ikon: string; text: string; onClick?: () => void; aktiv?: boolean; title?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
        aktiv ? 'bg-accent/15 text-accent-soft' : 'text-muted hover:bg-card-hover hover:text-ink'
      }`}
    >
      <span aria-hidden>{ikon}</span>
      {text && <span className="hidden xl:inline">{text}</span>}
    </button>
  )
}
