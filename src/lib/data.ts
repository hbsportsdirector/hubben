import { supabase } from './supabase'

let cachadAgare: string | null = null
supabase.auth.onAuthStateChange(() => { cachadAgare = null })

/** Vems hub skriver vi i?
 *
 *  Nästan alltid min egen — men en assistent som fått delegering loggar in
 *  som sig själv och arbetar i sin chefs hub. Då ska nya rader hamna hos
 *  chefen, inte hos henne, annars ser han dem aldrig. */
export async function getUserId(): Promise<string> {
  if (cachadAgare) return cachadAgare
  const { data: agare } = await supabase.rpc('hub_min_hub')
  if (typeof agare === 'string') {
    cachadAgare = agare
    return agare
  }
  // Faller tillbaka på det egna kontot om anropet inte gick fram
  const { data } = await supabase.auth.getUser()
  if (!data.user) throw new Error('Inte inloggad')
  return data.user.id
}

export function formatSEK(n: number): string {
  return new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK', maximumFractionDigits: 0 }).format(n)
}

export const priorityMeta: Record<number, { label: string; color: string }> = {
  1: { label: 'Hög', color: 'var(--color-bad)' },
  2: { label: 'Normal', color: 'var(--color-sky)' },
  3: { label: 'Låg', color: 'var(--color-muted)' },
}
