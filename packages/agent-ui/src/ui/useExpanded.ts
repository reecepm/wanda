// -----------------------------------------------------------------------------
// Small controlled/uncontrolled expansion hook. Lets a parent steer the
// open state while keeping a sane default.
// -----------------------------------------------------------------------------

import { useCallback, useState } from 'react'

export function useExpanded(initial = false): [boolean, (next?: boolean) => void] {
  const [open, setOpen] = useState<boolean>(initial)
  const toggle = useCallback((next?: boolean) => {
    if (typeof next === 'boolean') setOpen(next)
    else setOpen((prev) => !prev)
  }, [])
  return [open, toggle]
}
