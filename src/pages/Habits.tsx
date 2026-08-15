import { useEffect, useState, useCallback } from 'react'
import { format, startOfWeek, addDays, isAfter, subDays } from 'date-fns'
import { sv } from 'date-fns/locale'
import { supabase } from '../lib/supabase'
import { getUserId } from '../lib/data'
import type { HubHabit, HubHabitLog } from '../lib/types'
import { Card, Button, Input, Label, Modal, EmptyState, Spinner, SectionTitle } from '../components/ui'
import Heatmap from '../components/Heatmap'

const EMOJIS = ['💪', '🏃', '📖', '🧘', '💧', '🥗', '😴', '🎸', '🧹', '💊', '🚭', '✍️']
const COLORS = ['#22c55e', '#38bdf8', '#6366f1', '#fbbf24', '#f87171', '#e879f9']

export default function Habits() {
  const [habits, setHabits] = useState<HubHabit[]>([])
  const [logs, setLogs] = useState<HubHabitLog[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [editHabit, setEditHabit] = useState<HubHabit | null>(null)
  const [heatmapHabit, setHeatmapHabit] = useState<string | null>(null)

  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const today = new Date()

  const load = useCallback(async () => {
    const [h, l] = await Promise.all([
      supabase.from('hub_habits').select('*').eq('archived', false).order('created_at'),
      supabase.from('hub_habit_logs').select('*').gte('log_date', format(subDays(weekStart, 370), 'yyyy-MM-dd')),
    ])
    setHabits(h.data ?? [])
    setLogs(l.data ?? [])
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { load() }, [load])

  /** Tre lägen i stället för två: tom → klar → överhoppad → tom.
   *
   *  "Överhoppad" är inte samma sak som missad. Ett medvetet bortval ska inte
   *  se ut som ett misslyckande i rutnätet, och det är skillnaden som gör att
   *  man vågar bocka i sanningen i stället för att låta bli att öppna appen. */
  async function toggle(habit: HubHabit, day: Date) {
    if (isAfter(day, today)) return
    const dayStr = format(day, 'yyyy-MM-dd')
    const existing = logs.find((l) => l.habit_id === habit.id && l.log_date === dayStr)

    if (!existing) {
      const userId = await getUserId()
      const { data } = await supabase.from('hub_habit_logs')
        .insert({ user_id: userId, habit_id: habit.id, log_date: dayStr, status: 'klar' })
        .select().single()
      if (data) setLogs((prev) => [...prev, data])
      return
    }
    if ((existing.status ?? 'klar') === 'klar') {
      setLogs(logs.map((l) => (l.id === existing.id ? { ...l, status: 'overhoppad' } : l)))
      await supabase.from('hub_habit_logs').update({ status: 'overhoppad' }).eq('id', existing.id).throwOnError()
      return
    }
    setLogs(logs.filter((l) => l.id !== existing.id))
    await supabase.from('hub_habit_logs').delete().eq('id', existing.id).throwOnError()
  }

  const arKlar = (habitId: string, dag: Date) =>
    logs.some((l) => l.habit_id === habitId && l.log_date === format(dag, 'yyyy-MM-dd') && (l.status ?? 'klar') === 'klar')
  const arOverhoppad = (habitId: string, dag: Date) =>
    logs.some((l) => l.habit_id === habitId && l.log_date === format(dag, 'yyyy-MM-dd') && l.status === 'overhoppad')

  const arPausad = (habit: HubHabit, dag: Date) => {
    if (!habit.paused_to) return false
    const d = format(dag, 'yyyy-MM-dd')
    return d <= habit.paused_to && (!habit.paused_from || d >= habit.paused_from)
  }

  async function remove(habit: HubHabit) {
    await supabase.from('hub_habits').delete().eq('id', habit.id).throwOnError()
    load()
  }

  /** Sviten räknar VECKOR där veckomålet nåddes — inte obrutna dagar.
   *
   *  Förut nollade ett enda missat dygn allt, trots att target_per_week fanns
   *  hela tiden. Ett veckomål på 3 pass betyder att fyra lediga dagar är
   *  planen, inte ett misslyckande. Och en missad dag påverkar inte
   *  vanebildningen i sig — det är nollställningen som får folk att sluta.
   *
   *  Innevarande vecka räknas bara om målet redan nåtts, annars skulle sviten
   *  se ut att brytas varje måndag morgon. Veckor helt inom en paus hoppas
   *  över utan att bryta kedjan. */
  function veckansKlara(habit: HubHabit, mandag: Date): number {
    return Array.from({ length: 7 }, (_, i) => addDays(mandag, i))
      .filter((d) => arKlar(habit.id, d)).length
  }

  function streak(habit: HubHabit): number {
    const mal = Math.max(1, habit.target_per_week)
    let antal = 0
    let mandag = weekStart

    if (veckansKlara(habit, mandag) < mal) mandag = subDays(mandag, 7)

    // Femtiotvå veckor bakåt räcker; längre tillbaka finns ingen data ändå.
    for (let i = 0; i < 52; i++) {
      const helaVeckanPausad = Array.from({ length: 7 }, (_, d) => addDays(mandag, d))
        .every((d) => arPausad(habit, d))
      if (helaVeckanPausad) { mandag = subDays(mandag, 7); continue }
      if (veckansKlara(habit, mandag) < mal) break
      antal++
      mandag = subDays(mandag, 7)
    }
    return antal
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
        <>
        {/* Telefon: ett kort per vana. Tabellen kräver 520 px — sju dagar plus
            veckomål, svit och knappar får inte plats på 375 px — och tvingade
            fram en sidledsscroll där man tappade bort vilken rad man bockade i. */}
        <div className="space-y-3 md:hidden">
          {habits.map((habit) => {
            const weekCount = weekDays.filter((d) => arKlar(habit.id, d)).length
            const s = streak(habit)
            return (
              <Card key={habit.id} className="!p-4">
                <div className="mb-3 flex items-center gap-2">
                  <span aria-hidden>{habit.emoji}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{habit.name}</span>
                  <span className={`text-xs font-semibold ${weekCount >= habit.target_per_week ? 'text-good' : 'text-muted'}`}>
                    {weekCount}/{habit.target_per_week}
                  </span>
                  {/* Veckor med målet nått, inte obrutna dagar */}
                  {s > 0 && <span className="text-xs font-semibold" title={`${s} veckor i rad med målet nått`}>🔥 {s} v</span>}
                  {arPausad(habit, today) && <span className="text-xs text-muted" title={`Pausad t.o.m. ${habit.paused_to}`}>⏸</span>}
                  <button onClick={() => { setEditHabit(habit); setModal(true) }} className="p-1 text-xs" aria-label={`Redigera ${habit.name}`}>✏️</button>
                  <button onClick={() => remove(habit)} className="p-1 text-xs" aria-label={`Ta bort ${habit.name}`}>🗑️</button>
                </div>
                <div className="flex justify-between gap-1">
                  {weekDays.map((d) => {
                    const done = arKlar(habit.id, d)
                    const skipped = arOverhoppad(habit.id, d)
                    const future = isAfter(d, today)
                    const idag = format(d, 'yyyy-MM-dd') === format(today, 'yyyy-MM-dd')
                    return (
                      <div key={d.toISOString()} className="flex flex-1 flex-col items-center gap-1">
                        <span className={`text-[10px] capitalize ${idag ? 'font-bold text-accent-soft' : 'text-muted'}`}>
                          {format(d, 'EEEEE', { locale: sv })}
                        </span>
                        <button
                          onClick={() => toggle(habit, d)}
                          disabled={future}
                          className={`h-9 w-full rounded-lg border-2 text-xs text-white transition-all ${
                            done ? 'border-transparent'
                              : skipped ? 'border-dashed border-muted/50 text-muted'
                              : future ? 'border-border opacity-30' : 'border-border'
                          }`}
                          style={done ? { background: habit.color } : undefined}
                          aria-label={`${habit.name} ${format(d, 'EEEE d MMM', { locale: sv })}${done ? ' – klar' : skipped ? ' – överhoppad' : ''}`}
                        >
                          {done ? '✓' : skipped ? '–' : ''}
                        </button>
                        <span className="text-[9px] text-muted/70">{format(d, 'd/M')}</span>
                      </div>
                    )
                  })}
                </div>
              </Card>
            )
          })}
        </div>

        <Card className="hidden overflow-x-auto md:block">
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
                const weekCount = weekDays.filter((d) => arKlar(habit.id, d)).length
                const s = streak(habit)
                return (
                  <tr key={habit.id} className="group border-t border-border">
                    <td className="py-3 pr-3">
                      <span className="mr-2" aria-hidden>{habit.emoji}</span>
                      <span className="text-sm font-medium">{habit.name}</span>
                    </td>
                    {weekDays.map((d) => {
                      const done = arKlar(habit.id, d)
                      const skipped = arOverhoppad(habit.id, d)
                      const future = isAfter(d, today)
                      return (
                        <td key={d.toISOString()} className="py-3 text-center">
                          <button
                            onClick={() => toggle(habit, d)}
                            disabled={future}
                            className={`h-7 w-7 rounded-lg border-2 text-xs text-white transition-all ${
                              done ? 'border-transparent'
                                : skipped ? 'border-dashed border-muted/50 text-muted'
                                : future ? 'border-border opacity-30' : 'border-border hover:border-muted'
                            }`}
                            style={done ? { background: habit.color } : undefined}
                            aria-label={`${habit.name} ${format(d, 'EEEE d MMM', { locale: sv })}${done ? ' – klar' : skipped ? ' – överhoppad' : ''}`}
                          >
                            {done ? '✓' : skipped ? '–' : ''}
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
                      <span className="text-sm font-semibold" title={s > 0 ? `${s} veckor i rad med målet nått` : undefined}>
                        {arPausad(habit, today) ? '⏸' : s > 0 ? `🔥 ${s} v` : '–'}
                      </span>
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
        </>
      )}

      {habits.length > 0 && (
        <Card>
          <SectionTitle>Årsöversikt</SectionTitle>
          <div className="mb-4 flex flex-wrap gap-2">
            {habits.map((h) => {
              const active = (heatmapHabit ?? habits[0].id) === h.id
              return (
                <button
                  key={h.id}
                  onClick={() => setHeatmapHabit(h.id)}
                  className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors ${
                    active ? 'border-transparent text-white' : 'border-border text-muted hover:text-ink'
                  }`}
                  style={active ? { background: h.color } : undefined}
                >
                  <span aria-hidden>{h.emoji}</span>
                  {h.name}
                </button>
              )
            })}
          </div>
          {(() => {
            const habit = habits.find((h) => h.id === (heatmapHabit ?? habits[0].id)) ?? habits[0]
            // Överhoppade dagar färgas inte — heatmapen ska visa vad man gjort
            const habitLogs = logs.filter((l) => l.habit_id === habit.id && (l.status ?? 'klar') === 'klar')
            const values = new Map(habitLogs.map((l) => [l.log_date, 1]))
            return (
              <>
                <Heatmap values={values} color={habit.color} />
                <p className="mt-2 text-xs text-muted">
                  {habitLogs.length} dagar senaste året · nuvarande svit {streak(habit)} {streak(habit) === 1 ? 'vecka' : 'veckor'} med målet nått
                </p>
              </>
            )
          })()}
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
  const [pausadTill, setPausadTill] = useState('')

  useEffect(() => {
    setName(habit?.name ?? '')
    setEmoji(habit?.emoji ?? EMOJIS[0])
    setColor(habit?.color ?? COLORS[0])
    setTarget(habit?.target_per_week ?? 7)
    setPausadTill(habit?.paused_to ?? '')
  }, [habit, open])

  async function save() {
    if (!name.trim()) return
    // Pausen börjar idag och slutar det datum man valt. Ett fält räcker —
    // "pausa bakåt i tiden" är inte ett behov någon har.
    const payload = {
      name: name.trim(), emoji, color, target_per_week: target,
      paused_to: pausadTill || null,
      paused_from: pausadTill ? (habit?.paused_from ?? format(new Date(), 'yyyy-MM-dd')) : null,
    }
    if (habit) {
      await supabase.from('hub_habits').update(payload).eq('id', habit.id).throwOnError()
    } else {
      const userId = await getUserId()
      await supabase.from('hub_habits').insert({ ...payload, user_id: userId }).throwOnError()
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
          <p className="mt-1 text-xs text-muted">Sviten räknar veckor där målet nåddes — inte obrutna dagar.</p>
        </div>
        <div>
          <Label>Pausad till och med</Label>
          <div className="flex gap-2">
            <Input type="date" value={pausadTill} onChange={(e) => setPausadTill(e.target.value)} />
            {pausadTill && (
              <Button variant="ghost" onClick={() => setPausadTill('')}>Avbryt paus</Button>
            )}
          </div>
          <p className="mt-1 text-xs text-muted">
            Semester eller skada? Veckor inom pausen bryter inte sviten.
          </p>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Avbryt</Button>
          <Button onClick={save}>Spara</Button>
        </div>
      </div>
    </Modal>
  )
}
