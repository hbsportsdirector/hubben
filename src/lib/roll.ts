import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export interface Roll {
  /** Sant om den inloggade arbetar i någon annans hub */
  arDelegat: boolean
  /** Vems hub vi tittar i — den egna, eller chefens */
  agareId: string | null
  laddar: boolean
}

/** Vem är jag i den här hubben?
 *
 *  Nästan alltid ägaren. En assistent loggar in som sig själv men ser Pers
 *  mejl och kalender — och ska då varken se hans ekonomi i menyn eller kunna
 *  bjuda in fler assistenter. */
export function useRoll(): Roll {
  const [roll, setRoll] = useState<Roll>({ arDelegat: false, agareId: null, laddar: true })

  useEffect(() => {
    let levande = true
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { if (levande) setRoll({ arDelegat: false, agareId: null, laddar: false }); return }
      const { data } = await supabase
        .from('hub_delegater').select('agare_id').eq('delegat_id', user.id).maybeSingle()
      if (levande) {
        setRoll({
          arDelegat: !!data,
          agareId: (data?.agare_id as string | undefined) ?? user.id,
          laddar: false,
        })
      }
    })()
    return () => { levande = false }
  }, [])

  return roll
}
