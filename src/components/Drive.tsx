import { useCallback, useEffect, useRef, useState } from 'react'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { sv } from 'date-fns/locale'
import { supabase } from '../lib/supabase'

/** En rad ur hub_drive_sok. Innehållet finns inte här — bara namnet och
 *  vägen dit. Filen hämtas färsk från Google först när den ska bifogas. */
export interface DriveFil {
  file_id: string
  namn: string
  mime: string | null
  storlek: number | null
  andrad: string | null
  webblank: string | null
  agare: string | null
  stjarnmarkt: boolean
  delad: boolean
}

const KATEGORIER = [
  { id: '', namn: 'Allt' },
  { id: 'dokument', namn: 'Dokument' },
  { id: 'kalkyl', namn: 'Kalkyl' },
  { id: 'presentation', namn: 'Presentation' },
  { id: 'pdf', namn: 'PDF' },
  { id: 'bild', namn: 'Bilder' },
]

export function ikonFor(mime: string | null, namn: string) {
  const m = mime ?? ''
  const n = namn.toLowerCase()
  if (m === 'application/vnd.google-apps.document') return '📘'
  if (m === 'application/vnd.google-apps.spreadsheet') return '📗'
  if (m === 'application/vnd.google-apps.presentation') return '📙'
  if (m === 'application/vnd.google-apps.form') return '📋'
  if (m === 'application/pdf' || n.endsWith('.pdf')) return '📕'
  if (m.startsWith('image/')) return '🖼'
  if (m.startsWith('video/')) return '🎬'
  if (m.startsWith('audio/')) return '🎵'
  if (/\.(docx?|odt|rtf)$/.test(n)) return '📄'
  if (/\.(xlsx?|csv|ods)$/.test(n)) return '📊'
  if (/\.(pptx?|odp)$/.test(n)) return '📽'
  if (/\.(zip|rar|7z|tar|gz)$/.test(n)) return '🗜'
  return '📄'
}

export function storlekText(b: number | null) {
  if (!b || b < 0) return ''
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} kB`
  return `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB`
}

/** Sökrutan plus träfflistan. Delas av Drive-sidan och väljaren i mejlet, så
 *  att söka efter en fil känns likadant oavsett varför man gör det. */
export function DriveSok({ onValj, valjEtikett, autoFokus = true, hojd = 'max-h-[26rem]' }: {
  onValj?: (f: DriveFil) => void
  valjEtikett?: string
  autoFokus?: boolean
  hojd?: string
}) {
  const [fraga, setFraga] = useState('')
  const [kategori, setKategori] = useState('')
  const [traffar, setTraffar] = useState<DriveFil[]>([])
  const [laddar, setLaddar] = useState(true)
  const [fel, setFel] = useState<string | null>(null)
  const [markerad, setMarkerad] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)

  const sok = useCallback(async (q: string, k: string) => {
    const { data, error } = await supabase.rpc('hub_drive_sok', {
      p_fraga: q, p_kategori: k || null, p_antal: 40,
    })
    if (error) { setFel(error.message); setTraffar([]) }
    else { setFel(null); setTraffar((data as DriveFil[]) ?? []) }
    setLaddar(false)
    setMarkerad(0)
  }, [])

  // Kort fördröjning: sökningen ska kännas direkt, men inte skicka ett anrop
  // per tangenttryckning.
  useEffect(() => {
    setLaddar(true)
    const t = setTimeout(() => sok(fraga, kategori), 140)
    return () => clearTimeout(t)
  }, [fraga, kategori, sok])

  // Håll den markerade raden synlig när man pilar sig neråt i listan.
  useEffect(() => {
    listRef.current?.children[markerad]?.scrollIntoView({ block: 'nearest' })
  }, [markerad])

  function tangent(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setMarkerad((i) => Math.min(i + 1, traffar.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setMarkerad((i) => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter' && traffar[markerad]) {
      e.preventDefault()
      const f = traffar[markerad]
      if (onValj) onValj(f)
      else if (f.webblank) window.open(f.webblank, '_blank', 'noopener,noreferrer')
    }
  }

  return (
    <div>
      <input
        autoFocus={autoFokus}
        value={fraga}
        onChange={(e) => setFraga(e.target.value)}
        onKeyDown={tangent}
        placeholder="Sök i Drive — skriv delar av namnet, i vilken ordning som helst"
        className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm outline-none focus:border-accent"
      />

      <div className="mt-2 flex flex-wrap gap-1.5">
        {KATEGORIER.map((k) => (
          <button
            key={k.id}
            onClick={() => setKategori(k.id)}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
              kategori === k.id
                ? 'bg-accent/15 text-accent-soft'
                : 'border border-border text-muted hover:text-ink'
            }`}
          >
            {k.namn}
          </button>
        ))}
      </div>

      {fel && (
        <p className="mt-3 rounded-xl border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad">{fel}</p>
      )}

      <ul ref={listRef} className={`mt-3 space-y-1 overflow-y-auto ${hojd}`}>
        {traffar.map((f, i) => (
          <li key={f.file_id}>
            <div
              onMouseEnter={() => setMarkerad(i)}
              className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${
                i === markerad ? 'border-accent/50 bg-card-hover' : 'border-border bg-surface'
              }`}
            >
              <span className="shrink-0 text-lg leading-none">{ikonFor(f.mime, f.namn)}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-ink">
                  {f.stjarnmarkt && <span className="mr-1" aria-label="stjärnmärkt">⭐</span>}
                  {f.namn}
                </p>
                <p className="truncate text-[11px] text-muted">
                  {f.andrad && `ändrad ${formatDistanceToNow(parseISO(f.andrad), { locale: sv, addSuffix: true })}`}
                  {f.storlek ? ` · ${storlekText(f.storlek)}` : ''}
                  {f.delad && f.agare ? ` · av ${f.agare}` : ''}
                </p>
              </div>
              {f.webblank && (
                <a
                  href={f.webblank}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 rounded-lg border border-border px-2 py-1 text-[11px] text-muted transition-colors hover:text-ink"
                >
                  Öppna
                </a>
              )}
              {onValj && (
                <button
                  onClick={() => onValj(f)}
                  className="shrink-0 rounded-lg bg-accent px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-accent-soft"
                >
                  {valjEtikett ?? 'Välj'}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {!laddar && traffar.length === 0 && !fel && (
        <p className="py-8 text-center text-sm text-muted">
          {fraga
            ? 'Inget som heter så. Har filen tillkommit nyss kan registret behöva synkas.'
            : 'Inga filer i registret än. Synka Drive på Drive-sidan.'}
        </p>
      )}
    </div>
  )
}
