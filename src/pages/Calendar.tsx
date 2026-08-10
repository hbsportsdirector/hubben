import { useEffect, useState, useCallback, useMemo } from 'react'
import { Calendar as BigCalendar, Views } from 'react-big-calendar'
import type { View, SlotInfo, ToolbarProps } from 'react-big-calendar'
import withDragAndDrop from 'react-big-calendar/lib/addons/dragAndDrop'
import { format, parseISO, addHours, startOfWeek, endOfWeek, startOfMonth, endOfMonth, addDays } from 'date-fns'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css'
import '../styles/calendar.css'
import { supabase } from '../lib/supabase'
import { getUserId } from '../lib/data'
import { useNewParam } from '../lib/useNewParam'
import { localizer, messages, formats } from '../lib/calendarLocale'
import type { HubEvent } from '../lib/types'
import { Card, Button, Input, Label, Modal, Spinner, Textarea } from '../components/ui'

const EVENT_COLORS = ['#38bdf8', '#6366f1', '#34d399', '#fbbf24', '#f87171', '#e879f9']

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

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('hub_events')
      .select('*')
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
  useNewParam(() => { setEditEvent(null); setSlotStart(null); setSlotEnd(null); setModal(true) })

  // Händelser som kommer från Google får inte ändras här förrän skrivvägen
  // tillbaka finns — annars ändras bara vår kopia, och de två glider isär
  // utan att någon säger till.
  const [lastFast, setLastFast] = useState<string | null>(null)
  function arExtern(ev: HubEvent | null | undefined) {
    return !!ev?.calendar_id
  }
  function neka() {
    setLastFast('Den här händelsen kommer från Google. Ändra den i Google Kalender så länge — skrivvägen tillbaka är inte byggd än.')
    setTimeout(() => setLastFast(null), 6000)
  }

  async function persistTimes(ev: CalEvent, start: Date, end: Date, allDay: boolean) {
    if (arExtern(ev.raw)) { neka(); return }
    setEvents((prev) => prev.map((x) => (x.id === ev.id ? { ...x, start, end, allDay } : x)))
    await supabase
      .from('hub_events')
      .update({ starts_at: start.toISOString(), ends_at: allDay ? null : end.toISOString(), all_day: allDay })
      .eq('id', ev.id)
    load()
  }

  async function remove(id: string) {
    if (arExtern(events.find((e) => e.id === id)?.raw)) { neka(); return }
    await supabase.from('hub_events').delete().eq('id', id)
    setModal(false)
    load()
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

      <Card className="!p-4">
        {loading ? <Spinner /> : (
          <div style={{ height: '72vh', minHeight: 520 }}>
            <DnDCalendar
              localizer={localizer}
              culture="sv"
              messages={messages}
              formats={formats}
              events={events}
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
              draggableAccessor={(ev) => !ev.raw.calendar_id}
              resizableAccessor={(ev) => !ev.raw.calendar_id}
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
        onSaved={load}
        onDelete={remove}
      />
    </div>
  )
}

function SwedishToolbar({ label, onNavigate, onView, view }: ToolbarProps<CalEvent>) {
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
      <h2 className="text-base font-semibold capitalize">{label}</h2>
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

function EventModal({ open, onClose, event, initialStart, initialEnd, onSaved, onDelete }: {
  open: boolean
  onClose: () => void
  event: HubEvent | null
  initialStart: Date | null
  initialEnd: Date | null
  onSaved: () => void
  onDelete: (id: string) => void
}) {
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
    } else {
      const start = initialStart ?? new Date()
      const isWholeDay = Boolean(initialStart && initialEnd && (initialEnd.getTime() - initialStart.getTime()) >= 86_400_000)
      setTitle('')
      setDescription('')
      setLocation('')
      setDate(format(start, 'yyyy-MM-dd'))
      setTime(format(initialStart ?? new Date(), 'HH:mm'))
      setEndTime(initialEnd && !isWholeDay ? format(initialEnd, 'HH:mm') : '')
      setAllDay(isWholeDay)
      setColor(EVENT_COLORS[0])
    }
  }, [event, open, initialStart, initialEnd])

  async function save() {
    if (!title.trim() || !date) return
    const starts = allDay ? new Date(`${date}T00:00:00`) : new Date(`${date}T${time}:00`)
    const ends = !allDay && endTime ? new Date(`${date}T${endTime}:00`) : null
    const payload = {
      title: title.trim(),
      description: description.trim() || null,
      location: location.trim() || null,
      starts_at: starts.toISOString(),
      ends_at: ends ? ends.toISOString() : null,
      all_day: allDay,
      color,
    }
    if (event) {
      await supabase.from('hub_events').update(payload).eq('id', event.id)
    } else {
      const userId = await getUserId()
      await supabase.from('hub_events').insert({ ...payload, user_id: userId })
    }
    onClose()
    onSaved()
  }

  return (
    <Modal open={open} onClose={onClose} title={event ? 'Redigera händelse' : 'Ny händelse'}>
      <div className="space-y-4">
        <div>
          <Label>Titel</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Vad händer?" autoFocus />
        </div>
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
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
            <div>
              <Label>Slutar (valfritt)</Label>
              <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
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
            <Button variant="danger" onClick={() => onDelete(event.id)}>Ta bort</Button>
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
