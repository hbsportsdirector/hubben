import { useCallback, useEffect, useState } from 'react'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { sv } from 'date-fns/locale'
import { supabase } from '../lib/supabase'
import { getUserId } from '../lib/data'
import { Card, Spinner } from '../components/ui'

interface Rad {
  doman: string
  adresser: string[]
  visningsnamn: string | null
  antal: number
  senaste: string | null
  exempel: string | null
}
interface Adress {
  epost: string
  visningsnamn: string | null
  antal: number
  senaste: string | null
  exempel: string | null
}
interface Konto { id: string; label: string; gallring_mapp_id: string | null }
interface Mapp { id: string; account_id: string; path: string; name: string }

/** Städa avsändare.
 *
 *  Poängen är att göra tvåhundra beslut till tjugo: raderna är grupperade per
 *  domän, störst först, så github.com blir ett tryck och inte åttionio. Den
 *  som vill dela upp en domän kan fälla ut adresserna. */
export default function Gallring() {
  const [rader, setRader] = useState<Rad[]>([])
  const [konton, setKonton] = useState<Konto[]>([])
  const [mappar, setMappar] = useState<Mapp[]>([])
  const [utfalld, setUtfalld] = useState<string | null>(null)
  const [adresser, setAdresser] = useState<Adress[]>([])
  const [laddar, setLaddar] = useState(true)
  const [arbetar, setArbetar] = useState<string | null>(null)
  const [klara, setKlara] = useState(0)
  const [fel, setFel] = useState<string | null>(null)

  const ladda = useCallback(async () => {
    const [lista, k, m] = await Promise.all([
      supabase.rpc('hub_gallring_lista'),
      supabase.from('hub_mail_accounts').select('id, label, gallring_mapp_id').order('sort_order'),
      supabase.from('hub_folders').select('id, account_id, path, name').eq('hidden', false).order('path'),
    ])
    setRader((lista.data as Rad[]) ?? [])
    setKonton((k.data as Konto[]) ?? [])
    setMappar((m.data as Mapp[]) ?? [])
    setLaddar(false)
  }, [])

  useEffect(() => { ladda() }, [ladda])

  async function fallUt(doman: string) {
    if (utfalld === doman) { setUtfalld(null); return }
    setUtfalld(doman)
    setAdresser([])
    const { data } = await supabase.rpc('hub_gallring_adresser', { p_doman: doman })
    setAdresser((data as Adress[]) ?? [])
  }

  /** Ett beslut. `nyckel` är antingen en domän eller en enskild adress. */
  async function bestam(nyckel: { doman?: string; epost?: string }, beslut: 'in' | 'ut') {
    const etikett = nyckel.doman ?? nyckel.epost ?? ''
    setArbetar(etikett); setFel(null)
    try {
      const userId = await getUserId()
      const { error } = await supabase.from('hub_avsandare').insert({
        user_id: userId,
        doman: nyckel.doman ?? null,
        epost: nyckel.epost ?? null,
        beslut,
      })
      if (error) throw new Error(error.message)

      // Ett nej flyttar det som redan ligger i inkorgen. Ingenting raderas —
      // och har man inte valt någon mapp stannar mejlen där de är, de slutar
      // bara synas i inkorgen.
      if (beslut === 'ut') await flyttaBort(nyckel)

      setKlara((n) => n + 1)
      setUtfalld(null)
      await ladda()
    } catch (e) {
      setFel(e instanceof Error ? e.message : String(e))
    } finally {
      setArbetar(null)
    }
  }

  async function flyttaBort(nyckel: { doman?: string; epost?: string }) {
    const medMapp = konton.filter((k) => k.gallring_mapp_id)
    if (!medMapp.length) return

    for (const konto of medMapp) {
      // Det som vill ha betalt flyttas aldrig undan, hur bortgallrad
      // avsändaren än är. En faktura får inte tystas av ett domänbeslut.
      let q = supabase
        .from('hub_mejl')
        .select('id, from_email')
        .eq('account_id', konto.id)
        .eq('visad_roll', 'inbox')
        .eq('betalning', false)
      if (nyckel.epost) q = q.eq('from_email', nyckel.epost)
      const { data } = await q
      const ids = (data ?? [])
        .filter((m) => {
          const e = (m as { from_email: string | null }).from_email ?? ''
          return nyckel.epost ? e === nyckel.epost : e.endsWith('@' + nyckel.doman)
        })
        .map((m) => (m as { id: string }).id)
      if (!ids.length) continue
      await supabase.rpc('hub_flytta', {
        p_msg_ids: ids,
        p_mal_mapp: konto.gallring_mapp_id,
        p_mal_roll: null,
      })
    }
  }

  async function valjMapp(kontoId: string, mappId: string) {
    setKonton((prev) => prev.map((k) => (k.id === kontoId ? { ...k, gallring_mapp_id: mappId || null } : k)))
    await supabase.from('hub_mail_accounts')
      .update({ gallring_mapp_id: mappId || null }).eq('id', kontoId)
  }

  if (laddar) return <Spinner />

  const kvar = rader.reduce((n, r) => n + Number(r.antal), 0)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Städa avsändare</h1>
        <p className="mt-1 text-sm text-muted">
          {rader.length === 0
            ? 'Inga oavgjorda avsändare kvar.'
            : `${rader.length} avsändare och ${kvar} mejl att ta ställning till. Störst först — de tyngsta går snabbast att bli av med.`}
        </p>
      </div>

      <Card>
        <p className="mb-1 text-sm font-medium">Gallrade mejl flyttas till</p>
        <p className="mb-3 text-xs text-muted">
          Ingenting raderas. Väljer du ingen mapp stannar mejlen där de ligger — de slutar bara
          synas i inkorgen här.
        </p>
        <div className="space-y-2">
          {konton.map((k) => (
            <div key={k.id} className="flex flex-wrap items-center gap-2">
              <span className="w-32 shrink-0 text-xs text-muted">{k.label}</span>
              <select
                value={k.gallring_mapp_id ?? ''}
                onChange={(e) => valjMapp(k.id, e.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-ink outline-none focus:border-accent"
              >
                <option value="">— ingen mapp —</option>
                {mappar.filter((m) => m.account_id === k.id).map((m) => (
                  <option key={m.id} value={m.id}>{m.path}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </Card>

      {fel && <p className="rounded-xl border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{fel}</p>}
      {klara > 0 && (
        <p className="text-xs text-good">{klara} {klara === 1 ? 'avsändare' : 'avsändare'} avklarade den här omgången.</p>
      )}

      <div className="space-y-2">
        {rader.map((r) => {
          const upptagen = arbetar === r.doman
          return (
            <Card key={r.doman} className="p-0">
              <div className="flex flex-wrap items-start gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {r.visningsnamn || r.doman}
                    <span className="ml-2 text-xs font-normal text-muted">{r.doman}</span>
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted">{r.exempel || '(inget ämne)'}</p>
                  <p className="mt-1 text-[11px] text-muted/70">
                    {r.antal} mejl
                    {r.adresser.length > 1 && ` · ${r.adresser.length} adresser`}
                    {r.senaste && ` · senast för ${formatDistanceToNow(parseISO(r.senaste), { locale: sv })} sedan`}
                  </p>
                  {r.adresser.length > 1 && (
                    <button
                      onClick={() => fallUt(r.doman)}
                      className="mt-1.5 text-[11px] text-accent-soft hover:underline"
                    >
                      {utfalld === r.doman ? 'Dölj adresserna' : 'Dela upp per adress'}
                    </button>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    disabled={upptagen}
                    onClick={() => bestam({ doman: r.doman }, 'in')}
                    className="rounded-xl border border-good/40 px-3 py-2 text-xs font-medium text-good transition-colors hover:bg-good/10 disabled:opacity-50"
                  >
                    Släpp in
                  </button>
                  <button
                    disabled={upptagen}
                    onClick={() => bestam({ doman: r.doman }, 'ut')}
                    className="rounded-xl border border-border px-3 py-2 text-xs font-medium text-muted transition-colors hover:border-bad/50 hover:text-bad disabled:opacity-50"
                  >
                    {upptagen ? 'Gallrar…' : 'Gallra bort'}
                  </button>
                </div>
              </div>

              {utfalld === r.doman && (
                <div className="border-t border-border bg-surface/50 px-4 py-2">
                  {adresser.length === 0 ? (
                    <p className="py-2 text-xs text-muted">Hämtar…</p>
                  ) : adresser.map((a) => (
                    <div key={a.epost} className="flex flex-wrap items-center gap-2 border-b border-border/40 py-2 last:border-0">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium">{a.visningsnamn || a.epost}</p>
                        <p className="truncate text-[11px] text-muted">{a.epost} · {a.antal} mejl</p>
                      </div>
                      <button
                        disabled={arbetar === a.epost}
                        onClick={() => bestam({ epost: a.epost }, 'in')}
                        className="rounded-lg border border-good/40 px-2.5 py-1.5 text-[11px] font-medium text-good hover:bg-good/10 disabled:opacity-50"
                      >
                        Släpp in
                      </button>
                      <button
                        disabled={arbetar === a.epost}
                        onClick={() => bestam({ epost: a.epost }, 'ut')}
                        className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-medium text-muted hover:border-bad/50 hover:text-bad disabled:opacity-50"
                      >
                        Gallra
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )
        })}
      </div>

      {rader.length === 0 && (
        <Card>
          <p className="text-sm text-muted">
            Klart. Nya avsändare som aldrig skrivit till dig förut dyker upp här i fortsättningen —
            ett beslut per person, en gång.
          </p>
        </Card>
      )}
    </div>
  )
}
