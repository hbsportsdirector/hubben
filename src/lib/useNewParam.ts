import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'

/** Öppnar "skapa ny"-flödet när sidan nås med ?ny=1 (t.ex. från command palette). */
export function useNewParam(onNew: () => void) {
  const [searchParams, setSearchParams] = useSearchParams()
  const handled = useRef(false)
  useEffect(() => {
    if (searchParams.get('ny') === '1' && !handled.current) {
      handled.current = true
      onNew()
      const next = new URLSearchParams(searchParams)
      next.delete('ny')
      setSearchParams(next, { replace: true })
      // tillåt nästa ?ny=1 efter att parametern rensats
      setTimeout(() => { handled.current = false }, 0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])
}
