import { useEffect, useState, useCallback } from 'react'
import { supabase, supabaseUrl, supabaseKey } from '../lib/supabase'
import { getUserId } from '../lib/data'
import type { HubStock, MarketQuote } from '../lib/types'
import { Card, SectionTitle, Button, Input, EmptyState } from './ui'

// Kryptovalutor heter alltid PAR hos Yahoo. Skriver man bara "XRP" får man
// en börshandlad fond på NYSE Arca med samma namn — rätt namn, fel
// instrument, och ingenting i gränssnittet avslöjar förväxlingen. Därför
// ligger de färdiga här i stället för att skrivas för hand.
//
// XRP-SEK finns inte hos Yahoo; bara USD och EUR. Kursen visas alltså i
// dollar, och kortet skriver ut valutan.
const SUGGESTIONS: { symbol: string; label: string }[] = [
  { symbol: '^OMX', label: 'OMXS30' },
  { symbol: 'VOLV-B.ST', label: 'Volvo B' },
  { symbol: 'INVE-B.ST', label: 'Investor B' },
  { symbol: 'USDSEK=X', label: 'USD/SEK' },
  { symbol: 'EURSEK=X', label: 'EUR/SEK' },
  { symbol: 'BTC-USD', label: 'Bitcoin' },
  { symbol: 'XRP-USD', label: 'XRP' },
  { symbol: 'ETH-USD', label: 'Ethereum' },
]

export default function MarketWidgets() {
  const [stocks, setStocks] = useState<HubStock[]>([])
  const [quotes, setQuotes] = useState<Map<string, MarketQuote>>(new Map())
  const [loaded, setLoaded] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [symbolInput, setSymbolInput] = useState('')
  const [adding, setAdding] = useState(false)

  const loadStocks = useCallback(async () => {
    const { data } = await supabase.from('hub_stocks').select('*').order('sort_order').order('created_at')
    setStocks(data ?? [])
    setLoaded(true)
    return data ?? []
  }, [])

  const fetchQuotes = useCallback(async (list: HubStock[]) => {
    if (list.length === 0) {
      setQuotes(new Map())
      return
    }
    setFetching(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const symbols = list.map((s) => s.symbol).join(',')
      const res = await fetch(`${supabaseUrl}/functions/v1/market-data?symbols=${encodeURIComponent(symbols)}`, {
        headers: { Authorization: `Bearer ${session.access_token}`, apikey: supabaseKey },
      })
      if (!res.ok) return
      const json = await res.json()
      setQuotes(new Map((json.quotes as MarketQuote[]).map((q) => [q.symbol, q])))
    } finally {
      setFetching(false)
    }
  }, [])

  useEffect(() => {
    loadStocks().then(fetchQuotes)
  }, [loadStocks, fetchQuotes])

  async function add(symbol: string, label?: string) {
    const sym = symbol.trim().toUpperCase()
    if (!sym || stocks.some((s) => s.symbol === sym)) return
    setAdding(true)
    try {
      const userId = await getUserId()
      await supabase.from('hub_stocks').insert({
        user_id: userId,
        symbol: sym,
        label: label ?? null,
        sort_order: stocks.length,
      }).throwOnError()
      setSymbolInput('')
      const list = await loadStocks()
      fetchQuotes(list)
    } finally {
      setAdding(false)
    }
  }

  async function remove(id: string) {
    await supabase.from('hub_stocks').delete().eq('id', id).throwOnError()
    const list = await loadStocks()
    fetchQuotes(list)
  }

  if (!loaded) return null

  const unusedSuggestions = SUGGESTIONS.filter((s) => !stocks.some((st) => st.symbol === s.symbol))

  return (
    <Card>
      <SectionTitle
        action={
          <button
            onClick={() => fetchQuotes(stocks)}
            disabled={fetching}
            className="text-xs text-accent-soft hover:underline disabled:opacity-50"
          >
            {fetching ? 'Uppdaterar…' : '↻ Uppdatera'}
          </button>
        }
      >
        Marknad 📈
      </SectionTitle>

      {stocks.length === 0 ? (
        <EmptyState emoji="📈" text="Lägg till aktier, index eller valutor du vill bevaka." />
      ) : (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
          {stocks.map((stock) => (
            <QuoteCard key={stock.id} stock={stock} quote={quotes.get(stock.symbol)} onRemove={() => remove(stock.id)} />
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {unusedSuggestions.map((s) => (
          <button
            key={s.symbol}
            onClick={() => add(s.symbol, s.label)}
            disabled={adding}
            className="rounded-xl border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:bg-card-hover hover:text-ink disabled:opacity-50"
          >
            + {s.label}
          </button>
        ))}
        {/* Fältet var låst till 208 px, och tillsammans med knappen blev
            gruppen bredare än en 360 px-skärm har att ge — då fick hela sidan
            en sidledsscroll. Nu krymper det i stället. */}
        <div className="flex min-w-0 flex-1 basis-full items-center gap-2 sm:basis-auto">
          <Input
            value={symbolInput}
            onChange={(e) => setSymbolInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add(symbolInput)}
            placeholder="Yahoo-symbol, t.ex. ERIC-B.ST"
            className="!w-full !min-w-0 !py-1.5 text-xs sm:!w-52"
          />
          <Button variant="ghost" onClick={() => add(symbolInput)} disabled={adding || !symbolInput.trim()} className="!px-3 !py-1.5 text-xs">
            Lägg till
          </Button>
        </div>
      </div>
    </Card>
  )
}

function QuoteCard({ stock, quote, onRemove }: { stock: HubStock; quote?: MarketQuote; onRemove: () => void }) {
  const name = stock.label ?? quote?.name ?? stock.symbol
  const price = quote?.price
  const prev = quote?.prevClose
  const change = price != null && prev != null && prev !== 0 ? ((price - prev) / prev) * 100 : null
  const up = (change ?? 0) >= 0
  const changeColor = up ? 'var(--color-good)' : 'var(--color-bad)'

  return (
    <div className="group relative rounded-xl border border-border bg-surface p-3">
      <button
        onClick={onRemove}
        className="absolute right-2 top-2 text-xs opacity-0 transition-opacity group-hover:opacity-100"
        aria-label={`Ta bort ${name}`}
      >
        🗑️
      </button>
      <p className="truncate pr-5 text-xs font-medium text-muted" title={`${name} (${stock.symbol})`}>{name}</p>
      {quote?.error || price == null ? (
        <p className="mt-1 text-sm text-muted">Kunde inte hämta{quote?.error ? ` (${stock.symbol})` : '…'}</p>
      ) : (
        <>
          <div className="mt-0.5 flex items-baseline gap-2">
            <span className="text-lg font-bold">
              {new Intl.NumberFormat('sv-SE', { maximumFractionDigits: price < 10 ? 4 : 2 }).format(price)}
            </span>
            <span className="text-[10px] text-muted">{quote?.currency}</span>
          </div>
          {change != null && (
            <p className="text-xs font-medium" style={{ color: changeColor }}>
              {up ? '▲' : '▼'} {new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 2, signDisplay: 'always' }).format(change)} %
            </p>
          )}
          {quote?.spark && quote.spark.length > 1 ? (
            <Sparkline data={quote.spark} color={changeColor} />
          ) : (
            // Vissa noteringar har ett pris men ingen historik hos Yahoo — små
            // börshandlade produkter särskilt. Att bara utelämna kurvan ser ut
            // som ett fel i appen, så kortet säger det i stället.
            <p className="mt-1.5 text-[10px] text-muted/70">Ingen kurshistorik för {stock.symbol}</p>
          )}
        </>
      )}
    </div>
  )
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const W = 120, H = 28, PAD = 2
  const min = Math.min(...data)
  const max = Math.max(...data)
  const span = max - min || 1
  const points = data
    .map((v, i) => {
      const x = PAD + (i / (data.length - 1)) * (W - PAD * 2)
      const y = PAD + (1 - (v - min) / span) * (H - PAD * 2)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-1.5 w-full" role="img" aria-label="Kursutveckling senaste månaden">
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" opacity="0.9" />
    </svg>
  )
}
