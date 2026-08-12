import { useEffect, useRef, useState } from 'react'

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * Streams `full` text token-by-token to create a "typing" agent effect.
 * Honors prefers-reduced-motion (renders instantly). Deterministic — no randomness.
 *
 * @param full     the complete text to reveal
 * @param opts.speed  ms per chunk (default 18)
 * @param opts.chunk  chars revealed per tick (default 2)
 * @param opts.start  begin streaming when true (default true)
 */
export function useStreamingText(
  full: string,
  opts: { speed?: number; chunk?: number; start?: boolean } = {},
) {
  const { speed = 18, chunk = 2, start = true } = opts
  const [text, setText] = useState('')
  const [done, setDone] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    setText('')
    setDone(false)
    if (timer.current) clearInterval(timer.current)
    if (!start) return

    if (prefersReducedMotion()) {
      setText(full)
      setDone(true)
      return
    }

    let i = 0
    timer.current = setInterval(() => {
      i += chunk
      if (i >= full.length) {
        setText(full)
        setDone(true)
        if (timer.current) clearInterval(timer.current)
      } else {
        setText(full.slice(0, i))
      }
    }, speed)

    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [full, speed, chunk, start])

  return { text, done }
}
