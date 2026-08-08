import { useEffect, useState, useCallback, useMemo } from 'react'
import { format, startOfMonth, endOfMonth, addMonths, subMonths, parseISO } from 'date-fns'
import { sv } from 'date-fns/locale'
import { supabase } from '../lib/supabase'
import { getUserId, formatSEK } from '../lib/data'
import type { HubTransaction, HubBudget, HubSavingsGoal } from '../lib/types'
import { Card, SectionTitle, Button, Input, Select, Label, Modal, ProgressBar, EmptyState, Spinner, StatTile } from '../components/ui'

const EXPENSE_CATEGORIES = ['Boende', 'Mat', 'Transport', 'Nöje', 'Hälsa', 'Kläder', 'Sparande', 'Övrigt']
const INCOME_CATEGORIES = ['Lön', 'Bidrag', 'Försäljning', 'Övrigt']

// Diagramfärger — validerade mot mörk yta (dataviz-palette, diverging blå↔röd för in/ut)
const INCOME_COLOR = '#3987e5'
const EXPENSE_COLOR = '#e66767'

export default function Economy() {
  const [month, setMonth] = useState(startOfMonth(new Date()))
  const [txs, setTxs] = useState<HubTransaction[]>([])
  const [allTxs, setAllTxs] = useState<HubTransaction[]>([])
  const [budgets, setBudgets] = useState<HubBudget[]>([])
  const [savings, setSavings] = useState<HubSavingsGoal[]>([])
  const [loading, setLoading] = useState(true)
  const [txModal, setTxModal] = useState(false)
  const [savingsModal, setSavingsModal] = useState(false)

  const load = useCallback(async () => {
    const chartStart = startOfMonth(subMonths(new Date(), 5))
    const [t, all, b, s] = await Promise.all([
      supabase.from('hub_transactions').select('*')
        .gte('tx_date', format(startOfMonth(month), 'yyyy-MM-dd'))
        .lte('tx_date', format(endOfMonth(month), 'yyyy-MM-dd'))
        .order('tx_date', { ascending: false }),
      supabase.from('hub_transactions').select('*').gte('tx_date', format(chartStart, 'yyyy-MM-dd')),
      supabase.from('hub_budgets').select('*').order('category'),
      supabase.from('hub_savings_goals').select('*').order('created_at'),
    ])
    setTxs(t.data ?? [])
    setAllTxs(all.data ?? [])
    setBudgets(b.data ?? [])
    setSavings(s.data ?? [])
    setLoading(false)
  }, [month])

  useEffect(() => { load() }, [load])

  async function removeTx(id: string) {
    await supabase.from('hub_transactions').delete().eq('id', id)
    load()
  }

  const income = txs.filter((t) => t.kind === 'income').reduce((s, t) => s + Number(t.amount), 0)
  const expenses = txs.filter((t) => t.kind === 'expense').reduce((s, t) => s + Number(t.amount), 0)

  const monthlySeries = useMemo(() => {
    return Array.from({ length: 6 }, (_, i) => {
      const m = startOfMonth(subMonths(new Date(), 5 - i))
      const inMonth = allTxs.filter((t) => format(parseISO(t.tx_date), 'yyyy-MM') === format(m, 'yyyy-MM'))
      return {
        label: format(m, 'MMM', { locale: sv }),
        income: inMonth.filter((t) => t.kind === 'income').reduce((s, t) => s + Number(t.amount), 0),
        expense: inMonth.filter((t) => t.kind === 'expense').reduce((s, t) => s + Number(t.amount), 0),
      }
    })
  }, [allTxs])

  const byCategory = useMemo(() => {
    const map = new Map<string, number>()
    txs.filter((t) => t.kind === 'expense').forEach((t) => map.set(t.category, (map.get(t.category) ?? 0) + Number(t.amount)))
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [txs])

  if (loading) return <Spinner />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Ekonomi</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => setMonth(subMonths(month, 1))} className="rounded-lg px-2 py-1 text-muted hover:bg-card-hover hover:text-ink" aria-label="Föregående månad">←</button>
          <span className="min-w-28 text-center text-sm font-semibold capitalize">{format(month, 'MMMM yyyy', { locale: sv })}</span>
          <button onClick={() => setMonth(addMonths(month, 1))} className="rounded-lg px-2 py-1 text-muted hover:bg-card-hover hover:text-ink" aria-label="Nästa månad">→</button>
          <Button onClick={() => setTxModal(true)} className="ml-2">+ Ny transaktion</Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <StatTile label="Inkomster" value={formatSEK(income)} accent={INCOME_COLOR} />
        <StatTile label="Utgifter" value={formatSEK(expenses)} accent={EXPENSE_COLOR} />
        <StatTile label="Netto" value={formatSEK(income - expenses)} accent={income - expenses >= 0 ? 'var(--color-good)' : 'var(--color-bad)'} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionTitle>Senaste 6 månaderna</SectionTitle>
          <MonthlyChart data={monthlySeries} />
        </Card>

        <Card>
          <SectionTitle>Utgifter per kategori</SectionTitle>
          {byCategory.length === 0 ? (
            <EmptyState emoji="📊" text="Inga utgifter den här månaden." />
          ) : (
            <ul className="space-y-3">
              {byCategory.map(([cat, sum]) => (
                <li key={cat}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span>{cat}</span>
                    <span className="text-muted">{formatSEK(sum)}</span>
                  </div>
                  <ProgressBar value={(sum / (byCategory[0][1] || 1)) * 100} color={INCOME_COLOR} height={6} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <div className="mb-3 flex items-center justify-between">
            <SectionTitle>Budget per kategori</SectionTitle>
          </div>
          <BudgetSection budgets={budgets} spentByCategory={new Map(byCategory)} onChange={load} />
        </Card>

        <Card>
          <SectionTitle action={<Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => setSavingsModal(true)}>+ Nytt</Button>}>
            Sparmål 🏦
          </SectionTitle>
          {savings.length === 0 ? (
            <EmptyState emoji="🏖️" text="Skapa ett sparmål — semester, buffert, drömprylen." />
          ) : (
            <ul className="space-y-4">
              {savings.map((goal) => <SavingsRow key={goal.id} goal={goal} onChange={load} />)}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <SectionTitle>Transaktioner {format(month, 'MMMM', { locale: sv })}</SectionTitle>
        {txs.length === 0 ? (
          <EmptyState emoji="🧾" text="Inga transaktioner registrerade den här månaden." />
        ) : (
          <ul className="divide-y divide-border">
            {txs.map((tx) => (
              <li key={tx.id} className="group flex items-center gap-3 py-2.5">
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm ${tx.kind === 'income' ? 'bg-good/15' : 'bg-bad/15'}`} aria-hidden>
                  {tx.kind === 'income' ? '↓' : '↑'}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{tx.description || tx.category}</p>
                  <p className="text-xs text-muted">{tx.category} · {format(parseISO(tx.tx_date), 'd MMM', { locale: sv })}</p>
                </div>
                <span className={`text-sm font-semibold ${tx.kind === 'income' ? 'text-good' : ''}`}>
                  {tx.kind === 'income' ? '+' : '−'}{formatSEK(Number(tx.amount))}
                </span>
                <button onClick={() => removeTx(tx.id)} className="p-1 text-xs opacity-0 transition-opacity group-hover:opacity-100" aria-label="Ta bort">🗑️</button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <TxModal open={txModal} onClose={() => setTxModal(false)} onSaved={load} />
      <SavingsModal open={savingsModal} onClose={() => setSavingsModal(false)} onSaved={load} />
    </div>
  )
}

function MonthlyChart({ data }: { data: { label: string; income: number; expense: number }[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 520, H = 220, PAD_L = 12, PAD_B = 24, PAD_T = 16
  const max = Math.max(1, ...data.flatMap((d) => [d.income, d.expense]))
  const groupW = (W - PAD_L) / data.length
  const barW = Math.min(28, groupW / 3)

  if (data.every((d) => d.income === 0 && d.expense === 0)) {
    return <EmptyState emoji="📈" text="Lägg till transaktioner så växer diagrammet fram här." />
  }

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Inkomster och utgifter per månad, senaste sex månaderna">
        {/* recessiva gridlinjer */}
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={PAD_L} x2={W} y1={PAD_T + (H - PAD_B - PAD_T) * (1 - f)} y2={PAD_T + (H - PAD_B - PAD_T) * (1 - f)} stroke="#232d44" strokeWidth="1" />
        ))}
        {data.map((d, i) => {
          const cx = PAD_L + groupW * i + groupW / 2
          const scale = (v: number) => (v / max) * (H - PAD_B - PAD_T)
          const hIn = scale(d.income), hEx = scale(d.expense)
          const base = H - PAD_B
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              {/* osynlig hover-yta större än staplarna */}
              <rect x={PAD_L + groupW * i} y={0} width={groupW} height={H} fill="transparent" />
              <rect x={cx - barW - 1} y={base - hIn} width={barW} height={Math.max(hIn, d.income > 0 ? 2 : 0)} rx="4" fill={INCOME_COLOR} opacity={hover === null || hover === i ? 1 : 0.4} />
              <rect x={cx + 1} y={base - hEx} width={barW} height={Math.max(hEx, d.expense > 0 ? 2 : 0)} rx="4" fill={EXPENSE_COLOR} opacity={hover === null || hover === i ? 1 : 0.4} />
              <text x={cx} y={H - 6} textAnchor="middle" fill="#8b95ad" fontSize="11" className="capitalize">{d.label}</text>
            </g>
          )
        })}
        <line x1={PAD_L} x2={W} y1={H - PAD_B} y2={H - PAD_B} stroke="#38466a" strokeWidth="1" />
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute -top-2 rounded-xl border border-border bg-surface px-3 py-2 text-xs shadow-xl"
          style={{ left: `${(hover + 0.5) / data.length * 100}%`, transform: 'translateX(-50%)' }}
        >
          <p className="mb-1 font-semibold capitalize">{data[hover].label}</p>
          <p><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: INCOME_COLOR }} /> In: {formatSEK(data[hover].income)}</p>
          <p><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: EXPENSE_COLOR }} /> Ut: {formatSEK(data[hover].expense)}</p>
        </div>
      )}
      <div className="mt-2 flex justify-center gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: INCOME_COLOR }} /> Inkomster</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: EXPENSE_COLOR }} /> Utgifter</span>
      </div>
    </div>
  )
}

function BudgetSection({ budgets, spentByCategory, onChange }: {
  budgets: HubBudget[]; spentByCategory: Map<string, number>; onChange: () => void
}) {
  const [category, setCategory] = useState(EXPENSE_CATEGORIES[0])
  const [limit, setLimit] = useState('')

  async function add() {
    const amount = Number(limit)
    if (!amount || amount <= 0) return
    const userId = await getUserId()
    await supabase.from('hub_budgets').upsert(
      { user_id: userId, category, monthly_limit: amount },
      { onConflict: 'user_id,category' }
    )
    setLimit('')
    onChange()
  }

  async function remove(id: string) {
    await supabase.from('hub_budgets').delete().eq('id', id)
    onChange()
  }

  return (
    <div>
      <div className="mb-4 flex gap-2">
        <Select value={category} onChange={(e) => setCategory(e.target.value)} className="!w-36">
          {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
        <Input type="number" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="kr/mån" min={0} />
        <Button onClick={add}>Sätt</Button>
      </div>
      {budgets.length === 0 ? (
        <EmptyState emoji="🎯" text="Sätt en månadsbudget per kategori för att hålla koll." />
      ) : (
        <ul className="space-y-3">
          {budgets.map((b) => {
            const spent = spentByCategory.get(b.category) ?? 0
            const pct = (spent / Number(b.monthly_limit)) * 100
            const over = pct > 100
            const near = pct > 80 && !over
            const color = over ? 'var(--color-bad)' : near ? 'var(--color-warn)' : 'var(--color-good)'
            return (
              <li key={b.id} className="group">
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span>
                    {b.category}
                    {over && <span className="ml-2 text-xs font-medium text-bad">⚠ Över budget</span>}
                    {near && <span className="ml-2 text-xs font-medium text-warn">⚠ Nära gränsen</span>}
                  </span>
                  <span className="flex items-center gap-1 text-muted">
                    {formatSEK(spent)} / {formatSEK(Number(b.monthly_limit))}
                    <button onClick={() => remove(b.id)} className="ml-1 text-xs opacity-0 group-hover:opacity-100" aria-label={`Ta bort budget för ${b.category}`}>🗑️</button>
                  </span>
                </div>
                <ProgressBar value={pct} color={color} height={6} />
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function SavingsRow({ goal, onChange }: { goal: HubSavingsGoal; onChange: () => void }) {
  const [amount, setAmount] = useState('')
  const pct = (Number(goal.current_amount) / Number(goal.target_amount)) * 100

  async function addAmount() {
    const delta = Number(amount)
    if (!delta) return
    await supabase.from('hub_savings_goals').update({ current_amount: Number(goal.current_amount) + delta }).eq('id', goal.id)
    setAmount('')
    onChange()
  }

  async function remove() {
    await supabase.from('hub_savings_goals').delete().eq('id', goal.id)
    onChange()
  }

  return (
    <li className="group">
      <div className="mb-1 flex items-center justify-between text-sm">
        <span>{goal.name} {pct >= 100 && '🎉'}</span>
        <span className="flex items-center gap-1 text-muted">
          {formatSEK(Number(goal.current_amount))} / {formatSEK(Number(goal.target_amount))}
          <button onClick={remove} className="ml-1 text-xs opacity-0 group-hover:opacity-100" aria-label={`Ta bort ${goal.name}`}>🗑️</button>
        </span>
      </div>
      <ProgressBar value={pct} color={pct >= 100 ? 'var(--color-good)' : 'var(--color-sky)'} />
      <div className="mt-2 flex gap-2">
        <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Lägg till belopp…" className="!py-1.5 text-xs" />
        <Button variant="ghost" onClick={addAmount} className="!px-3 !py-1.5 text-xs">+</Button>
      </div>
    </li>
  )
}

function TxModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState<'income' | 'expense'>('expense')
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState(EXPENSE_CATEGORIES[0])
  const [description, setDescription] = useState('')
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'))

  useEffect(() => {
    if (open) {
      setKind('expense')
      setAmount('')
      setCategory(EXPENSE_CATEGORIES[0])
      setDescription('')
      setDate(format(new Date(), 'yyyy-MM-dd'))
    }
  }, [open])

  const cats = kind === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES

  async function save() {
    const value = Number(amount)
    if (!value || value <= 0) return
    const userId = await getUserId()
    await supabase.from('hub_transactions').insert({
      user_id: userId,
      kind,
      amount: value,
      category,
      description: description.trim() || null,
      tx_date: date,
    })
    onClose()
    onSaved()
  }

  return (
    <Modal open={open} onClose={onClose} title="Ny transaktion">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {(['expense', 'income'] as const).map((k) => (
            <button
              key={k}
              onClick={() => { setKind(k); setCategory((k === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES)[0]) }}
              className={`rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
                kind === k ? 'border-accent bg-accent/15 text-accent-soft' : 'border-border text-muted hover:bg-card-hover'
              }`}
            >
              {k === 'expense' ? '↑ Utgift' : '↓ Inkomst'}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Belopp (kr)</Label>
            <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" min={0} autoFocus />
          </div>
          <div>
            <Label>Datum</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <div>
          <Label>Kategori</Label>
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            {cats.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </div>
        <div>
          <Label>Beskrivning</Label>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="T.ex. ICA, hyra… (valfritt)" />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Avbryt</Button>
          <Button onClick={save}>Spara</Button>
        </div>
      </div>
    </Modal>
  )
}

function SavingsModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('')
  const [target, setTarget] = useState('')
  const [current, setCurrent] = useState('')
  const [deadline, setDeadline] = useState('')

  useEffect(() => {
    if (open) { setName(''); setTarget(''); setCurrent(''); setDeadline('') }
  }, [open])

  async function save() {
    const t = Number(target)
    if (!name.trim() || !t || t <= 0) return
    const userId = await getUserId()
    await supabase.from('hub_savings_goals').insert({
      user_id: userId,
      name: name.trim(),
      target_amount: t,
      current_amount: Number(current) || 0,
      deadline: deadline || null,
    })
    onClose()
    onSaved()
  }

  return (
    <Modal open={open} onClose={onClose} title="Nytt sparmål">
      <div className="space-y-4">
        <div>
          <Label>Namn</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="T.ex. Buffert, Japanresa…" autoFocus />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Målbelopp (kr)</Label>
            <Input type="number" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="50 000" min={0} />
          </div>
          <div>
            <Label>Sparat hittills (kr)</Label>
            <Input type="number" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="0" min={0} />
          </div>
        </div>
        <div>
          <Label>Deadline (valfritt)</Label>
          <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Avbryt</Button>
          <Button onClick={save}>Spara</Button>
        </div>
      </div>
    </Modal>
  )
}
