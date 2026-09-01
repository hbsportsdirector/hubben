import { supabase } from './supabase'

/** Ett påbörjat mejl. Bilagor ingår inte — se migrationen 20260901_hub_utkast. */
export interface Utkast {
  lage: 'nytt' | 'svar' | 'svaraAlla' | 'vidare'
  konto_id: string | null
  till: string
  kopia: string
  hemlig: string
  amne: string
  text: string
}

/** null = det fristående nya mejlet. Ett meddelande-id = ett påbörjat svar
 *  på just det mejlet, så flera trådar kan ha var sitt utkast liggande. */
export type UtkastNyckel = string | null

export async function hamtaUtkast(svarPa: UtkastNyckel): Promise<Utkast | null> {
  let q = supabase.from('hub_utkast').select('lage, konto_id, till, kopia, hemlig, amne, text')
  q = svarPa === null ? q.is('svar_pa', null) : q.eq('svar_pa', svarPa)
  const { data } = await q.maybeSingle()
  return (data as Utkast) ?? null
}

/** Returnerar tidpunkten det sparades, eller null när utkastet var tomt och
 *  därför togs bort. */
export async function sparaUtkast(svarPa: UtkastNyckel, u: Utkast): Promise<string | null> {
  const { data, error } = await supabase.rpc('hub_spara_utkast', {
    p_svar_pa: svarPa, p_lage: u.lage, p_konto: u.konto_id,
    p_till: u.till, p_kopia: u.kopia, p_hemlig: u.hemlig,
    p_amne: u.amne, p_text: u.text,
  })
  if (error) return null
  return (data as string | null) ?? null
}

export async function slangUtkast(svarPa: UtkastNyckel): Promise<void> {
  let q = supabase.from('hub_utkast').delete()
  q = svarPa === null ? q.is('svar_pa', null) : q.eq('svar_pa', svarPa)
  await q
}

/** "sparat 14:07" — tid räcker, ett utkast man tittar på är från idag. */
export function sparatText(iso: string | null) {
  if (!iso) return null
  return 'Utkast sparat ' + new Intl.DateTimeFormat('sv-SE', {
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso))
}
