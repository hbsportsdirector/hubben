import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { format, parseISO, isSameDay } from 'date-fns'
import { sv } from 'date-fns/locale'
import { supabase } from '../lib/supabase'
import { Spinner } from '../components/ui'

/** Den publika bokningssidan.
 *
 *  Hubbens enda yta utan inloggning. Den läser INGENTING direkt ur databasen —
 *  radsäkerheten låser allt till Per — utan går via två funktioner som lämnar
 *  ut exakt mötets namn och de lediga tiderna. Länkens token är enda nyckeln.
 *
 *  Tiderna räknas fram på servern och verifieras på servern igen vid bokning.
 *  Den här sidan kan alltså inte föreslå en tid som inte är ledig, hur man än
 *  petar i den.
 */
interface Sida {
  finns: boolean
  namn?: string
  langd_min?: number
  plats?: string | null
  beskrivning?: string | null
  tider?: string[]
}

export default function Boka() {
  const { token = '' } = useParams()
  const [sida, setSida] = useState<Sida | null>(null)
  const [vald, setVald] = useState<string | null>(null)
  const [namn, setNamn] = useState('')
  const [epost, setEpost] = useState('')
  const [meddelande, setMeddelande] = useState('')
  const [skickar, setSkickar] = useState(false)
  const [fel, setFel] = useState<string | null>(null)
  const [klart, setKlart] = useState<{ start: string } | null>(null)

  const ladda = useCallback(async () => {
    const { data, error } = await supabase.rpc('hub_bokningssida', { p_token: token })
    if (error) { setFel(error.message); setSida({ finns: false }); return }
    setSida(data as Sida)
  }, [token])

  useEffect(() => { ladda() }, [ladda])

  async function boka() {
    if (!vald || skickar) return
    setSkickar(true); setFel(null)
    try {
      const { data, error } = await supabase.rpc('hub_boka', {
        p_token: token, p_start: vald,
        p_namn: namn.trim(), p_epost: epost.trim(),
        p_meddelande: meddelande.trim() || null,
      })
      if (error) throw new Error(error.message)
      const svar = data as { ok: boolean; fel?: string; start?: string }
      if (!svar.ok) {
        setFel(svar.fel ?? 'Det gick inte att boka.')
        // Tiden kan ha tagits av någon annan medan formuläret var öppet
        await ladda()
        setVald(null)
        return
      }
      setKlart({ start: svar.start! })
    } catch (e) {
      setFel(e instanceof Error ? e.message : String(e))
    } finally {
      setSkickar(false)
    }
  }

  if (!sida) return <div className="flex min-h-screen items-center justify-center"><Spinner /></div>

  if (!sida.finns) {
    return (
      <Ram>
        <h1 className="text-xl font-semibold">Länken fungerar inte</h1>
        <p className="mt-2 text-sm text-muted">
          Den kan ha stängts eller så är adressen fel. Hör av dig till den som skickade den.
        </p>
      </Ram>
    )
  }

  if (klart) {
    const d = parseISO(klart.start)
    return (
      <Ram>
        <div className="text-3xl">✓</div>
        <h1 className="mt-3 text-xl font-semibold">Tiden är bokad</h1>
        <p className="mt-2 text-[15px] text-ink">
          {format(d, 'EEEE d MMMM', { locale: sv })} kl. {format(d, 'HH:mm')}
        </p>
        {sida.plats && <p className="mt-1 text-sm text-muted">{sida.plats}</p>}
        <p className="mt-4 text-sm text-muted">
          Tiden ligger nu i kalendern. Behöver du ändra dig, hör av dig direkt.
        </p>
      </Ram>
    )
  }

  const tider = sida.tider ?? []
  // Grupperade per dag — en lång rad med sextio klockslag går inte att läsa
  const dagar: { dag: Date; tider: string[] }[] = []
  for (const t of tider) {
    const d = parseISO(t)
    const sista = dagar[dagar.length - 1]
    if (sista && isSameDay(sista.dag, d)) sista.tider.push(t)
    else dagar.push({ dag: d, tider: [t] })
  }

  return (
    <Ram>
      <h1 className="text-xl font-semibold">{sida.namn}</h1>
      <p className="mt-1 text-sm text-muted">
        {sida.langd_min} minuter{sida.plats ? ` · ${sida.plats}` : ''}
      </p>
      {sida.beskrivning && <p className="mt-3 text-sm text-ink/80">{sida.beskrivning}</p>}

      {tider.length === 0 ? (
        <p className="mt-6 rounded-xl border border-border bg-surface px-4 py-3 text-sm text-muted">
          Inga lediga tider just nu. Prova igen om några dagar.
        </p>
      ) : (
        <div className="mt-6 space-y-4">
          {dagar.map(({ dag, tider: dagensTider }) => (
            <div key={dag.toISOString()}>
              <p className="mb-2 text-[13px] font-medium capitalize text-muted">
                {format(dag, 'EEEE d MMMM', { locale: sv })}
              </p>
              <div className="flex flex-wrap gap-2">
                {dagensTider.map((t) => (
                  <button
                    key={t}
                    onClick={() => { setVald(t); setFel(null) }}
                    className={`min-h-11 rounded-xl border px-4 text-sm tabular-nums transition-colors ${
                      vald === t
                        ? 'border-accent bg-accent text-white'
                        : 'border-border bg-surface text-ink hover:border-accent'
                    }`}
                  >
                    {format(parseISO(t), 'HH:mm')}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {vald && (
        <div className="mt-6 space-y-3 rounded-2xl border border-border bg-surface p-4">
          <p className="text-sm text-ink">
            <span className="text-muted">Vald tid: </span>
            <span className="font-medium capitalize">
              {format(parseISO(vald), 'EEEE d MMMM', { locale: sv })} kl. {format(parseISO(vald), 'HH:mm')}
            </span>
          </p>
          <input
            value={namn} onChange={(e) => setNamn(e.target.value)}
            placeholder="Ditt namn" autoComplete="name"
            className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-ink outline-none focus:border-accent"
          />
          <input
            value={epost} onChange={(e) => setEpost(e.target.value)}
            type="email" placeholder="Din mejladress" autoComplete="email"
            className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-ink outline-none focus:border-accent"
          />
          <textarea
            value={meddelande} onChange={(e) => setMeddelande(e.target.value)}
            placeholder="Vad gäller det? (valfritt)"
            className="min-h-20 w-full rounded-xl border border-border bg-card px-3 py-2.5 text-ink outline-none focus:border-accent"
          />
          {fel && <p className="rounded-xl border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{fel}</p>}
          <button
            onClick={boka}
            disabled={skickar || !namn.trim() || !epost.trim()}
            className="min-h-11 w-full rounded-xl bg-accent px-4 text-sm font-medium text-white disabled:opacity-50"
          >
            {skickar ? 'Bokar…' : 'Boka tiden'}
          </button>
        </div>
      )}

      {fel && !vald && (
        <p className="mt-4 rounded-xl border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{fel}</p>
      )}
    </Ram>
  )
}

/** Egen ram: den publika sidan ska inte ärva Hubbens navigering, och den som
 *  bokar ska inte se att det finns en app bakom. */
function Ram({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-start justify-center px-4 py-10 sm:py-16">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl">
        {children}
      </div>
    </div>
  )
}
