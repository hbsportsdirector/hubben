import { useEffect, useState, useCallback } from 'react'
import { format, parseISO } from 'date-fns'
import { sv } from 'date-fns/locale'
import { supabase } from '../lib/supabase'
import { getUserId } from '../lib/data'
import { Card, SectionTitle, Button, Input, Select, Label, EmptyState, Spinner } from '../components/ui'

/** Veckodagarna i Postgres dow-ordning (0 = söndag), men listade måndag först
 *  eftersom det är så en svensk vecka läses. Värdet är det som lagras. */
const VECKODAGAR = [
  { dow: 1, namn: 'Måndag' }, { dow: 2, namn: 'Tisdag' }, { dow: 3, namn: 'Onsdag' },
  { dow: 4, namn: 'Torsdag' }, { dow: 5, namn: 'Fredag' },
  { dow: 6, namn: 'Lördag' }, { dow: 0, namn: 'Söndag' },
]

interface Lank {
  id: string
  token: string
  namn: string
  langd_min: number
  kalender_id: string | null
  plats: string | null
  beskrivning: string | null
  framforhallning_dagar: number
  varsel_timmar: number
  aktiv: boolean
}
interface Oppettid { id: string; lank_id: string; veckodag: number; fran_tid: string; till_tid: string }
interface Bokning { id: string; lank_id: string; namn: string; epost: string; meddelande: string | null; starts_at: string }
interface Kalender { id: string; namn: string }

export default function Bokningar() {
  const [lankar, setLankar] = useState<Lank[]>([])
  const [tider, setTider] = useState<Oppettid[]>([])
  const [bokningar, setBokningar] = useState<Bokning[]>([])
  const [kalendrar, setKalendrar] = useState<Kalender[]>([])
  const [laddar, setLaddar] = useState(true)
  const [nyttNamn, setNyttNamn] = useState('')
  const [kopierad, setKopierad] = useState<string | null>(null)

  const ladda = useCallback(async () => {
    const [l, t, b, k] = await Promise.all([
      supabase.from('hub_bokningslankar').select('*').order('skapad'),
      supabase.from('hub_oppettider').select('*').order('veckodag').order('fran_tid'),
      supabase.from('hub_bokningar').select('*').is('avbokad_at', null).order('starts_at'),
      supabase.from('hub_calendars').select('id, namn').eq('aktiv', true).order('namn'),
    ])
    setLankar((l.data as Lank[]) ?? [])
    setTider((t.data as Oppettid[]) ?? [])
    setBokningar((b.data as Bokning[]) ?? [])
    setKalendrar((k.data as Kalender[]) ?? [])
    setLaddar(false)
  }, [])

  useEffect(() => { ladda() }, [ladda])

  async function skapa() {
    if (!nyttNamn.trim()) return
    await supabase.from('hub_bokningslankar').insert({
      user_id: await getUserId(),
      namn: nyttNamn.trim(),
      kalender_id: kalendrar[0]?.id ?? null,
    }).throwOnError()
    setNyttNamn('')
    ladda()
  }

  /** Adressen du delar. BASE_URL är /hubben/ på GitHub Pages. */
  const adress = (token: string) =>
    `${window.location.origin}${import.meta.env.BASE_URL}boka/${token}`

  async function kopiera(token: string) {
    await navigator.clipboard.writeText(adress(token))
    setKopierad(token)
    setTimeout(() => setKopierad(null), 2500)
  }

  if (laddar) return <Spinner />

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Bokningslänkar</h1>
        <p className="mt-1 text-sm text-muted">
          Sätt upp öppettider och dela en länk. Sidan räknar själv ut lediga tider och
          hoppar över allt som redan står i dina kalendrar.
        </p>
      </div>

      <Card>
        <SectionTitle>Ny länk</SectionTitle>
        <div className="flex gap-2">
          <Input
            value={nyttNamn}
            onChange={(e) => setNyttNamn(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && skapa()}
            placeholder="T.ex. Möte med Per, 30 min"
          />
          <Button onClick={skapa}>Skapa</Button>
        </div>
      </Card>

      {lankar.length === 0 ? (
        <Card><EmptyState emoji="📅" text="Ingen länk än. Skapa en så kan folk boka tid hos dig." /></Card>
      ) : (
        lankar.map((l) => (
          <LankKort
            key={l.id}
            lank={l}
            tider={tider.filter((t) => t.lank_id === l.id)}
            bokningar={bokningar.filter((b) => b.lank_id === l.id)}
            kalendrar={kalendrar}
            adress={adress(l.token)}
            kopierad={kopierad === l.token}
            onKopiera={() => kopiera(l.token)}
            onAndrat={ladda}
          />
        ))
      )}
    </div>
  )
}

function LankKort({ lank, tider, bokningar, kalendrar, adress, kopierad, onKopiera, onAndrat }: {
  lank: Lank; tider: Oppettid[]; bokningar: Bokning[]; kalendrar: Kalender[]
  adress: string; kopierad: boolean; onKopiera: () => void; onAndrat: () => void
}) {
  const [dag, setDag] = useState(1)
  const [fran, setFran] = useState('13:00')
  const [till, setTill] = useState('15:00')

  async function spara(patch: Partial<Lank>) {
    await supabase.from('hub_bokningslankar').update(patch).eq('id', lank.id).throwOnError()
    onAndrat()
  }

  async function laggTill() {
    if (till <= fran) return
    await supabase.from('hub_oppettider').insert({
      lank_id: lank.id, user_id: await getUserId(),
      veckodag: dag, fran_tid: fran, till_tid: till,
    }).throwOnError()
    onAndrat()
  }

  async function taBort(id: string) {
    await supabase.from('hub_oppettider').delete().eq('id', id).throwOnError()
    onAndrat()
  }

  async function taBortLank() {
    await supabase.from('hub_bokningslankar').delete().eq('id', lank.id).throwOnError()
    onAndrat()
  }

  const perDag = VECKODAGAR.map((v) => ({ ...v, rader: tider.filter((t) => t.veckodag === v.dow) }))

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">{lank.namn}</h2>
        {!lank.aktiv && (
          <span className="rounded-full bg-warn/15 px-2 py-0.5 text-[11px] font-medium text-warn">Avstängd</span>
        )}
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={() => spara({ aktiv: !lank.aktiv })}>
            {lank.aktiv ? 'Stäng av' : 'Slå på'}
          </Button>
          <Button variant="danger" onClick={taBortLank}>Ta bort</Button>
        </div>
      </div>

      {/* Adressen du delar */}
      <div className="mb-5 flex gap-2">
        <input
          readOnly value={adress}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-muted outline-none"
        />
        <Button onClick={onKopiera}>{kopierad ? 'Kopierad ✓' : 'Kopiera'}</Button>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <Label>Möteslängd</Label>
          <Select value={lank.langd_min} onChange={(e) => spara({ langd_min: Number(e.target.value) })}>
            {[15, 20, 30, 45, 60, 90].map((m) => <option key={m} value={m}>{m} minuter</option>)}
          </Select>
        </div>
        <div>
          <Label>Bokningarna hamnar i</Label>
          <Select
            value={lank.kalender_id ?? ''}
            onChange={(e) => spara({ kalender_id: e.target.value || null })}
          >
            <option value="">Bara i Hubben</option>
            {kalendrar.map((k) => <option key={k.id} value={k.id}>{k.namn}</option>)}
          </Select>
        </div>
        <div>
          <Label>Plats</Label>
          <Input
            defaultValue={lank.plats ?? ''}
            onBlur={(e) => e.target.value !== (lank.plats ?? '') && spara({ plats: e.target.value || null })}
            placeholder="Teams, kontoret, telefon…"
          />
        </div>
        <div>
          <Label>Visa tider {lank.framforhallning_dagar} dagar fram</Label>
          <input
            type="range" min={7} max={90} step={7}
            value={lank.framforhallning_dagar}
            onChange={(e) => spara({ framforhallning_dagar: Number(e.target.value) })}
            className="w-full accent-(--color-accent)"
          />
        </div>
      </div>

      <div className="mt-5">
        <SectionTitle>Öppettider</SectionTitle>
        {tider.length === 0 && (
          <p className="mb-3 rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
            Utan öppettider visar sidan inga tider alls.
          </p>
        )}
        <div className="mb-3 space-y-1.5">
          {perDag.filter((d) => d.rader.length).map((d) => (
            <div key={d.dow} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="w-20 shrink-0 text-muted">{d.namn}</span>
              {d.rader.map((t) => (
                <span key={t.id} className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1 tabular-nums">
                  {t.fran_tid.slice(0, 5)}–{t.till_tid.slice(0, 5)}
                  <button
                    onClick={() => taBort(t.id)}
                    className="text-muted hover:text-bad"
                    aria-label={`Ta bort ${d.namn} ${t.fran_tid.slice(0, 5)}`}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Select value={dag} onChange={(e) => setDag(Number(e.target.value))} className="!w-auto">
            {VECKODAGAR.map((v) => <option key={v.dow} value={v.dow}>{v.namn}</option>)}
          </Select>
          <Input type="time" value={fran} onChange={(e) => setFran(e.target.value)} className="!w-auto" />
          <span className="pb-2 text-muted">–</span>
          <Input type="time" value={till} onChange={(e) => setTill(e.target.value)} className="!w-auto" />
          <Button onClick={laggTill}>Lägg till</Button>
        </div>
      </div>

      {bokningar.length > 0 && (
        <div className="mt-5">
          <SectionTitle>Bokade tider ({bokningar.length})</SectionTitle>
          <ul className="space-y-1.5">
            {bokningar.map((b) => (
              <li key={b.id} className="rounded-xl border border-border bg-surface px-3 py-2 text-sm">
                <span className="font-medium capitalize">
                  {format(parseISO(b.starts_at), 'EEE d MMM HH:mm', { locale: sv })}
                </span>
                <span className="text-muted"> · {b.namn} · {b.epost}</span>
                {b.meddelande && <p className="mt-0.5 text-xs text-muted">{b.meddelande}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}
