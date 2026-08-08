import { useEffect, useState, useCallback } from 'react'
import { format, parseISO } from 'date-fns'
import { sv } from 'date-fns/locale'
import { supabase } from '../lib/supabase'
import type { HubMailAccount } from '../lib/types'
import { Card, SectionTitle, Button, Input, Label, Spinner } from '../components/ui'

export default function Settings() {
  const [accounts, setAccounts] = useState<HubMailAccount[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const { data } = await supabase.from('hub_mail_accounts').select('*').order('sort_order')
    setAccounts(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <Spinner />

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Inställningar</h1>
        <p className="mt-1 text-sm text-muted">Dina mejlkonton är redan uppsatta — det enda som saknas är lösenorden.</p>
      </div>

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

      <div className="space-y-4">
        <SectionTitle>Mejlkonton</SectionTitle>
        {accounts.map((acc) => (
          <AccountCard key={acc.id} account={acc} onSaved={load} />
        ))}
      </div>
    </div>
  )
}

function AccountCard({ account, onSaved }: { account: HubMailAccount; onSaved: () => void }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'fel'; text: string } | null>(null)

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
        <p className="mb-3 text-xs text-muted">
          Inkommande {account.imap_host}:{account.imap_port} · Utgående {account.smtp_host}:{account.smtp_port}
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
