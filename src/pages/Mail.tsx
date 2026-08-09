import { useEffect, useState, useCallback, useRef } from 'react'
import { format, parseISO, isToday, isYesterday } from 'date-fns'
import { sv } from 'date-fns/locale'
import { supabase, supabaseUrl, supabaseKey } from '../lib/supabase'
import { Spinner, EmptyState } from '../components/ui'

/** Lådor enligt HEY-modellen — Reply Later och Bubble Up spänner över alla konton. */
type Lada = 'imbox' | 'feed' | 'papertrail' | 'reply_later' | 'bubble_up'

const LADOR: { id: Lada; namn: string; ikon: string; tangent: string }[] = [
  { id: 'imbox', namn: 'Inkorg', ikon: '📥', tangent: '1' },
  { id: 'feed', namn: 'Flödet', ikon: '📰', tangent: '2' },
  { id: 'papertrail', namn: 'Kvitton', ikon: '🧾', tangent: '3' },
  { id: 'reply_later', namn: 'Svara senare', ikon: '↩️', tangent: '4' },
  { id: 'bubble_up', namn: 'Uppskjutna', ikon: '⏳', tangent: '6' },
]

interface Mejl {
  id: string
  account_id: string
  folder_id: string
  subject: string
  from_name: string | null
  from_email: string | null
  sent_at: string | null
  seen: boolean
  flagged: boolean
  reply_later: boolean
  bubble_up_at: string | null
  destination: string
  has_attachments: boolean
  rfc_message_id: string | null
}

interface Konto { id: string; label: string; color: string; email: string }
interface Mapp {
  id: string
  path: string
  name: string
  account_id: string
  total_count: number | null
  unseen_count: number | null
  last_synced_at: string | null
}

const AVATARFARGER = ['#3987e5', '#199e70', '#c98500', '#9085e9', '#e66767', '#d55181', '#d95926', '#0ea5e9']
function avatarFarg(n: string) {
  let h = 0
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0
  return AVATARFARGER[h % AVATARFARGER.length]
}
function initialer(n: string) {
  return n.split(/[\s@.]+/).filter(Boolean).map((d) => d[0]).slice(0, 2).join('').toUpperCase()
}
function visaTid(iso: string | null) {
  if (!iso) return ''
  const d = parseISO(iso)
  if (isToday(d)) return format(d, 'HH:mm')
  if (isYesterday(d)) return 'Igår'
  return format(d, 'd MMM', { locale: sv })
}

export default function Mail() {
  const [lada, setLada] = useState<Lada>('imbox')
  const [kontoFilter, setKontoFilter] = useState<string>('alla')
  const [mappFilter, setMappFilter] = useState<string | null>(null)
  const [sok, setSok] = useState('')
  const [mejl, setMejl] = useState<Mejl[]>([])
  const [konton, setKonton] = useState<Konto[]>([])
  const [mappar, setMappar] = useState<Mapp[]>([])
  const [valdId, setValdId] = useState<string | null>(null)
  const [laddar, setLaddar] = useState(true)
  const [antal, setAntal] = useState<Record<string, number>>({})
  const [synkarMapp, setSynkarMapp] = useState<string | null>(null)
  const [visaFlytt, setVisaFlytt] = useState(false)
  const [flyttar, setFlyttar] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  async function anropaFunktion(namn: string, kropp: Record<string, unknown>) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return { fel: 'Ingen session' }
    const res = await fetch(`${supabaseUrl}/functions/v1/${namn}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}`, apikey: supabaseKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(kropp),
    })
    return await res.json()
  }

  const laddaMeta = useCallback(async () => {
    const [k, m] = await Promise.all([
      supabase.from('hub_mail_accounts').select('id, label, color, email').eq('active', true).order('sort_order'),
      supabase.from('hub_folders').select('id, path, name, account_id, total_count, unseen_count, last_synced_at').eq('hidden', false).order('path'),
    ])
    setKonton(k.data ?? [])
    setMappar(m.data ?? [])
  }, [])

  const laddaAntal = useCallback(async () => {
    const nu = new Date().toISOString()
    const [imbox, feed, kvitto, senare, uppskjutna] = await Promise.all([
      supabase.from('hub_messages').select('*', { count: 'exact', head: true }).eq('destination', 'imbox').eq('reply_later', false).eq('seen', false),
      supabase.from('hub_messages').select('*', { count: 'exact', head: true }).eq('destination', 'feed').eq('seen', false),
      supabase.from('hub_messages').select('*', { count: 'exact', head: true }).eq('destination', 'papertrail').eq('seen', false),
      supabase.from('hub_messages').select('*', { count: 'exact', head: true }).eq('reply_later', true),
      supabase.from('hub_messages').select('*', { count: 'exact', head: true }).gt('bubble_up_at', nu),
    ])
    setAntal({
      imbox: imbox.count ?? 0, feed: feed.count ?? 0, papertrail: kvitto.count ?? 0,
      reply_later: senare.count ?? 0, bubble_up: uppskjutna.count ?? 0,
    })
  }, [])

  const laddaMejl = useCallback(async () => {
    setLaddar(true)
    const nu = new Date().toISOString()
    let q = supabase.from('hub_messages')
      .select('id, account_id, folder_id, subject, from_name, from_email, sent_at, seen, flagged, reply_later, bubble_up_at, destination, has_attachments, rfc_message_id')
      .order('sent_at', { ascending: false })
      .limit(200)

    if (lada === 'reply_later') q = q.eq('reply_later', true)
    else if (lada === 'bubble_up') q = q.gt('bubble_up_at', nu)
    else {
      q = q.eq('destination', lada).eq('reply_later', false).or(`bubble_up_at.is.null,bubble_up_at.lte.${nu}`)
    }
    if (kontoFilter !== 'alla') q = q.eq('account_id', kontoFilter)
    if (mappFilter) q = q.eq('folder_id', mappFilter)
    if (sok.trim()) q = q.or(`subject.ilike.%${sok.trim()}%,from_name.ilike.%${sok.trim()}%,from_email.ilike.%${sok.trim()}%`)

    const { data } = await q
    setMejl(data ?? [])
    setLaddar(false)
  }, [lada, kontoFilter, mappFilter, sok])

  useEffect(() => { laddaMeta() }, [laddaMeta])
  useEffect(() => { laddaMejl(); laddaAntal() }, [laddaMejl, laddaAntal])

  const vald = mejl.find((m) => m.id === valdId) ?? null

  async function uppdatera(id: string, patch: Partial<Mejl>) {
    setMejl((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)))
    await supabase.from('hub_messages').update(patch).eq('id', id)
    laddaAntal()
  }

  async function svaraSenare(m: Mejl) {
    await uppdatera(m.id, { reply_later: !m.reply_later, reply_later_at: m.reply_later ? null : new Date().toISOString() } as Partial<Mejl>)
    if (lada !== 'reply_later') setMejl((prev) => prev.filter((x) => x.id !== m.id))
  }

  async function skjutUpp(m: Mejl, timmar: number) {
    const nar = new Date(Date.now() + timmar * 3600_000).toISOString()
    await uppdatera(m.id, { bubble_up_at: nar })
    setMejl((prev) => prev.filter((x) => x.id !== m.id))
  }

  // Tangentbordstriage
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || e.metaKey || e.ctrlKey) return
      const siffra = LADOR.find((l) => l.tangent === e.key)
      if (siffra) { setLada(siffra.id); setMappFilter(null); setValdId(null); return }
      if (!mejl.length) return
      const i = mejl.findIndex((m) => m.id === valdId)
      if (e.key === 'j') { e.preventDefault(); setValdId(mejl[Math.min(i + 1, mejl.length - 1)]?.id ?? mejl[0].id) }
      if (e.key === 'k') { e.preventDefault(); setValdId(mejl[Math.max(i - 1, 0)]?.id ?? mejl[0].id) }
      if (!vald) return
      if (e.key === 'l') { e.preventDefault(); svaraSenare(vald) }
      if (e.key === 'z') { e.preventDefault(); skjutUpp(vald, 24) }
      if (e.key === 'u') { e.preventDefault(); uppdatera(vald.id, { seen: !vald.seen }) }
      if (e.key === 's') { e.preventDefault(); uppdatera(vald.id, { flagged: !vald.flagged }) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const kontoAv = (id: string) => konton.find((k) => k.id === id)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold tracking-tight">Mejl</h1>
        <div className="relative min-w-56 flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">🔍</span>
          <input
            value={sok}
            onChange={(e) => setSok(e.target.value)}
            placeholder="Sök i alla konton…"
            className="w-full rounded-xl border border-border bg-surface py-2 pl-9 pr-3 text-sm text-ink outline-none transition-colors placeholder:text-muted/60 focus:border-accent"
          />
        </div>
      </div>

      <div className="flex gap-3" style={{ height: 'calc(100vh - 8.5rem)' }}>
        {/* Lådor, konton och mappar */}
        <aside className="hidden w-52 shrink-0 flex-col gap-4 overflow-y-auto rounded-2xl border border-border bg-card p-3 xl:flex">
          <div>
            <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted">Lådor</p>
            {LADOR.map((l) => (
              <button
                key={l.id}
                onClick={() => { setLada(l.id); setMappFilter(null); setValdId(null) }}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors ${
                  lada === l.id && !mappFilter ? 'bg-accent/15 font-medium text-accent-soft' : 'text-muted hover:bg-card-hover hover:text-ink'
                }`}
              >
                <span aria-hidden>{l.ikon}</span>
                <span className="flex-1 truncate">{l.namn}</span>
                {antal[l.id] > 0 && <span className="text-[11px] font-semibold">{antal[l.id]}</span>}
                <kbd className="text-[9px] text-muted/50">{l.tangent}</kbd>
              </button>
            ))}
          </div>

          <div>
            <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted">Konton</p>
            <button
              onClick={() => { setKontoFilter('alla'); setValdId(null) }}
              className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors ${
                kontoFilter === 'alla' ? 'bg-accent/15 font-medium text-accent-soft' : 'text-muted hover:bg-card-hover hover:text-ink'
              }`}
            >
              <span className="h-2 w-2 rounded-full bg-muted" /> Alla konton
            </button>
            {konton.map((k) => (
              <button
                key={k.id}
                onClick={() => { setKontoFilter(k.id); setValdId(null) }}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors ${
                  kontoFilter === k.id ? 'bg-accent/15 font-medium text-accent-soft' : 'text-muted hover:bg-card-hover hover:text-ink'
                }`}
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: k.color }} />
                <span className="truncate">{k.label}</span>
              </button>
            ))}
          </div>

          <div>
            <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
              Mappar ({mappar.length})
            </p>
            <div className="max-h-64 overflow-y-auto">
              {mappar
                .filter((m) => kontoFilter === 'alla' || m.account_id === kontoFilter)
                .map((m) => (
                  <button
                    key={m.id}
                    onClick={async () => {
                      setMappFilter(m.id); setValdId(null)
                      // Lat synk: hämta mappen första gången den öppnas
                      if (!m.last_synced_at) {
                        setSynkarMapp(m.id)
                        await anropaFunktion('mail-sync', { folderId: m.id })
                        await laddaMeta()
                        await laddaMejl()
                        setSynkarMapp(null)
                      }
                    }}
                    title={m.path}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[12px] transition-colors ${
                      mappFilter === m.id ? 'bg-accent/15 font-medium text-accent-soft' : 'text-muted hover:bg-card-hover hover:text-ink'
                    }`}
                  >
                    <span className="truncate">{m.name}</span>
                    {synkarMapp === m.id ? (
                      <span className="ml-auto text-[10px] text-accent-soft">hämtar…</span>
                    ) : (
                      <>
                        {!m.last_synced_at && <span className="ml-auto text-[10px] text-muted/40" title="Inte hämtad än">○</span>}
                        {(m.total_count ?? 0) > 0 && <span className="ml-1 text-[10px] text-muted/70">{m.total_count}</span>}
                      </>
                    )}
                  </button>
                ))}
            </div>
          </div>
        </aside>

        {/* Lista */}
        <div className="flex w-full shrink-0 flex-col overflow-hidden rounded-2xl border border-border bg-card lg:w-88 xl:w-96">
          <div ref={listRef} className="flex-1 overflow-y-auto">
            {laddar ? <Spinner /> : mejl.length === 0 ? (
              <EmptyState emoji="✨" text={sok ? 'Inga träffar.' : 'Tomt här.'} />
            ) : (
              mejl.map((m) => {
                const namn = m.from_name || m.from_email || '(okänd)'
                const konto = kontoAv(m.account_id)
                return (
                  <button
                    key={m.id}
                    onClick={() => { setValdId(m.id); if (!m.seen) uppdatera(m.id, { seen: true }) }}
                    className={`flex w-full gap-3 border-l-2 border-b border-b-border/50 px-3 py-3 text-left transition-colors ${
                      valdId === m.id ? 'border-l-accent bg-accent/10' : 'border-l-transparent hover:bg-card-hover'
                    }`}
                  >
                    <span className="relative shrink-0">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ background: avatarFarg(namn) }}>
                        {initialer(namn)}
                      </span>
                      {konto && (
                        <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card" style={{ background: konto.color }} title={konto.label} />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={`truncate text-[13px] ${!m.seen ? 'font-semibold text-ink' : 'text-muted'}`}>{namn}</span>
                        <span className="shrink-0 text-[11px] text-muted">{visaTid(m.sent_at)}</span>
                      </span>
                      <span className={`mt-0.5 flex items-center gap-1.5 truncate text-[13px] ${!m.seen ? 'font-medium text-ink' : 'text-muted'}`}>
                        {m.flagged && <span className="shrink-0 text-[11px]">⭐</span>}
                        {m.reply_later && <span className="shrink-0 text-[11px]">↩️</span>}
                        <span className="truncate">{m.subject || '(inget ämne)'}</span>
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted/70">{m.from_email}</span>
                    </span>
                  </button>
                )
              })
            )}
          </div>
          <p className="border-t border-border px-3 py-2 text-[10px] text-muted">
            <kbd className="rounded border border-border bg-surface px-1">J</kbd>/<kbd className="rounded border border-border bg-surface px-1">K</kbd> bläddra ·
            <kbd className="ml-1 rounded border border-border bg-surface px-1">L</kbd> svara senare ·
            <kbd className="ml-1 rounded border border-border bg-surface px-1">Z</kbd> skjut upp ·
            <kbd className="ml-1 rounded border border-border bg-surface px-1">S</kbd> stjärna
          </p>
        </div>

        {/* Läsruta */}
        <div className="hidden min-w-0 flex-1 overflow-hidden rounded-2xl border border-border bg-card lg:block">
          {vald ? (
            <Lasruta
              mejl={vald}
              konto={kontoAv(vald.account_id)}
              mappar={mappar.filter((m) => m.id !== vald.folder_id)}
              konton={konton}
              visaFlytt={visaFlytt}
              setVisaFlytt={setVisaFlytt}
              flyttar={flyttar}
              onFlytta={async (mappId) => {
                const mal = mappar.find((m) => m.id === mappId)
                if (!mal) return
                const mellanKonton = mal.account_id !== vald.account_id
                setVisaFlytt(false)
                setFlyttar(true)
                try {
                  const svar = await anropaFunktion(
                    mellanKonton ? 'mail-move-x' : 'mail-move',
                    { messageId: vald.id, targetFolderId: mappId },
                  )
                  if (svar?.fel) { alert('Kunde inte flytta: ' + svar.fel); return }
                  setMejl((prev) => prev.filter((x) => x.id !== vald.id))
                  setValdId(null)
                  laddaMeta()
                  laddaAntal()
                } finally {
                  setFlyttar(false)
                }
              }}
              onSkicka={async (fromAccountId, till, amne, text) => {
                const svar = await anropaFunktion('mail-send', {
                  fromAccountId, to: till, subject: amne, body: text, inReplyToId: vald.id,
                })
                if (svar?.fel) return { fel: svar.fel as string }
                uppdatera(vald.id, { reply_later: false } as Partial<Mejl>)
                return { ok: true }
              }}
              onSvaraSenare={() => svaraSenare(vald)}
              onSkjutUpp={(h) => skjutUpp(vald, h)}
              onStjarna={() => uppdatera(vald.id, { flagged: !vald.flagged })}
              onRouta={async (dest) => {
                if (!vald.from_email) return
                await supabase.rpc('hub_route_sender', { p_pattern: vald.from_email, p_destination: dest })
                laddaMejl(); laddaAntal()
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <EmptyState emoji="✉️" text="Välj ett mejl" />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Lasruta({ mejl, konto, mappar, konton, visaFlytt, setVisaFlytt, flyttar, onFlytta, onSkicka, onSvaraSenare, onSkjutUpp, onStjarna, onRouta }: {
  mejl: Mejl
  konto?: Konto
  mappar: Mapp[]
  konton: Konto[]
  visaFlytt: boolean
  setVisaFlytt: (v: boolean) => void
  flyttar: boolean
  onFlytta: (mappId: string) => void
  onSkicka: (fromAccountId: string, till: string, amne: string, text: string) => Promise<{ ok?: boolean; fel?: string }>
  onSvaraSenare: () => void
  onSkjutUpp: (timmar: number) => void
  onStjarna: () => void
  onRouta: (dest: 'imbox' | 'feed' | 'papertrail') => void
}) {
  const [flyttSok, setFlyttSok] = useState('')
  const traffar = mappar.filter((m) => m.path.toLowerCase().includes(flyttSok.toLowerCase())).slice(0, 40)

  // Svarsruta — avsändaren förvald till kontot mejlet kom till
  const [visaSvar, setVisaSvar] = useState(false)
  const [franKonto, setFranKonto] = useState(mejl.account_id)
  const [till, setTill] = useState('')
  const [amne, setAmne] = useState('')
  const [text, setText] = useState('')
  const [skickar, setSkickar] = useState(false)
  const [resultat, setResultat] = useState<{ ok?: boolean; fel?: string } | null>(null)

  useEffect(() => {
    setVisaSvar(false); setResultat(null)
    setFranKonto(mejl.account_id)
    setTill(mejl.from_email ?? '')
    setAmne(/^re:/i.test(mejl.subject) ? mejl.subject : `Re: ${mejl.subject}`)
    setText('')
  }, [mejl.id, mejl.account_id, mejl.from_email, mejl.subject])
  const [kropp, setKropp] = useState<{ text_body: string | null; html_body: string | null } | null>(null)
  const [hamtar, setHamtar] = useState(false)
  const [fel, setFel] = useState<string | null>(null)
  const [visaHtml, setVisaHtml] = useState(false)

  useEffect(() => {
    let avbruten = false
    setKropp(null); setFel(null); setHamtar(true); setVisaHtml(false)
    ;(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return
        const res = await fetch(`${supabaseUrl}/functions/v1/mail-body`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.access_token}`, apikey: supabaseKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ messageId: mejl.id }),
        })
        const json = await res.json()
        if (avbruten) return
        if (json.fel) setFel(json.fel)
        else { setKropp(json); setVisaHtml(!json.text_body && !!json.html_body) }
      } catch (e) {
        if (!avbruten) setFel(String(e))
      } finally {
        if (!avbruten) setHamtar(false)
      }
    })()
    return () => { avbruten = true }
  }, [mejl.id])

  const namn = mejl.from_name || mejl.from_email || '(okänd)'

  return (
    <div className="flex h-full flex-col">
      <div className="relative flex flex-wrap items-center gap-0.5 border-b border-border px-3 py-2">
        <Verktyg ikon="✏️" text="Svara" aktiv={visaSvar} onClick={() => setVisaSvar(!visaSvar)} />
        <Verktyg ikon="↩️" text={mejl.reply_later ? 'I svarshögen' : 'Svara senare'} aktiv={mejl.reply_later} onClick={onSvaraSenare} />
        <Verktyg ikon="⏳" text="Skjut upp" onClick={() => onSkjutUpp(24)} />
        <Verktyg ikon="📁" text={flyttar ? 'Flyttar…' : 'Flytta till…'} aktiv={visaFlytt} onClick={() => { if (!flyttar) { setVisaFlytt(!visaFlytt); setFlyttSok('') } }} />
        <Verktyg ikon={mejl.flagged ? '⭐' : '☆'} text="" onClick={onStjarna} />

        {visaFlytt && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setVisaFlytt(false)} />
            <div className="absolute left-3 top-full z-30 mt-1 w-80 overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
              <input
                autoFocus
                value={flyttSok}
                onChange={(e) => setFlyttSok(e.target.value)}
                placeholder="Sök mapp…"
                className="w-full border-b border-border bg-transparent px-3 py-2.5 text-sm text-ink outline-none placeholder:text-muted/60"
              />
              <ul className="max-h-72 overflow-y-auto p-1">
                {traffar.length === 0 && <li className="px-3 py-4 text-center text-xs text-muted">Inga mappar matchar</li>}
                {traffar.map((m) => {
                  const mk = konton.find((k) => k.id === m.account_id)
                  const annatKonto = m.account_id !== mejl.account_id
                  return (
                    <li key={m.id}>
                      <button
                        onClick={() => onFlytta(m.id)}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-muted transition-colors hover:bg-accent/15 hover:text-ink"
                      >
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: mk?.color ?? '#8b95ad' }} title={mk?.label} />
                        <span className="truncate">{m.path.replace(/^INBOX[./]/, '').replace(/^\[Gmail\]\//, '')}</span>
                        {annatKonto && (
                          <span className="shrink-0 rounded-full bg-warn/15 px-1.5 text-[9px] font-medium text-warn">
                            {mk?.label}
                          </span>
                        )}
                        {(m.total_count ?? 0) > 0 && <span className="ml-auto text-[10px] text-muted/60">{m.total_count}</span>}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          </>
        )}
        <span className="ml-auto flex items-center gap-1">
          <span className="text-[10px] text-muted">Skicka framtida från denna avsändare till:</span>
          <Verktyg ikon="📥" text="" title="Inkorgen" onClick={() => onRouta('imbox')} />
          <Verktyg ikon="📰" text="" title="Flödet" onClick={() => onRouta('feed')} />
          <Verktyg ikon="🧾" text="" title="Kvitton" onClick={() => onRouta('papertrail')} />
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="px-6 pt-5">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {konto && (
              <span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: `${konto.color}22`, color: konto.color }}>
                {konto.label}
              </span>
            )}
            {mejl.bubble_up_at && new Date(mejl.bubble_up_at) > new Date() && (
              <span className="rounded-full bg-warn/15 px-2 py-0.5 text-[10px] font-medium text-warn">
                ⏳ Flyter upp {format(parseISO(mejl.bubble_up_at), 'd MMM HH:mm', { locale: sv })}
              </span>
            )}
          </div>

          <h2 className="text-xl font-semibold leading-snug">{mejl.subject || '(inget ämne)'}</h2>

          <div className="mt-4 flex items-center gap-3 border-b border-border pb-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: avatarFarg(namn) }}>
              {initialer(namn)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{namn}</p>
              <p className="truncate text-xs text-muted">{mejl.from_email}</p>
            </div>
            <span className="shrink-0 text-xs text-muted">
              {mejl.sent_at && format(parseISO(mejl.sent_at), 'd MMM yyyy HH:mm', { locale: sv })}
            </span>
          </div>
        </div>

        <div className="px-6 py-5">
          {hamtar && <Spinner />}
          {fel && <p className="rounded-xl border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">Kunde inte hämta brödtexten: {fel}</p>}
          {kropp && (
            <>
              {kropp.text_body && kropp.html_body && (
                <button onClick={() => setVisaHtml(!visaHtml)} className="mb-3 text-xs text-accent-soft hover:underline">
                  {visaHtml ? 'Visa som text' : 'Visa formaterad'}
                </button>
              )}
              {visaHtml && kropp.html_body ? (
                // Låst iframe: inga skript, inga formulär, ingen navigering
                <iframe
                  sandbox=""
                  srcDoc={`<style>body{font-family:system-ui,sans-serif;color:#e5eaf5;background:transparent;font-size:14px;line-height:1.6}a{color:#818cf8}img{max-width:100%;height:auto}</style>${kropp.html_body}`}
                  className="h-[55vh] w-full rounded-xl border border-border bg-surface"
                  title="Mejlinnehåll"
                />
              ) : (
                <pre className="max-w-prose whitespace-pre-wrap font-sans text-[14px] leading-relaxed text-ink/90">
                  {kropp.text_body || '(ingen textversion)'}
                </pre>
              )}
            </>
          )}
        </div>
      </div>

      {/* Svarsruta */}
      <div className="border-t border-border p-3">
        {!visaSvar ? (
          <button
            onClick={() => setVisaSvar(true)}
            className="flex w-full items-center gap-2.5 rounded-xl border border-border bg-surface px-3 py-2.5 text-left transition-colors hover:bg-card-hover"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: konto?.color ?? '#6366f1' }}>
              {initialer(konto?.email ?? 'du')}
            </span>
            <span className="text-sm text-muted">Svara {(mejl.from_name || mejl.from_email || '').split(' ')[0]}…</span>
          </button>
        ) : (
          <div className="space-y-2 rounded-xl border border-border bg-surface p-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted">Från</span>
              <select
                value={franKonto}
                onChange={(e) => setFranKonto(e.target.value)}
                className="rounded-lg border border-border bg-card px-2 py-1 text-xs text-ink outline-none focus:border-accent"
              >
                {konton.map((k) => (
                  <option key={k.id} value={k.id}>{k.email}</option>
                ))}
              </select>
              {franKonto !== mejl.account_id && (
                <span className="rounded-full bg-warn/15 px-2 py-0.5 text-[10px] font-medium text-warn">
                  Skickas via ett annat konto än mejlet kom till
                </span>
              )}
            </div>

            <input
              value={till}
              onChange={(e) => setTill(e.target.value)}
              placeholder="Till"
              className="w-full rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent"
            />
            <input
              value={amne}
              onChange={(e) => setAmne(e.target.value)}
              placeholder="Ämne"
              className="w-full rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent"
            />
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Skriv ditt svar…"
              autoFocus
              className="min-h-32 w-full rounded-lg border border-border bg-card px-2.5 py-2 text-sm text-ink outline-none focus:border-accent"
            />

            {resultat?.fel && (
              <p className="rounded-lg border border-bad/40 bg-bad/10 px-2.5 py-1.5 text-xs text-bad">{resultat.fel}</p>
            )}
            {resultat?.ok && (
              <p className="rounded-lg border border-good/40 bg-good/10 px-2.5 py-1.5 text-xs text-good">✓ Skickat</p>
            )}

            <div className="flex items-center justify-between">
              <button onClick={() => setVisaSvar(false)} className="text-xs text-muted hover:text-ink">Avbryt</button>
              <button
                disabled={skickar || !till.trim() || !text.trim()}
                onClick={async () => {
                  setSkickar(true); setResultat(null)
                  const r = await onSkicka(franKonto, till.trim(), amne, text)
                  setResultat(r)
                  if (r.ok) { setText(''); setTimeout(() => setVisaSvar(false), 1200) }
                  setSkickar(false)
                }}
                className="rounded-xl bg-accent px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-soft disabled:opacity-50"
              >
                {skickar ? 'Skickar…' : 'Skicka'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Verktyg({ ikon, text, onClick, aktiv, title }: { ikon: string; text: string; onClick?: () => void; aktiv?: boolean; title?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
        aktiv ? 'bg-accent/15 text-accent-soft' : 'text-muted hover:bg-card-hover hover:text-ink'
      }`}
    >
      <span aria-hidden>{ikon}</span>
      {text && <span className="hidden xl:inline">{text}</span>}
    </button>
  )
}
