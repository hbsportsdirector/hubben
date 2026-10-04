import { useCallback, useEffect, useState } from 'react'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { sv } from 'date-fns/locale'
import { supabase, supabaseUrl, supabaseKey } from '../lib/supabase'
import { Card } from './ui'

interface Prenumeration {
  id: string
  namn: string
  color: string
  external_id: string
  senast_synkad: string | null
  sista_fel: string | null
  blockerar: boolean
}

/** Kalendrar man prenumererar på via en länk — lagens matcher och liknande.
 *
 *  Hubben hämtar filen själv var trettionde minut (edge-funktionen ics-sync).
 *  Kalendrarna är skrivskyddade: det är laget som äger tiderna, och en ändring
 *  här skulle skrivas över vid nästa hämtning ändå. */
export function Prenumerationer() {
  const [lista, setLista] = useState<Prenumeration[]>([])
  const [lank, setLank] = useState('')
  const [namn, setNamn] = useState('')
  const [arbetar, setArbetar] = useState<string | null>(null)
  const [fel, setFel] = useState<string | null>(null)
  const [klart, setKlart] = useState<string | null>(null)

  const ladda = useCallback(async () => {
    const { data } = await supabase
      .from('hub_calendars')
      .select('id, namn, color, external_id, senast_synkad, sista_fel, blockerar')
      .eq('provider', 'ics')
      .order('namn')
    setLista((data as Prenumeration[]) ?? [])
  }, [])

  useEffect(() => { ladda() }, [ladda])

  async function anropa(kropp: Record<string, string>) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Ingen aktiv session')
    const res = await fetch(`${supabaseUrl}/functions/v1/ics-sync`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}`, apikey: supabaseKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(kropp),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || json.fel) throw new Error(json.fel ?? `Servern svarade ${res.status}`)
    return json
  }

  async function laggTill() {
    if (!lank.trim()) return
    setArbetar('ny'); setFel(null); setKlart(null)
    try {
      const svar = await anropa({ lank: lank.trim(), ...(namn.trim() ? { namn: namn.trim() } : {}) })
      setLank(''); setNamn('')
      setKlart(`✓ ${svar.kalender} — ${svar.handelser} händelser hämtade`)
    } catch (e) {
      setFel(e instanceof Error ? e.message : String(e))
    } finally {
      setArbetar(null)
      await ladda()
    }
  }

  async function hamtaOm(p: Prenumeration) {
    setArbetar(p.id); setFel(null); setKlart(null)
    try {
      const svar = await anropa({ kalender_id: p.id })
      const r = svar.resultat?.[0]
      if (r?.fel) setFel(`${p.namn}: ${r.fel}`)
      else if (r) setKlart(`✓ ${p.namn} — ${r.handelser} händelser`)
    } catch (e) {
      setFel(e instanceof Error ? e.message : String(e))
    } finally {
      setArbetar(null)
      await ladda()
    }
  }

  async function vaxlaBlockerar(p: Prenumeration) {
    setLista((prev) => prev.map((x) => (x.id === p.id ? { ...x, blockerar: !x.blockerar } : x)))
    await supabase.from('hub_calendars').update({ blockerar: !p.blockerar }).eq('id', p.id).throwOnError()
  }

  async function taBort(p: Prenumeration) {
    if (!window.confirm(`Sluta prenumerera på ${p.namn}? Dess händelser försvinner ur Hubben.`)) return
    // Händelserna följer med av sig själva — främmande nyckeln kaskaderar
    await supabase.from('hub_calendars').delete().eq('id', p.id).throwOnError()
    await ladda()
  }

  return (
    <Card>
      <h2 className="font-semibold">🏆 Prenumerationer — lagkalendrar</h2>
      <p className="mt-0.5 text-sm text-muted">
        Klistra in kalenderlänken från t.ex. Profixio, laget.se eller SportAdmin. Leta efter en
        knapp som heter <em>Prenumerera</em>, <em>iCal</em>, <em>ics</em> eller <em>Lägg till i kalender</em> och
        kopiera länken (den börjar ofta med <span className="font-mono text-xs">webcal://</span>).
        Hubben hämtar den var trettionde minut.
      </p>

      {lista.length > 0 && (
        <div className="mt-4 space-y-2">
          {lista.map((p) => (
            <div key={p.id} className="rounded-xl border border-border px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: p.color }} />
                <span className="min-w-0 flex-1 truncate text-sm text-ink" title={p.external_id}>{p.namn}</span>
                <button
                  onClick={() => hamtaOm(p)}
                  disabled={arbetar !== null}
                  className="rounded-lg px-2 py-1 text-xs text-muted transition-colors hover:bg-card-hover hover:text-ink disabled:opacity-50"
                >
                  {arbetar === p.id ? 'Hämtar…' : '↻ Hämta nu'}
                </button>
                <button
                  onClick={() => taBort(p)}
                  className="rounded-lg px-2 py-1 text-xs text-muted transition-colors hover:bg-card-hover hover:text-bad"
                >
                  Ta bort
                </button>
              </div>
              <p className="mt-1 text-xs text-muted">
                {p.senast_synkad
                  ? `Hämtad ${formatDistanceToNow(parseISO(p.senast_synkad), { locale: sv, addSuffix: true })}`
                  : 'Inte hämtad än'}
              </p>
              {p.sista_fel && <p className="mt-1 text-xs text-warn">{p.sista_fel}</p>}
              <label className="mt-1.5 flex cursor-pointer items-center gap-2 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={p.blockerar}
                  onChange={() => vaxlaBlockerar(p)}
                  className="h-3.5 w-3.5 shrink-0 accent-accent"
                />
                Räkna mig som upptagen på bokningssidan när något står här
              </label>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 space-y-2">
        <input
          type="url"
          inputMode="url"
          value={lank}
          onChange={(e) => setLank(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') laggTill() }}
          placeholder="webcal://… eller https://….ics"
          autoComplete="off"
          className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
        />
        <div className="flex gap-2">
          <input
            value={namn}
            onChange={(e) => setNamn(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') laggTill() }}
            placeholder="Namn (valfritt — annars kalenderns eget)"
            className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          />
          <button
            onClick={laggTill}
            disabled={arbetar !== null || !lank.trim()}
            className="shrink-0 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-soft disabled:opacity-50"
          >
            {arbetar === 'ny' ? 'Hämtar…' : 'Prenumerera'}
          </button>
        </div>
      </div>

      {klart && (
        <p className="mt-3 rounded-xl border border-good/40 bg-good/10 px-3 py-2 text-xs text-good">{klart}</p>
      )}
      {fel && (
        <p className="mt-3 rounded-xl border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad">{fel}</p>
      )}
    </Card>
  )
}
