import { useState } from 'react'
import type { FormEvent } from 'react'
import { supabase, HUB_EMAIL } from '../lib/supabase'
import { Button, Input, Label } from '../components/ui'

const MINNS_EPOST = 'hubben.assistentadress'

export default function Login() {
  const [password, setPassword] = useState('')
  // Hubben har en ägare, och han slipper skriva sin adress varje gång. En
  // assistent har en egen inloggning och behöver fältet — därav luckan.
  const [egenAdress, setEgenAdress] = useState(() => !!localStorage.getItem(MINNS_EPOST))
  const [epost, setEpost] = useState(() => localStorage.getItem(MINNS_EPOST) ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const adress = egenAdress ? epost.trim().toLowerCase() : HUB_EMAIL
      const { error } = await supabase.auth.signInWithPassword({ email: adress, password })
      if (error) {
        setError(translateError(error.message))
        return
      }
      // Nästa gång slipper hon leta rätt på luckan igen
      if (egenAdress) localStorage.setItem(MINNS_EPOST, adress)
      else localStorage.removeItem(MINNS_EPOST)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mb-3 text-5xl">🪐</div>
          <h1 className="text-3xl font-bold tracking-tight">Hubben</h1>
          <p className="mt-2 text-sm text-muted">Din digitala hub för livet</p>
        </div>
        <form onSubmit={handleSubmit} className="rounded-2xl border border-border bg-card p-6 shadow-2xl">
          {egenAdress && (
            <div className="mb-4">
              <Label>Mejladress</Label>
              <Input
                type="email"
                required
                value={epost}
                onChange={(e) => setEpost(e.target.value)}
                placeholder="namn@exempel.se"
                autoComplete="username"
                autoFocus
              />
            </div>
          )}
          <div className="mb-5">
            <Label>Lösenord</Label>
            <Input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              autoFocus={!egenAdress}
            />
          </div>
          {error && <p className="mb-4 rounded-xl border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? 'Vänta…' : 'Logga in'}
          </Button>
          <button
            type="button"
            onClick={() => { setEgenAdress((v) => !v); setError(null) }}
            className="mt-4 w-full text-center text-xs text-muted transition-colors hover:text-ink"
          >
            {egenAdress ? 'Det är min hub' : 'Jag är assistent'}
          </button>
        </form>
      </div>
    </div>
  )
}

function translateError(msg: string): string {
  if (msg.includes('Invalid login credentials')) return 'Fel adress eller lösenord.'
  if (msg.includes('Email not confirmed')) return 'Kontot är inte bekräftat än.'
  return msg
}
