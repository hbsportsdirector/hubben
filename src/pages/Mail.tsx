import { useState } from 'react'

/**
 * DESIGNSKISS för mejlklienten — påhittade mejl, ingen koppling till servern än.
 * Layoutidéer (mappkolumn, färgade initialringar, luftiga rader, svarsruta med
 * avatar) är inspirerade av Bulwark. Ingen kod därifrån är kopierad — Bulwark är
 * AGPL-licensierat och skulle smitta av sig på hela appen.
 */

interface DemoMail {
  id: number
  konto: 'handboll' | 'gmail' | 'outlook'
  avsandare: string
  adress: string
  amne: string
  utdrag: string
  brodtext: string[]
  tid: string
  grupp: 'Idag' | 'Igår' | 'Tidigare'
  olast: boolean
  stjarna: boolean
  bilaga?: string
  itrad?: number
  taggar?: string[]
}

const KONTON = {
  handboll: { namn: 'Täby Handboll', farg: '#38bdf8' },
  gmail: { namn: 'Gmail', farg: '#f87171' },
  outlook: { namn: 'Outlook', farg: '#818cf8' },
}

const TAGGAR: Record<string, string> = {
  Styrelse: '#a78bfa',
  Förälder: '#34d399',
  Faktura: '#fbbf24',
  Förbund: '#38bdf8',
}

/** Färg på initialringen härleds ur namnet — samma avsändare får alltid samma färg. */
const AVATARFARGER = ['#3987e5', '#199e70', '#c98500', '#9085e9', '#e66767', '#d55181', '#d95926', '#0ea5e9']
function avatarFarg(namn: string) {
  let h = 0
  for (let i = 0; i < namn.length; i++) h = (h * 31 + namn.charCodeAt(i)) >>> 0
  return AVATARFARGER[h % AVATARFARGER.length]
}
function initialer(namn: string) {
  return namn.split(' ').filter(Boolean).map((d) => d[0]).slice(0, 2).join('').toUpperCase()
}

const DEMO: DemoMail[] = [
  {
    id: 1, konto: 'handboll', avsandare: 'Anna Berg', adress: 'anna.berg@tabyhandboll.se',
    amne: 'Kallelse: Styrelsemöte 18 augusti',
    utdrag: 'Hej Per, bifogar dagordning och förra protokollet inför mötet. Vi behöver särskilt gå igenom budgeten för vårsäsongen och beslutet om nya halltider.',
    brodtext: [
      'Hej Per,',
      'Bifogar dagordning och förra protokollet inför mötet den 18 augusti. Vi behöver särskilt gå igenom budgeten för vårsäsongen och beslutet om nya halltider.',
      'Kan du förbereda en kort dragning om spelartruppen? Ungefär tio minuter räcker.',
      'Hälsningar,\nAnna',
    ],
    tid: '09:42', grupp: 'Idag', olast: true, stjarna: false, bilaga: 'Dagordning_18aug.pdf', itrad: 3, taggar: ['Styrelse'],
  },
  {
    id: 2, konto: 'handboll', avsandare: 'Tibblehallen Bokning', adress: 'bokning@tibblehallen.se',
    amne: 'Bekräftelse: Halltid vecka 34–38',
    utdrag: 'Din bokning är bekräftad. Måndagar 16:00–18:00 och torsdagar 17:00–19:00 i A-hallen, vecka 34 till 38.',
    brodtext: ['Din bokning är bekräftad.', 'Måndagar 16:00–18:00 och torsdagar 17:00–19:00 i A-hallen, vecka 34 till 38.', 'Avbokning senast 48 timmar innan.'],
    tid: '08:15', grupp: 'Idag', olast: true, stjarna: false,
  },
  {
    id: 3, konto: 'gmail', avsandare: 'Marcus Öberg', adress: 'marcus.oberg@gmail.com',
    amne: 'Re: Spelartrupp U18',
    utdrag: 'Låter bra! Jag tar med de tre från U16 på torsdagens pass så får vi se hur de fungerar ihop med resten.',
    brodtext: ['Låter bra!', 'Jag tar med de tre från U16 på torsdagens pass så får vi se hur de fungerar ihop med resten.', 'Ses på träningen.'],
    tid: 'Igår', grupp: 'Igår', olast: false, stjarna: true, itrad: 5,
  },
  {
    id: 4, konto: 'handboll', avsandare: 'Svenska Handbollförbundet', adress: 'info@svenskhandboll.se',
    amne: 'Nya tävlingsbestämmelser 2026/27',
    utdrag: 'Information till samtliga föreningar om ändringar i tävlingsbestämmelserna inför kommande säsong. De viktigaste rör dispensregler.',
    brodtext: ['Information till samtliga föreningar.', 'Inför säsongen 2026/27 träder nya tävlingsbestämmelser i kraft. De viktigaste ändringarna rör dispensregler för överåriga spelare samt anmälningstider.', 'Fullständigt dokument finns bifogat.'],
    tid: 'Igår', grupp: 'Igår', olast: false, stjarna: false, bilaga: 'TB_2026-27.pdf', taggar: ['Förbund'],
  },
  {
    id: 5, konto: 'gmail', avsandare: 'Erik Nilsson', adress: 'erik.nilsson@hotmail.com',
    amne: 'Fråga om cupen i Södertälje',
    utdrag: 'Hej! Undrar vad som gäller med transport till cupen — samåker vi eller tar alla sig dit själva?',
    brodtext: ['Hej!', 'Undrar vad som gäller med transport till cupen — samåker vi eller tar alla sig dit själva?', 'Mvh Erik, pappa till Wilma'],
    tid: '6 aug', grupp: 'Tidigare', olast: false, stjarna: false, taggar: ['Förälder'],
  },
  {
    id: 6, konto: 'outlook', avsandare: 'One.com', adress: 'noreply@one.com',
    amne: 'Din faktura är tillgänglig',
    utdrag: 'Fakturan för webbhotell och e-post för perioden augusti–oktober finns nu att hämta i kontrollpanelen.',
    brodtext: ['Fakturan för webbhotell och e-post för perioden augusti–oktober finns nu att hämta i kontrollpanelen.', 'Belopp: 349 kr. Förfaller 25 augusti.'],
    tid: '5 aug', grupp: 'Tidigare', olast: false, stjarna: false, taggar: ['Faktura'],
  },
]

const MAPPAR = [
  { id: 'inkorg', namn: 'Inkorg', ikon: '📥', antal: 2 },
  { id: 'stjarna', namn: 'Stjärnmärkt', ikon: '⭐', antal: 0 },
  { id: 'skickat', namn: 'Skickat', ikon: '📤', antal: 0 },
  { id: 'utkast', namn: 'Utkast', ikon: '📝', antal: 1 },
  { id: 'arkiv', namn: 'Arkiv', ikon: '📦', antal: 0 },
  { id: 'skrap', namn: 'Skräppost', ikon: '🚫', antal: 0 },
]

export default function Mail() {
  const [vald, setVald] = useState<DemoMail>(DEMO[0])
  const [mapp, setMapp] = useState('inkorg')
  const [kontoFilter, setKontoFilter] = useState('alla')
  const [sok, setSok] = useState('')

  const synliga = DEMO.filter((m) => kontoFilter === 'alla' || m.konto === kontoFilter)
  const grupper: DemoMail['grupp'][] = ['Idag', 'Igår', 'Tidigare']

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Mejl</h1>
          <p className="text-[11px] text-warn">⚠ Designskiss — påhittade mejl, inget är kopplat än</p>
        </div>
        <div className="flex flex-1 items-center justify-end gap-2">
          <div className="relative max-w-md flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">🔍</span>
            <input
              value={sok}
              onChange={(e) => setSok(e.target.value)}
              placeholder="Sök…  från:anna  har:bilaga"
              className="w-full rounded-xl border border-border bg-surface py-2 pl-9 pr-3 text-sm text-ink outline-none transition-colors placeholder:text-muted/60 focus:border-accent"
            />
          </div>
          <button className="shrink-0 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-soft">
            ✏️ Skriv nytt
          </button>
        </div>
      </div>

      <div className="flex gap-3" style={{ height: 'calc(100vh - 9.5rem)' }}>
        {/* Mappkolumn */}
        <aside className="hidden w-48 shrink-0 flex-col gap-4 overflow-y-auto rounded-2xl border border-border bg-card p-3 xl:flex">
          <div>
            <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted">Mappar</p>
            {MAPPAR.map((m) => (
              <button
                key={m.id}
                onClick={() => setMapp(m.id)}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors ${
                  mapp === m.id ? 'bg-accent/15 font-medium text-accent-soft' : 'text-muted hover:bg-card-hover hover:text-ink'
                }`}
              >
                <span aria-hidden>{m.ikon}</span>
                <span className="flex-1 truncate">{m.namn}</span>
                {m.antal > 0 && <span className="text-[11px] font-semibold">{m.antal}</span>}
              </button>
            ))}
          </div>

          <div>
            <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted">Konton</p>
            <button
              onClick={() => setKontoFilter('alla')}
              className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors ${
                kontoFilter === 'alla' ? 'bg-accent/15 font-medium text-accent-soft' : 'text-muted hover:bg-card-hover hover:text-ink'
              }`}
            >
              <span className="h-2 w-2 rounded-full bg-muted" />
              Alla konton
            </button>
            {Object.entries(KONTON).map(([k, v]) => (
              <button
                key={k}
                onClick={() => setKontoFilter(k)}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors ${
                  kontoFilter === k ? 'bg-accent/15 font-medium text-accent-soft' : 'text-muted hover:bg-card-hover hover:text-ink'
                }`}
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: v.farg }} />
                <span className="truncate">{v.namn}</span>
              </button>
            ))}
          </div>

          <div>
            <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted">Taggar</p>
            {Object.entries(TAGGAR).map(([namn, farg]) => (
              <button key={namn} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-muted transition-colors hover:bg-card-hover hover:text-ink">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: farg }} />
                {namn}
              </button>
            ))}
          </div>
        </aside>

        {/* Meddelandelista */}
        <div className="flex w-full shrink-0 flex-col overflow-hidden rounded-2xl border border-border bg-card lg:w-88 xl:w-96">
          <div className="flex-1 overflow-y-auto">
            {grupper.map((g) => {
              const iGrupp = synliga.filter((m) => m.grupp === g)
              if (!iGrupp.length) return null
              return (
                <div key={g}>
                  <p className="sticky top-0 z-10 border-b border-border/60 bg-card/95 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted backdrop-blur">
                    {g}
                  </p>
                  {iGrupp.map((m) => (
                    <MailRad key={m.id} mail={m} vald={vald.id === m.id} onClick={() => setVald(m)} />
                  ))}
                </div>
              )
            })}
          </div>
          <p className="border-t border-border px-4 py-2 text-[10px] text-muted">
            <kbd className="rounded border border-border bg-surface px-1">J</kbd>/<kbd className="rounded border border-border bg-surface px-1">K</kbd> bläddra ·
            <kbd className="ml-1 rounded border border-border bg-surface px-1">R</kbd> svara ·
            <kbd className="ml-1 rounded border border-border bg-surface px-1">E</kbd> arkivera
          </p>
        </div>

        {/* Läsruta */}
        <div className="hidden min-w-0 flex-1 overflow-hidden rounded-2xl border border-border bg-card lg:block">
          <Lasruta mail={vald} />
        </div>
      </div>
    </div>
  )
}

function MailRad({ mail, vald, onClick }: { mail: DemoMail; vald: boolean; onClick: () => void }) {
  const konto = KONTON[mail.konto]
  return (
    <button
      onClick={onClick}
      className={`flex w-full gap-3 border-l-2 border-b border-b-border/50 px-3 py-3.5 text-left transition-colors ${
        vald ? 'border-l-accent bg-accent/10' : 'border-l-transparent hover:bg-card-hover'
      }`}
    >
      {/* Initialring i avsändarens egen färg */}
      <span className="relative shrink-0">
        <span
          className="flex h-9 w-9 items-center justify-center rounded-full text-[11px] font-bold text-white"
          style={{ background: avatarFarg(mail.avsandare) }}
        >
          {initialer(mail.avsandare)}
        </span>
        {/* Liten prick i kontots färg = vilket konto mejlet kom till */}
        <span
          className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card"
          style={{ background: konto.farg }}
          title={konto.namn}
        />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className={`truncate text-[13px] ${mail.olast ? 'font-semibold text-ink' : 'text-muted'}`}>
            {mail.avsandare}
          </span>
          <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted">
            {mail.bilaga && <span aria-label="Bilaga">📎</span>}
            {mail.tid}
          </span>
        </span>
        <span className={`mt-0.5 flex items-center gap-1.5 truncate text-[13px] ${mail.olast ? 'font-medium text-ink' : 'text-muted'}`}>
          {mail.stjarna && <span className="shrink-0 text-[11px]">⭐</span>}
          <span className="truncate">{mail.amne}</span>
          {mail.itrad && <span className="shrink-0 rounded-full border border-border px-1.5 text-[10px] text-muted">{mail.itrad}</span>}
        </span>
        <span className="mt-1 line-clamp-2 text-[12px] leading-snug text-muted/75">{mail.utdrag}</span>
        {mail.taggar && (
          <span className="mt-1.5 flex flex-wrap gap-1">
            {mail.taggar.map((t) => (
              <span
                key={t}
                className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                style={{ background: `${TAGGAR[t]}22`, color: TAGGAR[t] }}
              >
                {t}
              </span>
            ))}
          </span>
        )}
        {mail.olast && <span className="mt-1.5 block h-1 w-1 rounded-full" />}
      </span>
    </button>
  )
}

function Lasruta({ mail }: { mail: DemoMail }) {
  const konto = KONTON[mail.konto]
  return (
    <div className="flex h-full flex-col">
      {/* Verktygsrad: svara till vänster, hantering till höger */}
      <div className="flex items-center gap-0.5 border-b border-border px-3 py-2">
        <Verktyg ikon="↩" text="Svara" primar />
        <Verktyg ikon="↩↩" text="Svara alla" />
        <Verktyg ikon="↪" text="Vidarebefordra" />
        <span className="ml-auto" />
        <Verktyg ikon="📦" text="Arkivera" />
        <Verktyg ikon="🗑" text="" />
        <Verktyg ikon={mail.stjarna ? '⭐' : '☆'} text="" />
        <Verktyg ikon="⋯" text="" />
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: `${konto.farg}22`, color: konto.farg }}>
            {konto.namn}
          </span>
          {mail.taggar?.map((t) => (
            <span key={t} className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: `${TAGGAR[t]}22`, color: TAGGAR[t] }}>
              {t}
            </span>
          ))}
          {mail.itrad && <span className="text-[11px] text-muted">{mail.itrad} meddelanden i tråden</span>}
        </div>

        <h2 className="text-xl font-semibold leading-snug">{mail.amne}</h2>

        <div className="mt-4 flex items-center gap-3 border-b border-border pb-4">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
            style={{ background: avatarFarg(mail.avsandare) }}
          >
            {initialer(mail.avsandare)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{mail.avsandare}</p>
            <p className="truncate text-xs text-muted">{mail.adress} · till mig</p>
          </div>
          <span className="shrink-0 text-xs text-muted">{mail.tid}</span>
        </div>

        {mail.bilaga && (
          <div className="mt-4 inline-flex items-center gap-2.5 rounded-xl border border-border bg-surface px-3 py-2.5">
            <span className="text-lg" aria-hidden>📄</span>
            <span className="text-sm">{mail.bilaga}</span>
            <span className="cursor-pointer text-xs text-accent-soft hover:underline">Ladda ner</span>
          </div>
        )}

        <div className="mt-5 max-w-prose space-y-3.5 text-[14px] leading-relaxed text-ink/90">
          {mail.brodtext.map((stycke, i) => (
            <p key={i} className="whitespace-pre-line">{stycke}</p>
          ))}
        </div>
      </div>

      {/* Snabbsvar med avatar */}
      <div className="border-t border-border p-3">
        <div className="flex items-center gap-2.5 rounded-xl border border-border bg-surface px-3 py-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-white">PL</span>
          <span className="text-sm text-muted">Svara {mail.avsandare.split(' ')[0]}…</span>
        </div>
      </div>
    </div>
  )
}

function Verktyg({ ikon, text, primar }: { ikon: string; text: string; primar?: boolean }) {
  return (
    <button
      className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
        primar ? 'text-accent-soft hover:bg-accent/15' : 'text-muted hover:bg-card-hover hover:text-ink'
      }`}
    >
      <span aria-hidden>{ikon}</span>
      {text && <span className="hidden xl:inline">{text}</span>}
    </button>
  )
}
