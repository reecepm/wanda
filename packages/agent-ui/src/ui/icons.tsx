// -----------------------------------------------------------------------------
// Minimal inline icon set. Stroke-based, 16px viewbox, `currentColor`.
// Kept here so the package has no icon-library dependency.
// -----------------------------------------------------------------------------

import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

const base = {
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  width: '1em',
  height: '1em',
}

export function IconArrowUp(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />
    </svg>
  )
}

export function IconStop(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function IconPaperclip(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M12.5 7 7.8 11.8a2.4 2.4 0 0 1-3.4-3.3L9.3 3.5a1.5 1.5 0 0 1 2.2 2.2L6.6 10.6" />
    </svg>
  )
}

export function IconX(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  )
}

export function IconChevronRight(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="m6 4 4 4-4 4" />
    </svg>
  )
}

export function IconChevronDown(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="m4 6 4 4 4-4" />
    </svg>
  )
}

export function IconTerminal(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="m5 7 2 2-2 2M9 11h2.5" />
    </svg>
  )
}

export function IconDiff(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M6 2v12M10 2v12M2 6h4M10 10h4" />
    </svg>
  )
}

export function IconSearch(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <circle cx="7" cy="7" r="4" />
      <path d="m13 13-3-3" />
    </svg>
  )
}

export function IconFile(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M4 2h5l3 3v9H4zM9 2v3h3" />
    </svg>
  )
}

export function IconGlobe(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M2.5 8h11M8 2.5a8 8 0 0 1 0 11M8 2.5a8 8 0 0 0 0 11" />
    </svg>
  )
}

export function IconBrain(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M6 3a2 2 0 0 0-2 2 2 2 0 0 0-1 3.5A2 2 0 0 0 4 12a2 2 0 0 0 2 1v-10ZM10 3a2 2 0 0 1 2 2 2 2 0 0 1 1 3.5A2 2 0 0 1 12 12a2 2 0 0 1-2 1v-10Z" />
    </svg>
  )
}

export function IconCheck(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="m3 8 3.5 3.5L13 5" />
    </svg>
  )
}

export function IconAlert(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M8 2 1.5 13.5h13zM8 6.5v3M8 11.5v.01" />
    </svg>
  )
}

export function IconSparkle(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M8 2v4M8 10v4M2 8h4M10 8h4M4 4l2.5 2.5M9.5 9.5 12 12M12 4 9.5 6.5M6.5 9.5 4 12" />
    </svg>
  )
}
