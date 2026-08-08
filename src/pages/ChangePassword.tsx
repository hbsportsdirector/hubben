import { useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { Button, Input, Label } from '../components/ui'

export default function ChangePassword() {
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password !== password2) {
      setError('Lösenorden matchar inte.')
      return
    }
    setBusy(true)
    try {
      const { error } = await supabase.auth.updateUser({
        password,
        data: { must_change_password: false },
      })
      if (error) {
        if (error.message.includes('should be different')) {
          setError('Det nya lösenordet måste skilja sig från det tillfälliga.')
        } else if (error.message.includes('Password should be')) {
          setError('Lösenordet måste vara minst 6 tecken.')
        } else {
          setError(error.message)
        }
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mb-3 text-5xl">🔐</div>
          <h1 className="text-2xl font-bold tracking-tight">Välj ditt eget lösenord</h1>
          <p className="mt-2 text-sm text-muted">Du loggade in med det tillfälliga lösenordet — dags att byta till ett eget.</p>
        </div>
        <form onSubmit={handleSubmit} className="rounded-2xl border border-border bg-card p-6 shadow-2xl">
          <div className="mb-4">
            <Label>Nytt lösenord</Label>
            <Input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Minst 6 tecken"
              autoComplete="new-password"
              autoFocus
            />
          </div>
          <div className="mb-5">
            <Label>Upprepa lösenordet</Label>
            <Input
              type="password"
              required
              minLength={6}
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
            />
          </div>
          {error && <p className="mb-4 rounded-xl border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? 'Sparar…' : 'Spara och fortsätt'}
          </Button>
        </form>
      </div>
    </div>
  )
}
