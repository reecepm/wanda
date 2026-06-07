import { cn } from '@/shared/utils'

/** Zed editor logo */
export function ZedIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 128 128" fill="none" className={cn('size-3.5', className)} aria-hidden="true">
      <title>Zed</title>
      {/* fillRule="evenodd" is required — the path draws an outer circle and
          then the "Z" lettering as inner subpaths, which only cut out of the
          circle under even-odd fill. Without it, the whole disk fills solid
          and the icon renders as a plain white circle. */}
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M64 0a64 64 0 1 0 0 128A64 64 0 0 0 64 0Zm-9.19 32h42.81L74.4 54.4h-9.6L87.2 32H54.8L32.4 54.4v-9.6L54.8 22.4 32.4 44.8V54.4L54.8 32Zm0 41.6h18.4v-9.6H45.19L32.4 76.8V64l22.4-22.4V54.4L32.4 76.8h22.4V64Zm14.99 22.4H32v-9.6l13.19-13.2h27.61l-13.2 13.2H96v9.6H69.8Z"
        fill="currentColor"
      />
    </svg>
  )
}

/** VS Code logo */
export function VSCodeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={cn('size-3.5', className)} aria-hidden="true">
      <title>VS Code</title>
      <path
        d="M70.9 99.3 92 89.1a5.4 5.4 0 0 0 3.1-4.9V15.8a5.4 5.4 0 0 0-3.1-4.9L70.9.7a5.4 5.4 0 0 0-6.1 1L24.3 38.5 6.7 25.1a3.6 3.6 0 0 0-4.6.2l-5.6 5.2a3.6 3.6 0 0 0 0 5.3L11.7 50-3.5 64.2a3.6 3.6 0 0 0 0 5.3l5.6 5.2a3.6 3.6 0 0 0 4.6.2l17.6-13.4 40.5 36.9a5.4 5.4 0 0 0 6.1.9ZM74.7 27.3 44 50l30.7 22.7V27.3Z"
        fill="currentColor"
      />
    </svg>
  )
}

/** Cursor editor logo */
export function CursorIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn('size-3.5', className)} aria-hidden="true">
      <title>Cursor</title>
      <path d="M11.925 24l10.425-6-10.425-6L1.5 18l10.425 6z" fill="currentColor" opacity="0.8" />
      <path d="M22.35 18V6L11.925 0v12l10.425 6z" fill="currentColor" opacity="0.6" />
      <path d="M11.925 0L1.5 6v12l10.425-6V0z" fill="currentColor" />
    </svg>
  )
}

export type EditorId = 'zed' | 'vscode' | 'cursor'

/**
 * Renders an editor's icon. Prefers the actual macOS `.app` bundle icon
 * (extracted via `sips` on the `.icns` and passed in as `iconDataUrl`),
 * falling back to the hand-rolled SVG when the bundle icon isn't available
 * — e.g. CLI-only installs, or an unknown editor id.
 */
export function EditorIcon({
  id,
  iconDataUrl,
  className,
}: {
  id: string
  iconDataUrl?: string | null
  className?: string
}) {
  if (iconDataUrl) {
    return <img src={iconDataUrl} alt="" aria-hidden="true" className={cn('size-3.5 shrink-0', className)} />
  }
  switch (id) {
    case 'zed':
      return <ZedIcon className={className} />
    case 'vscode':
      return <VSCodeIcon className={className} />
    case 'cursor':
      return <CursorIcon className={className} />
    default:
      return null
  }
}
