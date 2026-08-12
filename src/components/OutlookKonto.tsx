import { useCallback, useEffect, useState } from 'react'
import { supabase, supabaseUrl, supabaseKey } from '../lib/supabase'
import { Card } from './ui'

interface Klient {
  client_id: string | null
  konto: string | null
  ansluten_vid: string | null
  sista_fel: string | null
  har_hemlighet: boolean
}

/** Anslutning av Outlook-lådan.
 *
 *  Microsoft stängde av lösenordsinloggning för privata outlook.com-konton i
 *  september 2024, så IMAP kräver OAuth. Hemligheten skrivs via en RPC rakt
 *  ner i valvet och kan aldrig läsas tillbaka av klienten — därför visas den
 *  aldrig ifylld, bara som "sparad". */
export function OutlookKonto() {
  const [klient, setKlient] = useState<Klient | null>(null)
  const [clientId, setClientId] = useState('')
  const [hemlighet, setHemlighet] = useState('')
  const [sparar, setSparar] = useState(false)
  const [ansluter, setAnsluter] = useState(false)
  const [fel, setFel] = useState<string | null>(null)
  const [sparad, setSparad] = useState(false)

  const ladda = useCallback(async () => {
    const { data } = await supabase
      .from('hub_oauth_klienter')
      .select('client_id, konto, ansluten_vid, sista_fel, hemlighet_id')
      .eq('provider', 'microsoft')
      .maybeSingle()
    setKlient(data ? { ...data, har_hemlighet: !!data.hemlighet_id } : null)
    if (data?.client_id) setClientId((v) => v || data.client_id)
  }, [])

  useEffect(() => { ladda() }, [ladda])

  // Callbacken skickar tillbaka hit med utfallet i adressen
  const [utfall, setUtfall] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const status = q.get('outlook')
    if (!status) return
    setUtfall({ ok: status === 'ok', text: q.get('text') ?? '' })
    window.history.replaceState({}, '', window.location.pathname)
    ladda()
  }, [ladda])

  async function spara() {
    if (!clientId.trim() || !hemlighet.trim()) return
    setSparar(true); setFel(null); setSparad(false)
    const { error } = await supabase.rpc('hub_satt_oauth_hemlighet', {
      p_provider: 'microsoft',
      p_client_id: clientId.trim(),
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
      const res = await fetch(`${supabaseUrl}/functions/v1/ms-oauth-start`, {
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

  async function kopplaBort() {
    await supabase.rpc('hub_koppla_bort_oauth', { p_provider: 'microsoft' })
    await ladda()
  }

  const ansluten = !!klient?.ansluten_vid

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">✉️ Outlook-lådan</h2>
          <p className="mt-0.5 text-sm text-muted">
            {ansluten ? `Ansluten${klient?.konto ? ' — ' + klient.konto : ''}` : 'Inte ansluten än'}
          </p>
        </div>
        {ansluten && (
          <button
            onClick={kopplaBort}
            className="rounded-xl border border-border px-3 py-1.5 text-sm text-muted transition-colors hover:text-ink"
          >
            Koppla bort
          </button>
        )}
      </div>

      {!ansluten && (
        <div className="mt-4 space-y-3">
          <p className="rounded-xl border border-border bg-surface px-3 py-2 text-xs text-muted">
            Microsoft stängde av lösenordsinloggning för privata outlook.com-konton hösten 2024.
            Därför krävs en egen appregistrering i Azure — den gör du en gång.
          </p>

          <div>
            <label className="text-xs text-muted" htmlFor="ms-client">Program-ID (klient)</label>
            <input
              id="ms-client"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
              autoComplete="off"
              className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2 font-mono text-[12px] text-ink outline-none focus:border-accent"
            />
          </div>

          <div>
            <label className="text-xs text-muted" htmlFor="ms-hemlighet">
              Klienthemlighet {klient?.har_hemlighet && <span className="text-good">· sparad</span>}
            </label>
            <p className="mt-0.5 text-[11px] text-muted/70">
              Fältet <em>Värde</em> i Azure, inte Hemligt ID — och det visas bara en gång.
            </p>
            <div className="mt-1 flex gap-2">
              <input
                id="ms-hemlighet"
                type="password"
                value={hemlighet}
                onChange={(e) => setHemlighet(e.target.value)}
                placeholder={klient?.har_hemlighet ? 'Sparad — klistra in igen för att byta' : ''}
                autoComplete="off"
                className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
              />
              <button
                onClick={spara}
                disabled={sparar || !hemlighet.trim() || !clientId.trim()}
                className="shrink-0 rounded-xl border border-border px-3 py-2 text-sm text-muted transition-colors hover:text-ink disabled:opacity-50"
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
            {ansluter ? 'Öppnar Microsoft…' : 'Anslut Outlook'}
          </button>
          {!klient?.har_hemlighet && (
            <p className="text-xs text-muted">Spara uppgifterna först, sedan tänds knappen.</p>
          )}
          <p className="text-xs text-muted">
            Inloggningen går till ditt personliga konto, inte till någon av arbetsgivarkatalogerna.
            Du får godkänna att Hubben läser och skickar post — det är just de behörigheterna vi ber om.
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
