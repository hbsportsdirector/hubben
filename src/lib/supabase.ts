import { createClient } from '@supabase/supabase-js'

export const supabaseUrl = 'https://abwmdhvaxqlpyzgvuedj.supabase.co'
export const supabaseKey = 'sb_publishable_R1OuxhyY7HJq68XcEoFnSw_Zl16Gux9'

export const supabase = createClient(supabaseUrl, supabaseKey)

// Hubben är en enanvändar-app: kontot är knutet till den här adressen
// och inloggningen sker med enbart lösenord. VITE_HUB_EPOST i en lokal
// .env.local pekar om den vid utveckling, så testkonton aldrig behöver
// smyga in i den här filen.
export const HUB_EMAIL = import.meta.env.VITE_HUB_EPOST ?? 'lundgrenper.pl@gmail.com'
