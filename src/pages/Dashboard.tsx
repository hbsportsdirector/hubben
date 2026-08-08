import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { format, isToday, isPast, parseISO, startOfMonth, endOfMonth, addDays } from 'date-fns'
import { sv } from 'date-fns/locale'
import { supabase } from '../lib/supabase'
import { getUserId, formatSEK } from '../lib/data'
import type { HubTask, HubEvent, HubHabit, HubHabitLog, HubTransaction } from '../lib/types'
import { Card, SectionTitle, StatTile, EmptyState, Spinner, Input, Button } from '../components/ui'

export default function Dashboard() {
  const [tasks, setTasks] = useState<HubTask[]>([])
  const [events, setEvents] = useState<HubEvent[]>([])
  const [habits, setHabits] = useState<HubHabit[]>([])
  const [logs, setLogs] = useState<HubHabitLog[]>([])
  const [txs, setTxs] = useState<HubTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [quickTitle, setQuickTitle] = useState('')

  const todayStr = format(new Date(), 'yyyy-MM-dd')

  const load = useCallback(async () => {
    const now = new Date()
    const [t, e, h, l, tx] = await Promise.all([
      supabase.from('hub_tasks').select('*').eq('done', false).order('due_date', { ascending: true, nullsFirst: false }),
      supabase.from('hub_events').select('*').gte('starts_at', now.toISOString()).lte('starts_at', addDays(now, 7).toISOString()).order('starts_at'),
      supabase.from('hub_habits').select('*').eq('archived', false).order('created_at'),
      supabase.from('hub_habit_logs').select('*').eq('log_date', format(now, 'yyyy-MM-dd')),
      supabase.from('hub_transactions').select('*').gte('tx_date', format(startOfMonth(now), 'yyyy-MM-dd')).lte('tx_date', format(endOfMonth(now), 'yyyy-MM-dd')),
    ])
    setTasks(t.data ?? [])
    setEvents(e.data ?? [])
    setHabits(h.data ?? [])
    setLogs(l.data ?? [])
    setTxs(tx.data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function quickAdd() {
    if (!quickTitle.trim()) return
    const userId = await getUserId()
    await supabase.from('hub_tasks').insert({ user_id: userId, title: quickTitle.trim(), due_date: todayStr })
    setQuickTitle('')
    load()
  }

  async function toggleTask(task: HubTask) {
    await supabase.from('hub_tasks').update({ done: true, completed_at: new Date().toISOString() }).eq('id', task.id)
    load()
  }

  async function toggleHabit(habit: HubHabit) {
    const existing = logs.find((l) => l.habit_id === habit.id)
    if (existing) {
      await supabase.from('hub_habit_logs').delete().eq('id', existing.id)
    } else {
      const userId = await getUserId()
      await supabase.from('hub_habit_logs').insert({ user_id: userId, habit_id: habit.id, log_date: todayStr })
    }
    load()
  }

  if (loading) return <Spinner />

  const hour = new Date().getHours()
  const greeting = hour < 5 ? 'God natt' : hour < 10 ? 'God morgon' : hour < 12 ? 'God förmiddag' : hour < 18 ? 'God eftermiddag' : 'God kväll'
  const dueTodayOrLate = tasks.filter((t) => t.due_date && (isToday(parseISO(t.due_date)) || isPast(parseISO(t.due_date))))
  const eventsToday = events.filter((e) => isToday(parseISO(e.starts_at)))
  const habitsDone = habits.filter((h) => logs.some((l) => l.habit_id === h.id)).length
  const income = txs.filter((t) => t.kind === 'income').reduce((s, t) => s + Number(t.amount), 0)
  const expenses = txs.filter((t) => t.kind === 'expense').reduce((s, t) => s + Number(t.amount), 0)
  const net = income - expenses

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{greeting}! 👋</h1>
        <p className="mt-1 text-sm capitalize text-muted">{format(new Date(), 'EEEE d MMMM yyyy', { locale: sv })}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Uppgifter idag" value={dueTodayOrLate.length} sub={`${tasks.length} öppna totalt`} />
        <StatTile label="Händelser idag" value={eventsToday.length} sub="närmaste 7 dagarna nedan" />
        <StatTile label="Vanor idag" value={`${habitsDone}/${habits.length}`} sub={habits.length > 0 && habitsDone === habits.length ? 'Alla klara! 🎉' : 'avklarade'} />
        <StatTile label="Månadens netto" value={formatSEK(net)} accent={net >= 0 ? 'var(--color-good)' : 'var(--color-bad)'} sub={`${formatSEK(income)} in · ${formatSEK(expenses)} ut`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionTitle action={<Link to="/uppgifter" className="text-xs text-accent-soft hover:underline">Visa alla →</Link>}>
            Att göra
          </SectionTitle>
          <div className="mb-3 flex gap-2">
            <Input
              value={quickTitle}
              onChange={(e) => setQuickTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && quickAdd()}
              placeholder="Snabblägg till en uppgift för idag…"
            />
            <Button onClick={quickAdd}>+</Button>
          </div>
          {tasks.length === 0 ? (
            <EmptyState emoji="🌤️" text="Inga öppna uppgifter — njut av dagen!" />
          ) : (
            <ul className="space-y-2">
              {tasks.slice(0, 7).map((task) => {
                const overdue = task.due_date && isPast(parseISO(task.due_date)) && !isToday(parseISO(task.due_date))
                return (
                  <li key={task.id} className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5">
                    <button
                      onClick={() => toggleTask(task)}
                      className="h-5 w-5 shrink-0 rounded-md border-2 border-muted transition-colors hover:border-good hover:bg-good/20"
                      aria-label={`Markera "${task.title}" som klar`}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm">{task.title}</span>
                    {task.due_date && (
                      <span className={`shrink-0 text-xs ${overdue ? 'font-medium text-bad' : 'text-muted'}`}>
                        {overdue ? 'Försenad · ' : ''}{format(parseISO(task.due_date), 'd MMM', { locale: sv })}
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        <Card>
          <SectionTitle action={<Link to="/kalender" className="text-xs text-accent-soft hover:underline">Kalender →</Link>}>
            Kommande 7 dagar
          </SectionTitle>
          {events.length === 0 ? (
            <EmptyState emoji="🗓️" text="Inget inbokat den närmaste veckan." />
          ) : (
            <ul className="space-y-2">
              {events.slice(0, 7).map((ev) => (
                <li key={ev.id} className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5">
                  <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: ev.color }} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{ev.title}</p>
                    <p className="text-xs capitalize text-muted">
                      {format(parseISO(ev.starts_at), ev.all_day ? 'EEE d MMM' : 'EEE d MMM · HH:mm', { locale: sv })}
                      {ev.location ? ` · ${ev.location}` : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <SectionTitle action={<Link to="/vanor" className="text-xs text-accent-soft hover:underline">Alla vanor →</Link>}>
            Dagens vanor
          </SectionTitle>
          {habits.length === 0 ? (
            <EmptyState emoji="🌱" text="Inga vanor än — skapa din första under Vanor." />
          ) : (
            <div className="flex flex-wrap gap-2">
              {habits.map((habit) => {
                const done = logs.some((l) => l.habit_id === habit.id)
                return (
                  <button
                    key={habit.id}
                    onClick={() => toggleHabit(habit)}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-all ${
                      done ? 'border-transparent text-white' : 'border-border bg-surface text-muted hover:text-ink'
                    }`}
                    style={done ? { background: habit.color } : undefined}
                  >
                    <span aria-hidden>{habit.emoji}</span>
                    {habit.name}
                    {done && <span aria-hidden>✓</span>}
                  </button>
                )
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
