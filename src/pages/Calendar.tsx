import { useEffect, useState, useCallback } from 'react'
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, addMonths,
  isSameMonth, isSameDay, parseISO,
} from 'date-fns'
import { sv } from 'date-fns/locale'
import { supabase } from '../lib/supabase'
import { getUserId } from '../lib/data'
import type { HubEvent } from '../lib/types'
import { Card, Button, Input, Label, Modal, EmptyState, Spinner, Textarea } from '../components/ui'

const EVENT_COLORS = ['#38bdf8', '#6366f1', '#34d399', '#fbbf24', '#f87171', '#e879f9']

export default function Calendar() {
  const [month, setMonth] = useState(startOfMonth(new Date()))
  const [events, setEvents] = useState<HubEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedDay, setSelectedDay] = useState<Date>(new Date())
  const [modal, setModal] = useState(false)
  const [editEvent, setEditEvent] = useState<HubEvent | null>(null)

  const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 1 })
  const gridEnd = endOfWeek(endOfMonth(month), { weekStartsOn: 1 })

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('hub_events')
      .select('*')
      .gte('starts_at', gridStart.toISOString())
      .lte('starts_at', addDays(gridEnd, 1).toISOString())
      .order('starts_at')
    setEvents(data ?? [])
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month])

  useEffect(() => { load() }, [load])

  async function remove(id: string) {
    await supabase.from('hub_events').delete().eq('id', id)
    load()
  }

  const days: Date[] = []
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) days.push(d)
  const dayEvents = (day: Date) => events.filter((e) => isSameDay(parseISO(e.starts_at), day))
  const selectedEvents = dayEvents(selectedDay)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Kalender</h1>
        <Button onClick={() => { setEditEvent(null); setModal(true) }}>+ Ny händelse</Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <button onClick={() => setMonth(addMonths(month, -1))} className="rounded-lg px-3 py-1 text-muted hover:bg-card-hover hover:text-ink" aria-label="Föregående månad">←</button>
            <h2 className="text-lg font-semibold capitalize">{format(month, 'MMMM yyyy', { locale: sv })}</h2>
            <button onClick={() => setMonth(addMonths(month, 1))} className="rounded-lg px-3 py-1 text-muted hover:bg-card-hover hover:text-ink" aria-label="Nästa månad">→</button>
          </div>

          {loading ? <Spinner /> : (
            <>
              <div className="mb-1 grid grid-cols-7 text-center text-xs font-medium uppercase text-muted">
                {['Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör', 'Sön'].map((d) => <div key={d} className="py-1">{d}</div>)}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {days.map((day) => {
                  const evs = dayEvents(day)
                  const isSelected = isSameDay(day, selectedDay)
                  const isToday = isSameDay(day, new Date())
                  return (
                    <button
                      key={day.toISOString()}
                      onClick={() => setSelectedDay(day)}
                      className={`flex aspect-square flex-col items-center justify-start rounded-xl border p-1 transition-colors sm:aspect-4/3 ${
                        isSelected ? 'border-accent bg-accent/15' : 'border-transparent hover:bg-card-hover'
                      } ${!isSameMonth(day, month) ? 'opacity-35' : ''}`}
                    >
                      <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${isToday ? 'bg-accent font-bold text-white' : ''}`}>
                        {format(day, 'd')}
                      </span>
                      <div className="mt-0.5 flex flex-wrap justify-center gap-0.5">
                        {evs.slice(0, 3).map((e) => (
                          <span key={e.id} className="h-1.5 w-1.5 rounded-full" style={{ background: e.color }} />
                        ))}
                        {evs.length > 3 && <span className="text-[9px] text-muted">+{evs.length - 3}</span>}
                      </div>
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-semibold capitalize">{format(selectedDay, 'EEEE d MMMM', { locale: sv })}</h2>
          {selectedEvents.length === 0 ? (
            <EmptyState emoji="🌙" text="Inget inbokat den här dagen." />
          ) : (
            <ul className="space-y-2">
              {selectedEvents.map((ev) => (
                <li key={ev.id} className="group rounded-xl border border-border bg-surface p-3">
                  <div className="flex items-start gap-2">
                    <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: ev.color }} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{ev.title}</p>
                      <p className="text-xs text-muted">
                        {ev.all_day ? 'Heldag' : format(parseISO(ev.starts_at), 'HH:mm')}
                        {!ev.all_day && ev.ends_at ? `–${format(parseISO(ev.ends_at), 'HH:mm')}` : ''}
                        {ev.location ? ` · ${ev.location}` : ''}
                      </p>
                      {ev.description && <p className="mt-1 text-xs text-muted">{ev.description}</p>}
                    </div>
                    <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button onClick={() => { setEditEvent(ev); setModal(true) }} className="p-0.5 text-xs" aria-label="Redigera">✏️</button>
                      <button onClick={() => remove(ev.id)} className="p-0.5 text-xs" aria-label="Ta bort">🗑️</button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Button variant="ghost" className="mt-4 w-full" onClick={() => { setEditEvent(null); setModal(true) }}>
            + Lägg till denna dag
          </Button>
        </Card>
      </div>

      <EventModal
        open={modal}
        onClose={() => setModal(false)}
        event={editEvent}
        defaultDay={selectedDay}
        onSaved={load}
      />
    </div>
  )
}

function EventModal({ open, onClose, event, defaultDay, onSaved }: {
  open: boolean; onClose: () => void; event: HubEvent | null; defaultDay: Date; onSaved: () => void
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
      setTitle('')
      setDescription('')
      setLocation('')
      setDate(format(defaultDay, 'yyyy-MM-dd'))
      setTime('12:00')
      setEndTime('')
      setAllDay(false)
      setColor(EVENT_COLORS[0])
    }
  }, [event, open, defaultDay])

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
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Detaljer (valfritt)" />
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
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Avbryt</Button>
          <Button onClick={save}>Spara</Button>
        </div>
      </div>
    </Modal>
  )
}
