import { useCallback, useEffect, useState } from 'react'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { sv } from 'date-fns/locale'
import { supabase, supabaseUrl, supabaseKey } from '../lib/supabase'
import { Card, SectionTitle, Button, Spinner } from '../components/ui'
import { DriveSok } from '../components/Drive'

interface Synk {
  senast_synkad: string | null
  sista_fel: string | null
  page_token: string | null
}

export default function Drive() {
  const [synk, setSynk] = useState<Synk | null>(null)
  const [antal, setAntal] = useState(0)
  const [laddar, setLaddar] = useState(true)
  const [synkar, setSynkar] = useState(false)
  const [besked, setBesked] = useState<string | null>(null)

  const ladda = useCallback(async () => {
    const [s, a] = await Promise.all([
      supabase.from('hub_drive_synk').select('senast_synkad, sista_fel, page_token').maybeSingle(),
      supabase.from('hub_drive_filer').select('*', { count: 'exact', head: true }),
    ])
    setSynk((s.data as Synk) ?? null)
    setAntal(a.count ?? 0)
    setLaddar(false)
  }, [])

  useEffect(() => { ladda() }, [ladda])

  async function synka(full = false) {
    setSynkar(true)
    setBesked(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Inte inloggad')
      const r = await fetch(`${supabaseUrl}/functions/v1/drive-sync`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: supabaseKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ full }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.fel ?? `Servern svarade ${r.status}`)
      setBesked(j.full
        ? `Hämtade hem ${j.filer} filer.`
        : `${j.andrade ?? 0} ändrade, ${j.borttagna ?? 0} borttagna.`)
      await ladda()
    } catch (e) {
      setBesked(e instanceof Error ? e.message : String(e))
    } finally {
      setSynkar(false)
    }
  }

  if (laddar) return <Spinner />

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Drive</h1>
        <p className="mt-1 text-sm text-muted">
          Filregistret ligger i Hubben, så sökningen svarar direkt och du slipper
          Drives mappträd. Innehållet stannar hos Google — det hämtas först när du
          öppnar eller bifogar något.
        </p>
      </div>

      <Card>
        <DriveSok />
      </Card>

      <Card>
        <SectionTitle>Registret</SectionTitle>
        <p className="text-sm text-muted">
          {antal.toLocaleString('sv-SE')} filer.
          {synk?.senast_synkad
            ? ` Senast hämtat ${formatDistanceToNow(parseISO(synk.senast_synkad), { locale: sv, addSuffix: true })}.`
            : ' Aldrig hämtat.'}
        </p>
        {synk?.sista_fel && (
          <p className="mt-2 rounded-xl border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad">
            Senaste felet: {synk.sista_fel}
          </p>
        )}
        {besked && (
          <p className="mt-2 rounded-xl border border-border bg-surface px-3 py-2 text-xs text-muted">{besked}</p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={() => synka(false)} disabled={synkar}>
            {synkar ? 'Hämtar…' : 'Hämta ändringar'}
          </Button>
          <Button variant="ghost" onClick={() => synka(true)} disabled={synkar}>
            Hämta om allt
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted">
          Efter första hämtningen frågar Hubben bara efter det som ändrats, så det
          går på ett ögonblick. "Hämta om allt" behövs bara om något ser fel ut.
        </p>
      </Card>
    </div>
  )
}
