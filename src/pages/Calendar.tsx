import { useEffect, useState, useCallback, useMemo } from 'react'
import { Calendar as BigCalendar, Views } from 'react-big-calendar'
import type { View, SlotInfo, ToolbarProps } from 'react-big-calendar'
import withDragAndDrop from 'react-big-calendar/lib/addons/dragAndDrop'
import { format, parseISO, addHours, startOfWeek, endOfWeek, startOfMonth, endOfMonth, addDays, getISOWeek } from 'date-fns'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css'
import '../styles/calendar.css'
import { supabase, supabaseUrl, supabaseKey } from '../lib/supabase'
import { getUserId } from '../lib/data'
import { useNewParam } from '../lib/useNewParam'
import { localizer, messages, formats } from '../lib/calendarLocale'
import type { HubEvent } from '../lib/types'
import { Card, Button, Input, Label, Modal, Spinner, Textarea } from '../components/ui'

const EVENT_COLORS = ['#38bdf8', '#6366f1', '#34d399', '#fbbf24', '#f87171', '#e879f9']

const VECKODAGAR = [
  { kod: 'MO', namn: 'må' }, { kod: 'TU', namn: 'ti' }, { kod: 'WE', namn: 'on' },
  { kod: 'TH', namn: 'to' }, { kod: 'FR', namn: 'fr' }, { kod: 'SA', namn: 'lö' },
  { kod: 'SU', namn: 'sö' },
]

type Upprepning = 'aldrig' | 'dag' | 'vecka' | 'varannan' | 'manad' | 'ar'

const UPPREPNINGAR: { id: Upprepning; namn: string }[] = [
  { id: 'aldrig', namn: 'Upprepas inte' },
  { id: 'dag', namn: 'Varje dag' },
  { id: 'vecka', namn: 'Varje vecka' },
  { id: 'varannan', namn: 'Varannan vecka' },
  { id: 'manad', namn: 'Varje månad' },
  { id: 'ar', namn: 'Varje år' },
]

/** Bygger en upprepningsregel enligt RFC 5545. Vi tolkar den aldrig själva —
 *  Google expanderar serien och ger tillbaka de enskilda tillfällena. */
export function byggRrule(u: Upprepning, dagar: string[], tillOchMed: string, heldag = false): string | null {
  if (u === 'aldrig') return null
  const delar: string[] = []
  if (u === 'dag') delar.push('FREQ=DAILY')
  else if (u === 'manad') delar.push('FREQ=MONTHLY')
  else if (u === 'ar') delar.push('FREQ=YEARLY')
  else {
    delar.push('FREQ=WEEKLY')
    if (u === 'varannan') delar.push('INTERVAL=2')
    if (dagar.length) delar.push('BYDAY=' + dagar.join(','))
  }
  if (tillOchMed) {
    // UNTIL är inklusive, och måste ha SAMMA form som starttiden (RFC 5545):
    // bara datum för en heldagsserie, datum-och-tid i UTC för en tidsatt.
    // Skickar man tid på en heldagsserie kan Google avvisa hela regeln.
    const d = tillOchMed.replace(/-/g, '')
    delar.push('UNTIL=' + (heldag ? d : d + 'T235900Z'))
  }
  return delar.join(';')
}

/** Tolkar tid som folk faktiskt skriver den.
 *
 *  Ett vanligt <input type="time"> kräver "10:00" — skriver man "10" händer
 *  ingenting. Den som lägger in trettio träningstider i rad märker det.
 *  "10", "1030", "10.30" och "10:30" ska alla duga. */
export function tolkaTid(rå: string): string | null {
  const s = rå.trim().replace(/[.,;]/g, ':')
  if (!s) return null

  const tvåDelar = s.match(/^(\d{1,2}):(\d{1,2})$/)
  if (tvåDelar) {
    const t = Number(tvåDelar[1])
    const m = Number(tvåDelar[2])
    if (t > 23 || m > 59) return null
    return `${String(t).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }

  const bara = s.match(/^(\d{1,4})$/)
  if (bara) {
    const d = bara[1]
    // 1–2 siffror är hela timmar, 3–4 siffror är timmar+minuter
    const t = d.length <= 2 ? Number(d) : Number(d.slice(0, d.length - 2))
    const m = d.length <= 2 ? 0 : Number(d.slice(-2))
    if (t > 23 || m > 59) return null
    return `${String(t).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }
  return null
}

interface Kalender {
  id: string
  namn: string
  color: string
  synlig: boolean
}

interface CalEvent {
  id: string
  title: string
  start: Date
  end: Date
  allDay: boolean
  color: string
  raw: HubEvent
}

const DnDCalendar = withDragAndDrop<CalEvent>(BigCalendar<CalEvent>)

export default function Calendar() {
  const [events, setEvents] = useState<CalEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<View>(Views.MONTH)
  const [date, setDate] = useState(new Date())
  const [modal, setModal] = useState(false)
  const [editEvent, setEditEvent] = useState<HubEvent | null>(null)
  const [slotStart, setSlotStart] = useState<Date | null>(null)
  const [slotEnd, setSlotEnd] = useState<Date | null>(null)

  // Hämta ett generöst fönster runt aktuellt datum så navigering känns direkt
  const [from, to] = useMemo(() => {
    if (view === Views.DAY) return [addDays(date, -2), addDays(date, 2)]
    if (view === Views.WEEK) return [addDays(startOfWeek(date, { weekStartsOn: 1 }), -7), addDays(endOfWeek(date, { weekStartsOn: 1 }), 7)]
    if (view === Views.AGENDA) return [addDays(date, -1), addDays(date, 40)]
    return [addDays(startOfMonth(date), -10), addDays(endOfMonth(date), 10)]
  }, [view, date])

  const [kalendrar, setKalendrar] = useState<Kalender[]>([])
  const [visaEgna, setVisaEgna] = useState(true)

  // Vad som faktiskt ritas ut. Kalendrarna vaxlas i sidhuvudet, precis som i
  // Google - synligheten sparas sa den overlever ett sidbyte.
  const synligaHandelser = useMemo(() => {
    const dolda = new Set(kalendrar.filter((k) => !k.synlig).map((k) => k.id))
    return events.filter((e) => (e.raw.calendar_id ? !dolda.has(e.raw.calendar_id) : visaEgna))
  }, [events, kalendrar, visaEgna])

  const laddaKalendrar = useCallback(async () => {
    // Bara de kalendrar som är påslagna i Inställningar. De avstängda ska inte
    // synas alls här — inte ens som ett avkryssat val.
    const { data } = await supabase
      .from('hub_calendars')
      .select('id, namn, color, synlig')
      .eq('aktiv', true)
      .order('namn')
    setKalendrar((data as Kalender[]) ?? [])
  }, [])

  async function vaxlaSynlig(k: Kalender) {
    setKalendrar((prev) => prev.map((x) => (x.id === k.id ? { ...x, synlig: !x.synlig } : x)))
    await supabase.from('hub_calendars').update({ synlig: !k.synlig }).eq('id', k.id)
  }

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('hub_events')
      .select('*')
      .or('pending_op.is.null,pending_op.neq.radera')
      .gte('starts_at', from.toISOString())
      .lte('starts_at', to.toISOString())
      .order('starts_at')
    setEvents(
      (data ?? []).map((e: HubEvent) => {
        const start = parseISO(e.starts_at)
        return {
          id: e.id,
          title: e.title,
          start,
          end: e.ends_at ? parseISO(e.ends_at) : (e.all_day ? start : addHours(start, 1)),
          allDay: e.all_day,
          color: e.color,
          raw: e,
        }
      }),
    )
    setLoading(false)
  }, [from, to])

  useEffect(() => { load() }, [load])
  useEffect(() => { laddaKalendrar() }, [laddaKalendrar])
  useNewParam(() => { setEditEvent(null); setSlotStart(null); setSlotEnd(null); setModal(true) })

  const [lastFast, setLastFast] = useState<string | null>(null)

  /** Skickar vidare det som koats till Google. Misslyckas det star handelsen
   *  kvar dar du lade den, med en markering, och kon forsoker igen. */
  const betaAvKon = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const res = await fetch(`${supabaseUrl}/functions/v1/calendar-push`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, apikey: supabaseKey },
      })
      const json = await res.json().catch(() => ({}))
      if (json.fel) {
        setLastFast(json.fel)
        setTimeout(() => setLastFast(null), 12000)
      } else if (json.problem?.length) {
        setLastFast(`Google tog inte emot: ${json.problem.map((x: { fel: string }) => x.fel).join(' · ')}`)
        setTimeout(() => setLastFast(null), 12000)
      }
    } catch { /* nasta gang */ }
    load()
  }, [load])

  async function persistTimes(ev: CalEvent, start: Date, end: Date, allDay: boolean) {
    setEvents((prev) => prev.map((x) => (x.id === ev.id ? { ...x, start, end, allDay } : x)))
    await supabase
      .from('hub_events')
      .update({
        starts_at: start.toISOString(),
        ends_at: allDay ? null : end.toISOString(),
        all_day: allDay,
        // Hor handelsen till en Google-kalender ska andringen dit ocksa
        ...(ev.raw.calendar_id ? { pending_op: 'andra', pending_nasta: new Date().toISOString(), pending_forsok: 0 } : {}),
      })
      .eq('id', ev.id)
    if (ev.raw.calendar_id) betaAvKon(); else load()
  }

  async function remove(id: string, omfattning: 'instans' | 'serie' = 'instans') {
    const rad = events.find((e) => e.id === id)?.raw
    setModal(false)
    if (rad?.calendar_id) {
      // Raden far ligga kvar tills Google slappt den - external_id behovs for
      // att kunna beratta vilken handelse det galler. Den goms ur vyn sa lange.
      await supabase.from('hub_events')
        .update({ pending_op: 'radera', pending_scope: rad.series_master_id ? omfattning : null, pending_nasta: new Date().toISOString(), pending_forsok: 0 })
        .eq('id', id)
      await betaAvKon()
    } else {
      await supabase.from('hub_events').delete().eq('id', id)
      load()
    }
  }

  function onSelectSlot(slot: SlotInfo) {
    setEditEvent(null)
    setSlotStart(slot.start as Date)
    setSlotEnd(slot.end as Date)
    setModal(true)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Kalender</h1>
        <Button onClick={() => { setEditEvent(null); setSlotStart(null); setSlotEnd(null); setModal(true) }}>
          + Ny händelse
        </Button>
      </div>

      {lastFast && (
        <p className="rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">{lastFast}</p>
      )}

      {kalendrar.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">Visa:</span>
          {kalendrar.map((k) => (
            <button
              key={k.id}
              onClick={() => vaxlaSynlig(k)}
              className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-xs transition-colors ${
                k.synlig
                  ? 'border-border bg-card text-ink'
                  : 'border-border/50 bg-transparent text-muted/60 line-through'
              }`}
              title={k.synlig ? 'Dölj den här kalendern' : 'Visa den här kalendern'}
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: k.synlig ? k.color : 'transparent', border: `1.5px solid ${k.color}` }}
              />
              {k.namn}
            </button>
          ))}
          {/* Händelser skapade i Hubben hör inte till någon Google-kalender */}
          <button
            onClick={() => setVisaEgna((v) => !v)}
            className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-xs transition-colors ${
              visaEgna ? 'border-border bg-card text-ink' : 'border-border/50 bg-transparent text-muted/60 line-through'
            }`}
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-full border-[1.5px] border-muted" style={{ background: visaEgna ? '#8b95ad' : 'transparent' }} />
            Bara i Hubben
          </button>
          {kalendrar.some((k) => !k.synlig) && (
            <button
              onClick={async () => {
                setKalendrar((prev) => prev.map((x) => ({ ...x, synlig: true })))
                setVisaEgna(true)
                await supabase.from('hub_calendars').update({ synlig: true }).eq('synlig', false)
              }}
              className="rounded-xl px-2 py-1 text-xs text-accent-soft hover:underline"
            >
              Visa alla
            </button>
          )}
        </div>
      )}

      <Card className="!p-4">
        {loading ? <Spinner /> : (
          <div style={{ height: '72vh', minHeight: 520 }}>
            <DnDCalendar
              localizer={localizer}
              culture="sv"
              messages={messages}
              formats={formats}
              events={synligaHandelser}
              view={view}
              onView={setView}
              date={date}
              onNavigate={setDate}
              views={[Views.MONTH, Views.WEEK, Views.DAY, Views.AGENDA]}
              step={30}
              timeslots={2}
              scrollToTime={new Date(1970, 0, 1, 7, 0)}
              popup
              selectable
              onSelectSlot={onSelectSlot}
              onSelectEvent={(ev) => { setEditEvent(ev.raw); setModal(true) }}
              onEventDrop={({ event, start, end, isAllDay }) =>
                persistTimes(event, start as Date, end as Date, Boolean(isAllDay))
              }
              onEventResize={({ event, start, end }) =>
                persistTimes(event, start as Date, end as Date, event.allDay)
              }
              resizable
              components={{ toolbar: SwedishToolbar }}
              eventPropGetter={(ev) => ({ style: { backgroundColor: ev.color } })}
              dayLayoutAlgorithm="no-overlap"
              style={{ height: '100%' }}
            />
          </div>
        )}
      </Card>

      <p className="text-xs text-muted">
        Tips: dra i en händelse för att flytta den, dra i kanten för att ändra längd, eller markera ett tidsspann för att skapa en ny.
      </p>

      <EventModal
        open={modal}
        onClose={() => setModal(false)}
        event={editEvent}
        initialStart={slotStart}
        initialEnd={slotEnd}
        kalendrar={kalendrar}
        onSaved={(tillGoogle) => (tillGoogle ? betaAvKon() : load())}
        onDelete={remove}
      />
    </div>
  )
}

function SwedishToolbar({ label, onNavigate, onView, view, date }: ToolbarProps<CalEvent>) {
  const views: { key: View; label: string }[] = [
    { key: Views.MONTH, label: 'Månad' },
    { key: Views.WEEK, label: 'Vecka' },
    { key: Views.DAY, label: 'Dag' },
    { key: Views.AGENDA, label: 'Agenda' },
  ]
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-1">
        <button onClick={() => onNavigate('PREV')} className="rounded-lg px-2.5 py-1 text-muted hover:bg-card-hover hover:text-ink" aria-label="Föregående">←</button>
        <button onClick={() => onNavigate('TODAY')} className="rounded-lg border border-border px-3 py-1 text-xs font-medium text-muted hover:bg-card-hover hover:text-ink">Idag</button>
        <button onClick={() => onNavigate('NEXT')} className="rounded-lg px-2.5 py-1 text-muted hover:bg-card-hover hover:text-ink" aria-label="Nästa">→</button>
      </div>
      <h2 className="flex items-baseline gap-2 text-base font-semibold capitalize">
        {label}
        {/* Svensk idrott går på veckonummer — "vecka 33" är hur folk pratar */}
        <span className="text-xs font-normal normal-case text-muted">
          v. {getISOWeek(date as Date)}
        </span>
      </h2>
      <div className="flex gap-1">
        {views.map((v) => (
          <button
            key={v.key}
            onClick={() => onView(v.key)}
            className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
              view === v.key ? 'bg-accent/20 text-accent-soft' : 'text-muted hover:bg-card-hover hover:text-ink'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function EventModal({ open, onClose, event, initialStart, initialEnd, onSaved, onDelete, kalendrar }: {
  open: boolean
  onClose: () => void
  event: HubEvent | null
  initialStart: Date | null
  initialEnd: Date | null
  onSaved: (tillGoogle: boolean) => void
  onDelete: (id: string, omfattning: 'instans' | 'serie') => void
  kalendrar: Kalender[]
}) {
  // null = inget val gjort än. Skiljs från tom sträng, som betyder att Per
  // aktivt valt "Bara i Hubben". Utan den skillnaden kan en långsam
  // kalenderladdning tyst göra händelsen lokal.
  const [valdKalender, setValdKalender] = useState<string | null>(null)
  const [krockar, setKrockar] = useState<string[]>([])
  const [upprepning, setUpprepning] = useState<Upprepning>('aldrig')
  const [veckodagar, setVeckodagar] = useState<string[]>([])
  const [tillOchMed, setTillOchMed] = useState('')
  // Vad en ändring på ett tillfälle ur en serie ska gälla
  const [omfattning, setOmfattning] = useState<'instans' | 'serie'>('instans')

  // Ett tillfälle ur en serie — Google har expanderat den åt oss
  const iSerie = !!event?.series_master_id
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [location, setLocation] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('12:00')
  const [endTime, setEndTime] = useState('')
  const [allDay, setAllDay] = useState(false)
  const [color, setColor] = useState(EVENT_COLORS[0])

  useEffect(() => {
    if (!open) return
    if (event) {
      const start = parseISO(event.starts_at)
      setTitle(event.title)
      setDescription(event.description ?? '')
      setLocation(event.location ?? '')
      setDate(format(start, 'yyyy-MM-dd'))
      setTime(format(start, 'HH:mm'))
      setEndTime(event.ends_at ? format(parseISO(event.ends_at), 'HH:mm') : '')
      setAllDay(event.all_day)
      setColor(event.color)
      setValdKalender(event.calendar_id ?? '')
      // Serier ändras aldrig till en annan upprepning härifrån — det gör man
      // i Google. Här handlar det om att ändra tid, titel eller plats.
      setUpprepning('aldrig')
      setVeckodagar([])
      setTillOchMed('')
      setOmfattning('instans')
    } else {
      // Lämnas som null tills kalendrarna hunnit laddas — effekten nedanför
      // fyller i förvalet så fort de finns.
      setValdKalender(null)
      const start = initialStart ?? new Date()
      // Att klicka på en dag i månadsvyn markerar precis ett dygn. Det betyder
      // "ny händelse den dagen", inte "heldagshändelse" — heldag kryssas bara
      // i om man dragit över flera dagar.
      const isWholeDay = Boolean(initialStart && initialEnd && (initialEnd.getTime() - initialStart.getTime()) > 86_400_000)
      setTitle('')
      setDescription('')
      setLocation('')
      setDate(format(start, 'yyyy-MM-dd'))
      setTime(format(initialStart ?? new Date(), 'HH:mm'))
      setEndTime(initialEnd && !isWholeDay ? format(initialEnd, 'HH:mm') : '')
      setAllDay(isWholeDay)
      setColor(EVENT_COLORS[0])
      setUpprepning('aldrig')
      // Veckodagen som förval är den man valt — "varje vecka" betyder
      // nästan alltid samma veckodag som händelsen ligger på
      setVeckodagar([VECKODAGAR[(start.getDay() + 6) % 7].kod])
      setTillOchMed('')
      setOmfattning('instans')
    }
  }, [event, open, initialStart, initialEnd])

  // Kalendrarna kan landa efter att formuläret öppnats. Utan det här blev
  // förvalet "Bara i Hubben" och händelsen nådde aldrig Google.
  useEffect(() => {
    if (open && !event && valdKalender === null && kalendrar.length) {
      setValdKalender(kalendrar[0].id)
    }
  }, [open, event, kalendrar, valdKalender])

  // Krockvarning: som sportchef bokar man många lag, och en dubbelbokning
  // vill man se innan man sparar — inte efteråt.
  useEffect(() => {
    if (!open || !date) { setKrockar([]); return }
    let avbruten = false
    const starts = allDay ? new Date(`${date}T00:00:00`) : new Date(`${date}T${time}:00`)
    const ends = !allDay && endTime ? new Date(`${date}T${endTime}:00`) : addHours(starts, 1)
    ;(async () => {
      const { data } = await supabase
        .from('hub_events')
        .select('id, title, starts_at, ends_at, all_day')
        .lt('starts_at', ends.toISOString())
        .gte('starts_at', addDays(starts, -2).toISOString())
      if (avbruten) return
      type Rad = { id: string; title: string; starts_at: string; ends_at: string | null; all_day: boolean }
      const traffar = ((data ?? []) as Rad[])
        .filter((e) => e.id !== event?.id && !e.all_day && !allDay)
        .filter((e) => {
          const s = parseISO(e.starts_at)
          const sl = e.ends_at ? parseISO(e.ends_at) : addHours(s, 1)
          return s < ends && sl > starts
        })
        .map((e) => `${e.title} ${format(parseISO(e.starts_at), 'HH:mm')}`)
      setKrockar(traffar)
    })()
    return () => { avbruten = true }
  }, [open, date, time, endTime, allDay, event?.id])

  async function save() {
    if (!title.trim() || !date) return
    // Heldagar lagras som midnatt UTC, precis som de vi hämtar från Google.
    // Med lokal midnatt blev tidsstämpeln 22:00 dagen innan, och då pekade
    // datumdelen på fel dag när den skickades tillbaka till Google.
    // Tolkas även här, inte bara vid blur — trycker man Spara direkt efter att
    // ha skrivit "1830" hinner blur aldrig köra, och datumet blir ogiltigt.
    const start = tolkaTid(time) ?? '00:00'
    const slut = endTime.trim() ? tolkaTid(endTime) : null
    const starts = allDay ? new Date(`${date}T00:00:00Z`) : new Date(`${date}T${start}:00`)
    const ends = !allDay && slut ? new Date(`${date}T${slut}:00`) : null
    const payload = {
      title: title.trim(),
      description: description.trim() || null,
      location: location.trim() || null,
      starts_at: starts.toISOString(),
      ends_at: ends ? ends.toISOString() : null,
      all_day: allDay,
      color,
    }
    // Tom sträng betyder "bara i Hubben" — då finns inget att skicka till Google
    const kalenderId = valdKalender || null
    const ko = kalenderId
      ? {
          pending_op: event ? 'andra' : 'skapa',
          pending_scope: iSerie ? omfattning : null,
          pending_nasta: new Date().toISOString(),
          pending_forsok: 0,
        }
      : {}

    if (event) {
      await supabase.from('hub_events').update({ ...payload, ...ko }).eq('id', event.id)
    } else {
      const userId = await getUserId()
      const rrule = byggRrule(upprepning, veckodagar, tillOchMed, allDay)
      await supabase.from('hub_events').insert({
        ...payload, ...ko, rrule, calendar_id: kalenderId, user_id: userId,
      })
    }
    onClose()
    onSaved(!!kalenderId)
  }

  return (
    <Modal open={open} onClose={onClose} title={event ? 'Redigera händelse' : 'Ny händelse'}>
      <div className="space-y-4">
        <div>
          <Label>Titel</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Vad händer?" autoFocus />
        </div>
        {/* Alltid synlig. Doldes den när listan inte hunnit laddas blev
            händelsen tyst lokal, och nådde aldrig Google. */}
        <div>
          <Label>Kalender</Label>
          <select
            value={valdKalender ?? ''}
            onChange={(e) => setValdKalender(e.target.value)}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          >
            {kalendrar.map((k) => <option key={k.id} value={k.id}>{k.namn}</option>)}
            <option value="">Bara i Hubben</option>
          </select>
          <p className={`mt-1 text-xs ${valdKalender ? 'text-muted' : 'text-warn'}`}>
            {valdKalender
              ? 'Hamnar i Google och syns i telefonen.'
              : kalendrar.length
                ? 'Stannar här — syns inte i Google Kalender.'
                : 'Ingen Google-kalender inläst. Händelsen stannar i Hubben.'}
          </p>
        </div>

        {krockar.length > 0 && (
          <p className="rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
            Krockar med {krockar.join(', ')}. Du kan spara ändå.
          </p>
        )}

        {/* Serier skapas här, men ändras alltid som antingen ett tillfälle
            eller hela serien — aldrig genom att skriva om regeln. */}
        {!event && valdKalender && (
          <div>
            <Label>Upprepas</Label>
            <select
              value={upprepning}
              onChange={(e) => setUpprepning(e.target.value as Upprepning)}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            >
              {UPPREPNINGAR.map((u) => <option key={u.id} value={u.id}>{u.namn}</option>)}
            </select>

            {(upprepning === 'vecka' || upprepning === 'varannan') && (
              <div className="mt-2 flex gap-1">
                {VECKODAGAR.map((d) => {
                  const pa = veckodagar.includes(d.kod)
                  return (
                    <button
                      key={d.kod}
                      type="button"
                      onClick={() => setVeckodagar((prev) =>
                        pa ? prev.filter((x) => x !== d.kod) : [...prev, d.kod])}
                      className={`h-8 w-8 rounded-lg text-xs font-medium capitalize transition-colors ${
                        pa ? 'bg-accent text-white' : 'border border-border text-muted hover:text-ink'
                      }`}
                    >
                      {d.namn}
                    </button>
                  )
                })}
              </div>
            )}

            {upprepning !== 'aldrig' && (
              <div className="mt-2">
                <Label>Till och med (valfritt)</Label>
                <Input type="date" value={tillOchMed} onChange={(e) => setTillOchMed(e.target.value)} />
                <p className="mt-1 text-xs text-muted">
                  {tillOchMed ? 'Sista tillfället den dagen.' : 'Utan slutdatum fortsätter serien tills vidare.'}
                </p>
              </div>
            )}
          </div>
        )}

        {iSerie && (
          <div className="rounded-xl border border-border bg-surface p-3">
            <p className="mb-2 text-xs text-muted">
              Det här är ett tillfälle ur en återkommande serie. Vad ska ändringen gälla?
            </p>
            <div className="flex gap-2">
              {([
                { id: 'instans', namn: 'Bara det här tillfället' },
                { id: 'serie', namn: 'Hela serien' },
              ] as const).map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setOmfattning(v.id)}
                  className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                    omfattning === v.id ? 'bg-accent text-white' : 'border border-border text-muted hover:text-ink'
                  }`}
                >
                  {v.namn}
                </button>
              ))}
            </div>
            {omfattning === 'serie' && (
              <p className="mt-2 text-xs text-warn">
                Ändrar du tiden flyttas alla tillfällen — även de som varit.
              </p>
            )}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Datum</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="accent-(--color-accent)" />
              Heldag
            </label>
          </div>
        </div>
        {!allDay && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Startar</Label>
              <Input
                value={time}
                onChange={(e) => setTime(e.target.value)}
                onBlur={(e) => setTime(tolkaTid(e.target.value) ?? time)}
                placeholder="18 eller 18:30"
                inputMode="numeric"
              />
            </div>
            <div>
              <Label>Slutar (valfritt)</Label>
              <Input
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                onBlur={(e) => setEndTime(e.target.value.trim() ? (tolkaTid(e.target.value) ?? endTime) : '')}
                placeholder="19:30"
                inputMode="numeric"
              />
            </div>
          </div>
        )}
        <div>
          <Label>Plats</Label>
          <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Var? (valfritt)" />
        </div>
        <div>
          <Label>Beskrivning</Label>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Detaljer (valfritt)" className="min-h-16" />
        </div>
        <div>
          <Label>Färg</Label>
          <div className="flex gap-2">
            {EVENT_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={`h-8 w-8 rounded-full transition-transform ${color === c ? 'scale-110 ring-2 ring-ink ring-offset-2 ring-offset-card' : ''}`}
                style={{ background: c }}
                aria-label={`Färg ${c}`}
              />
            ))}
          </div>
        </div>
        <div className="flex justify-between gap-2 pt-2">
          {event ? (
            <Button variant="danger" onClick={() => onDelete(event.id, omfattning)}>
              {iSerie && omfattning === 'serie' ? 'Ta bort hela serien' : 'Ta bort'}
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Avbryt</Button>
            <Button onClick={save}>Spara</Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
