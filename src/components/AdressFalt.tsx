import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

interface Forslag {
  adress: string
  namn: string | null
  antal: number
  senast: string | null
}

/** Var det ord man håller på att skriva börjar. Fältet kan innehålla flera
 *  adresser, och det är bara den sista som ska kompletteras — skriver man
 *  "kansli@x.se, anders" är det "anders" som söks. */
function sistaOrdet(v: string) {
  const i = Math.max(v.lastIndexOf(','), v.lastIndexOf(';'))
  return { start: i + 1, ord: v.slice(i + 1).trim() }
}

/**
 * Ett adressfält som föreslår mottagare medan man skriver.
 *
 * Förslagen kommer ur mejlen som redan finns — ingen adressbok behövs, och
 * ingenting behöver underhållas. Den man skrivit med oftast står överst.
 */
export function AdressFalt({ value, onChange, placeholder, className, autoFocus }: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
  autoFocus?: boolean
}) {
  const [forslag, setForslag] = useState<Forslag[]>([])
  const [oppen, setOppen] = useState(false)
  const [markerad, setMarkerad] = useState(0)
  const rutan = useRef<HTMLDivElement>(null)

  const sok = useCallback(async (ord: string) => {
    const { data, error } = await supabase.rpc('hub_mottagare_forslag', {
      p_fraga: ord, p_antal: 6,
    })
    if (error) { setForslag([]); return }
    setForslag((data as Forslag[]) ?? [])
    setMarkerad(0)
  }, [])

  // Kort fördröjning: listan ska följa med medan man skriver, men inte skicka
  // ett anrop per tangenttryckning.
  useEffect(() => {
    if (!oppen) return
    const { ord } = sistaOrdet(value)
    // Ett tecken räcker för att smalna av — men en helt tom ruta ger de man
    // skriver med oftast, vilket är rätt svar på "vem var det nu igen".
    const t = setTimeout(() => sok(ord), 120)
    return () => clearTimeout(t)
  }, [value, oppen, sok])

  // Klick utanför stänger. Utan det blir listan hängande kvar över det man
  // försöker läsa.
  useEffect(() => {
    if (!oppen) return
    const utanfor = (e: MouseEvent) => {
      if (!rutan.current?.contains(e.target as Node)) setOppen(false)
    }
    document.addEventListener('mousedown', utanfor)
    return () => document.removeEventListener('mousedown', utanfor)
  }, [oppen])

  function valj(f: Forslag) {
    const { start } = sistaOrdet(value)
    const fore = value.slice(0, start)
    // Avslutande komma direkt: nästa adress kan skrivas utan att man först
    // måste komma på att man behöver ett skiljetecken.
    onChange((fore ? fore.trimEnd() + ' ' : '') + f.adress + ', ')
    setOppen(false)
    setForslag([])
  }

  function tangent(e: React.KeyboardEvent) {
    if (!oppen || forslag.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setMarkerad((i) => Math.min(i + 1, forslag.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setMarkerad((i) => Math.max(i - 1, 0)) }
    else if (e.key === 'Escape') { e.preventDefault(); setOppen(false) }
    // Både Enter och Tab väljer, som i alla andra klienter. Tab flyttar sedan
    // vidare av sig själv, vilket är precis vad man vill.
    else if (e.key === 'Enter' || e.key === 'Tab') {
      if (forslag[markerad]) { e.preventDefault(); valj(forslag[markerad]) }
    }
  }

  return (
    <div ref={rutan} className="relative">
      <input
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => { onChange(e.target.value); setOppen(true) }}
        onFocus={() => setOppen(true)}
        onKeyDown={tangent}
        placeholder={placeholder}
        // Webbläsarens egen ifyllning lägger sig ovanpå den här listan
        autoComplete="off"
        className={className}
      />
      {oppen && forslag.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-y-auto rounded-xl border border-border bg-card shadow-2xl">
          {forslag.map((f, i) => (
            <li key={f.adress}>
              <button
                type="button"
                onMouseEnter={() => setMarkerad(i)}
                // mousedown, inte click: annars hinner fältet tappa fokus och
                // listan stängas innan klicket landar.
                onMouseDown={(e) => { e.preventDefault(); valj(f) }}
                className={`flex w-full items-baseline gap-2 px-3 py-2 text-left text-sm ${
                  i === markerad ? 'bg-accent/15 text-accent-soft' : 'text-ink hover:bg-card-hover'
                }`}
              >
                {f.namn && <span className="shrink-0 font-medium">{f.namn}</span>}
                <span className={`min-w-0 truncate text-xs ${f.namn ? 'text-muted' : ''}`}>{f.adress}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
