import { useHotkey } from '@tanstack/react-hotkeys'
import { lazy, type ReactNode, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useAttentionAutoNav } from '@/features/attention-mode'
import { CommandPalette, useCommandPalette } from '@/features/command-palette'
import { InboxPanel, useMcpInvalidation } from '@/features/notifications'
import { usePodRecoveryInfo } from '@/features/pod/hooks/use-pod-lifecycle'
import { createBrowserItem } from '@/features/pod/utils/browser-utils'
import { usePairedInvalidation } from '@/features/servers'
import { getBinding } from '@/features/shortcuts'
import { onTerminalUrlDetected, openExternalUrl } from '@/features/terminal/terminal-transport'
import { useViewStore } from '@/features/view'
import { WorkspaceExplorer } from '@/features/workspace'
import { useAppNavigation } from '@/shared/hooks/use-app-navigation'
import { cn } from '@/shared/utils'
import { useShortcutStore } from '@/stores/shortcut-store'
import { useUIStore } from '@/stores/ui-store'
import { Toaster } from '@/ui/sonner'
import { RecoveryBanner } from './recovery-banner'
import { TopBarProvider } from './topbar'

const WorkspaceViewScreen = lazy(() => import('@/features/view').then((m) => ({ default: m.WorkspaceViewScreen })))

interface AppLayoutProps {
  children: ReactNode
}

export function AppLayout({ children }: AppLayoutProps) {
  useMcpInvalidation()
  usePairedInvalidation()
  useAppNavigation()
  useAttentionAutoNav()

  const paletteBinding = getBinding(
    'app:command-palette',
    useShortcutStore((s) => s.overrides),
  )
  useHotkey(paletteBinding, (e) => {
    e.preventDefault()
    useCommandPalette.getState().toggle()
  })

  const activeWorkspaceViewId = useUIStore((s) => s.activeWorkspaceViewId)
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed)
  const [sidebarHovered, setSidebarHovered] = useState(false)
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const leaveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [recoveryInfo, setRecoveryInfo] = useState<{ recovered: number; failed: number; wasDirty: boolean } | null>(
    null,
  )

  const handleRecovered = useCallback((info: { recovered: number; failed: number; wasDirty: boolean }) => {
    if (info.recovered > 0 || info.failed > 0) {
      setRecoveryInfo(info)
    }
  }, [])
  usePodRecoveryInfo(handleRecovered)

  const handleDetectedUrl = useCallback((_streamId: string, url: string, podId: string | null) => {
    toast.info(`Server ready at ${url}`, {
      action: podId
        ? {
            label: 'Open in View',
            onClick: async () => {
              const item = await createBrowserItem(podId, { url, label: url })
              if (item) useViewStore.getState().splitPane('horizontal', item.id)
            },
          }
        : undefined,
      cancel: {
        label: 'Open in Browser',
        onClick: () => openExternalUrl(url),
      },
      duration: 8000,
    })
  }, [])

  // Show toast when a dev-server URL is detected in command output.
  useEffect(() => {
    const cleanup = onTerminalUrlDetected(handleDetectedUrl)
    return () => {
      cleanup()
    }
  }, [handleDetectedUrl])

  const handleHoverZoneEnter = useCallback(() => {
    if (!sidebarCollapsed) return
    clearTimeout(leaveTimeoutRef.current)
    clearTimeout(hoverTimeoutRef.current)
    hoverTimeoutRef.current = setTimeout(() => setSidebarHovered(true), 100)
  }, [sidebarCollapsed])

  const handleSidebarLeave = useCallback(() => {
    clearTimeout(hoverTimeoutRef.current)
    leaveTimeoutRef.current = setTimeout(() => setSidebarHovered(false), 100)
  }, [])

  const handleSidebarEnter = useCallback(() => {
    clearTimeout(leaveTimeoutRef.current)
  }, [])

  const sidebarOverlayRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!sidebarCollapsed || !sidebarHovered) return
    function isInsideEl(el: HTMLElement | null, x: number, y: number) {
      if (!el) return false
      const r = el.getBoundingClientRect()
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
    }
    function handlePointerMove(e: PointerEvent) {
      if (isInsideEl(sidebarOverlayRef.current, e.clientX, e.clientY)) return
      setSidebarHovered(false)
    }
    document.addEventListener('pointermove', handlePointerMove)
    return () => document.removeEventListener('pointermove', handlePointerMove)
  }, [sidebarCollapsed, sidebarHovered])

  return (
    <div className="h-screen flex flex-col bg-background text-foreground">
      <TopBarProvider>
        {/* Below topbar: sidebar + content */}
        <div className="flex flex-1 min-h-0">
          {/* Left: combined nav + workspace explorer */}
          <div className="relative flex-shrink-0 h-full">
            {sidebarCollapsed && (
              <div
                aria-hidden="true"
                className="absolute inset-y-0 left-0 w-3 z-10"
                onMouseEnter={handleHoverZoneEnter}
                onMouseLeave={handleSidebarLeave}
                role="presentation"
              />
            )}
            {!sidebarCollapsed ? (
              <WorkspaceExplorer />
            ) : (
              <div
                className={cn(
                  'absolute left-0 top-0 z-20 h-full shadow-2xl shadow-black/50 transition-all duration-200 ease-out',
                  sidebarHovered ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-2 pointer-events-none',
                )}
                ref={sidebarOverlayRef}
                onMouseEnter={handleSidebarEnter}
                onMouseLeave={handleSidebarLeave}
                aria-label="Workspace explorer"
                role="navigation"
              >
                <WorkspaceExplorer />
              </div>
            )}
          </div>

          {/* Right: content */}
          <div className="flex flex-col flex-1 min-w-0 h-full">
            {recoveryInfo && <RecoveryBanner {...recoveryInfo} onDismiss={() => setRecoveryInfo(null)} />}
            <main className="flex-1 min-h-0 min-w-0 flex flex-col" aria-label="Main content">
              {activeWorkspaceViewId ? (
                <Suspense fallback={<div className="flex-1" />}>
                  <WorkspaceViewScreen workspaceId={activeWorkspaceViewId} />
                </Suspense>
              ) : (
                children
              )}
            </main>
          </div>
        </div>
      </TopBarProvider>

      <InboxPanel />

      <CommandPalette />
      <Toaster />
    </div>
  )
}
