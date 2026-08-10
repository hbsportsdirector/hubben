import { useCallback, useEffect, useState } from 'react'
import { format, addHours } from 'date-fns'
import { sv } from 'date-fns/locale'
import { supabase, supabaseUrl, supabaseKey } from '../lib/supabase'
import { getUserId } from '../lib/data'
import { tolkaTid } from '../pages/Calendar'

interface Kalender { id: string; namn: string; color: string }

/** Gör en uppgift eller en kalenderhändelse av ett mejl.
 *
 *  Per har mejlat sig själv "Uppgift: …" sedan 2021 — tjugotre gånger bara i
 *  det vi hämtat hem. Det här är samma sak utan omvägen via inkorgen, och
 *  uppgiften behåller en länk tillbaka till mejlet den kom ur. */
export function MejlTillHubben({ msgId, amne, franEpost, onKlart }: {
  msgId: string
  amne: string
  franEpost: string | null
  onKlart?: (text: string) => void
}) {
  const [oppen, setOppen] = useState<'uppgift' | 'handelse' | null>(null)
  const [titel, setTitel] = useState('')
  const [datum, setDatum] = useState('')
  const [tid, setTid] = useState('09:00')
  const [kalendrar, setKalendrar] = useState<Kalender[]>([])
  const [valdKalender, setValdKalender] = useState('')
  const [sparar, setSparar] = useState(false)
  const [fel, setFel] = useState<string | null>(null)

  const laddaKalendrar = useCallback(async () => {
    const { data } = await supabase
      .from('hub_calendars').select('id, namn, color').eq('aktiv', true).order('namn')
    const lista = (data as Kalender[]) ?? []
    setKalendrar(lista)
    setValdKalender((v) => v || lista[0]?.id || '')
  }, [])

  useEffect(() => {
    if (oppen === 'handelse') laddaKalendrar()
  }, [oppen, laddaKalendrar])

  function oppna(vad: 'uppgift' | 'handelse') {
    // Ämnesraden är nästan alltid det man vill kalla saken
    setTitel(amne || '(inget ämne)')
    setDatum(format(new Date(), 'yyyy-MM-dd'))
    setTid(format(addHours(new Date(), 1), 'HH:00'))
    setFel(null)
    setOppen(vad)
  }

  async function sparaUppgift() {
    if (!titel.trim()) return
    setSparar(true); setFel(null)
    const userId = await getUserId()
    const { error } = await supabase.from('hub_tasks').insert({
      user_id: userId,
      title: titel.trim(),
      due_date: datum || null,
      priority: 2,
      done: false,
      sort_order: Date.now(),
      mail_msg_id: msgId,
      mail_avsandare: franEpost,
    })
    setSparar(false)
    if (error) { setFel(error.message); return }
    setOppen(null)
    onKlart?.('Uppgiften är skapad')
  }

  async function sparaHandelse() {
    if (!titel.trim() || !datum) return
    setSparar(true); setFel(null)
    const klockslag = tolkaTid(tid) ?? '09:00'
    const start = new Date(`${datum}T${klockslag}:00`)
    const userId = await getUserId()
    const { error } = await supabase.from('hub_events').insert({
      user_id: userId,
      title: titel.trim(),
      starts_at: start.toISOString(),
      ends_at: addHours(start, 1).toISOString(),
      all_day: false,
      color: kalendrar.find((k) => k.id === valdKalender)?.color ?? '#38bdf8',
      calendar_id: valdKalender || null,
      // Samma kö som allt annat: databasen först, Google strax efter
      ...(valdKalender
        ? { pending_op: 'skapa', pending_nasta: new Date().toISOString(), pending_forsok: 0 }
        : {}),
    })
    if (!error && valdKalender) {
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        await fetch(`${supabaseUrl}/functions/v1/calendar-push`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.access_token}`, apikey: supabaseKey },
        }).catch(() => {})
      }
    }
    setSparar(false)
    if (error) { setFel(error.message); return }
    setOppen(null)
    onKlart?.(valdKalender ? 'Inbokat, och på väg till Google' : 'Inbokat i Hubben')
  }

  return (
    <>
      <Verktygsknapp ikon="✅" text="Uppgift" onClick={() => oppna('uppgift')} />
      <Verktygsknapp ikon="📅" text="Boka in" onClick={() => oppna('handelse')} />

      {oppen && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOppen(null)} />
          <div className="absolute left-3 top-full z-40 mt-1 w-80 rounded-xl border border-border bg-card p-3 shadow-2xl">
            <p className="mb-2 text-xs font-medium text-ink">
              {oppen === 'uppgift' ? 'Ny uppgift från mejlet' : 'Boka in mejlet'}
            </p>

            <input
              autoFocus
              value={titel}
              onChange={(e) => setTitel(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent"
            />

            <div className="mt-2 flex gap-2">
              <input
                type="date"
                value={datum}
                onChange={(e) => setDatum(e.target.value)}
                className="flex-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-ink outline-none focus:border-accent"
              />
              {oppen === 'handelse' && (
                <input
                  value={tid}
                  onChange={(e) => setTid(e.target.value)}
                  onBlur={(e) => setTid(tolkaTid(e.target.value) ?? tid)}
                  placeholder="18 eller 18:30"
                  inputMode="numeric"
                  className="w-24 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-ink outline-none focus:border-accent"
                />
              )}
            </div>
            {oppen === 'uppgift' && (
              <p className="mt-1 text-[11px] text-muted">Datum är valfritt — lämna det som det är eller töm det.</p>
            )}

            {oppen === 'handelse' && kalendrar.length > 0 && (
              <select
                value={valdKalender}
                onChange={(e) => setValdKalender(e.target.value)}
                className="mt-2 w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-ink outline-none focus:border-accent"
              >
                {kalendrar.map((k) => <option key={k.id} value={k.id}>{k.namn}</option>)}
                <option value="">Bara i Hubben</option>
              </select>
            )}

            {fel && <p className="mt-2 text-[11px] text-bad">{fel}</p>}

            <div className="mt-3 flex items-center justify-between">
              <button onClick={() => setOppen(null)} className="text-xs text-muted hover:text-ink">Avbryt</button>
              <button
                disabled={sparar || !titel.trim() || (oppen === 'handelse' && !datum)}
                onClick={oppen === 'uppgift' ? sparaUppgift : sparaHandelse}
                className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-soft disabled:opacity-50"
              >
                {sparar ? 'Sparar…' : oppen === 'uppgift' ? 'Skapa uppgift' : 'Boka in'}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  )
}

function Verktygsknapp({ ikon, text, onClick }: { ikon: string; text: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-card-hover hover:text-ink"
    >
      <span aria-hidden>{ikon}</span>
      {text}
    </button>
  )
}

/** Dagens schema, bredvid inkorgen. Man vill veta vad man har innan man
 *  svarar på något — inte efteråt. */
export function DagensSchema() {
  const [handelser, setHandelser] = useState<{ id: string; title: string; starts_at: string; all_day: boolean; color: string }[]>([])

  useEffect(() => {
    const nu = new Date()
    const start = new Date(nu.getFullYear(), nu.getMonth(), nu.getDate())
    const slut = new Date(start.getTime() + 86400000)
    supabase
      .from('hub_events')
      .select('id, title, starts_at, all_day, color')
      .or('pending_op.is.null,pending_op.neq.radera')
      .gte('starts_at', start.toISOString())
      .lt('starts_at', slut.toISOString())
      .order('starts_at')
      .then(({ data }) => setHandelser(data ?? []))
  }, [])

  if (!handelser.length) return null

  return (
    <div>
      <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
        Idag · {format(new Date(), 'EEEE d MMM', { locale: sv })}
      </p>
      <div className="space-y-0.5">
        {handelser.map((h) => (
          <div key={h.id} className="flex items-baseline gap-2 rounded-lg px-2 py-1 text-[12px]">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: h.color }} />
            <span className="w-10 shrink-0 tabular-nums text-muted">
              {h.all_day ? '—' : format(new Date(h.starts_at), 'HH:mm')}
            </span>
            <span className="truncate text-ink">{h.title}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
