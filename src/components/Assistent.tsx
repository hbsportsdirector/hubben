import { useCallback, useEffect, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { sv } from 'date-fns/locale'
import { supabase, supabaseUrl, supabaseKey } from '../lib/supabase'
import { Button, Input, Label } from './ui'

interface Rad { id: string; namn: string | null; epost: string | null; skapad: string }

/** Bjuder in någon att arbeta i hubben.
 *
 *  Lösenordet skrivs här av dig och går raka vägen till Supabase Auth. Det
 *  passerar aldrig något vi sparar, och det finns ingen väg att läsa tillbaka
 *  det efteråt — glöms det bort får du sätta ett nytt. */
export default function Assistent() {
  const [lista, setLista] = useState<Rad[]>([])
  const [laddar, setLaddar] = useState(true)
  const [visaForm, setVisaForm] = useState(false)
  const [namn, setNamn] = useState('')
  const [epost, setEpost] = useState('')
  const [losenord, setLosenord] = useState('')
  const [arbetar, setArbetar] = useState(false)
  const [fel, setFel] = useState<string | null>(null)
  const [kvitto, setKvitto] = useState<string | null>(null)

  const anropa = useCallback(async (kropp: Record<string, unknown>) => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Inte inloggad')
    const r = await fetch(`${supabaseUrl}/functions/v1/assistent`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: supabaseKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(kropp),
    })
    const text = await r.text()
    let svar: Record<string, unknown> = {}
    try { svar = JSON.parse(text) } catch { throw new Error(text.slice(0, 200) || 'Oväntat svar') }
    if (svar.fel) throw new Error(String(svar.fel))
    return svar
  }, [])

  const ladda = useCallback(async () => {
    try {
      const svar = await anropa({ handling: 'lista' })
      setLista((svar.assistenter as Rad[]) ?? [])
    } catch {
      setLista([])
    } finally {
      setLaddar(false)
    }
  }, [anropa])

  useEffect(() => { ladda() }, [ladda])

  async function bjudIn() {
    setArbetar(true); setFel(null); setKvitto(null)
    try {
      const svar = await anropa({ handling: 'bjud_in', namn, epost, losenord })
      setKvitto(svar.fannsSedanTidigare
        ? `${epost} hade redan ett konto och är nu inkopplad — hon loggar in med sitt gamla lösenord.`
        : `${epost} är inbjuden. Ge henne lösenordet du just skrev.`)
      setNamn(''); setEpost(''); setLosenord(''); setVisaForm(false)
      ladda()
    } catch (e) {
      setFel(e instanceof Error ? e.message : String(e))
    } finally {
      setArbetar(false)
    }
  }

  async function kopplaBort(rad: Rad) {
    if (!confirm(`Koppla bort ${rad.epost ?? rad.namn ?? 'assistenten'}? Hon kommer inte åt något i Hubben efteråt.`)) return
    setFel(null); setKvitto(null)
    try {
      await anropa({ handling: 'koppla_bort', delegat_id: rad.id })
      setKvitto('Bortkopplad. Kontot finns kvar men når ingenting.')
      ladda()
    } catch (e) {
      setFel(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Assistent</h3>
          <p className="text-xs text-muted">
            Får läsa och skriva i dina mejl, din kalender och dina uppgifter. Ser inte ekonomi,
            vanor, träning eller anteckningar.
          </p>
        </div>
        {!visaForm && (
          <Button onClick={() => { setVisaForm(true); setFel(null); setKvitto(null) }}>
            Bjud in
          </Button>
        )}
      </div>

      {kvitto && (
        <p className="mb-3 rounded-xl border border-good/40 bg-good/10 px-3 py-2 text-sm text-good">{kvitto}</p>
      )}
      {fel && (
        <p className="mb-3 rounded-xl border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{fel}</p>
      )}

      {visaForm && (
        <div className="mb-4 rounded-xl border border-border bg-surface p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Namn</Label>
              <Input value={namn} onChange={(e) => setNamn(e.target.value)} placeholder="Förnamn" />
            </div>
            <div>
              <Label>Mejladress</Label>
              <Input
                type="email"
                value={epost}
                onChange={(e) => setEpost(e.target.value)}
                placeholder="namn@exempel.se"
                autoComplete="off"
              />
            </div>
          </div>
          <div className="mt-3">
            <Label>Lösenord du ger henne</Label>
            <Input
              type="text"
              value={losenord}
              onChange={(e) => setLosenord(e.target.value)}
              placeholder="Minst 12 tecken"
              autoComplete="off"
            />
            <p className="mt-1 text-[11px] text-muted">
              Syns i klartext med flit — du ska kunna läsa upp det för henne. Det sparas ingenstans
              hos oss, så skriv ner det innan du lämnar sidan.
            </p>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <Button onClick={bjudIn} disabled={arbetar || !epost.trim() || losenord.length < 12}>
              {arbetar ? 'Bjuder in…' : 'Bjud in'}
            </Button>
            <button
              onClick={() => { setVisaForm(false); setFel(null) }}
              className="text-xs text-muted hover:text-ink"
            >
              Avbryt
            </button>
          </div>
        </div>
      )}

      {laddar ? (
        <p className="text-xs text-muted">Hämtar…</p>
      ) : lista.length === 0 ? (
        <p className="text-xs text-muted">Ingen assistent inbjuden.</p>
      ) : (
        <div className="space-y-2">
          {lista.map((rad) => (
            <div
              key={rad.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{rad.namn || rad.epost}</p>
                <p className="truncate text-xs text-muted">
                  {rad.namn ? `${rad.epost} · ` : ''}
                  inbjuden {format(parseISO(rad.skapad), 'd MMM yyyy', { locale: sv })}
                </p>
              </div>
              <button
                onClick={() => kopplaBort(rad)}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-bad/50 hover:text-bad"
              >
                Koppla bort
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
