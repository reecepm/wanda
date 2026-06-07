import { createContext, type ReactNode, useContext, useState } from 'react'
import { createPortal } from 'react-dom'
import { AgentCommandBar } from '@/features/agent'
import { WandaLogo } from '@/features/icons'
import { RiSideBarLine } from '@/lib/icons'
import { useUIStore } from '@/stores/ui-store'

declare const __APP_CHANNEL__: string | undefined
const isDevChannel = (typeof __APP_CHANNEL__ !== 'undefined' ? __APP_CHANNEL__ : 'dev') === 'dev'

const TopBarPortalContext = createContext<HTMLDivElement | null>(null)

export function TopBarProvider({ children }: { children: ReactNode }) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  return (
    <TopBarPortalContext.Provider value={container}>
      <AppTopBar portalRef={setContainer} />
      {children}
    </TopBarPortalContext.Provider>
  )
}

export function TopBarActions({ children }: { children: ReactNode }) {
  const container = useContext(TopBarPortalContext)
  if (!container) return null
  return createPortal(children, container)
}

function AppTopBar({ portalRef }: { portalRef: (el: HTMLDivElement | null) => void }) {
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed)
  const toggleSidebarCollapsed = useUIStore((s) => s.toggleSidebarCollapsed)

  return (
    <div className="h-9 flex items-center gap-2 px-3 border-b border-border bg-background drag-region shrink-0">
      <div className="flex items-center gap-1.5 pl-[4.5rem] shrink-0">
        <WandaLogo className="h-3.5 w-3.5 text-zinc-300" />
        <span className="text-xs font-semibold text-zinc-200 tracking-tight">Wanda</span>
        {isDevChannel && (
          <span className="text-[10px] font-medium text-blue-400 bg-blue-400/10 px-1.5 py-0.5 rounded">DEV</span>
        )}
      </div>
      {sidebarCollapsed && (
        <button
          type="button"
          onClick={toggleSidebarCollapsed}
          title="Show sidebar"
          className="no-drag p-1 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors shrink-0"
        >
          <RiSideBarLine className="h-4 w-4" />
        </button>
      )}
      <AgentCommandBar />
      <div ref={portalRef} className="flex-1 flex items-center gap-2 min-w-0" />
    </div>
  )
}
