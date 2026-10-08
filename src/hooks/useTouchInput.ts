import { useEffect, useState } from 'react'
import { useIsMobile } from './use-mobile'

export function useTouchInput() {
  const compact = useIsMobile()
  const [coarse, setCoarse] = useState(() => window.matchMedia('(pointer: coarse)').matches)
  useEffect(() => {
    const query = window.matchMedia('(pointer: coarse)')
    const update = () => setCoarse(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return compact || coarse
}
