import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { format, startOfWeek, endOfWeek, addWeeks, parseISO, isPast, isToday, startOfMonth, endOfMonth } from 'date-fns'
import { sv } from 'date-fns/locale'
import { supabase } from '../lib/supabase'
import { getUserId, formatSEK } from '../lib/data'
import type { HubWeeklyReview, HubTask, HubGoal, HubTransaction, HubHabit, HubHabitLog, HubWorkout } from '../lib/types'
import { Card, SectionTitle, Button, Input, Textarea, Label, EmptyState, Spinner } from '../components/ui'

export default function WeeklyReview() {
  const [weekOffset, setWeekOffset] = useState(0)
  const [review, setReview] = useState<HubWeeklyReview | null>(null)
  const [inboxTasks, setInboxTasks] = useState<HubTask[]>([])
  const [overdueTasks, setOverdueTasks] = useState<HubTask[]>([])
  const [goals, setGoals] = useState<HubGoal[]>([])
  const [txs, setTxs] = useState<HubTransaction[]>([])
  const [habits, setHabits] = useState<HubHabit[]>([])
  const [weekLogs, setWeekLogs] = useState<HubHabitLog[]>([])
  const [weekWorkouts, setWeekWorkouts] = useState<HubWorkout[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Formulärfält
  const [focus, setFocus] = useState('')
  const [priorities, setPriorities] = useState<string[]>(['', '', ''])
  const [wins, setWins] = useState('')
  const [carriedOver, setCarriedOver] = useState('')

  const weekStart = startOfWeek(addWeeks(new Date(), weekOffset), { weekStartsOn: 1 })
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 })
  const weekKey = format(weekStart, 'yyyy-MM-dd')

  const load = useCallback(async () => {
    setLoading(true)
    const now = new Date()
    const [r, inbox, overdue, g, tx, h, hl, w] = await Promise.all([
      supabase.from('hub_weekly_reviews').select('*').eq('week_start', weekKey).maybeSingle(),
      supabase.from('hub_tasks').select('*').eq('done', false).is('due_date', null).order('created_at'),
      supabase.from('hub_tasks').select('*').eq('done', false).not('due_date', 'is', null).lt('due_date', format(now, 'yyyy-MM-dd')),
      supabase.from('hub_goals').select('*').order('created_at'),
      supabase.from('hub_transactions').select('*')
        .gte('tx_date', format(startOfMonth(now), 'yyyy-MM-dd'))
        .lte('tx_date', format(endOfMonth(now), 'yyyy-MM-dd')),
      supabase.from('hub_habits').select('*').eq('archived', false),
      supabase.from('hub_habit_logs').select('*')
        .gte('log_date', format(weekStart, 'yyyy-MM-dd'))
        .lte('log_date', format(weekEnd, 'yyyy-MM-dd')),
      supabase.from('hub_workouts').select('*')
        .gte('workout_date', format(weekStart, 'yyyy-MM-dd'))
        .lte('workout_date', format(weekEnd, 'yyyy-MM-dd')),
    ])
    const rev = r.data as HubWeeklyReview | null
    setReview(rev)
    setFocus(rev?.focus ?? '')
    setPriorities(rev?.priorities?.length ? [...rev.priorities, '', '', ''].slice(0, Math.max(3, rev.priorities.length)) : ['', '', ''])
    setWins(rev?.wins ?? '')
    setCarriedOver(rev?.carried_over ?? '')
    setInboxTasks(inbox.data ?? [])
    setOverdueTasks(overdue.data ?? [])
    setGoals(g.data ?? [])
    setTxs(tx.data ?? [])
    setHabits(h.data ?? [])
    setWeekLogs(hl.data ?? [])
    setWeekWorkouts(w.data ?? [])
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekKey])

  useEffect(() => { load() }, [load])

  async function save(markDone: boolean) {
    setSaving(true)
    try {
      const userId = await getUserId()
      const payload = {
        user_id: userId,
        week_start: weekKey,
        focus: focus.trim(),
        priorities: priorities.map((p) => p.trim()).filter(Boolean),
        wins: wins.trim(),
        carried_over: carriedOver.trim(),
        completed_at: markDone ? new Date().toISOString() : review?.completed_at ?? null,
      }
      await supabase.from('hub_weekly_reviews').upsert(payload, { onConflict: 'user_id,week_start' })
      load()
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Spinner />

  const income = txs.filter((t) => t.kind === 'income').reduce((s, t) => s + Number(t.amount), 0)
  const expenses = txs.filter((t) => t.kind === 'expense').reduce((s, t) => s + Number(t.amount), 0)
  const habitPct = habits.length > 0 ? Math.round((weekLogs.length / (habits.length * 7)) * 100) : 0
  const trainMin = weekWorkouts.reduce((s, w) => s + w.duration_min, 0)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Veckogranskning 🧭</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => setWeekOffset(weekOffset - 1)} className="rounded-lg px-2 py-1 text-muted hover:bg-card-hover hover:text-ink" aria-label="Föregående vecka">←</button>
          <span className="min-w-40 text-center text-sm font-semibold">
            v.{format(weekStart, 'w', { locale: sv })} · {format(weekStart, 'd MMM', { locale: sv })}–{format(weekEnd, 'd MMM', { locale: sv })}
          </span>
          <button onClick={() => setWeekOffset(weekOffset + 1)} className="rounded-lg px-2 py-1 text-muted hover:bg-card-hover hover:text-ink" aria-label="Nästa vecka">→</button>
        </div>
      </div>

      {review?.completed_at && (
        <p className="rounded-xl border border-good/40 bg-good/10 px-4 py-2.5 text-sm text-good">
          ✓ Veckogranskningen gjord {format(parseISO(review.completed_at), 'd MMM HH:mm', { locale: sv })}
        </p>
      )}

      <p className="text-sm text-muted">15–30 minuter räcker. Gå igenom stegen uppifrån och ner — sätt sedan ETT fokus och max fem prioriteringar för veckan.</p>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Steg 1: Töm inboxen */}
        <Card>
          <SectionTitle action={<Link to="/uppgifter" className="text-xs text-accent-soft hover:underline">Öppna uppgifter →</Link>}>
            1 · Töm inboxen
          </SectionTitle>
          <p className="mb-3 text-xs text-muted">Uppgifter utan datum — bestäm: gör, planera in eller släng.</p>
          {inboxTasks.length === 0 ? (
            <p className="text-sm text-good">✓ Inboxen är tom!</p>
          ) : (
            <ul className="space-y-1.5">
              {inboxTasks.slice(0, 8).map((t) => (
                <li key={t.id} className="rounded-lg border border-border bg-surface px-3 py-2 text-sm">{t.title}</li>
              ))}
              {inboxTasks.length > 8 && <li className="text-xs text-muted">…och {inboxTasks.length - 8} till</li>}
            </ul>
          )}
        </Card>

        {/* Steg 2: Försenat */}
        <Card>
          <SectionTitle>2 · Hantera det försenade</SectionTitle>
          <p className="mb-3 text-xs text-muted">Omplanera eller släpp — låt inget ligga och skava.</p>
          {overdueTasks.length === 0 ? (
            <p className="text-sm text-good">✓ Inget försenat!</p>
          ) : (
            <ul className="space-y-1.5">
              {overdueTasks.slice(0, 8).map((t) => (
                <li key={t.id} className="flex justify-between rounded-lg border border-border bg-surface px-3 py-2 text-sm">
                  <span className="truncate">{t.title}</span>
                  <span className="ml-2 shrink-0 text-xs text-bad">{format(parseISO(t.due_date!), 'd MMM', { locale: sv })}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Steg 3: Mål */}
        <Card>
          <SectionTitle action={<Link to="/uppgifter" className="text-xs text-accent-soft hover:underline">Uppdatera mål →</Link>}>
            3 · Granska målen
          </SectionTitle>
          <p className="mb-3 text-xs text-muted">Rör de sig framåt? Uppdatera framsteg eller sätt nästa steg.</p>
          {goals.length === 0 ? (
            <EmptyState emoji="🎯" text="Inga mål än." />
          ) : (
            <ul className="space-y-2">
              {goals.map((g) => (
                <li key={g.id} className="flex items-center justify-between text-sm">
                  <span className="truncate">{g.title}</span>
                  <span className={`ml-2 shrink-0 text-xs ${g.progress >= 100 ? 'text-good' : 'text-muted'}`}>{g.progress}%</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Steg 4: Veckans siffror */}
        <Card>
          <SectionTitle>4 · Veckans siffror</SectionTitle>
          <ul className="space-y-2 text-sm">
            <li className="flex justify-between"><span className="text-muted">Vanor avklarade</span><span className="font-medium">{habitPct}%</span></li>
            <li className="flex justify-between"><span className="text-muted">Träning</span><span className="font-medium">{weekWorkouts.length} pass · {trainMin} min</span></li>
            <li className="flex justify-between"><span className="text-muted">Månadens netto hittills</span>
              <span className={`font-medium ${income - expenses >= 0 ? 'text-good' : 'text-bad'}`}>{formatSEK(income - expenses)}</span>
            </li>
          </ul>
        </Card>
      </div>

      {/* Steg 5: Reflektion + plan */}
      <Card>
        <SectionTitle>5 · Reflektera & planera</SectionTitle>
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <Label>Veckans vinster 🏆</Label>
            <Textarea value={wins} onChange={(e) => setWins(e.target.value)} placeholder="Vad gick bra?" className="min-h-20" />
          </div>
          <div>
            <Label>Tas med till nästa vecka</Label>
            <Textarea value={carriedOver} onChange={(e) => setCarriedOver(e.target.value)} placeholder="Vad blev inte klart och förtjänar en ny chans?" className="min-h-20" />
          </div>
        </div>
        <div className="mt-4">
          <Label>Veckans fokus — EN rad</Label>
          <Input value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="Det enda som verkligen måste hända den här veckan" />
        </div>
        <div className="mt-4">
          <Label>3–5 prioriteringar</Label>
          <div className="space-y-2">
            {priorities.map((p, i) => (
              <Input
                key={i}
                value={p}
                onChange={(e) => setPriorities(priorities.map((x, j) => (j === i ? e.target.value : x)))}
                placeholder={`Prioritering ${i + 1}`}
              />
            ))}
          </div>
          {priorities.length < 5 && (
            <button onClick={() => setPriorities([...priorities, ''])} className="mt-2 text-xs text-accent-soft hover:underline">
              + En till (max 5)
            </button>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => save(false)} disabled={saving}>Spara utkast</Button>
          <Button onClick={() => save(true)} disabled={saving}>{saving ? 'Sparar…' : 'Klarmarkera veckan ✓'}</Button>
        </div>
      </Card>
    </div>
  )
}
