import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://abwmdhvaxqlpyzgvuedj.supabase.co'
const supabaseKey = 'sb_publishable_R1OuxhyY7HJq68XcEoFnSw_Zl16Gux9'

export const supabase = createClient(supabaseUrl, supabaseKey)

// Hubben är en enanvändar-app: kontot är knutet till den här adressen
// och inloggningen sker med enbart lösenord.
export const HUB_EMAIL = 'lundgrenper.pl@gmail.com'
