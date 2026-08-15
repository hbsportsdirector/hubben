import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { format, isToday, isPast, parseISO, startOfMonth, endOfMonth, addDays, startOfWeek, endOfWeek, startOfDay, endOfDay } from 'date-fns'
import { sv } from 'date-fns/locale'
import { supabase } from '../lib/supabase'
import { getUserId, formatSEK } from '../lib/data'
import type { HubTask, HubEvent, HubHabit, HubHabitLog, HubTransaction, HubWeeklyReview, HubWorkout } from '../lib/types'
import { Card, SectionTitle, StatTile, EmptyState, Spinner, Input, Button } from '../components/ui'

interface Mejlrad { id: string; subject: string; from_name: string | null; from_email: string | null; sent_at: string | null }
interface Postlage { olasta: number; senare: number; gallring: number; senaste: Mejlrad[] }

export default function Dashboard() {
  const [tasks, setTasks] = useState<HubTask[]>([])
  const [events, setEvents] = useState<HubEvent[]>([])
  const [habits, setHabits] = useState<HubHabit[]>([])
  const [logs, setLogs] = useState<HubHabitLog[]>([])
  const [txs, setTxs] = useState<HubTransaction[]>([])
  const [review, setReview] = useState<HubWeeklyReview | null>(null)
  const [weekWorkouts, setWeekWorkouts] = useState<HubWorkout[]>([])
  const [post, setPost] = useState<Postlage>({ olasta: 0, senare: 0, gallring: 0, senaste: [] })
  const [loading, setLoading] = useState(true)
  const [quickTitle, setQuickTitle] = useState('')

  const todayStr = format(new Date(), 'yyyy-MM-dd')

  const load = useCallback(async () => {
    const now = new Date()
    const weekStart = startOfWeek(now, { weekStartsOn: 1 })
    const inkorg = () => supabase.from('hub_mejl').select('*', { count: 'exact', head: true })
    const [t, e, h, l, tx, r, w, olasta, senare, gallring, senaste] = await Promise.all([
      supabase.from('hub_tasks').select('*').eq('done', false).order('due_date', { ascending: true, nullsFirst: false }),
      supabase.from('hub_events').select('*').gte('starts_at', startOfDay(now).toISOString()).lte('starts_at', addDays(now, 7).toISOString()).order('starts_at'),
      supabase.from('hub_habits').select('*').eq('archived', false).order('created_at'),
      supabase.from('hub_habit_logs').select('*').eq('log_date', format(now, 'yyyy-MM-dd')),
      supabase.from('hub_transactions').select('*').gte('tx_date', format(startOfMonth(now), 'yyyy-MM-dd')).lte('tx_date', format(endOfMonth(now), 'yyyy-MM-dd')),
      supabase.from('hub_weekly_reviews').select('*').eq('week_start', format(weekStart, 'yyyy-MM-dd')).maybeSingle(),
      supabase.from('hub_workouts').select('*')
        .gte('workout_date', format(weekStart, 'yyyy-MM-dd'))
        .lte('workout_date', format(endOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd')),
      inkorg().eq('seen', false).eq('reply_later', false).eq('visad_roll', 'inbox').eq('avsandarbeslut', 'in'),
      inkorg().eq('reply_later', true),
      inkorg().eq('visad_roll', 'inbox').eq('avsandarbeslut', 'oavgjord'),
      supabase.from('hub_mejl').select('id, subject, from_name, from_email, sent_at')
        .eq('seen', false).eq('reply_later', false).eq('visad_roll', 'inbox').eq('avsandarbeslut', 'in')
        .order('sent_at', { ascending: false }).limit(3),
    ])
    setTasks(t.data ?? [])
    setEvents(e.data ?? [])
    setHabits(h.data ?? [])
    setLogs(l.data ?? [])
    setTxs(tx.data ?? [])
    setReview((r.data as HubWeeklyReview | null) ?? null)
    setWeekWorkouts(w.data ?? [])
    setPost({
      olasta: olasta.count ?? 0,
      senare: senare.count ?? 0,
      gallring: gallring.count ?? 0,
      senaste: (senaste.data as Mejlrad[]) ?? [],
    })
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function quickAdd() {
    if (!quickTitle.trim()) return
    const userId = await getUserId()
    await supabase.from('hub_tasks').insert({ user_id: userId, title: quickTitle.trim(), due_date: todayStr }).throwOnError()
    setQuickTitle('')
    load()
  }

  async function toggleTask(task: HubTask) {
    await supabase.from('hub_tasks').update({ done: true, completed_at: new Date().toISOString() }).eq('id', task.id).throwOnError()
    load()
  }

  async function toggleHabit(habit: HubHabit) {
    const existing = logs.find((l) => l.habit_id === habit.id)
    if (existing) {
      await supabase.from('hub_habit_logs').delete().eq('id', existing.id).throwOnError()
    } else {
      const userId = await getUserId()
      await supabase.from('hub_habit_logs').insert({ user_id: userId, habit_id: habit.id, log_date: todayStr }).throwOnError()
    }
    load()
  }

  if (loading) return <Spinner />

  const hour = new Date().getHours()
  const greeting = hour < 5 ? 'God natt' : hour < 10 ? 'God morgon' : hour < 12 ? 'God förmiddag' : hour < 18 ? 'God eftermiddag' : 'God kväll'
  const idagsSlut = endOfDay(new Date())
  const eventsToday = events.filter((e) => isToday(parseISO(e.starts_at)))
  const eventsSenare = events.filter((e) => parseISO(e.starts_at) > idagsSlut)
  const dueTodayOrLate = tasks.filter((t) => t.due_date && (isToday(parseISO(t.due_date)) || isPast(parseISO(t.due_date))))
  const forsenade = dueTodayOrLate.filter((t) => t.due_date && isPast(parseISO(t.due_date)) && !isToday(parseISO(t.due_date)))
  const habitsDone = habits.filter((h) => logs.some((l) => l.habit_id === h.id)).length
  const income = txs.filter((t) => t.kind === 'income').reduce((s, t) => s + Number(t.amount), 0)
  const expenses = txs.filter((t) => t.kind === 'expense').reduce((s, t) => s + Number(t.amount), 0)
  const net = income - expenses

  // Är dagen faktiskt tom, eller har man bara inte kollat?
  const dagenTom = eventsToday.length === 0 && dueTodayOrLate.length === 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{greeting}! 👋</h1>
        <p className="mt-1 text-sm capitalize text-muted">{format(new Date(), 'EEEE d MMMM yyyy', { locale: sv })}</p>
      </div>

      {review && (review.focus || review.priorities.length > 0) ? (
        <Card className="border-accent/40 bg-accent/5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-accent-soft">Veckans fokus</p>
              {review.focus && <p className="mt-1 text-lg font-semibold">{review.focus}</p>}
              {review.priorities.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {review.priorities.map((p, i) => (
                    <li key={i} className="rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted">{p}</li>
                  ))}
                </ul>
              )}
            </div>
            <Link to="/vecka" className="shrink-0 text-xs text-accent-soft hover:underline">Granska →</Link>
          </div>
        </Card>
      ) : (
        <Link to="/vecka" className="block rounded-2xl border border-dashed border-border px-4 py-3 text-sm text-muted transition-colors hover:border-accent hover:text-ink">
          🧭 Inget veckofokus satt — gör veckogranskningen och sätt riktningen för veckan →
        </Link>
      )}

      {/* Dagen först. Det är den man öppnar Hubben för att få svar på. */}
      <Card>
        <SectionTitle action={<Link to="/kalender" className="text-xs text-accent-soft hover:underline">Kalender →</Link>}>
          Idag
        </SectionTitle>

        {dagenTom ? (
          <EmptyState emoji="🌤️" text="Ingenting inbokat och inget som förfaller idag." />
        ) : (
          <div className="space-y-4">
            {eventsToday.length > 0 && (
              <ul className="space-y-1.5">
                {eventsToday.map((ev) => (
                  <li key={ev.id} className="flex items-baseline gap-3 rounded-xl border border-border bg-surface px-3 py-2.5">
                    <span className="w-12 shrink-0 tabular-nums text-sm font-medium text-muted">
                      {ev.all_day ? 'Heldag' : format(parseISO(ev.starts_at), 'HH:mm')}
                    </span>
                    <span className="h-2 w-2 shrink-0 translate-y-0.5 rounded-full" style={{ background: ev.color }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{ev.title}</span>
                      {ev.location && <span className="block truncate text-xs text-muted">{ev.location}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {dueTodayOrLate.length > 0 && (
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
                  Att göra{forsenade.length > 0 && <span className="text-bad"> · {forsenade.length} försenad{forsenade.length === 1 ? '' : 'e'}</span>}
                </p>
                <ul className="space-y-1.5">
                  {dueTodayOrLate.slice(0, 6).map((task) => {
                    const overdue = task.due_date && isPast(parseISO(task.due_date)) && !isToday(parseISO(task.due_date))
                    return (
                      <li key={task.id} className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5">
                        <button
                          onClick={() => toggleTask(task)}
                          className="h-5 w-5 shrink-0 rounded-md border-2 border-muted transition-colors hover:border-good hover:bg-good/20"
                          aria-label={`Markera "${task.title}" som klar`}
                        />
                        <span className="min-w-0 flex-1 truncate text-sm">{task.title}</span>
                        {overdue && task.due_date && (
                          <span className="shrink-0 text-xs font-medium text-bad">
                            {format(parseISO(task.due_date), 'd MMM', { locale: sv })}
                          </span>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className="mt-4 flex gap-2">
          <Input
            value={quickTitle}
            onChange={(e) => setQuickTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && quickAdd()}
            placeholder="Lägg till något för idag…"
          />
          <Button onClick={quickAdd}>+</Button>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatTile label="Olästa mejl" value={post.olasta} sub={post.senare > 0 ? `${post.senare} att svara på` : 'i inkorgen'} />
        <StatTile label="Uppgifter idag" value={dueTodayOrLate.length} sub={`${tasks.length} öppna totalt`} />
        <StatTile label="Vanor idag" value={`${habitsDone}/${habits.length}`} sub={habits.length > 0 && habitsDone === habits.length ? 'Alla klara! 🎉' : 'avklarade'} />
        <StatTile label="Träning v." value={weekWorkouts.length} sub={`${weekWorkouts.reduce((s, w) => s + w.duration_min, 0)} min denna vecka`} />
        <StatTile label="Månadens netto" value={formatSEK(net)} accent={net >= 0 ? 'var(--color-good)' : 'var(--color-bad)'} sub={`${formatSEK(income)} in · ${formatSEK(expenses)} ut`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionTitle action={<Link to="/mejl" className="text-xs text-accent-soft hover:underline">Inkorgen →</Link>}>
            Posten
          </SectionTitle>

          {post.gallring > 0 && (
            <Link
              to="/gallring"
              className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-warn/40 bg-warn/10 px-3 py-2.5 text-sm text-warn transition-colors hover:bg-warn/20"
            >
              <span>🚦 {post.gallring} mejl väntar på att du släpper in avsändaren</span>
              <span aria-hidden>→</span>
            </Link>
          )}

          {post.senaste.length === 0 ? (
            <EmptyState emoji="📭" text={post.gallring > 0 ? 'Inget oläst från dem du släppt in.' : 'Inkorgen är tom.'} />
          ) : (
            <ul className="space-y-1.5">
              {post.senaste.map((m) => (
                <li key={m.id}>
                  <Link
                    to={`/mejl?mejl=${m.id}`}
                    className="flex items-baseline gap-3 rounded-xl border border-border bg-surface px-3 py-2.5 transition-colors hover:bg-card-hover"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{m.subject || '(inget ämne)'}</span>
                      <span className="block truncate text-xs text-muted">{m.from_name || m.from_email}</span>
                    </span>
                    {m.sent_at && (
                      <span className="shrink-0 text-xs text-muted">
                        {isToday(parseISO(m.sent_at)) ? format(parseISO(m.sent_at), 'HH:mm') : format(parseISO(m.sent_at), 'd MMM', { locale: sv })}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {post.senare > 0 && (
            <Link to="/mejl" className="mt-3 block text-xs text-muted transition-colors hover:text-ink">
              ↩️ {post.senare} i svarshögen →
            </Link>
          )}
        </Card>

        <Card>
          <SectionTitle action={<Link to="/kalender" className="text-xs text-accent-soft hover:underline">Kalender →</Link>}>
            Resten av veckan
          </SectionTitle>
          {eventsSenare.length === 0 ? (
            <EmptyState emoji="🗓️" text="Inget inbokat den närmaste veckan." />
          ) : (
            <ul className="space-y-1.5">
              {eventsSenare.slice(0, 7).map((ev) => (
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
