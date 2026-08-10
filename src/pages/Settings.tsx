import { useEffect, useState, useCallback } from 'react'
import { format, parseISO } from 'date-fns'
import { sv } from 'date-fns/locale'
import { supabase, supabaseUrl, supabaseKey } from '../lib/supabase'
import type { HubMailAccount } from '../lib/types'
import { Card, SectionTitle, Button, Input, Label, Spinner, Textarea } from '../components/ui'
import { GoogleKalender } from '../components/GoogleKalender'
import Assistent from '../components/Assistent'

interface Testsvar {
  // Från imap-test
  label?: string
  epost?: string
  inloggad?: boolean
  serversvar?: string
  notering?: string
  antalIInkorgen?: number | null
  antalMappar?: number
  totaltMs?: number
  harCONDSTORE?: boolean
  harQRESYNC?: boolean
  harIDLE?: boolean
  // Från mail-sync
  konto?: string
  nya?: number
  iInkorgen?: number
  msTotalt?: number
  skrivfel?: string
  uidvalidityBytt?: boolean
  // Från mail-folders
  antal?: number
  mappar?: string[]
  // Gemensamt
  fel?: string
}

interface Kontostatus {
  mejl: number
  mappar: number
  senastSynkad: string | null
}

export default function Settings() {
  const [accounts, setAccounts] = useState<HubMailAccount[]>([])
  const [status, setStatus] = useState<Record<string, Kontostatus>>({})
  const [loading, setLoading] = useState(true)
  const [testar, setTestar] = useState(false)
  const [test, setTest] = useState<Testsvar[] | null>(null)
  const [testFel, setTestFel] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data } = await supabase.from('hub_mail_accounts').select('*').order('sort_order')
    setAccounts(data ?? [])

    // Status hämtas från databasen så den överlever sidbyten
    const nytt: Record<string, Kontostatus> = {}
    for (const acc of data ?? []) {
      const [{ count: mejl }, { data: mappar }] = await Promise.all([
        supabase.from('hub_messages').select('*', { count: 'exact', head: true }).eq('account_id', acc.id),
        supabase.from('hub_folders').select('last_synced_at').eq('account_id', acc.id),
      ])
      const senast = (mappar ?? [])
        .map((f: { last_synced_at: string | null }) => f.last_synced_at)
        .filter(Boolean)
        .sort()
        .pop() ?? null
      nytt[acc.id] = { mejl: mejl ?? 0, mappar: (mappar ?? []).length, senastSynkad: senast }
    }
    setStatus(nytt)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function anropa(funktion: string, satt: (r: Testsvar[]) => void) {
    setTestar(true)
    setTest(null)
    setTestFel(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { setTestFel('Ingen aktiv session'); return }
      const res = await fetch(`${supabaseUrl}/functions/v1/${funktion}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, apikey: supabaseKey },
      })
      const json = await res.json()
      if (!res.ok || json.fel) setTestFel(json.fel ?? `Fel ${res.status}`)
      else satt(json.resultat as Testsvar[])
      load()
    } catch (e) {
      setTestFel(String(e))
    } finally {
      setTestar(false)
    }
  }

  if (loading) return <Spinner />

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Inställningar</h1>
        <p className="mt-1 text-sm text-muted">Dina mejlkonton är redan uppsatta — det enda som saknas är lösenorden.</p>
      </div>

      <GoogleKalender />

      <Card>
        <Assistent />
      </Card>

      <Card className="border-accent/30 bg-accent/5">
        <div className="flex gap-3">
          <span className="text-lg" aria-hidden>🔐</span>
          <div className="text-sm">
            <p className="font-medium">Så förvaras lösenorden</p>
            <p className="mt-1 text-muted">
              De krypteras direkt i Supabase Vault och hamnar aldrig i en tabell som webbläsaren kan läsa —
              varken du, jag eller den publika API-nyckeln kan hämta tillbaka dem. De används bara av
              servern när mejlen ska hämtas.
            </p>
          </div>
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Testa anslutningen</p>
            <p className="mt-0.5 text-xs text-muted">
              Servern loggar in på riktigt mot varje konto och rapporterar vad den hittar.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => anropa('imap-test', setTest)} disabled={testar}>
              {testar ? 'Kör…' : '🔌 Testa'}
            </Button>
            <Button variant="ghost" onClick={() => anropa('mail-folders', setTest)} disabled={testar}>
              {testar ? 'Kör…' : '📁 Läs mappar'}
            </Button>
            <Button onClick={() => anropa('mail-sync', setTest)} disabled={testar}>
              {testar ? 'Kör…' : '📥 Hämta mejl'}
            </Button>
          </div>
        </div>

        {testFel && (
          <p className="mt-3 rounded-xl border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{testFel}</p>
        )}

        {test && (
          <ul className="mt-4 space-y-3">
            {test.map((r, i) => {
              const namn = r.label ?? r.konto ?? 'Konto'
              const problem = r.fel ?? r.skrivfel ?? r.serversvar
              const lyckat = !problem && (r.inloggad === true || r.nya !== undefined || r.antal !== undefined)
              return (
                <li
                  key={`${namn}-${i}`}
                  className={`rounded-xl border px-3 py-2.5 text-sm ${
                    lyckat ? 'border-good/40 bg-good/10' : 'border-bad/40 bg-bad/10'
                  }`}
                >
                  <p className="font-medium">
                    {lyckat ? '✓' : '✗'} {namn}
                    {r.epost && <span className="ml-2 text-xs font-normal text-muted">{r.epost}</span>}
                  </p>

                  {problem && <p className="mt-1 text-xs text-bad">{problem}</p>}

                  {r.nya !== undefined && !problem && (
                    <p className="mt-1 text-xs text-muted">
                      <strong className="text-ink">{r.nya}</strong> mejl hämtade
                      {r.iInkorgen !== undefined && ` · ${r.iInkorgen} i inkorgen`}
                      {r.msTotalt && ` · ${(r.msTotalt / 1000).toFixed(1)} s`}
                      {r.uidvalidityBytt && ' · brevlådan hade nollställts, hämtade om'}
                    </p>
                  )}

                  {r.antal !== undefined && !problem && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs text-muted">
                        <strong className="text-ink">{r.antal}</strong> mappar inlästa — visa
                      </summary>
                      <ul className="mt-2 max-h-48 space-y-0.5 overflow-y-auto text-[11px] text-muted">
                        {(r.mappar ?? []).map((m) => <li key={m} className="truncate">{m}</li>)}
                      </ul>
                    </details>
                  )}

                  {r.inloggad && (
                    <>
                      <p className="mt-1 text-xs text-muted">
                        {r.antalIInkorgen ?? '?'} mejl i inkorgen · {r.antalMappar ?? '?'} mappar · {r.totaltMs} ms
                      </p>
                      <p className="mt-1 flex flex-wrap gap-1.5 text-[10px]">
                        {([['CONDSTORE', r.harCONDSTORE], ['QRESYNC', r.harQRESYNC], ['IDLE', r.harIDLE]] as const).map(
                          ([n, finns]) => (
                            <span
                              key={n}
                              className={`rounded-full px-2 py-0.5 font-medium ${finns ? 'bg-good/20 text-good' : 'bg-surface text-muted'}`}
                            >
                              {finns ? '✓' : '–'} {n}
                            </span>
                          ),
                        )}
                      </p>
                    </>
                  )}

                  {r.notering && <p className="mt-1 text-xs text-warn">⚠ {r.notering}</p>}
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <div className="space-y-4">
        <SectionTitle>Mejlkonton</SectionTitle>
        {accounts.map((acc) => (
          <AccountCard key={acc.id} account={acc} status={status[acc.id]} onSaved={load} />
        ))}
      </div>
    </div>
  )
}

function AccountCard({ account, status, onSaved }: { account: HubMailAccount; status?: Kontostatus; onSaved: () => void }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'fel'; text: string } | null>(null)
  const [signatur, setSignatur] = useState(account.signature ?? '')
  const [signSparad, setSignSparad] = useState(true)

  const isOutlook = account.provider === 'outlook'
  const hasSecret = Boolean(account.secret_id)

  async function save() {
    if (!password.trim()) return
    setBusy(true)
    setMsg(null)
    try {
      const { error } = await supabase.rpc('hub_set_mail_secret', {
        p_account_id: account.id,
        p_password: password,
      })
      if (error) {
        setMsg({ kind: 'fel', text: error.message })
      } else {
        setPassword('')
        setMsg({ kind: 'ok', text: 'Lösenordet är sparat och krypterat.' })
        onSaved()
      }
    } finally {
      setBusy(false)
    }
  }

  async function clear() {
    setBusy(true)
    setMsg(null)
    try {
      const { error } = await supabase.rpc('hub_clear_mail_secret', { p_account_id: account.id })
      if (error) setMsg({ kind: 'fel', text: error.message })
      else {
        setMsg({ kind: 'ok', text: 'Lösenordet är borttaget.' })
        onSaved()
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="h-9 w-1.5 shrink-0 rounded-full" style={{ background: account.color }} />
          <div>
            <p className="font-semibold">{account.label}</p>
            <p className="text-xs text-muted">{account.email}</p>
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${
            isOutlook ? 'bg-warn/15 text-warn' : hasSecret ? 'bg-good/15 text-good' : 'bg-surface text-muted'
          }`}
        >
          {isOutlook ? 'Kräver Microsoft-inloggning' : hasSecret ? '✓ Lösenord sparat' : 'Lösenord saknas'}
        </span>
      </div>

      {account.imap_host && (
        <p className="mb-2 text-xs text-muted">
          Inkommande {account.imap_host}:{account.imap_port} · Utgående {account.smtp_host}:{account.smtp_port}
        </p>
      )}

      {status && (status.mejl > 0 || status.mappar > 0) && (
        <p className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-surface px-3 py-2 text-xs">
          <span><strong className="text-ink">{status.mejl}</strong> <span className="text-muted">mejl hämtade</span></span>
          <span><strong className="text-ink">{status.mappar}</strong> <span className="text-muted">mappar</span></span>
          {status.senastSynkad && (
            <span className="text-muted">
              senast {format(parseISO(status.senastSynkad), 'd MMM HH:mm', { locale: sv })}
            </span>
          )}
        </p>
      )}

      {isOutlook ? (
        <p className="rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-muted">
          Microsoft stängde av lösenordsinloggning för personliga Outlook-konton i september 2024.
          Det här kontot kopplas in med en inloggningsknapp i stället — den bygger jag härnäst.
        </p>
      ) : (
        <>
          <Label>{hasSecret ? 'Byt lösenord' : 'Lösenord'}</Label>
          <div className="flex gap-2">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
              placeholder={account.email.endsWith('@gmail.com') ? 'App-lösenord från Google' : '••••••••'}
              autoComplete="new-password"
            />
            <Button onClick={save} disabled={busy || !password.trim()}>
              {busy ? 'Sparar…' : 'Spara'}
            </Button>
            {hasSecret && (
              <Button variant="danger" onClick={clear} disabled={busy}>Ta bort</Button>
            )}
          </div>
          {account.email.endsWith('@gmail.com') && (
            <p className="mt-2 text-xs text-muted">
              Gmail kräver ett <strong>app-lösenord</strong>, inte ditt vanliga. Skapa ett under Google-kontots
              säkerhetsinställningar (tvåstegsverifiering måste vara på).
            </p>
          )}
        </>
      )}

      {/* Signatur — läggs på automatiskt när du skickar från det här kontot */}
      <div className="mt-4 border-t border-border pt-4">
        <Label>Signatur</Label>
        <Textarea
          value={signatur}
          onChange={(e) => { setSignatur(e.target.value); setSignSparad(false) }}
          placeholder={`Per Lundgren\nSportchef, ${account.label}\n${account.email}`}
          className="min-h-20 font-mono text-xs"
        />
        <div className="mt-2 flex items-center gap-2">
          <Button
            variant="ghost"
            className="!px-3 !py-1.5 text-xs"
            disabled={signSparad}
            onClick={async () => {
              await supabase.from('hub_mail_accounts').update({ signature: signatur }).eq('id', account.id)
              setSignSparad(true)
              onSaved()
            }}
          >
            {signSparad ? '✓ Sparad' : 'Spara signatur'}
          </Button>
          <span className="text-[11px] text-muted">Läggs till efter en avdelare när du skickar härifrån.</span>
        </div>
      </div>

      {msg && (
        <p className={`mt-3 rounded-xl border px-3 py-2 text-sm ${
          msg.kind === 'ok' ? 'border-good/40 bg-good/10 text-good' : 'border-bad/40 bg-bad/10 text-bad'
        }`}>
          {msg.text}
        </p>
      )}

      {account.last_error && (
        <p className="mt-3 rounded-xl border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
          Senaste felet: {account.last_error}
        </p>
      )}

      {account.last_checked_at && (
        <p className="mt-2 text-xs text-muted">
          Senast kontrollerad {format(parseISO(account.last_checked_at), 'd MMM HH:mm', { locale: sv })}
        </p>
      )}
    </Card>
  )
}
