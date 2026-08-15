import { useEffect, useState, useCallback, useMemo } from 'react'
import { format, parseISO, startOfWeek, subDays, isWithinInterval, addDays } from 'date-fns'
import { sv } from 'date-fns/locale'
import { supabase } from '../lib/supabase'
import { getUserId } from '../lib/data'
import { useNewParam } from '../lib/useNewParam'
import type { HubWorkout } from '../lib/types'
import { Card, SectionTitle, Button, Input, Label, Modal, EmptyState, Spinner, StatTile, Textarea } from '../components/ui'
import Heatmap from '../components/Heatmap'

const KINDS = ['Handboll', 'Gym', 'Löpning', 'Padel', 'Promenad', 'Annat']
const KIND_EMOJI: Record<string, string> = {
  Handboll: '🤾', Gym: '🏋️', Löpning: '🏃', Padel: '🎾', Promenad: '🚶', Annat: '💪',
}
const INTENSITY_LABELS = ['', 'Mycket lätt', 'Lätt', 'Medel', 'Hårt', 'Max']

export default function Training() {
  const [workouts, setWorkouts] = useState<HubWorkout[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [editWorkout, setEditWorkout] = useState<HubWorkout | null>(null)

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('hub_workouts')
      .select('*')
      .gte('workout_date', format(subDays(new Date(), 370), 'yyyy-MM-dd'))
      .order('workout_date', { ascending: false })
    setWorkouts(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])
  useNewParam(() => { setEditWorkout(null); setModal(true) })

  async function remove(id: string) {
    await supabase.from('hub_workouts').delete().eq('id', id).throwOnError()
    load()
  }

  const today = new Date()
  const weekStart = startOfWeek(today, { weekStartsOn: 1 })
  const lastWeekStart = subDays(weekStart, 7)

  const thisWeek = workouts.filter((w) => isWithinInterval(parseISO(w.workout_date), { start: weekStart, end: addDays(weekStart, 6) }))
  const lastWeek = workouts.filter((w) => isWithinInterval(parseISO(w.workout_date), { start: lastWeekStart, end: subDays(weekStart, 1) }))
  const thisWeekMin = thisWeek.reduce((s, w) => s + w.duration_min, 0)
  const lastWeekMin = lastWeek.reduce((s, w) => s + w.duration_min, 0)

  const heatValues = useMemo(() => {
    const m = new Map<string, number>()
    workouts.forEach((w) => m.set(w.workout_date, (m.get(w.workout_date) ?? 0) + 1))
    return m
  }, [workouts])

  const perKind = useMemo(() => {
    const m = new Map<string, number>()
    thisWeek.forEach((w) => m.set(w.kind, (m.get(w.kind) ?? 0) + w.duration_min))
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [thisWeek])

  if (loading) return <Spinner />

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Träning</h1>
        <Button onClick={() => { setEditWorkout(null); setModal(true) }}>+ Logga pass</Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <StatTile label="Pass denna vecka" value={thisWeek.length} sub={`${lastWeek.length} förra veckan`} />
        <StatTile label="Minuter denna vecka" value={thisWeekMin} sub={`${lastWeekMin} förra veckan`} />
        <StatTile
          label="Snittintensitet"
          value={thisWeek.length > 0 ? (thisWeek.reduce((s, w) => s + w.intensity, 0) / thisWeek.length).toFixed(1) : '–'}
          sub="av 5 denna vecka"
        />
      </div>

      <Card>
        <SectionTitle>Träningsår</SectionTitle>
        <Heatmap values={heatValues} max={2} color="#38bdf8" unit="pass" />
        <p className="mt-2 text-xs text-muted">{workouts.length} pass senaste året</p>
      </Card>

      {perKind.length > 0 && (
        <Card>
          <SectionTitle>Veckans fördelning</SectionTitle>
          <div className="flex flex-wrap gap-3">
            {perKind.map(([kind, min]) => (
              <div key={kind} className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-sm">
                <span aria-hidden>{KIND_EMOJI[kind] ?? '💪'}</span>
                <span>{kind}</span>
                <span className="text-muted">{min} min</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <SectionTitle>Loggade pass</SectionTitle>
        {workouts.length === 0 ? (
          <EmptyState emoji="🤾" text="Logga ditt första pass — handboll, gym eller vad som helst!" />
        ) : (
          <ul className="divide-y divide-border">
            {workouts.slice(0, 30).map((w) => (
              <li key={w.id} className="group flex items-center gap-3 py-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface text-lg" aria-hidden>
                  {KIND_EMOJI[w.kind] ?? '💪'}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {w.kind} · {w.duration_min} min
                    <span className="ml-2 text-xs font-normal text-muted">{INTENSITY_LABELS[w.intensity]}</span>
                  </p>
                  <p className="text-xs capitalize text-muted">
                    {format(parseISO(w.workout_date), 'EEEE d MMM', { locale: sv })}
                    {w.notes ? ` · ${w.notes}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button onClick={() => { setEditWorkout(w); setModal(true) }} className="p-1 text-xs" aria-label="Redigera">✏️</button>
                  <button onClick={() => remove(w.id)} className="p-1 text-xs" aria-label="Ta bort">🗑️</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <WorkoutModal open={modal} onClose={() => setModal(false)} workout={editWorkout} onSaved={load} />
    </div>
  )
}

function WorkoutModal({ open, onClose, workout, onSaved }: {
  open: boolean; onClose: () => void; workout: HubWorkout | null; onSaved: () => void
}) {
  const [kind, setKind] = useState(KINDS[0])
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [duration, setDuration] = useState('60')
  const [intensity, setIntensity] = useState(3)
  const [notes, setNotes] = useState('')

  useEffect(() => {
    setKind(workout?.kind ?? KINDS[0])
    setDate(workout?.workout_date ?? format(new Date(), 'yyyy-MM-dd'))
    setDuration(String(workout?.duration_min ?? 60))
    setIntensity(workout?.intensity ?? 3)
    setNotes(workout?.notes ?? '')
  }, [workout, open])

  async function save() {
    const min = Number(duration)
    if (!min || min <= 0 || !date) return
    const payload = { kind, workout_date: date, duration_min: min, intensity, notes: notes.trim() || null }
    if (workout) {
      await supabase.from('hub_workouts').update(payload).eq('id', workout.id).throwOnError()
    } else {
      const userId = await getUserId()
      await supabase.from('hub_workouts').insert({ ...payload, user_id: userId }).throwOnError()
    }
    onClose()
    onSaved()
  }

  return (
    <Modal open={open} onClose={onClose} title={workout ? 'Redigera pass' : 'Logga pass'}>
      <div className="space-y-4">
        <div>
          <Label>Typ av pass</Label>
          <div className="flex flex-wrap gap-1.5">
            {KINDS.map((k) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={`rounded-xl border px-3 py-1.5 text-sm transition-colors ${
                  kind === k ? 'border-accent bg-accent/15 text-accent-soft' : 'border-border text-muted hover:bg-card-hover'
                }`}
              >
                {KIND_EMOJI[k]} {k}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Datum</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <Label>Längd (minuter)</Label>
            <Input type="number" value={duration} onChange={(e) => setDuration(e.target.value)} min={1} />
          </div>
        </div>
        <div>
          <Label>Intensitet: {INTENSITY_LABELS[intensity]}</Label>
          <input type="range" min={1} max={5} value={intensity} onChange={(e) => setIntensity(Number(e.target.value))} className="w-full accent-(--color-accent)" />
        </div>
        <div>
          <Label>Anteckning</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Hur kändes det? (valfritt)" className="min-h-16" />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Avbryt</Button>
          <Button onClick={save}>Spara</Button>
        </div>
      </div>
    </Modal>
  )
}
