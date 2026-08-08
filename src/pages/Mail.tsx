import { useState } from 'react'

/**
 * DESIGNSKISS för mejlklienten — påhittade mejl, ingen koppling till servern än.
 * Syftet är att låsa utseendet innan maskineriet byggs.
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
}

const KONTON = {
  handboll: { namn: 'Täby Handboll', farg: '#38bdf8' },
  gmail: { namn: 'Gmail', farg: '#f87171' },
  outlook: { namn: 'Outlook', farg: '#818cf8' },
}

const DEMO: DemoMail[] = [
  {
    id: 1, konto: 'handboll', avsandare: 'Anna Berg', adress: 'anna.berg@tabyhandboll.se',
    amne: 'Kallelse: Styrelsemöte 18 augusti',
    utdrag: 'Hej Per, bifogar dagordning och förra protokollet inför mötet. Vi behöver särskilt gå igenom…',
    brodtext: [
      'Hej Per,',
      'Bifogar dagordning och förra protokollet inför mötet den 18 augusti. Vi behöver särskilt gå igenom budgeten för vårsäsongen och beslutet om nya halltider.',
      'Kan du förbereda en kort dragning om spelartruppen? Ungefär tio minuter räcker.',
      'Hälsningar,\nAnna',
    ],
    tid: '09:42', grupp: 'Idag', olast: true, stjarna: false, bilaga: 'Dagordning_18aug.pdf', itrad: 3,
  },
  {
    id: 2, konto: 'handboll', avsandare: 'Tibblehallen Bokning', adress: 'bokning@tibblehallen.se',
    amne: 'Bekräftelse: Halltid vecka 34–38',
    utdrag: 'Din bokning är bekräftad. Måndagar 16:00–18:00 och torsdagar 17:00–19:00 i A-hallen…',
    brodtext: ['Din bokning är bekräftad.', 'Måndagar 16:00–18:00 och torsdagar 17:00–19:00 i A-hallen, vecka 34 till 38.', 'Avbokning senast 48 timmar innan.'],
    tid: '08:15', grupp: 'Idag', olast: true, stjarna: false,
  },
  {
    id: 3, konto: 'gmail', avsandare: 'Marcus Öberg', adress: 'marcus.oberg@gmail.com',
    amne: 'Re: Spelartrupp U18',
    utdrag: 'Låter bra! Jag tar med de tre från U16 på torsdagens pass så får vi se hur de fungerar…',
    brodtext: ['Låter bra!', 'Jag tar med de tre från U16 på torsdagens pass så får vi se hur de fungerar ihop med resten.', 'Ses på träningen.'],
    tid: 'Igår', grupp: 'Igår', olast: false, stjarna: true, itrad: 5,
  },
  {
    id: 4, konto: 'handboll', avsandare: 'Svenska Handbollförbundet', adress: 'info@svenskhandboll.se',
    amne: 'Nya tävlingsbestämmelser 2026/27',
    utdrag: 'Information till samtliga föreningar om ändringar i tävlingsbestämmelserna inför kommande…',
    brodtext: ['Information till samtliga föreningar.', 'Inför säsongen 2026/27 träder nya tävlingsbestämmelser i kraft. De viktigaste ändringarna rör dispensregler för överåriga spelare samt anmälningstider.', 'Fullständigt dokument finns bifogat.'],
    tid: 'Igår', grupp: 'Igår', olast: false, stjarna: false, bilaga: 'TB_2026-27.pdf',
  },
  {
    id: 5, konto: 'gmail', avsandare: 'Erik Nilsson', adress: 'erik.nilsson@hotmail.com',
    amne: 'Fråga om cupen i Södertälje',
    utdrag: 'Hej! Undrar vad som gäller med transport till cupen — samåker vi eller tar alla sig dit själva?',
    brodtext: ['Hej!', 'Undrar vad som gäller med transport till cupen — samåker vi eller tar alla sig dit själva?', 'Mvh Erik, pappa till Wilma'],
    tid: '6 aug', grupp: 'Tidigare', olast: false, stjarna: false,
  },
  {
    id: 6, konto: 'outlook', avsandare: 'One.com', adress: 'noreply@one.com',
    amne: 'Din faktura är tillgänglig',
    utdrag: 'Fakturan för webbhotell och e-post för perioden augusti–oktober finns nu att hämta…',
    brodtext: ['Fakturan för webbhotell och e-post för perioden augusti–oktober finns nu att hämta i kontrollpanelen.', 'Belopp: 349 kr. Förfaller 25 augusti.'],
    tid: '5 aug', grupp: 'Tidigare', olast: false, stjarna: false,
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
  const [kontoFilter, setKontoFilter] = useState<string>('alla')
  const [sok, setSok] = useState('')

  const synliga = DEMO.filter((m) => kontoFilter === 'alla' || m.konto === kontoFilter)
  const grupper: DemoMail['grupp'][] = ['Idag', 'Igår', 'Tidigare']

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Mejl</h1>
          <p className="mt-0.5 text-xs text-warn">⚠ Designskiss — påhittade mejl, inget är kopplat än</p>
        </div>
        <button className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-soft">
          ✏️ Skriv nytt
        </button>
      </div>

      {/* Sökfält + kontofilter */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-64 flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">🔍</span>
          <input
            value={sok}
            onChange={(e) => setSok(e.target.value)}
            placeholder="Sök i alla konton…  från:anna  har:bilaga"
            className="w-full rounded-xl border border-border bg-surface py-2 pl-9 pr-3 text-sm text-ink outline-none transition-colors placeholder:text-muted/60 focus:border-accent"
          />
        </div>
        <div className="flex gap-1">
          <FilterChip aktiv={kontoFilter === 'alla'} onClick={() => setKontoFilter('alla')}>Alla</FilterChip>
          {Object.entries(KONTON).map(([k, v]) => (
            <FilterChip key={k} aktiv={kontoFilter === k} onClick={() => setKontoFilter(k)} farg={v.farg}>
              {v.namn}
            </FilterChip>
          ))}
        </div>
      </div>

      {/* Mappar */}
      <div className="flex gap-1 overflow-x-auto pb-1">
        {MAPPAR.map((m) => (
          <button
            key={m.id}
            onClick={() => setMapp(m.id)}
            className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-colors ${
              mapp === m.id ? 'bg-accent/15 text-accent-soft' : 'text-muted hover:bg-card-hover hover:text-ink'
            }`}
          >
            <span aria-hidden>{m.ikon}</span>
            {m.namn}
            {m.antal > 0 && (
              <span className="ml-0.5 rounded-full bg-accent px-1.5 text-[10px] font-bold text-white">{m.antal}</span>
            )}
          </button>
        ))}
      </div>

      {/* Lista + läsruta */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {/* Lista */}
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="max-h-[62vh] overflow-y-auto">
            {grupper.map((g) => {
              const iGrupp = synliga.filter((m) => m.grupp === g)
              if (!iGrupp.length) return null
              return (
                <div key={g}>
                  <p className="sticky top-0 z-10 bg-card/95 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted backdrop-blur">
                    {g}
                  </p>
                  {iGrupp.map((m) => (
                    <MailRad key={m.id} mail={m} vald={vald.id === m.id} onClick={() => setVald(m)} />
                  ))}
                </div>
              )
            })}
          </div>
        </div>

        {/* Läsruta */}
        <div className="hidden overflow-hidden rounded-2xl border border-border bg-card lg:block">
          <Lasruta mail={vald} />
        </div>
      </div>

      <p className="text-xs text-muted">
        <kbd className="rounded border border-border bg-surface px-1">J</kbd>/<kbd className="rounded border border-border bg-surface px-1">K</kbd> bläddra ·
        <kbd className="ml-1.5 rounded border border-border bg-surface px-1">R</kbd> svara ·
        <kbd className="ml-1.5 rounded border border-border bg-surface px-1">A</kbd> svara alla ·
        <kbd className="ml-1.5 rounded border border-border bg-surface px-1">E</kbd> arkivera
      </p>
    </div>
  )
}

function FilterChip({ children, aktiv, onClick, farg }: { children: React.ReactNode; aktiv: boolean; onClick: () => void; farg?: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-medium transition-colors ${
        aktiv ? 'border-accent/50 bg-accent/15 text-accent-soft' : 'border-border text-muted hover:bg-card-hover hover:text-ink'
      }`}
    >
      {farg && <span className="h-2 w-2 rounded-full" style={{ background: farg }} />}
      {children}
    </button>
  )
}

function MailRad({ mail, vald, onClick }: { mail: DemoMail; vald: boolean; onClick: () => void }) {
  const konto = KONTON[mail.konto]
  return (
    <button
      onClick={onClick}
      className={`flex w-full gap-3 border-l-2 border-b border-b-border/60 px-4 py-3.5 text-left transition-colors ${
        vald ? 'border-l-accent bg-accent/10' : 'border-l-transparent hover:bg-card-hover'
      }`}
    >
      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: mail.olast ? konto.farg : 'transparent' }} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className={`truncate text-sm ${mail.olast ? 'font-semibold text-ink' : 'text-muted'}`}>
            {mail.avsandare}
          </span>
          <span className="shrink-0 text-[11px] text-muted">{mail.tid}</span>
        </span>
        <span className={`mt-0.5 flex items-center gap-1.5 truncate text-sm ${mail.olast ? 'font-medium text-ink' : 'text-muted'}`}>
          {mail.stjarna && <span className="shrink-0 text-xs">⭐</span>}
          <span className="truncate">{mail.amne}</span>
          {mail.itrad && (
            <span className="shrink-0 rounded-full border border-border px-1.5 text-[10px] text-muted">{mail.itrad}</span>
          )}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted/80">
          {mail.bilaga && <span className="shrink-0">📎</span>}
          <span className="truncate">{mail.utdrag}</span>
        </span>
      </span>
    </button>
  )
}

function Lasruta({ mail }: { mail: DemoMail }) {
  const konto = KONTON[mail.konto]
  const initialer = mail.avsandare.split(' ').map((d) => d[0]).slice(0, 2).join('')
  return (
    <div className="flex h-full max-h-[62vh] flex-col">
      {/* Verktygsrad */}
      <div className="flex items-center gap-0.5 overflow-x-auto border-b border-border px-3 py-2">
        <Verktyg ikon="↩" text="Svara" primar />
        <Verktyg ikon="↩↩" text="Svara alla" />
        <Verktyg ikon="↪" text="Vidarebefordra" />
        <span className="mx-1 h-5 w-px shrink-0 bg-border" />
        <Verktyg ikon="📦" text="Arkivera" />
        <Verktyg ikon="🗑" text="Radera" />
        <span className="ml-auto" />
        <Verktyg ikon={mail.stjarna ? '⭐' : '☆'} text="" />
        <Verktyg ikon="⋯" text="" />
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="mb-1 flex items-center gap-2">
          <span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: `${konto.farg}22`, color: konto.farg }}>
            {konto.namn}
          </span>
          {mail.itrad && <span className="text-[11px] text-muted">{mail.itrad} meddelanden i tråden</span>}
        </div>

        <h2 className="text-lg font-semibold leading-snug">{mail.amne}</h2>

        <div className="mt-3 flex items-center gap-3 border-b border-border pb-3">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
            style={{ background: konto.farg }}
          >
            {initialer}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{mail.avsandare}</p>
            <p className="truncate text-xs text-muted">{mail.adress}</p>
          </div>
          <span className="shrink-0 text-xs text-muted">{mail.tid}</span>
        </div>

        {mail.bilaga && (
          <div className="mt-3 inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2">
            <span aria-hidden>📄</span>
            <span className="text-sm">{mail.bilaga}</span>
            <span className="text-xs text-accent-soft">Ladda ner</span>
          </div>
        )}

        <div className="mt-4 space-y-3 text-sm leading-relaxed text-ink/90">
          {mail.brodtext.map((stycke, i) => (
            <p key={i} className="whitespace-pre-line">{stycke}</p>
          ))}
        </div>
      </div>

      {/* Snabbsvar */}
      <div className="border-t border-border p-3">
        <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-muted">
          <span aria-hidden>✏️</span>
          Svara {mail.avsandare.split(' ')[0]}…
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
      {text && <span className="hidden sm:inline">{text}</span>}
    </button>
  )
}
