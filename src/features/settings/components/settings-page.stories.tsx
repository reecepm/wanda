import type { Meta, StoryObj } from '@storybook/react-vite'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SettingsScreen } from '@/features/settings'
import { RiCalendarScheduleLine, RiComputerLine, RiHome5Fill, RiSettings3Fill, RiTerminalLine } from '@/lib/icons'

const storyQueryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
})

/** macOS window chrome wrapper */
function MacWindow({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-screen flex items-center justify-center bg-zinc-800 p-6">
      <div className="w-full max-w-[1400px] h-[820px] rounded-xl border border-zinc-700 overflow-hidden shadow-2xl">
        {children}
      </div>
    </div>
  )
}

/** App shell with nav rail, no sidebar (settings page hides pods sidebar) */
function LayoutShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full flex flex-col bg-zinc-950 text-zinc-50">
      <header className="h-9 flex items-center border-b border-zinc-800 bg-zinc-950 px-3">
        <div className="flex items-center gap-2 mr-3">
          <span className="size-3 rounded-full bg-[#FF5F57]" />
          <span className="size-3 rounded-full bg-[#FEBC2E]" />
          <span className="size-3 rounded-full bg-[#28C840]" />
        </div>
        <div className="flex items-center gap-1.5">
          <RiTerminalLine className="h-3.5 w-3.5 text-zinc-400" />
          <span className="text-xs font-semibold text-zinc-200 tracking-tight">Wanda</span>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Nav Rail with workspace switcher at top */}
        <nav className="w-12 border-r border-zinc-800 bg-zinc-950 flex flex-col items-center py-2 gap-1">
          <button
            type="button"
            title="Default"
            className="flex items-center justify-center size-8 rounded-md text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800/50 transition-colors"
          >
            <RiTerminalLine className="size-4" />
          </button>
          <div className="w-6 my-1 border-b border-zinc-800" />
          {[
            { icon: RiHome5Fill, label: 'Home' },
            { icon: RiCalendarScheduleLine, label: 'Schedules' },
            { icon: RiComputerLine, label: 'Setups' },
          ].map((item) => (
            <button
              key={item.label}
              type="button"
              title={item.label}
              className="flex items-center justify-center size-8 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 transition-colors"
            >
              <item.icon className="size-4" />
            </button>
          ))}
          <div className="mt-auto">
            <button
              type="button"
              title="Settings"
              className="flex items-center justify-center size-8 rounded-md bg-zinc-800 text-zinc-50 transition-colors"
            >
              <RiSettings3Fill className="size-4" />
            </button>
          </div>
        </nav>

        {/* Main content — no sidebar on settings */}
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  )
}

const meta = {
  title: 'Settings/SettingsPage',
  component: SettingsScreen,
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta<typeof SettingsScreen>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <QueryClientProvider client={storyQueryClient}>
      <MacWindow>
        <LayoutShell>
          <SettingsScreen />
        </LayoutShell>
      </MacWindow>
    </QueryClientProvider>
  ),
}
