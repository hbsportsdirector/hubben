import { useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { Button, Input, Label } from '../components/ui'

export default function Login() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setInfo(null)
    setBusy(true)
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) setError(translateError(error.message))
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password })
        if (error) setError(translateError(error.message))
        else if (!data.session) setInfo('Konto skapat! Kolla din mejl och bekräfta adressen för att logga in.')
      }
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
          <div className="mb-4">
            <Label>E-post</Label>
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="du@exempel.se" autoComplete="email" />
          </div>
          <div className="mb-5">
            <Label>Lösenord</Label>
            <Input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            />
          </div>
          {error && <p className="mb-4 rounded-xl border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
          {info && <p className="mb-4 rounded-xl border border-good/40 bg-good/10 px-3 py-2 text-sm text-good">{info}</p>}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? 'Vänta…' : mode === 'signin' ? 'Logga in' : 'Skapa konto'}
          </Button>
          <button
            type="button"
            onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); setInfo(null) }}
            className="mt-4 w-full text-center text-xs text-muted hover:text-ink"
          >
            {mode === 'signin' ? 'Inget konto? Skapa ett →' : '← Har du redan ett konto? Logga in'}
          </button>
        </form>
      </div>
    </div>
  )
}

function translateError(msg: string): string {
  if (msg.includes('Invalid login credentials')) return 'Fel e-post eller lösenord.'
  if (msg.includes('Email not confirmed')) return 'E-postadressen är inte bekräftad än — kolla din inkorg.'
  if (msg.includes('User already registered')) return 'Det finns redan ett konto med den här e-postadressen.'
  if (msg.includes('Password should be')) return 'Lösenordet måste vara minst 6 tecken.'
  return msg
}
