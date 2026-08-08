import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

interface Command {
  label: string
  emoji: string
  keywords: string
  hint?: string
  action: (navigate: ReturnType<typeof useNavigate>) => void
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
]

export default function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
        setQuery('')
        setSelected(0)
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

  function run(cmd: Command) {
    setOpen(false)
    cmd.action(navigate)
  }

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
            if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((s) => Math.min(s + 1, filtered.length - 1)) }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)) }
            if (e.key === 'Enter' && filtered[selected]) run(filtered[selected])
          }}
          placeholder="Skriv ett kommando eller sök…"
          className="w-full border-b border-border bg-transparent px-4 py-3.5 text-sm text-ink placeholder:text-muted/60 outline-none"
        />
        <ul className="max-h-80 overflow-y-auto p-2">
          {filtered.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">Inga träffar</li>}
          {filtered.map((cmd, i) => (
            <li key={cmd.label}>
              <button
                onClick={() => run(cmd)}
                onMouseEnter={() => setSelected(i)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${
                  i === selected ? 'bg-accent/15 text-ink' : 'text-muted'
                }`}
              >
                <span aria-hidden>{cmd.emoji}</span>
                <span className="flex-1">{cmd.label}</span>
                {cmd.hint && <span className="text-[10px] uppercase tracking-wider text-muted/70">{cmd.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
        <div className="border-t border-border px-4 py-2 text-[10px] text-muted">
          ↑↓ navigera · Enter välj · Esc stäng
        </div>
      </div>
    </div>
  )
}
