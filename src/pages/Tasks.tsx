import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { format, isToday, isPast, parseISO } from 'date-fns'
import { sv } from 'date-fns/locale'
import { supabase } from '../lib/supabase'
import { getUserId, priorityMeta } from '../lib/data'
import { useNewParam } from '../lib/useNewParam'
import type { HubTask, HubProject, HubGoal } from '../lib/types'
import { Card, SectionTitle, Button, Input, Select, Label, Modal, ProgressBar, EmptyState, Spinner, Textarea } from '../components/ui'

type Filter = 'open' | 'today' | 'done'

export default function Tasks() {
  const [tasks, setTasks] = useState<HubTask[]>([])
  const [projects, setProjects] = useState<HubProject[]>([])
  const [goals, setGoals] = useState<HubGoal[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('open')
  const [projectFilter, setProjectFilter] = useState<string>('all')
  const [taskModal, setTaskModal] = useState(false)
  const [goalModal, setGoalModal] = useState(false)
  const [editTask, setEditTask] = useState<HubTask | null>(null)
  const [editGoal, setEditGoal] = useState<HubGoal | null>(null)

  const load = useCallback(async () => {
    const [t, p, g] = await Promise.all([
      supabase.from('hub_tasks').select('*').order('done').order('due_date', { ascending: true, nullsFirst: false }).order('priority'),
      supabase.from('hub_projects').select('*').order('created_at'),
      supabase.from('hub_goals').select('*').order('created_at'),
    ])
    setTasks(t.data ?? [])
    setProjects(p.data ?? [])
    setGoals(g.data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])
  useNewParam(() => { setEditTask(null); setTaskModal(true) })

  async function toggleDone(task: HubTask) {
    await supabase.from('hub_tasks').update({
      done: !task.done,
      completed_at: task.done ? null : new Date().toISOString(),
    }).eq('id', task.id)
    load()
  }

  async function removeTask(id: string) {
    await supabase.from('hub_tasks').delete().eq('id', id)
    load()
  }

  async function removeGoal(id: string) {
    await supabase.from('hub_goals').delete().eq('id', id)
    load()
  }

  async function setProgress(goal: HubGoal, progress: number) {
    setGoals(goals.map((g) => (g.id === goal.id ? { ...g, progress } : g)))
    await supabase.from('hub_goals').update({ progress }).eq('id', goal.id)
  }

  if (loading) return <Spinner />

  const visible = tasks.filter((t) => {
    if (filter === 'open' && t.done) return false
    if (filter === 'today' && (t.done || !t.due_date || !(isToday(parseISO(t.due_date)) || isPast(parseISO(t.due_date))))) return false
    if (filter === 'done' && !t.done) return false
    if (projectFilter !== 'all' && t.project_id !== (projectFilter === 'none' ? null : projectFilter)) return false
    return true
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Uppgifter & Mål</h1>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => { setEditGoal(null); setGoalModal(true) }}>+ Nytt mål</Button>
          <Button onClick={() => { setEditTask(null); setTaskModal(true) }}>+ Ny uppgift</Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {(['open', 'today', 'done'] as Filter[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`rounded-xl px-3 py-1.5 text-xs font-medium transition-colors ${
                    filter === f ? 'bg-accent/20 text-accent-soft' : 'text-muted hover:bg-card-hover'
                  }`}
                >
                  {f === 'open' ? 'Öppna' : f === 'today' ? 'Idag & försenade' : 'Klara'}
                </button>
              ))}
              <div className="ml-auto">
                <Select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className="!w-auto text-xs">
                  <option value="all">Alla projekt</option>
                  <option value="none">Utan projekt</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </div>
            </div>

            {visible.length === 0 ? (
              <EmptyState emoji="✨" text="Inget här — bra jobbat eller dags att lägga till något!" />
            ) : (
              <ul className="space-y-2">
                {visible.map((task) => {
                  const project = projects.find((p) => p.id === task.project_id)
                  const overdue = !task.done && task.due_date && isPast(parseISO(task.due_date)) && !isToday(parseISO(task.due_date))
                  return (
                    <li key={task.id} className="group flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5">
                      <button
                        onClick={() => toggleDone(task)}
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 text-[10px] text-white transition-colors ${
                          task.done ? 'border-good bg-good' : 'border-muted hover:border-good'
                        }`}
                        aria-label={task.done ? 'Ångra' : 'Markera klar'}
                      >
                        {task.done && '✓'}
                      </button>
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: priorityMeta[task.priority].color }} title={`Prioritet: ${priorityMeta[task.priority].label}`} />
                      <div className="min-w-0 flex-1">
                        <p className={`truncate text-sm ${task.done ? 'text-muted line-through' : ''}`}>{task.title}</p>
                        {(project || task.notes || task.mail_msg_id) && (
                          <p className="truncate text-xs text-muted">
                            {project && <span style={{ color: project.color }}>{project.name}</span>}
                            {project && (task.notes || task.mail_msg_id) && ' · '}
                            {/* Kom uppgiften ur ett mejl går det att hoppa
                                tillbaka dit — det var hela poängen med att
                                slippa mejla sig själv. */}
                            {task.mail_msg_id && (
                              <Link
                                to={`/mejl?mejl=${task.mail_msg_id}`}
                                className="text-accent-soft hover:underline"
                                title={task.mail_avsandare ?? undefined}
                              >
                                📧 från mejl
                              </Link>
                            )}
                            {task.mail_msg_id && task.notes && ' · '}
                            {task.notes}
                          </p>
                        )}
                      </div>
                      {task.due_date && (
                        <span className={`shrink-0 text-xs ${overdue ? 'font-medium text-bad' : 'text-muted'}`}>
                          {format(parseISO(task.due_date), 'd MMM', { locale: sv })}
                        </span>
                      )}
                      <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <button onClick={() => { setEditTask(task); setTaskModal(true) }} className="rounded-lg p-1 text-muted hover:text-ink" aria-label="Redigera">✏️</button>
                        <button onClick={() => removeTask(task.id)} className="rounded-lg p-1 text-muted hover:text-bad" aria-label="Ta bort">🗑️</button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <SectionTitle>Mål 🎯</SectionTitle>
            {goals.length === 0 ? (
              <EmptyState emoji="🎯" text="Sätt upp ditt första mål!" />
            ) : (
              <ul className="space-y-4">
                {goals.map((goal) => (
                  <li key={goal.id} className="group">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">{goal.title}</p>
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-muted">{goal.progress}%</span>
                        <button onClick={() => { setEditGoal(goal); setGoalModal(true) }} className="p-0.5 text-xs opacity-0 group-hover:opacity-100" aria-label="Redigera">✏️</button>
                        <button onClick={() => removeGoal(goal.id)} className="p-0.5 text-xs opacity-0 group-hover:opacity-100" aria-label="Ta bort">🗑️</button>
                      </div>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={goal.progress}
                      onChange={(e) => setProgress(goal, Number(e.target.value))}
                      className="mb-1 w-full accent-(--color-accent)"
                      aria-label={`Framsteg för ${goal.title}`}
                    />
                    <ProgressBar value={goal.progress} color={goal.progress >= 100 ? 'var(--color-good)' : 'var(--color-accent)'} height={6} />
                    {goal.target_date && (
                      <p className="mt-1 text-xs text-muted">Mål: {format(parseISO(goal.target_date), 'd MMM yyyy', { locale: sv })}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <ProjectsCard projects={projects} onChange={load} />
        </div>
      </div>

      <TaskModal open={taskModal} onClose={() => setTaskModal(false)} task={editTask} projects={projects} onSaved={load} />
      <GoalModal open={goalModal} onClose={() => setGoalModal(false)} goal={editGoal} onSaved={load} />
    </div>
  )
}

function ProjectsCard({ projects, onChange }: { projects: HubProject[]; onChange: () => void }) {
  const [name, setName] = useState('')
  const [fel, setFel] = useState<string | null>(null)
  const colors = ['#6366f1', '#38bdf8', '#34d399', '#fbbf24', '#f87171', '#e879f9']

  async function add() {
    if (!name.trim()) return
    setFel(null)
    try {
      const { error } = await supabase.from('hub_projects')
        .insert({ user_id: await getUserId(), name: name.trim(), color: colors[projects.length % colors.length] })
      if (error) { setFel(error.message); return }
    } catch (e) {
      setFel(e instanceof Error ? e.message : String(e))
      return
    }
    setName('')
    onChange()
  }

  async function remove(id: string) {
    await supabase.from('hub_projects').delete().eq('id', id)
    onChange()
  }

  return (
    <Card>
      <SectionTitle>Projekt</SectionTitle>
      <div className="mb-3 flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Nytt projekt…" />
        <Button onClick={add}>+</Button>
      </div>
      {fel && (
        <p className="mb-3 rounded-xl border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad">
          Projektet sparades inte: {fel}
        </p>
      )}
      <ul className="space-y-1.5">
        {projects.map((p) => (
          <li key={p.id} className="group flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-card-hover">
            <span className="h-3 w-3 rounded-full" style={{ background: p.color }} />
            <span className="flex-1">{p.name}</span>
            <button onClick={() => remove(p.id)} className="text-xs opacity-0 group-hover:opacity-100" aria-label={`Ta bort ${p.name}`}>🗑️</button>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function TaskModal({ open, onClose, task, projects, onSaved }: {
  open: boolean; onClose: () => void; task: HubTask | null; projects: HubProject[]; onSaved: () => void
}) {
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [priority, setPriority] = useState(2)
  const [projectId, setProjectId] = useState('')
  const [fel, setFel] = useState<string | null>(null)

  useEffect(() => {
    setTitle(task?.title ?? '')
    setNotes(task?.notes ?? '')
    setDueDate(task?.due_date ?? '')
    setPriority(task?.priority ?? 2)
    setProjectId(task?.project_id ?? '')
    setFel(null)
  }, [task, open])

  // Går skrivningen fel stannar rutan kvar med felet framme. Förut stängdes
  // den ändå, och uppgiften bara försvann utan att någon fick veta varför.
  async function save() {
    if (!title.trim()) { setFel('Uppgiften behöver en titel.'); return }
    setFel(null)
    const payload = {
      title: title.trim(),
      notes: notes.trim() || null,
      due_date: dueDate || null,
      priority,
      project_id: projectId || null,
    }
    try {
      const { error } = task
        ? await supabase.from('hub_tasks').update(payload).eq('id', task.id)
        : await supabase.from('hub_tasks').insert({ ...payload, user_id: await getUserId() })
      if (error) { setFel(error.message); return }
    } catch (e) {
      setFel(e instanceof Error ? e.message : String(e))
      return
    }
    onClose()
    onSaved()
  }

  return (
    <Modal open={open} onClose={onClose} title={task ? 'Redigera uppgift' : 'Ny uppgift'}>
      <div className="space-y-4">
        <div>
          <Label>Titel</Label>
          {/* Enter sparar. Resten av fälten är valfria, och att behöva flytta
              handen till muspekaren för "Ring tandläkaren" är precis den
              friktion som gör att man låter bli att skriva ner saker. */}
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save() } }}
            placeholder="Vad ska göras?"
            autoFocus
          />
        </div>
        <div>
          <Label>Anteckning</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Detaljer (valfritt)" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Deadline</Label>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <div>
            <Label>Prioritet</Label>
            <Select value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
              <option value={1}>Hög</option>
              <option value={2}>Normal</option>
              <option value={3}>Låg</option>
            </Select>
          </div>
        </div>
        <div>
          <Label>Projekt</Label>
          <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Inget projekt</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </div>
        {fel && (
          <p className="rounded-xl border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad">
            Uppgiften sparades inte: {fel}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Avbryt</Button>
          <Button onClick={save}>Spara</Button>
        </div>
      </div>
    </Modal>
  )
}

function GoalModal({ open, onClose, goal, onSaved }: { open: boolean; onClose: () => void; goal: HubGoal | null; onSaved: () => void }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [fel, setFel] = useState<string | null>(null)

  useEffect(() => {
    setTitle(goal?.title ?? '')
    setDescription(goal?.description ?? '')
    setTargetDate(goal?.target_date ?? '')
    setFel(null)
  }, [goal, open])

  async function save() {
    if (!title.trim()) { setFel('Målet behöver en rubrik.'); return }
    setFel(null)
    const payload = { title: title.trim(), description: description.trim() || null, target_date: targetDate || null }
    try {
      const { error } = goal
        ? await supabase.from('hub_goals').update(payload).eq('id', goal.id)
        : await supabase.from('hub_goals').insert({ ...payload, user_id: await getUserId() })
      if (error) { setFel(error.message); return }
    } catch (e) {
      setFel(e instanceof Error ? e.message : String(e))
      return
    }
    onClose()
    onSaved()
  }

  return (
    <Modal open={open} onClose={onClose} title={goal ? 'Redigera mål' : 'Nytt mål'}>
      <div className="space-y-4">
        <div>
          <Label>Mål</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Vad vill du uppnå?" autoFocus />
        </div>
        <div>
          <Label>Beskrivning</Label>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Varför och hur? (valfritt)" />
        </div>
        <div>
          <Label>Måldatum</Label>
          <Input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
        </div>
        {fel && (
          <p className="rounded-xl border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad">
            Målet sparades inte: {fel}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Avbryt</Button>
          <Button onClick={save}>Spara</Button>
        </div>
      </div>
    </Modal>
  )
}
