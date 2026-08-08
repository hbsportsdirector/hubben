import { useEffect, useState, useCallback } from 'react'
import { format, startOfWeek, addDays, isAfter, subDays } from 'date-fns'
import { sv } from 'date-fns/locale'
import { supabase } from '../lib/supabase'
import { getUserId } from '../lib/data'
import type { HubHabit, HubHabitLog } from '../lib/types'
import { Card, Button, Input, Select, Label, Modal, EmptyState, Spinner } from '../components/ui'

const EMOJIS = ['💪', '🏃', '📖', '🧘', '💧', '🥗', '😴', '🎸', '🧹', '💊', '🚭', '✍️']
const COLORS = ['#22c55e', '#38bdf8', '#6366f1', '#fbbf24', '#f87171', '#e879f9']

export default function Habits() {
  const [habits, setHabits] = useState<HubHabit[]>([])
  const [logs, setLogs] = useState<HubHabitLog[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [editHabit, setEditHabit] = useState<HubHabit | null>(null)

  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const today = new Date()

  const load = useCallback(async () => {
    const [h, l] = await Promise.all([
      supabase.from('hub_habits').select('*').eq('archived', false).order('created_at'),
      supabase.from('hub_habit_logs').select('*').gte('log_date', format(subDays(weekStart, 60), 'yyyy-MM-dd')),
    ])
    setHabits(h.data ?? [])
    setLogs(l.data ?? [])
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { load() }, [load])

  async function toggle(habit: HubHabit, day: Date) {
    if (isAfter(day, today)) return
    const dayStr = format(day, 'yyyy-MM-dd')
    const existing = logs.find((l) => l.habit_id === habit.id && l.log_date === dayStr)
    if (existing) {
      setLogs(logs.filter((l) => l.id !== existing.id))
      await supabase.from('hub_habit_logs').delete().eq('id', existing.id)
    } else {
      const userId = await getUserId()
      const { data } = await supabase.from('hub_habit_logs').insert({ user_id: userId, habit_id: habit.id, log_date: dayStr }).select().single()
      if (data) setLogs((prev) => [...prev, data])
    }
  }

  async function remove(habit: HubHabit) {
    await supabase.from('hub_habits').delete().eq('id', habit.id)
    load()
  }

  function streak(habit: HubHabit): number {
    let count = 0
    let day = today
    // Räkna bakåt från idag (eller igår om idag inte är loggad än)
    if (!logs.some((l) => l.habit_id === habit.id && l.log_date === format(day, 'yyyy-MM-dd'))) {
      day = subDays(day, 1)
    }
    while (logs.some((l) => l.habit_id === habit.id && l.log_date === format(day, 'yyyy-MM-dd'))) {
      count++
      day = subDays(day, 1)
    }
    return count
  }

  if (loading) return <Spinner />

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Vanor</h1>
        <Button onClick={() => { setEditHabit(null); setModal(true) }}>+ Ny vana</Button>
      </div>

      {habits.length === 0 ? (
        <Card><EmptyState emoji="🌱" text="Skapa din första vana — små steg varje dag!" /></Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-130">
            <thead>
              <tr>
                <th className="pb-3 text-left text-xs font-semibold uppercase tracking-wider text-muted">Vana</th>
                {weekDays.map((d) => (
                  <th key={d.toISOString()} className="pb-3 text-center text-xs font-medium text-muted">
                    <span className={`capitalize ${format(d, 'yyyy-MM-dd') === format(today, 'yyyy-MM-dd') ? 'text-accent-soft font-bold' : ''}`}>
                      {format(d, 'EEE', { locale: sv })}
                    </span>
                    <br />
                    <span className="text-[10px]">{format(d, 'd/M')}</span>
                  </th>
                ))}
                <th className="pb-3 text-center text-xs font-semibold uppercase tracking-wider text-muted">Vecka</th>
                <th className="pb-3 text-center text-xs font-semibold uppercase tracking-wider text-muted">Svit</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {habits.map((habit) => {
                const weekCount = weekDays.filter((d) => logs.some((l) => l.habit_id === habit.id && l.log_date === format(d, 'yyyy-MM-dd'))).length
                const s = streak(habit)
                return (
                  <tr key={habit.id} className="group border-t border-border">
                    <td className="py-3 pr-3">
                      <span className="mr-2" aria-hidden>{habit.emoji}</span>
                      <span className="text-sm font-medium">{habit.name}</span>
                    </td>
                    {weekDays.map((d) => {
                      const done = logs.some((l) => l.habit_id === habit.id && l.log_date === format(d, 'yyyy-MM-dd'))
                      const future = isAfter(d, today)
                      return (
                        <td key={d.toISOString()} className="py-3 text-center">
                          <button
                            onClick={() => toggle(habit, d)}
                            disabled={future}
                            className={`h-7 w-7 rounded-lg border-2 text-xs text-white transition-all ${
                              done ? 'border-transparent' : future ? 'border-border opacity-30' : 'border-border hover:border-muted'
                            }`}
                            style={done ? { background: habit.color } : undefined}
                            aria-label={`${habit.name} ${format(d, 'EEEE d MMM', { locale: sv })}${done ? ' – klar' : ''}`}
                          >
                            {done && '✓'}
                          </button>
                        </td>
                      )
                    })}
                    <td className="py-3 text-center">
                      <span className={`text-sm font-semibold ${weekCount >= habit.target_per_week ? 'text-good' : 'text-muted'}`}>
                        {weekCount}/{habit.target_per_week}
                      </span>
                    </td>
                    <td className="py-3 text-center">
                      <span className="text-sm font-semibold">{s > 0 ? `🔥 ${s}` : '–'}</span>
                    </td>
                    <td className="py-3 text-right">
                      <div className="flex justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <button onClick={() => { setEditHabit(habit); setModal(true) }} className="p-1 text-xs" aria-label="Redigera">✏️</button>
                        <button onClick={() => remove(habit)} className="p-1 text-xs" aria-label="Ta bort">🗑️</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}

      <HabitModal open={modal} onClose={() => setModal(false)} habit={editHabit} onSaved={load} />
    </div>
  )
}

function HabitModal({ open, onClose, habit, onSaved }: { open: boolean; onClose: () => void; habit: HubHabit | null; onSaved: () => void }) {
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState(EMOJIS[0])
  const [color, setColor] = useState(COLORS[0])
  const [target, setTarget] = useState(7)

  useEffect(() => {
    setName(habit?.name ?? '')
    setEmoji(habit?.emoji ?? EMOJIS[0])
    setColor(habit?.color ?? COLORS[0])
    setTarget(habit?.target_per_week ?? 7)
  }, [habit, open])

  async function save() {
    if (!name.trim()) return
    const payload = { name: name.trim(), emoji, color, target_per_week: target }
    if (habit) {
      await supabase.from('hub_habits').update(payload).eq('id', habit.id)
    } else {
      const userId = await getUserId()
      await supabase.from('hub_habits').insert({ ...payload, user_id: userId })
    }
    onClose()
    onSaved()
  }

  return (
    <Modal open={open} onClose={onClose} title={habit ? 'Redigera vana' : 'Ny vana'}>
      <div className="space-y-4">
        <div>
          <Label>Namn</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="T.ex. Träna, Läsa, Dricka vatten…" autoFocus />
        </div>
        <div>
          <Label>Emoji</Label>
          <div className="flex flex-wrap gap-1.5">
            {EMOJIS.map((e) => (
              <button
                key={e}
                onClick={() => setEmoji(e)}
                className={`h-9 w-9 rounded-lg border text-lg transition-colors ${emoji === e ? 'border-accent bg-accent/15' : 'border-border hover:bg-card-hover'}`}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
        <div>
          <Label>Färg</Label>
          <div className="flex gap-2">
            {COLORS.map((c) => (
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
        <div>
          <Label>Mål per vecka: {target} dagar</Label>
          <input type="range" min={1} max={7} value={target} onChange={(e) => setTarget(Number(e.target.value))} className="w-full accent-(--color-accent)" />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Avbryt</Button>
          <Button onClick={save}>Spara</Button>
        </div>
      </div>
    </Modal>
  )
}
