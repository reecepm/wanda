import { nativeImage } from 'electron'
import badgeTemplate from '../../resources/tray/tray-badgeTemplate.png?asset'
import devBadge from '../../resources/tray/tray-dev-badge.png?asset'
import devIdle from '../../resources/tray/tray-dev-idle.png?asset'
// Pre-built PNG tray icons (generated from SVG via scripts/generate-tray-icons)
import idleTemplate from '../../resources/tray/tray-idleTemplate.png?asset'
import { isDev } from '../app-config'

export type TrayIconState = 'idle' | 'running' | 'attention'

/**
 * Derive the tray icon state from pod/notification counts.
 * Priority: attention > running > idle.
 */
export function computeTrayIconState(runningPodCount: number, blockingNotificationCount: number): TrayIconState {
  if (blockingNotificationCount > 0) return 'attention'
  if (runningPodCount > 0) return 'running'
  return 'idle'
}

/** Build the tooltip string for the tray icon. */
export function computeTrayTooltip(runningPodCount: number): string {
  if (runningPodCount === 0) return 'Wanda'
  return `Wanda — ${runningPodCount} pod${runningPodCount === 1 ? '' : 's'} running`
}

/**
 * Get the tray icon for a given state. Instant — loads pre-built PNGs.
 *
 * - Prod: uses macOS template images (black+alpha, system auto-inverts for dark mode)
 * - Dev: uses blue-tinted non-template images for easy identification
 * - Attention: both dev and prod show an amber notification badge dot
 */
export function getTrayIcon(state: TrayIconState): Electron.NativeImage {
  const hasBadge = state === 'attention'

  if (isDev) {
    return nativeImage.createFromPath(hasBadge ? devBadge : devIdle)
  }

  // Prod: template images. Electron auto-loads @2x variant on retina.
  return nativeImage.createFromPath(hasBadge ? badgeTemplate : idleTemplate)
}
