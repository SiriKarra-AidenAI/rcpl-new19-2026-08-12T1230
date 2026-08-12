import { useCallback, useState } from 'react'

/** Toggleable selection set — reused by bulk-select tables, expandable lists, etc. */
export function useToggleSet<T>(initial: T[] = []) {
  const [items, setItems] = useState<T[]>(initial)
  const has = useCallback((v: T) => items.includes(v), [items])
  const toggle = useCallback((v: T) => setItems((s) => (s.includes(v) ? s.filter((x) => x !== v) : [...s, v])), [])
  const clear = useCallback(() => setItems([]), [])
  return { items, has, toggle, clear, setItems }
}

/** Single-open accordion / drill selection. */
export function useSingleOpen<T>(initial: T | null = null) {
  const [open, setOpen] = useState<T | null>(initial)
  const toggle = useCallback((v: T) => setOpen((cur) => (cur === v ? null : v)), [])
  return { open, setOpen, toggle, isOpen: (v: T) => open === v }
}
