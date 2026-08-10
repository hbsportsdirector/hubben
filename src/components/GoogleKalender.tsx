import { useCallback, useEffect, useState } from 'react'
import { supabase, supabaseUrl, supabaseKey } from '../lib/supabase'
import { Card } from './ui'

interface Kalender {
  id: string
  namn: string
  color: string
  aktiv: boolean
}

interface Klient {
  client_id: string | null
  konto: string | null
  ansluten_vid: string | null
  sista_fel: string | null
  har_hemlighet: boolean
}

/** Anslutning av Google-kalendern.
 *
 *  Hemligheten skrivs via en RPC rakt ner i valvet och kan aldrig lasas
 *  tillbaka av klienten — darfor visas den aldrig ifylld, bara som "sparad". */
export function GoogleKalender() {
  const [klient, setKlient] = useState<Klient | null>(null)
  const [kalendrar, setKalendrar] = useState<Kalender[]>([])
  const [hemlighet, setHemlighet] = useState('')
  const [sparar, setSparar] = useState(false)
  const [ansluter, setAnsluter] = useState(false)
  const [synkar, setSynkar] = useState(false)
  const [synkSvar, setSynkSvar] = useState<{ resultat?: { kalender: string; franGoogle: number; sparade: number; borttagna: number; fickSynktoken: boolean; fel?: string }[] } | null>(null)
  const [fel, setFel] = useState<string | null>(null)
  const [sparad, setSparad] = useState(false)

  const ladda = useCallback(async () => {
    const [{ data }, { data: kal }] = await Promise.all([
      supabase
        .from('hub_oauth_klienter')
        .select('client_id, konto, ansluten_vid, sista_fel, hemlighet_id')
        .eq('provider', 'google')
        .maybeSingle(),
      supabase
        .from('hub_calendars')
        .select('id, namn, color, aktiv')
        .order('namn'),
    ])
    setKlient(data ? { ...data, har_hemlighet: !!data.hemlighet_id } : null)
    setKalendrar((kal as Kalender[]) ?? [])
  }, [])

  /** Slår av eller på en kalender. Avstängd betyder att den inte hämtas hem
   *  och inte syns någonstans i Hubben — Google rörs inte. Händelserna
   *  rensas bort, annars ligger gamla tider kvar och spökar. */
  async function vaxlaAktiv(k: Kalender) {
    const nyttVarde = !k.aktiv
    setKalendrar((prev) => prev.map((x) => (x.id === k.id ? { ...x, aktiv: nyttVarde } : x)))
    await supabase.from('hub_calendars')
      .update(nyttVarde ? { aktiv: true } : { aktiv: false, delta_link: null, senast_synkad: null })
      .eq('id', k.id)
    if (!nyttVarde) await supabase.from('hub_events').delete().eq('calendar_id', k.id)
    await ladda()
  }

  useEffect(() => { ladda() }, [ladda])

  // Callbacken skickar tillbaka hit med utfallet i adressen — den ritar ingen
  // egen sida, eftersom Supabase inte serverar dess HTML som HTML.
  const [utfall, setUtfall] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const status = q.get('kalender')
    if (!status) return
    setUtfall({ ok: status === 'ok', text: q.get('text') ?? '' })
    window.history.replaceState({}, '', window.location.pathname)
    ladda()
  }, [ladda])

  async function sparaHemlighet() {
    if (!hemlighet.trim()) return
    setSparar(true); setFel(null); setSparad(false)
    const { error } = await supabase.rpc('hub_satt_oauth_hemlighet', {
      p_provider: 'google',
      p_client_id: klient?.client_id ?? null,
      p_hemlighet: hemlighet.trim(),
    })
    if (error) setFel(error.message)
    else { setHemlighet(''); setSparad(true); await ladda() }
    setSparar(false)
  }

  async function anslut() {
    setAnsluter(true); setFel(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { setFel('Ingen aktiv session'); return }
      const res = await fetch(`${supabaseUrl}/functions/v1/google-oauth-start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, apikey: supabaseKey },
      })
      const json = await res.json().catch(() => ({}))
      if (json.url) window.location.href = json.url
      else setFel(json.fel ?? `Servern svarade ${res.status}`)
    } catch (e) {
      setFel(String(e))
    } finally {
      setAnsluter(false)
    }
  }

  async function synka() {
    setSynkar(true); setFel(null); setSynkSvar(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { setFel('Ingen aktiv session'); return }
      const res = await fetch(`${supabaseUrl}/functions/v1/calendar-sync`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, apikey: supabaseKey },
      })
      const json = await res.json().catch(() => ({}))
      if (json.fel) setFel(json.fel)
      else setSynkSvar(json)
      await ladda()
    } catch (e) {
      setFel(String(e))
    } finally {
      setSynkar(false)
    }
  }

  async function kopplaBort() {
    await supabase.rpc('hub_koppla_bort_oauth', { p_provider: 'google' })
    await ladda()
  }

  const ansluten = !!klient?.ansluten_vid

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">📅 Google-kalendern</h2>
          <p className="mt-0.5 text-sm text-muted">
            {ansluten
              ? `Ansluten${klient?.konto ? ' — ' + klient.konto : ''}`
              : 'Inte ansluten än'}
          </p>
        </div>
        {ansluten && (
          <div className="flex gap-2">
            <button
              onClick={synka}
              disabled={synkar}
              className="rounded-xl bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-soft disabled:opacity-50"
            >
              {synkar ? 'Hämtar…' : '↻ Hämta kalendern'}
            </button>
            <button
              onClick={kopplaBort}
              className="rounded-xl border border-border px-3 py-1.5 text-sm text-muted transition-colors hover:text-ink"
            >
              Koppla bort
            </button>
          </div>
        )}
      </div>

      {ansluten && kalendrar.length > 0 && (
        <div className="mt-4">
          <p className="mb-1.5 text-xs text-muted">
            Vilka kalendrar ska finnas i Hubben? Avstängda hämtas inte alls och syns ingenstans —
            de ligger kvar orörda i Google.
          </p>
          <div className="space-y-1">
            {kalendrar.map((k) => (
              <label
                key={k.id}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-card-hover"
              >
                <input
                  type="checkbox"
                  checked={k.aktiv}
                  onChange={() => vaxlaAktiv(k)}
                  className="h-4 w-4 shrink-0 accent-accent"
                />
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: k.color }} />
                <span className={k.aktiv ? 'text-ink' : 'text-muted'}>{k.namn}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {ansluten && synkSvar && (
        <div className="mt-3 space-y-1 text-xs">
          {synkSvar.resultat?.map((r, i) => (
            <p key={i} className={r.fel ? 'text-bad' : 'text-muted'}>
              <span className="text-ink">{r.kalender}</span>
              {r.fel
                ? ` — ${r.fel}`
                : r.franGoogle === 0
                  ? ' — tom i det här tidsspannet'
                  : ` — ${r.sparade} av ${r.franGoogle} händelser${r.borttagna ? `, ${r.borttagna} borttagna` : ''}`}
            </p>
          ))}
          {!synkSvar.resultat?.length && <p className="text-muted">Inga kalendrar att hämta.</p>}
        </div>
      )}

      {!ansluten && (
        <div className="mt-4 space-y-3">
          <div>
            <p className="text-xs text-muted">Klient-ID</p>
            <p className="mt-0.5 break-all font-mono text-[11px] text-ink/80">
              {klient?.client_id ?? '— saknas —'}
            </p>
          </div>

          <div>
            <label className="text-xs text-muted" htmlFor="google-hemlighet">
              Klienthemlighet {klient?.har_hemlighet && <span className="text-good">· sparad</span>}
            </label>
            <div className="mt-1 flex gap-2">
              <input
                id="google-hemlighet"
                type="password"
                value={hemlighet}
                onChange={(e) => setHemlighet(e.target.value)}
                placeholder={klient?.har_hemlighet ? 'Sparad — klistra in igen för att byta' : 'GOCSPX-…'}
                autoComplete="off"
                className="flex-1 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
              />
              <button
                onClick={sparaHemlighet}
                disabled={sparar || !hemlighet.trim()}
                className="rounded-xl border border-border px-3 py-2 text-sm text-muted transition-colors hover:text-ink disabled:opacity-50"
              >
                {sparar ? 'Sparar…' : 'Spara'}
              </button>
            </div>
            {sparad && <p className="mt-1 text-xs text-good">✓ Sparad i valvet</p>}
          </div>

          <button
            onClick={anslut}
            disabled={ansluter || !klient?.har_hemlighet}
            className="w-full rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-soft disabled:opacity-50"
          >
            {ansluter ? 'Öppnar Google…' : 'Anslut Google-kalendern'}
          </button>
          {!klient?.har_hemlighet && (
            <p className="text-xs text-muted">Spara hemligheten först, sedan tänds knappen.</p>
          )}
          <p className="text-xs text-muted">
            Google visar en varning om att appen inte är granskad — det är väntat, eftersom den bara
            är till för dig. Välj <em>Avancerat</em> och fortsätt.
          </p>
        </div>
      )}

      {utfall && (
        <p className={`mt-3 rounded-xl border px-3 py-2 text-xs ${
          utfall.ok ? 'border-good/40 bg-good/10 text-good' : 'border-bad/40 bg-bad/10 text-bad'
        }`}>
          {utfall.ok
            ? `✓ Ansluten${utfall.text ? ' — ' + utfall.text : ''}`
            : `Anslutningen gick inte igenom: ${utfall.text || 'okänt fel'}`}
        </p>
      )}
      {fel && (
        <p className="mt-3 rounded-xl border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad">{fel}</p>
      )}
      {klient?.sista_fel && !fel && (
        <p className="mt-3 rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          Senaste försöket: {klient.sista_fel}
        </p>
      )}
    </Card>
  )
}
