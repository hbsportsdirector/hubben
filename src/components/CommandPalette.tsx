import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { getUserId } from '../lib/data'
import { tolkaText, beskrivTolkning } from '../lib/tolkaText'

interface Command {
  label: string
  emoji: string
  keywords: string
  hint?: string
  action: (navigate: ReturnType<typeof useNavigate>) => void
}

/** Ett förslag i listan — antingen ett kommando eller en infångning. */
interface Post {
  nyckel: string
  emoji: string
  text: string
  detalj?: string
  hint?: string
  kor: () => void | Promise<void>
}

const COMMANDS: Command[] = [
  { label: 'Ny uppgift', emoji: '✅', keywords: 'skapa task todo att göra', hint: 'skapa', action: (n) => n('/uppgifter?ny=1') },
  { label: 'Logga träningspass', emoji: '🤾', keywords: 'skapa workout träna pass gym handboll', hint: 'skapa', action: (n) => n('/traning?ny=1') },
  { label: 'Ny händelse', emoji: '📅', keywords: 'skapa event kalender möte boka', hint: 'skapa', action: (n) => n('/kalender?ny=1') },
  { label: 'Ny anteckning', emoji: '📝', keywords: 'skapa note skriv', hint: 'skapa', action: (n) => n('/anteckningar?ny=1') },
  { label: 'Ny transaktion', emoji: '💸', keywords: 'skapa utgift inkomst köp pengar', hint: 'skapa', action: (n) => n('/ekonomi?ny=1') },
  { label: 'Ny länk', emoji: '🔗', keywords: 'skapa bokmärke spara', hint: 'skapa', action: (n) => n('/lankar?ny=1') },
  { label: 'Starta veckogranskning', emoji: '🧭', keywords: 'vecka review granska planera fokus', hint: 'ritual', action: (n) => n('/vecka') },
  { label: 'Översikt', emoji: '🪐', keywords: 'hem dashboard start idag', hint: 'gå till', action: (n) => n('/') },
  { label: 'Uppgifter & Mål', emoji: '✅', keywords: 'tasks todo mål projekt', hint: 'gå till', action: (n) => n('/uppgifter') },
  { label: 'Vanor', emoji: '🔁', keywords: 'habits streak svit', hint: 'gå till', action: (n) => n('/vanor') },
  { label: 'Träning', emoji: '💪', keywords: 'workout gym handboll pass', hint: 'gå till', action: (n) => n('/traning') },
  { label: 'Kalender', emoji: '📅', keywords: 'schema månad händelser', hint: 'gå till', action: (n) => n('/kalender') },
  { label: 'Anteckningar', emoji: '📝', keywords: 'notes idéer', hint: 'gå till', action: (n) => n('/anteckningar') },
  { label: 'Länkar', emoji: '🔗', keywords: 'bokmärken', hint: 'gå till', action: (n) => n('/lankar') },
  { label: 'Ekonomi', emoji: '💰', keywords: 'budget pengar transaktioner sparmål', hint: 'gå till', action: (n) => n('/ekonomi') },
  { label: 'Inställningar', emoji: '⚙️', keywords: 'mejl konton lösenord imap konfiguration', hint: 'gå till', action: (n) => n('/installningar') },
]

export default function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [sparar, setSparar] = useState(false)
  const [fel, setFel] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
        setQuery('')
        setSelected(0)
        setFel(null)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 10)
  }, [open])

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim()
    if (!q) return COMMANDS
    return COMMANDS.filter((c) => (c.label + ' ' + c.keywords).toLowerCase().includes(q))
  }, [query])

  const tolkning = useMemo(() => tolkaText(query), [query])
  const tid = beskrivTolkning(tolkning)

  /** Skriver först, navigerar sedan dit saken hamnade — man ska se resultatet,
   *  inte lita på att det gick. Går det fel står felet kvar i rutan; förr i
   *  Hubben stängdes rutan ändå och raden bara försvann. */
  async function skriv(gor: () => Promise<string | null>, vart: string) {
    if (sparar) return
    setSparar(true)
    setFel(null)
    try {
      const problem = await gor()
      if (problem) { setFel(problem); return }
      setOpen(false)
      navigate(vart)
    } catch (e) {
      setFel(e instanceof Error ? e.message : String(e))
    } finally {
      setSparar(false)
    }
  }

  const skapaUppgift = () => skriv(async () => {
    const { error } = await supabase.from('hub_tasks').insert({
      user_id: await getUserId(),
      title: tolkning.titel,
      due_date: tolkning.datum,
      priority: 2,
    })
    return error?.message ?? null
  }, '/uppgifter')

  const skapaAnteckning = () => skriv(async () => {
    const { error } = await supabase.from('hub_notes').insert({
      user_id: await getUserId(),
      title: tolkning.titel,
      content: '',
    })
    return error?.message ?? null
  }, '/anteckningar')

  const skapaHandelse = () => skriv(async () => {
    // Samma förval som i kalendern: den kalender man faktiskt tittar i, annars
    // den första påslagna. Har man ingen alls blir händelsen lokal.
    const { data: kalendrar } = await supabase
      .from('hub_calendars').select('id, color, synlig').eq('aktiv', true).order('namn')
    const kal = kalendrar?.find((k) => k.synlig) ?? kalendrar?.[0] ?? null

    const datum = tolkning.datum ?? new Date().toISOString().slice(0, 10)
    // Heldagar lagras som midnatt UTC, precis som de vi hämtar från Google —
    // med lokal midnatt pekar datumdelen på fel dag när den skickas tillbaka.
    const start = tolkning.start ? new Date(`${datum}T${tolkning.start}:00`) : new Date(`${datum}T00:00:00Z`)
    const slut = tolkning.slut ? new Date(`${datum}T${tolkning.slut}:00`) : null

    const { error } = await supabase.from('hub_events').insert({
      user_id: await getUserId(),
      title: tolkning.titel,
      starts_at: start.toISOString(),
      ends_at: slut ? slut.toISOString() : null,
      all_day: !tolkning.start,
      color: kal?.color ?? '#6366f1',
      calendar_id: kal?.id ?? null,
      // Kalendersidan betar av kön när den öppnas, och dit navigerar vi nu.
      ...(kal ? { pending_op: 'skapa', pending_nasta: new Date().toISOString(), pending_forsok: 0 } : {}),
    })
    return error?.message ?? null
  }, '/kalender')

  /** Fritext eller kommando? Kommandon är korta ("kal", "vecka"); det man
   *  fångar in är längre eller bär ett datum. Tre ord är gränsen som gör att
   *  "Ring tandläkaren imorgon" blir en uppgift medan "kalender" navigerar. */
  const infangningar = useMemo<Post[]>(() => {
    if (!tolkning.titel) return []
    const uppgift: Post = {
      nyckel: 'ny-uppgift', emoji: '✅', hint: 'skapa',
      text: `Uppgift: ${tolkning.titel}`,
      detalj: tolkning.datum ? `deadline ${tid}` : undefined,
      kor: skapaUppgift,
    }
    const handelse: Post = {
      nyckel: 'ny-handelse', emoji: '📅', hint: 'skapa',
      text: `Händelse: ${tolkning.titel}`,
      detalj: tid ?? undefined,
      kor: skapaHandelse,
    }
    const anteckning: Post = {
      nyckel: 'ny-anteckning', emoji: '📝', hint: 'skapa',
      text: `Anteckning: ${tolkning.titel}`,
      kor: skapaAnteckning,
    }
    // Står det ett klockslag är det nästan alltid något som ska in i kalendern
    return tolkning.start ? [handelse, uppgift, anteckning] : [uppgift, handelse, anteckning]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tolkning, tid])

  const poster = useMemo<Post[]>(() => {
    const kommandon: Post[] = filtered.map((c) => ({
      nyckel: 'cmd-' + c.label, emoji: c.emoji, text: c.label, hint: c.hint,
      kor: () => { setOpen(false); c.action(navigate) },
    }))
    if (!query.trim()) return kommandon
    const ord = query.trim().split(/\s+/).length
    const arFritext = ord >= 3 || !!tolkning.datum || !!tolkning.start || kommandon.length === 0
    return arFritext ? [...infangningar, ...kommandon] : [...kommandon, ...infangningar]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, infangningar, query, tolkning])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[15vh]" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative z-10 w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setSelected(0) }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((s) => Math.min(s + 1, poster.length - 1)) }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)) }
            if (e.key === 'Enter' && poster[selected]) { e.preventDefault(); void poster[selected].kor() }
          }}
          placeholder="Skriv vad som helst — eller ett kommando…"
          className="w-full border-b border-border bg-transparent px-4 py-3.5 text-sm text-ink placeholder:text-muted/60 outline-none"
        />
        <ul className="max-h-80 overflow-y-auto p-2">
          {poster.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">Inga träffar</li>}
          {poster.map((p, i) => (
            <li key={p.nyckel}>
              <button
                onClick={() => void p.kor()}
                onMouseEnter={() => setSelected(i)}
                disabled={sparar}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors disabled:opacity-50 ${
                  i === selected ? 'bg-accent/15 text-ink' : 'text-muted'
                }`}
              >
                <span aria-hidden>{p.emoji}</span>
                <span className="min-w-0 flex-1 truncate">{p.text}</span>
                {/* Det tolken förstod, framme innan man trycker Enter */}
                {p.detalj && <span className="shrink-0 text-[11px] text-accent-soft">{p.detalj}</span>}
                {p.hint && <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted/70">{p.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
        {fel && (
          <p className="border-t border-border bg-bad/10 px-4 py-2 text-xs text-bad">Sparades inte: {fel}</p>
        )}
        <div className="border-t border-border px-4 py-2 text-[10px] text-muted">
          ↑↓ navigera · Enter välj · Esc stäng
        </div>
      </div>
    </div>
  )
}
