import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://abwmdhvaxqlpyzgvuedj.supabase.co'
const supabaseKey = 'sb_publishable_R1OuxhyY7HJq68XcEoFnSw_Zl16Gux9'

export const supabase = createClient(supabaseUrl, supabaseKey)
