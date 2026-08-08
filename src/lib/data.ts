import { supabase } from './supabase'

export async function getUserId(): Promise<string> {
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
