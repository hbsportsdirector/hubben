import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, supabaseUrl, supabaseKey } from '../lib/supabase'
import { DriveSok, type DriveFil } from './Drive'

export interface Bilaga {
  id: string
  filename: string
  content_type: string
  size_bytes: number | null
  inline: boolean
}

/** Hur bilagan får visas i webbläsaren.
 *
 *  Servern skickar alltid `application/octet-stream` med `Content-Disposition:
 *  attachment`, så inget innehåll kan renderas direkt från vårt ursprung. Här
 *  avgör klienten i stället, typ för typ, vad som är säkert att packa upp:
 *
 *  - Bilder och text är ofarliga — bilder avkodas av webbläsarens bilddekoder
 *    och text skrivs ut escapead av React.
 *  - PDF ritas med pdf.js till en canvas, inte i webbläsarens plugin. Ingen
 *    iframe och ingen blob-navigering. PDF:ens egna skript körs aldrig — det
 *    kräver pdf.js sandlådemodul, som vi inte laddar — och XFA stängs av.
 *  - SVG, HTML, Office-dokument och arkiv visas ALDRIG inbäddat. SVG och HTML
 *    är körbar kod förklädd till dokument, och Office-format kräver makro-
 *    tolkning som ingen webbvisare bör göra åt en.
 */
type Visning = 'bild' | 'pdf' | 'text' | 'ingen'

function klassa(b: Bilaga): Visning {
  const t = (b.content_type || '').toLowerCase().split(';')[0].trim()
  const n = b.filename.toLowerCase()
  // Notera att image/svg+xml medvetet saknas här.
  if (/^image\/(png|jpeg|jpg|gif|webp|bmp|avif)$/.test(t)) return 'bild'
  if (t === 'application/pdf' || (t === 'application/octet-stream' && n.endsWith('.pdf'))) return 'pdf'
  if (/^text\/(plain|csv|markdown|tab-separated-values)$/.test(t) || t === 'application/json') return 'text'
  return 'ingen'
}

function ikon(b: Bilaga) {
  const n = b.filename.toLowerCase()
  if (/\.(png|jpe?g|gif|webp|bmp|avif|svg|heic)$/.test(n)) return '🖼'
  if (n.endsWith('.pdf')) return '📕'
  if (/\.(docx?|odt|rtf|pages)$/.test(n)) return '📄'
  if (/\.(xlsx?|csv|ods|numbers)$/.test(n)) return '📊'
  if (/\.(pptx?|odp|key)$/.test(n)) return '📽'
  if (/\.(zip|rar|7z|tar|gz|bz2)$/.test(n)) return '🗜'
  if (/\.(mp3|wav|m4a|ogg|flac)$/.test(n)) return '🎵'
  if (/\.(mp4|mov|avi|mkv|webm)$/.test(n)) return '🎬'
  if (/\.ics$/.test(n)) return '📅'
  if (/\.(txt|md|log|json|xml)$/.test(n)) return '📃'
  return '📎'
}

function storlek(b: number | null) {
  if (!b || b < 0) return ''
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} kB`
  return `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB`
}

function laddaNer(blob: Blob, filnamn: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filnamn
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}

/* ── Datahämtning ─────────────────────────────────────────── */

async function hamtaBytes(attachmentId: string): Promise<Blob> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Inte inloggad')
  const res = await fetch(`${supabaseUrl}/functions/v1/mail-attachment`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: supabaseKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ attachmentId }),
  })
  if (!res.ok) {
    const rå = await res.text()
    let meddelande = rå
    try { meddelande = JSON.parse(rå).fel ?? rå } catch { /* inte JSON */ }
    throw new Error(meddelande.slice(0, 200) || `Servern svarade ${res.status}`)
  }
  return await res.blob()
}

/* ── Bilagelisten under rubriken ──────────────────────────── */

export function Bilagor({ msgId, aktiv }: { msgId: string; aktiv: boolean }) {
  const [bilagor, setBilagor] = useState<Bilaga[] | null>(null)
  const [visaInbaddade, setVisaInbaddade] = useState(false)
  const [oppen, setOppen] = useState<number | null>(null)
  const [laddarNer, setLaddarNer] = useState<string | null>(null)
  const [fel, setFel] = useState<string | null>(null)

  // Löftet sparas, inte bara resultatet: två samtidiga anrop för samma bilaga
  // ska dela en hämtning i stället för att öppna två IMAP-anslutningar.
  const cache = useRef<Map<string, Promise<Blob>>>(new Map())

  useEffect(() => {
    cache.current = new Map()
    setBilagor(null); setOppen(null); setFel(null); setVisaInbaddade(false)
  }, [msgId])

  useEffect(() => {
    if (!aktiv) return
    let avbruten = false
    ;(async () => {
      const { data } = await supabase
        .from('hub_attachments')
        .select('id, filename, content_type, size_bytes, inline')
        .eq('msg_id', msgId)
        .order('inline')
        .order('filename')
      if (!avbruten) setBilagor((data as Bilaga[]) ?? [])
    })()
    return () => { avbruten = true }
  }, [msgId, aktiv])

  const hamta = useCallback((b: Bilaga) => {
    const sparad = cache.current.get(b.id)
    if (sparad) return sparad
    // Misslyckas hämtningen tas löftet bort, annars skulle felet cachas
    // och knappen aldrig kunna försöka igen.
    const p = hamtaBytes(b.id).catch((e) => { cache.current.delete(b.id); throw e })
    cache.current.set(b.id, p)
    return p
  }, [])

  if (!bilagor || bilagor.length === 0) return null

  const riktiga = bilagor.filter((b) => !b.inline)
  const inbaddade = bilagor.filter((b) => b.inline)
  const synliga = visaInbaddade ? [...riktiga, ...inbaddade] : riktiga
  if (synliga.length === 0 && inbaddade.length === 0) return null

  return (
    <div className="shrink-0 border-b border-border bg-surface/40 px-6 py-2.5">
      <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
        <span className="shrink-0 text-[11px] text-muted">
          {riktiga.length > 0 ? `${riktiga.length} ${riktiga.length === 1 ? 'bilaga' : 'bilagor'}` : 'Inbäddat'}
        </span>
        {synliga.map((b, i) => {
          const v = klassa(b)
          return (
            <button
              key={b.id}
              onClick={() => { setFel(null); setOppen(i) }}
              title={`${b.filename}${v === 'ingen' ? ' — går inte att förhandsvisa, öppnas som nedladdning' : ''}`}
              className="group flex shrink-0 items-center gap-2 rounded-xl border border-border bg-card px-2.5 py-1.5 text-left transition-colors hover:border-accent/50 hover:bg-card-hover"
            >
              <span className="text-base leading-none">{ikon(b)}</span>
              <span className="min-w-0">
                <span className="block max-w-52 truncate text-[12px] text-ink">{b.filename}</span>
                <span className="block text-[10px] text-muted">
                  {storlek(b.size_bytes)}
                  {b.inline && ' · inbäddad'}
                  {v === 'ingen' && ' · laddas ner'}
                </span>
              </span>
            </button>
          )
        })}
        {inbaddade.length > 0 && !visaInbaddade && (
          <button
            onClick={() => setVisaInbaddade(true)}
            className="shrink-0 rounded-xl border border-dashed border-border px-2.5 py-2 text-[11px] text-muted transition-colors hover:text-ink"
          >
            +{inbaddade.length} inbäddade
          </button>
        )}
        {riktiga.length > 1 && (
          <button
            disabled={laddarNer === 'alla'}
            onClick={async () => {
              setLaddarNer('alla'); setFel(null)
              try {
                for (const b of riktiga) laddaNer(await hamta(b), b.filename)
              } catch (e) {
                setFel(String(e instanceof Error ? e.message : e))
              } finally { setLaddarNer(null) }
            }}
            className="ml-auto shrink-0 rounded-xl border border-border px-2.5 py-2 text-[11px] text-muted transition-colors hover:text-ink disabled:opacity-50"
          >
            {laddarNer === 'alla' ? 'Hämtar…' : '⬇ Alla'}
          </button>
        )}
      </div>
      {fel && <p className="mt-1.5 text-[11px] text-bad">{fel}</p>}

      {oppen !== null && synliga[oppen] && (
        <Forhandsvisning
          bilagor={synliga}
          index={oppen}
          setIndex={setOppen}
          hamta={hamta}
          onStang={() => setOppen(null)}
        />
      )}
    </div>
  )
}

/* ── Bifoga filer till utgående mejl ──────────────────────── */

export interface UtgaendeBilaga {
  filename: string
  contentType: string
  dataBase64: string
  storlek: number
}

/** Servern nekar över 15 MB, så vi säger till här i stället för att låta
 *  användaren skriva klart ett mejl som ändå inte går att skicka. */
export const MAX_UTGAENDE = 15 * 1024 * 1024

function tillBas64(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf)
  let bin = ''
  // I bitar — String.fromCharCode tar inte emot hur många argument som helst
  const steg = 0x8000
  for (let i = 0; i < bytes.length; i += steg) {
    bin += String.fromCharCode(...bytes.subarray(i, i + steg))
  }
  return btoa(bin)
}

/** Hämtar en Drive-fil som bilaga. Googles egna dokumentformat har inget
 *  innehåll att ladda ner, så servern exporterar dem — därför kan namnet som
 *  kommer tillbaka skilja sig från det i Drive. */
async function hamtaFranDrive(fileId: string): Promise<UtgaendeBilaga> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Inte inloggad')
  const res = await fetch(`${supabaseUrl}/functions/v1/drive-fil`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: supabaseKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fileId }),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(j.fel ?? `Servern svarade ${res.status}`)
  return {
    filename: j.filename,
    contentType: j.mimeType,
    dataBase64: j.dataBase64,
    storlek: j.bytes,
  }
}

export function Bifoga({ bilagor, setBilagor }: {
  bilagor: UtgaendeBilaga[]
  setBilagor: (b: UtgaendeBilaga[]) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [laser, setLaser] = useState(false)
  const [driveOppen, setDriveOppen] = useState(false)
  const [driveFel, setDriveFel] = useState<string | null>(null)
  const [hamtarDrive, setHamtarDrive] = useState<string | null>(null)
  const summa = bilagor.reduce((s, b) => s + b.storlek, 0)

  async function franDrive(f: DriveFil) {
    setHamtarDrive(f.file_id)
    setDriveFel(null)
    try {
      const b = await hamtaFranDrive(f.file_id)
      setBilagor([...bilagor, b])
      setDriveOppen(false)
    } catch (e) {
      setDriveFel(e instanceof Error ? e.message : String(e))
    } finally {
      setHamtarDrive(null)
    }
  }

  return (
    <div>
      <input
        ref={input}
        type="file"
        multiple
        className="hidden"
        onChange={async (e) => {
          const filer = [...(e.target.files ?? [])]
          e.target.value = ''
          if (!filer.length) return
          setLaser(true)
          const nya: UtgaendeBilaga[] = []
          for (const f of filer) {
            nya.push({
              filename: f.name,
              contentType: f.type || 'application/octet-stream',
              dataBase64: tillBas64(await f.arrayBuffer()),
              storlek: f.size,
            })
          }
          setBilagor([...bilagor, ...nya])
          setLaser(false)
        }}
      />
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={laser}
          onClick={() => input.current?.click()}
          className="rounded-lg border border-border px-2 py-1 text-[11px] text-muted transition-colors hover:text-ink disabled:opacity-50"
        >
          {laser ? 'Läser…' : '📎 Bifoga fil'}
        </button>
        <button
          type="button"
          onClick={() => { setDriveOppen(true); setDriveFel(null) }}
          className="rounded-lg border border-border px-2 py-1 text-[11px] text-muted transition-colors hover:text-ink"
        >
          ☁ Från Drive
        </button>
        {bilagor.map((b, i) => (
          <span key={i} className="flex items-center gap-1 rounded-lg border border-border bg-surface px-2 py-1 text-[11px] text-muted">
            <span className="max-w-40 truncate text-ink">{b.filename}</span>
            <span>{storlek(b.storlek)}</span>
            <button
              type="button"
              onClick={() => setBilagor(bilagor.filter((_, j) => j !== i))}
              className="text-muted hover:text-bad"
              aria-label={`Ta bort ${b.filename}`}
            >✕</button>
          </span>
        ))}
      </div>
      {summa > MAX_UTGAENDE && (
        <p className="mt-1 text-[11px] text-bad">
          {storlek(summa)} totalt — servern tar emot högst 15 MB. Ta bort något.
        </p>
      )}

      {driveOppen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-4 backdrop-blur-sm sm:p-8"
          onClick={() => setDriveOppen(false)}
        >
          <div
            className="w-full max-w-2xl rounded-2xl border border-border bg-card p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-sm font-semibold">Bifoga från Drive</h2>
              <button
                type="button"
                onClick={() => setDriveOppen(false)}
                className="ml-auto rounded-lg px-2 py-1 text-lg leading-none text-muted hover:text-ink"
                aria-label="Stäng"
              >✕</button>
            </div>
            {driveFel && (
              <p className="mb-2 rounded-xl border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad">{driveFel}</p>
            )}
            {hamtarDrive && (
              <p className="mb-2 rounded-xl border border-border bg-surface px-3 py-2 text-xs text-muted">
                Hämtar filen från Google…
              </p>
            )}
            <DriveSok onValj={franDrive} valjEtikett="Bifoga" hojd="max-h-[22rem]" />
            <p className="mt-2 text-[11px] text-muted">
              Google-dokument och presentationer bifogas som PDF, kalkylark som xlsx —
              de har inget eget filformat att skicka. Över 10 MB får du skicka en länk
              i stället.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Förhandsvisning ──────────────────────────────────────── */

function Forhandsvisning({ bilagor, index, setIndex, hamta, onStang }: {
  bilagor: Bilaga[]
  index: number
  setIndex: (i: number) => void
  hamta: (b: Bilaga) => Promise<Blob>
  onStang: () => void
}) {
  const b = bilagor[index]
  const visning = klassa(b)
  const [blob, setBlob] = useState<Blob | null>(null)
  const [text, setText] = useState<string | null>(null)
  const [bildUrl, setBildUrl] = useState<string | null>(null)
  const [hamtar, setHamtar] = useState(false)
  const [fel, setFel] = useState<string | null>(null)

  useEffect(() => {
    const tangent = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onStang()
      else if (e.key === 'ArrowRight' && index < bilagor.length - 1) setIndex(index + 1)
      else if (e.key === 'ArrowLeft' && index > 0) setIndex(index - 1)
    }
    window.addEventListener('keydown', tangent)
    return () => window.removeEventListener('keydown', tangent)
  }, [index, bilagor.length, setIndex, onStang])

  useEffect(() => {
    let avbruten = false
    let skapadUrl: string | null = null
    setBlob(null); setText(null); setBildUrl(null); setFel(null)
    // Format vi inte visar behöver inte hämtas i onödan — användaren får
    // trycka på nedladdningsknappen.
    if (visning === 'ingen') return
    setHamtar(true)
    ;(async () => {
      try {
        const data = await hamta(b)
        if (avbruten) return
        setBlob(data)
        if (visning === 'bild') {
          // Blobben från servern är octet-stream; typen sätts här, av oss,
          // och bara till en typ vi själva har godkänt som bild.
          skapadUrl = URL.createObjectURL(new Blob([data], { type: b.content_type.split(';')[0].trim() }))
          setBildUrl(skapadUrl)
        } else if (visning === 'text') {
          const t = await data.text()
          if (!avbruten) setText(t.slice(0, 500000))
        }
      } catch (e) {
        if (!avbruten) setFel(e instanceof Error ? e.message : String(e))
      } finally {
        if (!avbruten) setHamtar(false)
      }
    })()
    return () => {
      avbruten = true
      if (skapadUrl) URL.revokeObjectURL(skapadUrl)
    }
  }, [b, visning, hamta])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/85 backdrop-blur-sm" onClick={onStang}>
      <div
        className="mx-auto flex h-full w-full max-w-5xl flex-col p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 rounded-t-2xl border border-border bg-card px-4 py-3">
          <span className="text-xl leading-none">{ikon(b)}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink">{b.filename}</p>
            <p className="text-[11px] text-muted">
              {b.content_type || 'okänd typ'}
              {b.size_bytes ? ` · ${storlek(b.size_bytes)}` : ''}
              {bilagor.length > 1 && ` · ${index + 1} av ${bilagor.length}`}
            </p>
          </div>
          {bilagor.length > 1 && (
            <span className="flex shrink-0 items-center gap-1">
              <button
                disabled={index === 0}
                onClick={() => setIndex(index - 1)}
                className="rounded-lg border border-border px-2 py-1 text-xs text-muted hover:text-ink disabled:opacity-30"
              >←</button>
              <button
                disabled={index === bilagor.length - 1}
                onClick={() => setIndex(index + 1)}
                className="rounded-lg border border-border px-2 py-1 text-xs text-muted hover:text-ink disabled:opacity-30"
              >→</button>
            </span>
          )}
          <button
            disabled={hamtar}
            onClick={async () => {
              try {
                laddaNer(blob ?? await hamta(b), b.filename)
              } catch (e) {
                setFel(e instanceof Error ? e.message : String(e))
              }
            }}
            className="shrink-0 rounded-xl bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-soft disabled:opacity-50"
          >⬇ Ladda ner</button>
          <button onClick={onStang} className="shrink-0 rounded-lg px-2 py-1 text-lg leading-none text-muted hover:text-ink">✕</button>
        </div>

        <div className="flex-1 overflow-auto rounded-b-2xl border border-t-0 border-border bg-surface p-4">
          {hamtar && <p className="py-16 text-center text-sm text-muted">Hämtar filen från servern…</p>}
          {fel && (
            <p className="mx-auto max-w-md rounded-xl border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
              Kunde inte hämta bilagan: {fel}
            </p>
          )}

          {!hamtar && !fel && visning === 'bild' && bildUrl && (
            <img src={bildUrl} alt={b.filename} className="mx-auto max-w-full rounded-xl bg-white" />
          )}

          {!hamtar && !fel && visning === 'text' && text !== null && (
            <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-ink/90">
              {text || '(tom fil)'}
            </pre>
          )}

          {!hamtar && !fel && visning === 'pdf' && blob && <PdfVisare blob={blob} />}

          {visning === 'ingen' && (
            <div className="py-16 text-center">
              <p className="mb-2 text-4xl">{ikon(b)}</p>
              <p className="text-sm text-ink">Den här filtypen visas inte i webbläsaren.</p>
              <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-muted">
                Office-dokument, SVG, HTML och arkiv kan bära med sig kod, och Hubben
                packar därför aldrig upp dem åt dig. Ladda ner filen och öppna den i
                ett program du litar på.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── PDF via pdf.js ───────────────────────────────────────── */

function PdfVisare({ blob }: { blob: Blob }) {
  const [sidor, setSidor] = useState(0)
  const [sida, setSida] = useState(1)
  const [fel, setFel] = useState<string | null>(null)
  const [redo, setRedo] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dok = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const laddning = useRef<any>(null)

  useEffect(() => {
    let avbruten = false
    setRedo(false); setFel(null); setSidor(0); setSida(1)
    ;(async () => {
      try {
        // Laddas först när en PDF faktiskt öppnas — annars skulle biblioteket
        // ligga i huvudpaketet och göra hela appen tyngre för alla.
        const pdfjs = await import('pdfjs-dist')
        const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default
        const bas = import.meta.env.BASE_URL
        const uppgift = pdfjs.getDocument({
          data: new Uint8Array(await blob.arrayBuffer()),
          enableXfa: false,     // XFA-formulär är en egen körmiljö — av
          disableAutoFetch: true,
          // Utan de här sökvägarna ritas PDF:er som förlitar sig på Helvetica,
          // Times eller Courier helt utan text. Filerna kopieras hit av
          // scripts/kopiera-pdf-resurser.mjs.
          standardFontDataUrl: `${bas}pdfjs/standard_fonts/`,
          cMapUrl: `${bas}pdfjs/cmaps/`,
          cMapPacked: true,
        })
        laddning.current = uppgift
        const d = await uppgift.promise
        if (avbruten) { uppgift.destroy(); return }
        dok.current = d
        setSidor(d.numPages)
        setRedo(true)
      } catch (e) {
        if (!avbruten) setFel(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      avbruten = true
      // Det är laddningsuppgiften som äger arbetartråden, inte dokumentet.
      laddning.current?.destroy?.()
      laddning.current = null
      dok.current = null
    }
  }, [blob])

  useEffect(() => {
    if (!redo || !dok.current) return
    let avbruten = false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let uppgift: any = null
    ;(async () => {
      try {
        const p = await dok.current.getPage(sida)
        const c = canvasRef.current
        if (avbruten || !c) return
        const ctx = c.getContext('2d')
        if (!ctx) return
        const tillgangligBredd = c.parentElement?.clientWidth ?? 800
        const dpr = window.devicePixelRatio || 1
        const grund = p.getViewport({ scale: 1 })
        const viewport = p.getViewport({ scale: (Math.min(1.6, tillgangligBredd / grund.width)) * dpr })
        c.width = viewport.width
        c.height = viewport.height
        c.style.width = `${viewport.width / dpr}px`
        c.style.height = 'auto'
        uppgift = p.render({ canvasContext: ctx, viewport })
        await uppgift.promise
      } catch (e) {
        // Avbruten rendering vid snabbt sidbyte är väntat och inget fel.
        if (!avbruten && !/cancel/i.test(String(e))) setFel(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => { avbruten = true; uppgift?.cancel?.() }
  }, [sida, redo])

  if (fel) {
    return (
      <p className="mx-auto max-w-md rounded-xl border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
        Kunde inte läsa PDF:en: {fel}. Ladda ner den i stället.
      </p>
    )
  }
  if (!redo) return <p className="py-16 text-center text-sm text-muted">Öppnar PDF:en…</p>

  return (
    <div>
      {sidor > 1 && (
        <div className="mb-3 flex items-center justify-center gap-3 text-xs text-muted">
          <button
            disabled={sida === 1}
            onClick={() => setSida(sida - 1)}
            className="rounded-lg border border-border px-2 py-1 hover:text-ink disabled:opacity-30"
          >← Föregående</button>
          <span>Sida {sida} av {sidor}</span>
          <button
            disabled={sida === sidor}
            onClick={() => setSida(sida + 1)}
            className="rounded-lg border border-border px-2 py-1 hover:text-ink disabled:opacity-30"
          >Nästa →</button>
        </div>
      )}
      <canvas ref={canvasRef} className="mx-auto rounded-xl bg-white shadow-lg" />
    </div>
  )
}
