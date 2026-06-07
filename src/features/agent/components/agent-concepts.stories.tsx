import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { fn } from 'storybook/test'
import { type Workspace, WorkspaceList } from '@/features/workspace'
import {
  RiAddLine,
  RiArrowDownSLine,
  RiArrowUpSLine,
  RiCalendarScheduleLine,
  RiCloseLine,
  RiComputerLine,
  RiFlowChart,
  RiHome5Fill,
  RiRobotLine,
  RiSendPlane2Fill,
  RiSettings3Line,
  RiSparklingLine,
  RiStopLine,
  RiTerminalLine,
} from '@/lib/icons'

// ─── Shared mock data & layout ────────────────────────────────────────────────

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

function MockAgentTerminal() {
  return (
    <div className="h-full bg-[#09090b] font-mono text-xs text-zinc-300 p-3 overflow-hidden">
      <div className="text-amber-400 mb-1">─────────────────────────────────────────────────</div>
      <div className="text-amber-400 font-bold mb-2">{'  '}Claude Code v2.1.44 · Opus 4.6</div>
      <div className="text-zinc-500 mb-3">{'  '}/Users/example/wanda</div>
      <div className="text-zinc-400 mb-1">
        <span className="text-blue-400">❯</span> Create a new environment profile for Node.js 22
      </div>
      <div className="text-zinc-500 mb-1">
        {'  '}I'll create a Node.js 22 environment profile. Let me check the existing profiles first...
      </div>
      <div className="text-emerald-400/70 text-[10px] mb-1">{'  '}Read electron/db/schema.ts</div>
      <div className="text-emerald-400/70 text-[10px] mb-1">{'  '}Read electron/services/profile.service.ts</div>
      <div className="text-zinc-500 mb-2">{'  '}Creating profile with base image `node:22-slim`...</div>
      <div className="text-emerald-400 mb-1">{'  '}✓ Created profile "Node.js 22" (base type)</div>
      <div className="mt-2">
        <span className="text-blue-400">❯</span> <span className="inline-block w-2 h-3.5 bg-zinc-400 animate-pulse" />
      </div>
    </div>
  )
}

function MacWindow({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-screen flex items-center justify-center bg-zinc-800 p-6">
      <div className="w-full max-w-[1400px] h-[820px] rounded-xl border border-zinc-700 overflow-hidden shadow-2xl">
        {children}
      </div>
    </div>
  )
}

function LayoutShell({ children, overlay }: { children: React.ReactNode; overlay?: React.ReactNode }) {
  const [selected, setSelected] = useState('pod1')

  return (
    <div className="h-full flex flex-col bg-zinc-950 text-zinc-50 relative">
      {/* Header */}
      <header className="h-9 flex items-center border-b border-zinc-800 bg-zinc-950 px-3 shrink-0">
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
        {/* Nav */}
        <nav className="w-12 border-r border-zinc-800 bg-zinc-950 flex flex-col items-center py-2 gap-1 shrink-0">
          <button
            type="button"
            title="Workspace"
            className="flex items-center justify-center size-8 rounded-md text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800/50"
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
              className="flex items-center justify-center size-8 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
            >
              <RiSettings3Line className="size-4" />
            </button>
          </div>
        </nav>

        {/* Sidebar */}
        <aside className="w-60 border-r border-zinc-800 bg-zinc-950 flex flex-col shrink-0">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-800">
            <span className="text-[10px] font-medium text-zinc-500">Projects</span>
            <button
              type="button"
              className="p-1 rounded-md hover:bg-zinc-800 text-zinc-600 hover:text-zinc-300"
              title="New project"
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
        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0 relative">{children}</main>
      </div>

      {/* Overlay layer — for concepts that render over the app */}
      {overlay}
    </div>
  )
}

function MainContent() {
  return (
    <div className="flex flex-col h-full gap-2 p-2">
      <div className="flex items-center gap-3 px-3 py-2 bg-zinc-900/50 rounded-lg border border-zinc-800">
        <div className="flex items-center gap-2 flex-1">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          <span className="text-sm font-medium text-zinc-200">Dev Server</span>
          <span className="text-[10px] text-zinc-500">Running</span>
        </div>
      </div>
      <div
        className="flex-1 min-h-0 grid gap-1"
        style={{
          gridTemplateColumns: 'repeat(2, 1fr)',
          gridTemplateRows: 'repeat(2, 1fr)',
        }}
      >
        {['shell', 'dev server', 'tests'].map((name) => (
          <div key={name} className="min-h-0 rounded-lg overflow-hidden border border-zinc-800">
            <div className="text-[10px] px-2 py-0.5 text-zinc-500 bg-zinc-900 border-b border-zinc-800">{name}</div>
            <MockTerminal name={name} />
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Meta ─────────────────────────────────────────────────────────────────────

const meta = {
  title: 'Agent/UI Concepts',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

// ─── Concept 1: Floating Bubble ──────────────────────────────────────────────
// Bottom-right floating button that expands into a terminal panel.
// Like Intercom/Drift chat widgets. Minimal footprint, always accessible.

export const FloatingBubble: Story = {
  name: '1 · Floating Bubble',
  render: () => {
    const [open, setOpen] = useState(true)
    return (
      <MacWindow>
        <LayoutShell
          overlay={
            <div className="absolute bottom-4 right-4 z-50 flex flex-col items-end gap-3">
              {open && (
                <div className="w-[420px] h-[480px] flex flex-col rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl shadow-black/50 overflow-hidden animate-in slide-in-from-bottom-4 fade-in duration-200">
                  {/* Panel header */}
                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800 bg-zinc-900">
                    <div className="flex items-center gap-2">
                      <div className="size-6 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
                        <RiSparklingLine className="size-3 text-white" />
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-zinc-200">Agent</div>
                        <div className="text-[10px] text-emerald-400 flex items-center gap-1">
                          <span className="size-1.5 rounded-full bg-emerald-400 inline-block" />
                          Connected
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setOpen(false)}
                      className="p-1 rounded-md hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300"
                    >
                      <RiCloseLine className="size-4" />
                    </button>
                  </div>

                  {/* Terminal area */}
                  <div className="flex-1 min-h-0 overflow-hidden">
                    <MockAgentTerminal />
                  </div>

                  {/* Input */}
                  <div className="px-3 py-2.5 border-t border-zinc-800 bg-zinc-900/80">
                    <div className="flex items-center gap-2 bg-zinc-800/60 rounded-lg px-3 py-2 border border-zinc-700/50">
                      <input
                        type="text"
                        placeholder="Ask the agent..."
                        className="flex-1 bg-transparent text-xs text-zinc-200 placeholder:text-zinc-600 outline-none"
                      />
                      <button type="button" className="text-zinc-500 hover:text-amber-400 transition-colors">
                        <RiSendPlane2Fill className="size-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Bubble button */}
              <button
                type="button"
                onClick={() => setOpen(!open)}
                className={`size-12 rounded-full flex items-center justify-center shadow-lg shadow-black/30 transition-all duration-200 ${
                  open
                    ? 'bg-zinc-700 hover:bg-zinc-600 rotate-0'
                    : 'bg-gradient-to-br from-amber-400 to-orange-500 hover:from-amber-300 hover:to-orange-400 scale-100 hover:scale-105'
                }`}
              >
                {open ? (
                  <RiArrowDownSLine className="size-5 text-zinc-300" />
                ) : (
                  <RiSparklingLine className="size-5 text-white" />
                )}
              </button>
            </div>
          }
        >
          <MainContent />
        </LayoutShell>
      </MacWindow>
    )
  },
}

// ─── Concept 2: Bottom Drawer ────────────────────────────────────────────────
// VS Code-style bottom panel that pushes content up. Feels like an
// integrated part of the IDE. Toggle bar always visible at bottom edge.

export const BottomDrawer: Story = {
  name: '2 · Bottom Drawer',
  render: () => {
    const [open, setOpen] = useState(true)
    return (
      <MacWindow>
        <LayoutShell>
          <div className="flex flex-col h-full">
            {/* Main content area */}
            <div className="flex-1 min-h-0">
              <MainContent />
            </div>

            {/* Drawer toggle bar — always visible */}
            <button
              type="button"
              onClick={() => setOpen(!open)}
              className="flex items-center gap-2 px-3 py-1 border-t border-zinc-800 bg-zinc-900/50 hover:bg-zinc-900 transition-colors shrink-0 cursor-pointer"
            >
              <div className="flex items-center gap-1.5">
                <RiRobotLine className="size-3 text-amber-400" />
                <span className="text-[10px] font-medium text-zinc-400">AGENT</span>
                <span className="size-1.5 rounded-full bg-emerald-400" />
              </div>
              <div className="flex-1" />
              {open ? (
                <RiArrowDownSLine className="size-3.5 text-zinc-500" />
              ) : (
                <RiArrowUpSLine className="size-3.5 text-zinc-500" />
              )}
            </button>

            {/* Drawer content */}
            {open && (
              <div className="h-[260px] border-t border-zinc-800 flex flex-col shrink-0">
                {/* Drawer header */}
                <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-900 border-b border-zinc-800">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-medium text-zinc-200">Terminal</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                      <span className="text-zinc-600">·</span>
                      claude — ~/wanda
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="p-1 rounded-md hover:bg-zinc-800 text-zinc-600 hover:text-zinc-300"
                      title="New session"
                    >
                      <RiAddLine className="size-3" />
                    </button>
                    <button
                      type="button"
                      className="p-1 rounded-md hover:bg-zinc-800 text-zinc-600 hover:text-red-400"
                      title="Stop"
                    >
                      <RiStopLine className="size-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setOpen(false)}
                      className="p-1 rounded-md hover:bg-zinc-800 text-zinc-600 hover:text-zinc-300"
                      title="Close"
                    >
                      <RiCloseLine className="size-3" />
                    </button>
                  </div>
                </div>
                {/* Terminal */}
                <div className="flex-1 min-h-0">
                  <MockAgentTerminal />
                </div>
              </div>
            )}
          </div>
        </LayoutShell>
      </MacWindow>
    )
  },
}

// ─── Concept 3: Right Side Panel ─────────────────────────────────────────────
// Slide-in panel from the right edge. Triggered by a nav rail icon.
// Overlays main content with a translucent backdrop.

export const SidePanel: Story = {
  name: '3 · Side Panel',
  render: () => {
    const [open, setOpen] = useState(true)
    return (
      <MacWindow>
        <div className="h-full flex flex-col bg-zinc-950 text-zinc-50 relative">
          {/* Header */}
          <header className="h-9 flex items-center border-b border-zinc-800 bg-zinc-950 px-3 shrink-0">
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
            {/* Nav — with agent icon */}
            <nav className="w-12 border-r border-zinc-800 bg-zinc-950 flex flex-col items-center py-2 gap-1 shrink-0">
              <button
                type="button"
                title="Workspace"
                className="flex items-center justify-center size-8 rounded-md text-zinc-400"
              >
                <RiTerminalLine className="size-4" />
              </button>
              <div className="w-6 my-1 border-b border-zinc-800" />
              {[
                { icon: RiHome5Fill, active: true },
                { icon: RiFlowChart, active: false },
                { icon: RiCalendarScheduleLine, active: false },
                { icon: RiComputerLine, active: false },
              ].map((item, i) => (
                <button
                  key={i}
                  type="button"
                  className={`flex items-center justify-center size-8 rounded-md transition-colors ${
                    item.active ? 'bg-zinc-800 text-zinc-50' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
                  }`}
                >
                  <item.icon className="size-4" />
                </button>
              ))}
              <div className="mt-auto flex flex-col gap-1">
                {/* Agent button in nav */}
                <button
                  type="button"
                  title="Agent"
                  onClick={() => setOpen(!open)}
                  className={`flex items-center justify-center size-8 rounded-md transition-colors relative ${
                    open ? 'bg-amber-500/20 text-amber-400' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
                  }`}
                >
                  <RiRobotLine className="size-4" />
                  <span className="absolute top-1 right-1 size-1.5 rounded-full bg-emerald-400" />
                </button>
                <button
                  type="button"
                  className="flex items-center justify-center size-8 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
                >
                  <RiSettings3Line className="size-4" />
                </button>
              </div>
            </nav>

            {/* Sidebar */}
            <aside className="w-60 border-r border-zinc-800 bg-zinc-950 flex flex-col shrink-0">
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-800">
                <span className="text-[10px] font-medium text-zinc-500">Projects</span>
              </div>
              <div className="flex-1 overflow-y-auto p-1.5">
                <WorkspaceList
                  workspaces={mockWorkspaces}
                  selectedPodId="pod1"
                  expandedWorkspaces={new Set(mockWorkspaces.map((w) => w.id))}
                  onToggleWorkspace={fn()}
                  onSelectPod={fn()}
                  onCreateWorkspace={fn()}
                  onCreatePod={fn()}
                  onReorderWorkspaces={fn()}
                  onReorderPods={fn()}
                />
              </div>
            </aside>

            {/* Main */}
            <main className="flex-1 min-w-0 relative">
              <MainContent />
            </main>

            {/* Side panel — slides in from right */}
            {open && (
              <div className="w-[380px] border-l border-zinc-800 bg-zinc-950 flex flex-col shrink-0">
                <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
                  <div className="flex items-center gap-2">
                    <RiRobotLine className="size-3.5 text-amber-400" />
                    <span className="text-xs font-semibold text-zinc-200">Agent</span>
                    <span className="text-[10px] text-zinc-600">claude — ~/wanda</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button type="button" className="p-1 rounded-md hover:bg-zinc-800 text-zinc-600 hover:text-red-400">
                      <RiStopLine className="size-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setOpen(false)}
                      className="p-1 rounded-md hover:bg-zinc-800 text-zinc-600 hover:text-zinc-300"
                    >
                      <RiCloseLine className="size-3" />
                    </button>
                  </div>
                </div>
                <div className="flex-1 min-h-0">
                  <MockAgentTerminal />
                </div>
              </div>
            )}
          </div>
        </div>
      </MacWindow>
    )
  },
}

// ─── Concept 4: Command Bar ──────────────────────────────────────────────────
// Floating bar anchored to bottom center. Always visible as a slim prompt,
// expands upward to reveal terminal output. Spotlight/Raycast-style.

export const CommandBar: Story = {
  name: '4 · Command Bar',
  render: () => {
    const [expanded, setExpanded] = useState(true)
    return (
      <MacWindow>
        <LayoutShell
          overlay={
            <div
              className="absolute bottom-5 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center"
              style={{ width: 'calc(100% - 340px)', maxWidth: '720px' }}
            >
              {/* Expanded terminal output */}
              {expanded && (
                <div className="w-full h-[320px] mb-0 rounded-t-xl border border-b-0 border-zinc-700/80 bg-zinc-900/95 backdrop-blur-xl overflow-hidden shadow-2xl shadow-black/40">
                  <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-800/60">
                    <div className="flex items-center gap-2">
                      <span className="size-1.5 rounded-full bg-emerald-400" />
                      <span className="text-[10px] text-zinc-500">claude — ~/wanda</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className="p-0.5 rounded-md hover:bg-zinc-800 text-zinc-600 hover:text-red-400"
                      >
                        <RiStopLine className="size-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setExpanded(false)}
                        className="p-0.5 rounded-md hover:bg-zinc-800 text-zinc-600 hover:text-zinc-300"
                      >
                        <RiArrowDownSLine className="size-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 h-[calc(100%-28px)]">
                    <MockAgentTerminal />
                  </div>
                </div>
              )}

              {/* Input bar — always visible */}
              <div
                className={`w-full flex items-center gap-3 bg-zinc-800/90 backdrop-blur-xl border border-zinc-700/80 px-4 py-2.5 shadow-2xl shadow-black/40 ${
                  expanded ? 'rounded-b-xl' : 'rounded-xl'
                }`}
              >
                <div className="size-5 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shrink-0">
                  <RiSparklingLine className="size-2.5 text-white" />
                </div>
                <input
                  type="text"
                  placeholder="Ask agent to manage pods, environments, profiles..."
                  className="flex-1 bg-transparent text-xs text-zinc-200 placeholder:text-zinc-500 outline-none"
                  onClick={() => !expanded && setExpanded(true)}
                />
                <div className="flex items-center gap-2">
                  {!expanded && (
                    <button
                      type="button"
                      onClick={() => setExpanded(true)}
                      className="text-zinc-600 hover:text-zinc-300"
                    >
                      <RiArrowUpSLine className="size-4" />
                    </button>
                  )}
                  <kbd className="text-[9px] text-zinc-600 bg-zinc-900/60 px-1.5 py-0.5 rounded-md border border-zinc-700/50">
                    ⌘J
                  </kbd>
                </div>
              </div>
            </div>
          }
        >
          <MainContent />
        </LayoutShell>
      </MacWindow>
    )
  },
}

// ─── Concept 5: Header Pill + Overlay ────────────────────────────────────────
// Minimal pill in the header bar. Expands into a centered overlay panel.
// Clean, out-of-the-way, contextual.

export const HeaderPill: Story = {
  name: '5 · Header Pill + Overlay',
  render: () => {
    const [open, setOpen] = useState(true)
    return (
      <MacWindow>
        <div className="h-full flex flex-col bg-zinc-950 text-zinc-50 relative">
          {/* Header — with agent pill */}
          <header className="h-9 flex items-center border-b border-zinc-800 bg-zinc-950 px-3 shrink-0">
            <div className="flex items-center gap-2 mr-3">
              <span className="size-3 rounded-full bg-[#FF5F57]" />
              <span className="size-3 rounded-full bg-[#FEBC2E]" />
              <span className="size-3 rounded-full bg-[#28C840]" />
            </div>
            <div className="flex items-center gap-1.5">
              <RiTerminalLine className="h-4 w-4 text-zinc-400" />
              <span className="text-sm font-semibold text-zinc-200 tracking-tight">Wanda</span>
            </div>
            <div className="flex-1" />
            {/* Agent pill */}
            <button
              type="button"
              onClick={() => setOpen(!open)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium transition-all duration-150 ${
                open
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                  : 'bg-zinc-800/80 text-zinc-400 border border-zinc-700/50 hover:bg-zinc-800 hover:text-zinc-300'
              }`}
            >
              <RiRobotLine className="size-3" />
              Agent
              <span className="size-1.5 rounded-full bg-emerald-400" />
            </button>
          </header>

          <div className="flex flex-1 min-h-0">
            {/* Nav */}
            <nav className="w-12 border-r border-zinc-800 bg-zinc-950 flex flex-col items-center py-2 gap-1 shrink-0">
              <button type="button" className="flex items-center justify-center size-8 rounded-md text-zinc-400">
                <RiTerminalLine className="size-4" />
              </button>
              <div className="w-6 my-1 border-b border-zinc-800" />
              {[
                { icon: RiHome5Fill, active: true },
                { icon: RiFlowChart, active: false },
                { icon: RiCalendarScheduleLine, active: false },
                { icon: RiComputerLine, active: false },
              ].map((item, i) => (
                <button
                  key={i}
                  type="button"
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
                  className="flex items-center justify-center size-8 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
                >
                  <RiSettings3Line className="size-4" />
                </button>
              </div>
            </nav>

            {/* Sidebar */}
            <aside className="w-60 border-r border-zinc-800 bg-zinc-950 flex flex-col shrink-0">
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-800">
                <span className="text-[10px] font-medium text-zinc-500">Projects</span>
              </div>
              <div className="flex-1 overflow-y-auto p-1.5">
                <WorkspaceList
                  workspaces={mockWorkspaces}
                  selectedPodId="pod1"
                  expandedWorkspaces={new Set(mockWorkspaces.map((w) => w.id))}
                  onToggleWorkspace={fn()}
                  onSelectPod={fn()}
                  onCreateWorkspace={fn()}
                  onCreatePod={fn()}
                  onReorderWorkspaces={fn()}
                  onReorderPods={fn()}
                />
              </div>
            </aside>

            {/* Main with overlay */}
            <main className="flex-1 min-w-0 relative">
              <MainContent />

              {/* Overlay panel */}
              {open && (
                <>
                  {/* Backdrop */}
                  <div
                    className="absolute inset-0 bg-black/40 backdrop-blur-[2px] z-40"
                    onClick={() => setOpen(false)}
                    onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
                    role="button"
                    tabIndex={-1}
                    aria-label="Close agent"
                  />
                  {/* Panel */}
                  <div className="absolute inset-4 z-50 flex flex-col rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl shadow-black/60 overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800 bg-zinc-900 shrink-0">
                      <div className="flex items-center gap-2">
                        <div className="size-6 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
                          <RiSparklingLine className="size-3 text-white" />
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-zinc-200">Agent Session</div>
                          <div className="text-[10px] text-zinc-500">claude — ~/wanda</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-500 hover:text-red-400"
                        >
                          <RiStopLine className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setOpen(false)}
                          className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300"
                        >
                          <RiCloseLine className="size-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="flex-1 min-h-0">
                      <MockAgentTerminal />
                    </div>
                    <div className="px-3 py-2.5 border-t border-zinc-800 bg-zinc-900/80 shrink-0">
                      <div className="flex items-center gap-2 bg-zinc-800/60 rounded-lg px-3 py-2 border border-zinc-700/50">
                        <input
                          type="text"
                          placeholder="Send a message..."
                          className="flex-1 bg-transparent text-xs text-zinc-200 placeholder:text-zinc-600 outline-none"
                        />
                        <RiSendPlane2Fill className="size-3.5 text-zinc-600" />
                      </div>
                    </div>
                  </div>
                </>
              )}
            </main>
          </div>
        </div>
      </MacWindow>
    )
  },
}
