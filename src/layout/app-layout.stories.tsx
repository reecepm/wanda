import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { fn } from 'storybook/test'
import { type Workspace, WorkspaceList } from '@/features/workspace'
import {
  RiAddLine,
  RiCalendarScheduleLine,
  RiComputerLine,
  RiHome5Fill,
  RiPlayFill,
  RiSettings3Line,
  RiTerminalLine,
} from '@/lib/icons'

const mockWorkspaces: Workspace[] = [
  {
    id: 'p1',
    name: 'wanda',
    pods: [
      { id: 'pod1', name: 'Dev Server', status: 'running', runtimeKind: 'shell', workspaceId: 'p1' },
      { id: 'pod2', name: 'Worker', status: 'stopped', runtimeKind: 'shell', workspaceId: 'p1' },
      { id: 'pod3', name: 'Database', status: 'failed', runtimeKind: 'shell', workspaceId: 'p1' },
    ],
  },
  {
    id: 'p2',
    name: 'website',
    pods: [
      { id: 'pod4', name: 'Next.js', status: 'running', runtimeKind: 'shell', workspaceId: 'p2' },
      { id: 'pod5', name: 'Tailwind Watch', status: 'stopped', runtimeKind: 'shell', workspaceId: 'p2' },
    ],
  },
  {
    id: 'p3',
    name: 'api-server',
    pods: [{ id: 'pod6', name: 'API', status: 'stopped', runtimeKind: 'shell', workspaceId: 'p3' }],
  },
]

function MockTerminal({ name }: { name: string }) {
  return (
    <div className="h-full bg-zinc-950 font-mono text-xs text-zinc-300 p-2 overflow-hidden">
      <div className="text-zinc-600">~ {name}</div>
      <div className="text-emerald-400">$ bun run dev</div>
      <div className="text-zinc-500">watching for changes...</div>
      <div className="mt-1 inline-block w-2 h-3.5 bg-zinc-400 animate-pulse" />
    </div>
  )
}

/** macOS window chrome wrapper — rounded-md corners, border, shadow, and traffic lights. */
function MacWindow({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-screen flex items-center justify-center bg-zinc-800 p-6">
      <div className="w-full max-w-[1400px] h-[820px] rounded-xl border border-zinc-700 overflow-hidden shadow-2xl">
        {children}
      </div>
    </div>
  )
}

/** Full app shell with sidebar, header, and main content — for visualizing layout changes. */
function LayoutShell({ children, selectedPodId }: { children: React.ReactNode; selectedPodId?: string }) {
  const [selected, setSelected] = useState(selectedPodId ?? 'pod1')

  return (
    <div className="h-full flex flex-col bg-zinc-950 text-zinc-50">
      {/* Header with traffic lights */}
      <header className="h-9 flex items-center border-b border-zinc-800 bg-zinc-950 px-3">
        <div className="flex items-center gap-2 mr-3">
          <span className="size-3 rounded-full bg-[#FF5F57]" />
          <span className="size-3 rounded-full bg-[#FEBC2E]" />
          <span className="size-3 rounded-full bg-[#28C840]" />
        </div>
        <div className="flex items-center gap-1.5">
          <RiTerminalLine className="h-4 w-4 text-zinc-400" />
          <span className="text-sm font-semibold text-zinc-200 tracking-tight">Wanda</span>
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
            { icon: RiHome5Fill, label: 'Home', active: true },
            { icon: RiCalendarScheduleLine, label: 'Schedules', active: false },
            { icon: RiComputerLine, label: 'Setups', active: false },
          ].map((item) => (
            <button
              key={item.label}
              type="button"
              title={item.label}
              className={`flex items-center justify-center size-8 rounded-md transition-colors ${
                item.active ? 'bg-zinc-800 text-zinc-50' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
              }`}
            >
              <item.icon className="size-4" />
            </button>
          ))}
          <div className="mt-auto">
            <button
              type="button"
              title="Settings"
              className="flex items-center justify-center size-8 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 transition-colors"
            >
              <RiSettings3Line className="size-4" />
            </button>
          </div>
        </nav>

        {/* Sidebar */}
        <aside className="w-60 border-r border-zinc-800 bg-zinc-950 flex flex-col">
          <div className="flex flex-col h-full">
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-800">
              <span className="text-[10px] font-medium text-zinc-500">Workspaces</span>
              <button
                type="button"
                className="p-1 rounded-md hover:bg-zinc-800 text-zinc-600 hover:text-zinc-300 transition-colors"
                title="New workspace"
              >
                <RiAddLine className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-1.5">
              <WorkspaceList
                workspaces={mockWorkspaces}
                selectedPodId={selected}
                expandedWorkspaces={new Set(mockWorkspaces.map((w) => w.id))}
                onToggleWorkspace={fn()}
                onSelectPod={setSelected}
                onCreateWorkspace={fn()}
                onCreatePod={fn()}
                onReorderWorkspaces={fn()}
                onReorderPods={fn()}
              />
            </div>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0 p-2">{children}</main>
      </div>
    </div>
  )
}

const meta = {
  title: 'Layout/AppLayout',
  component: LayoutShell,
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta<typeof LayoutShell>

export default meta
type Story = StoryObj<typeof meta>

/** Empty state — no pod selected */
export const EmptyState: Story = {
  args: { children: null },
  render: () => (
    <MacWindow>
      <LayoutShell>
        <div className="flex items-center justify-center h-full">
          <p className="text-sm text-zinc-600">Select a pod from the sidebar to get started</p>
        </div>
      </LayoutShell>
    </MacWindow>
  ),
}

/** Pod selected — stopped, showing terminal configs */
export const PodStopped: Story = {
  args: { children: null },
  render: () => (
    <MacWindow>
      <LayoutShell selectedPodId="pod2">
        <div className="flex flex-col h-full gap-2">
          <div className="flex items-center gap-3 px-3 py-2 bg-zinc-900/50 rounded-lg border border-zinc-800">
            <div className="flex items-center gap-2 flex-1">
              <span className="h-2 w-2 rounded-full bg-zinc-500" />
              <span className="text-sm font-medium text-zinc-200">Worker</span>
              <span className="text-[10px] text-zinc-500">Stopped</span>
            </div>
            <button
              type="button"
              className="p-1.5 rounded-md hover:bg-zinc-700 text-zinc-400 hover:text-emerald-400 transition-colors"
            >
              <RiPlayFill className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 flex flex-col">
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-xs font-medium text-zinc-400">Terminals (2)</span>
            </div>
            <div className="flex flex-col gap-1 px-3">
              {['shell', 'dev server'].map((name) => (
                <div
                  key={name}
                  className="flex items-center gap-2 px-3 py-2 rounded-md bg-zinc-900/50 border border-zinc-800"
                >
                  <RiTerminalLine className="h-3.5 w-3.5 text-zinc-500" />
                  <span className="text-xs text-zinc-300">{name}</span>
                </div>
              ))}
              <button
                type="button"
                className="mt-3 flex items-center justify-center gap-2 py-2 rounded-md bg-emerald-600/20 border border-emerald-600/30 text-emerald-400 text-xs font-medium hover:bg-emerald-600/30 transition-colors"
              >
                <RiPlayFill className="h-3.5 w-3.5" />
                Start Pod
              </button>
            </div>
          </div>
        </div>
      </LayoutShell>
    </MacWindow>
  ),
}

/** Pod running — terminal grid visible */
export const PodRunning: Story = {
  args: { children: null },
  render: () => (
    <MacWindow>
      <LayoutShell selectedPodId="pod1">
        <div className="flex flex-col h-full gap-2">
          <div className="flex items-center gap-3 px-3 py-2 bg-zinc-900/50 rounded-lg border border-zinc-800">
            <div className="flex items-center gap-2 flex-1">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              <span className="text-sm font-medium text-zinc-200">Dev Server</span>
              <span className="text-[10px] text-zinc-500">Running</span>
            </div>
          </div>
          <div
            className="flex-1 min-h-0 grid gap-1"
            style={{ gridTemplateColumns: 'repeat(2, 1fr)', gridTemplateRows: 'repeat(2, 1fr)' }}
          >
            {['shell', 'dev server', 'tests'].map((name) => (
              <div key={name} className="min-h-0 rounded-lg overflow-hidden border border-zinc-800">
                <div className="text-[10px] px-2 py-0.5 text-zinc-500 bg-zinc-900 border-b border-zinc-800">{name}</div>
                <MockTerminal name={name} />
              </div>
            ))}
          </div>
        </div>
      </LayoutShell>
    </MacWindow>
  ),
}
