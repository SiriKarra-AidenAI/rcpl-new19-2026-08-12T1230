import { useState } from 'react'

// Renders the Reliance Consumer Products logo from public/rcpl-logo.png.
// Falls back to the styled "R" letter mark if that file hasn't been added yet,
// so the app never shows a broken image.
export function BrandMark({ variant = 'mark' }: { variant?: 'mark' | 'full' }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <span className="mark">R</span>
  return (
    <img
      className={variant === 'full' ? 'brand-img brand-img-full' : 'brand-img'}
      src="/rcpl.png"
      alt="Reliance Consumer Products Limited"
      onError={() => setFailed(true)}
    />
  )
}
