import { useHotkeyRecorder } from '@tanstack/react-hotkeys'
import { useState } from 'react'
import { EditorIcon } from '@/features/icons'
import type { AgentOption } from '@/features/pod'
import {
  completeAgentMenuOrder,
  completeItemMenuOrder,
  DEFAULT_ITEM_MENU_ORDER,
  ITEM_MENU_LABELS,
  type ItemMenuItemId,
} from '@/features/view'
import { SectionHeader } from '@/layout/section-header'
import {
  RiArrowDownLine,
  RiArrowUpLine,
  RiCloseLine,
  RiEditLine,
  RiEyeLine,
  RiEyeOffLine,
  RiRefreshLine,
  RiResetLeftLine,
  RiTerminalLine,
} from '@/lib/icons'
import { ACCENT_COLORS, type AccentColor, useAppearanceStore } from '@/stores/appearance-store'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { Separator } from '@/ui/separator'
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group'

function FieldRow({
  label,
  description,
  children,
}: {
  label: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-6 py-2.5">
      <div className="min-w-0">
        <div className="text-xs font-medium text-zinc-300">{label}</div>
        {description && <div className="text-xs text-zinc-500 mt-0.5">{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

interface GeneralSectionProps {
  containerLifecycle?: string
  onContainerLifecycleChange?: (value: string) => void
  wandaMcpPolicy?: string
  onWandaMcpPolicyChange?: (value: string) => void
  closeToTray?: boolean
  onCloseToTrayChange?: (value: boolean) => void
  detectedEditors?: { id: string; name: string; iconDataUrl: string | null }[]
  defaultEditor?: string | null
  onDefaultEditorChange?: (value: string) => void
  onRefreshAllWorkspaceIcons?: () => void | Promise<void>
  refreshAllWorkspaceIconsBusy?: boolean
}

export function GeneralSection({
  containerLifecycle,
  onContainerLifecycleChange,
  wandaMcpPolicy,
  onWandaMcpPolicyChange,
  closeToTray,
  onCloseToTrayChange,
  detectedEditors,
  defaultEditor,
  onDefaultEditorChange,
  onRefreshAllWorkspaceIcons,
  refreshAllWorkspaceIconsBusy,
}: GeneralSectionProps) {
  return (
    <div>
      <SectionHeader title="General" description="Core app behavior and defaults." />

      <FieldRow label="Workspace icon" description="Shown in the sidebar and workspace switcher.">
        <button
          type="button"
          className="size-8 rounded-md bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-400 hover:border-zinc-600 transition-colors"
        >
          <RiTerminalLine className="size-4" />
        </button>
      </FieldRow>

      {onRefreshAllWorkspaceIcons && (
        <>
          <Separator />
          <FieldRow
            label="Workspace icons"
            description="Re-detect each workspace's icon from its git remote (e.g. GitHub org/user avatar)."
          >
            <Button
              variant="outline"
              size="sm"
              onClick={() => onRefreshAllWorkspaceIcons()}
              disabled={refreshAllWorkspaceIconsBusy}
            >
              <RiRefreshLine className={`size-3.5 ${refreshAllWorkspaceIconsBusy ? 'animate-spin' : ''}`} />
              {refreshAllWorkspaceIconsBusy ? 'Refreshing…' : 'Refresh all'}
            </Button>
          </FieldRow>
        </>
      )}

      <Separator />

      <FieldRow label="Default shell" description="Used when creating new terminals.">
        <Input className="w-44" defaultValue="/bin/zsh" readOnly />
      </FieldRow>

      <Separator />

      <FieldRow label="Startup behavior" description="What happens when Wanda launches.">
        <ToggleGroup defaultValue={['restore-last']} variant="outline" size="sm">
          <ToggleGroupItem value="restore-last">Restore last</ToggleGroupItem>
          <ToggleGroupItem value="empty">Empty</ToggleGroupItem>
        </ToggleGroup>
      </FieldRow>

      <Separator />

      <FieldRow label="Auto-save" description="Automatically save workspace state on quit.">
        <ToggleGroup defaultValue={['on']} variant="outline" size="sm">
          <ToggleGroupItem value="on">On</ToggleGroupItem>
          <ToggleGroupItem value="off">Off</ToggleGroupItem>
        </ToggleGroup>
      </FieldRow>

      <Separator />

      <FieldRow label="Container lifecycle" description="What happens to Docker containers when Wanda closes.">
        <ToggleGroup
          value={containerLifecycle ? [containerLifecycle] : ['keep-running']}
          onValueChange={(value) => {
            if (value[0]) onContainerLifecycleChange?.(value[0])
          }}
          variant="outline"
          size="sm"
        >
          <ToggleGroupItem value="keep-running">Keep running</ToggleGroupItem>
          <ToggleGroupItem value="stop-on-exit">Stop on exit</ToggleGroupItem>
        </ToggleGroup>
      </FieldRow>

      <Separator />

      <FieldRow label="Wanda MCP" description="Default availability for agent sessions.">
        <ToggleGroup
          value={[wandaMcpPolicy === 'exclude' ? 'exclude' : 'include']}
          onValueChange={(value) => {
            if (value[0]) onWandaMcpPolicyChange?.(value[0])
          }}
          variant="outline"
          size="sm"
        >
          <ToggleGroupItem value="include">Include</ToggleGroupItem>
          <ToggleGroupItem value="exclude">Exclude</ToggleGroupItem>
        </ToggleGroup>
      </FieldRow>

      <Separator />

      <FieldRow
        label="Close to tray"
        description="Hide the window instead of quitting when you close it. Terminals stay alive."
      >
        <ToggleGroup
          value={[closeToTray ? 'on' : 'off']}
          onValueChange={(value) => {
            if (value.length) onCloseToTrayChange?.(value[0] === 'on')
          }}
          variant="outline"
          size="sm"
        >
          <ToggleGroupItem value="on">On</ToggleGroupItem>
          <ToggleGroupItem value="off">Off</ToggleGroupItem>
        </ToggleGroup>
      </FieldRow>

      {detectedEditors && detectedEditors.length > 0 && (
        <>
          <Separator />

          <FieldRow label="Default editor" description="Editor launched when opening a pod in your IDE.">
            <Select
              value={defaultEditor ?? detectedEditors[0]?.id ?? ''}
              onValueChange={(value) => onDefaultEditorChange?.(value as string)}
            >
              <SelectTrigger size="sm" className="w-44 text-xs">
                <SelectValue placeholder="Select editor...">
                  {(value: string | null) => {
                    const editor = detectedEditors.find((e) => e.id === value)
                    if (!editor) return 'Select editor...'
                    return (
                      <span className="flex items-center gap-2">
                        <EditorIcon id={editor.id} iconDataUrl={editor.iconDataUrl} className="size-4.5" />
                        {editor.name}
                      </span>
                    )
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {detectedEditors.map((editor) => (
                  <SelectItem key={editor.id} value={editor.id}>
                    <EditorIcon id={editor.id} iconDataUrl={editor.iconDataUrl} className="size-4.5" />
                    {editor.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldRow>
        </>
      )}
    </div>
  )
}

export function AppearanceSection() {
  const accentColor = useAppearanceStore((s) => s.accentColor)
  const setAccentColor = useAppearanceStore((s) => s.setAccentColor)

  return (
    <div>
      <SectionHeader title="Appearance" description="Visual preferences and theming." />

      <FieldRow label="Focus accent" description="Border color for the focused terminal pane.">
        <div className="flex items-center gap-1.5">
          {(Object.keys(ACCENT_COLORS) as AccentColor[]).map((key) => {
            const isActive = accentColor === key
            return (
              <button
                key={key}
                type="button"
                onClick={() => setAccentColor(key)}
                className={`size-5 rounded-full ${ACCENT_COLORS[key].swatch} transition-all ${
                  isActive
                    ? 'ring-2 ring-offset-2 ring-offset-zinc-900 ring-white scale-110'
                    : 'opacity-60 hover:opacity-100'
                }`}
                title={ACCENT_COLORS[key].label}
              />
            )
          })}
        </div>
      </FieldRow>

      <Separator />

      <FieldRow label="UI font size" description="Base font size for the interface.">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon">
            −
          </Button>
          <span className="text-xs text-zinc-300 w-6 text-center">13</span>
          <Button variant="ghost" size="icon">
            +
          </Button>
        </div>
      </FieldRow>

      <Separator />

      <FieldRow label="Terminal font" description="Font used in terminal panes.">
        <Input className="w-44" defaultValue="JetBrainsMono NFM" readOnly />
      </FieldRow>

      <Separator />

      <FieldRow label="Terminal font size" description="Font size in terminal panes.">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon">
            −
          </Button>
          <span className="text-xs text-zinc-300 w-6 text-center">14</span>
          <Button variant="ghost" size="icon">
            +
          </Button>
        </div>
      </FieldRow>
    </div>
  )
}

interface ItemMenuOrderSectionProps {
  order: ItemMenuItemId[]
  agentOptions: AgentOption[]
  agentOptionOrder: string[]
  hiddenAgentOptions: string[]
  onChange: (order: ItemMenuItemId[]) => void
  onAgentOptionsChange: (order: string[], hidden: string[]) => void
  onReset: () => void
  onAgentOptionsReset: () => void
}

export function ItemMenuOrderSection({
  order,
  agentOptions,
  agentOptionOrder,
  hiddenAgentOptions,
  onChange,
  onAgentOptionsChange,
  onReset,
  onAgentOptionsReset,
}: ItemMenuOrderSectionProps) {
  const completeOrder = completeItemMenuOrder(order)
  const completeAgentOptions = completeAgentMenuOrder(agentOptions, agentOptionOrder)
  const hiddenAgents = new Set(hiddenAgentOptions)

  function move(id: ItemMenuItemId, direction: -1 | 1) {
    const index = completeOrder.indexOf(id)
    const nextIndex = index + direction
    if (index < 0 || nextIndex < 0 || nextIndex >= completeOrder.length) return
    const next = completeOrder.slice()
    const current = next[index]
    const swap = next[nextIndex]
    if (current === undefined || swap === undefined) return
    next[index] = swap
    next[nextIndex] = current
    onChange(next)
  }

  function moveAgent(id: string, direction: -1 | 1) {
    const currentOrder = completeAgentOptions.map((option) => option.id)
    const index = currentOrder.indexOf(id)
    const nextIndex = index + direction
    if (index < 0 || nextIndex < 0 || nextIndex >= currentOrder.length) return
    const next = currentOrder.slice()
    const current = next[index]
    const swap = next[nextIndex]
    if (current === undefined || swap === undefined) return
    next[index] = swap
    next[nextIndex] = current
    onAgentOptionsChange(next, hiddenAgentOptions)
  }

  function toggleAgent(id: string) {
    const currentOrder = completeAgentOptions.map((option) => option.id)
    const nextHidden = hiddenAgents.has(id)
      ? hiddenAgentOptions.filter((hiddenId) => hiddenId !== id)
      : [...hiddenAgentOptions, id]
    onAgentOptionsChange(currentOrder, nextHidden)
  }

  const isDefault = completeOrder.join('|') === DEFAULT_ITEM_MENU_ORDER.join('|')
  const defaultAgentOrder = agentOptions.map((option) => option.id)
  const currentAgentOrder = completeAgentOptions.map((option) => option.id)
  const isAgentDefault = hiddenAgentOptions.length === 0 && currentAgentOrder.join('|') === defaultAgentOrder.join('|')

  return (
    <div>
      <SectionHeader title="Menus" description="Order for the Cmd+T item picker and right-click add menu." />

      <div className="rounded-lg border border-zinc-800 overflow-hidden">
        <div className="grid grid-cols-[1fr_auto] gap-x-4 px-3 py-1.5 bg-zinc-900/50 border-b border-zinc-800">
          <span className="text-[10px] font-medium text-zinc-500">Item type</span>
          <span className="text-[10px] font-medium text-zinc-500">Order</span>
        </div>
        {completeOrder.map((id, index) => (
          <div
            key={id}
            className={`grid grid-cols-[1fr_auto] gap-x-4 items-center px-3 py-1.5 ${
              index < completeOrder.length - 1 ? 'border-b border-zinc-800/50' : ''
            }`}
          >
            <span className="text-xs text-zinc-300">{ITEM_MENU_LABELS[id]}</span>
            <div className="flex gap-0.5">
              <Button variant="ghost" size="icon" onClick={() => move(id, -1)} disabled={index === 0} title="Move up">
                <RiArrowUpLine className="size-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => move(id, 1)}
                disabled={index === completeOrder.length - 1}
                title="Move down"
              >
                <RiArrowDownLine className="size-3" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3">
        <Button variant="outline" size="sm" onClick={onReset} disabled={isDefault}>
          <RiResetLeftLine className="size-3" />
          Reset order
        </Button>
      </div>

      <div className="mt-6">
        <SectionHeader
          title="Agent Options"
          description="Order or hide the choices inside the Agent submenu and Cmd+T agent picker."
        />

        <div className="rounded-lg border border-zinc-800 overflow-hidden">
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-3 py-1.5 bg-zinc-900/50 border-b border-zinc-800">
            <span className="text-[10px] font-medium text-zinc-500">Agent</span>
            <span className="text-[10px] font-medium text-zinc-500">Visible</span>
            <span className="text-[10px] font-medium text-zinc-500">Order</span>
          </div>
          {completeAgentOptions.map((option, index) => {
            const isHidden = hiddenAgents.has(option.id)
            return (
              <div
                key={option.id}
                className={`grid grid-cols-[1fr_auto_auto] gap-x-4 items-center px-3 py-1.5 ${
                  index < completeAgentOptions.length - 1 ? 'border-b border-zinc-800/50' : ''
                }`}
              >
                <div className="min-w-0">
                  <span className={`text-xs ${isHidden ? 'text-zinc-600' : 'text-zinc-300'}`}>{option.label}</span>
                  <span className="ml-2 text-[10px] text-zinc-600">{option.kind === 'cli' ? 'CLI' : 'Chat'}</span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => toggleAgent(option.id)}
                  title={isHidden ? 'Show' : 'Hide'}
                >
                  {isHidden ? <RiEyeOffLine className="size-3" /> : <RiEyeLine className="size-3" />}
                </Button>
                <div className="flex gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => moveAgent(option.id, -1)}
                    disabled={index === 0}
                    title="Move up"
                  >
                    <RiArrowUpLine className="size-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => moveAgent(option.id, 1)}
                    disabled={index === completeAgentOptions.length - 1}
                    title="Move down"
                  >
                    <RiArrowDownLine className="size-3" />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>

        <div className="mt-3">
          <Button variant="outline" size="sm" onClick={onAgentOptionsReset} disabled={isAgentDefault}>
            <RiResetLeftLine className="size-3" />
            Reset agents
          </Button>
        </div>
      </div>
    </div>
  )
}

export interface ShortcutItem {
  action: string
  label: string
  binding: string
  isOverridden: boolean
}

interface ShortcutsSectionProps {
  shortcuts: ShortcutItem[]
  onRecord: (action: string, binding: string) => void
  onReset: (action: string) => void
}

export function ShortcutsSection({ shortcuts, onRecord, onReset }: ShortcutsSectionProps) {
  const [recordingAction, setRecordingAction] = useState<string | null>(null)

  const recorder = useHotkeyRecorder({
    onRecord: (hotkey) => {
      if (recordingAction) {
        onRecord(recordingAction, hotkey)
        setRecordingAction(null)
      }
    },
    onCancel: () => {
      setRecordingAction(null)
    },
  })

  function startRecording(action: string) {
    setRecordingAction(action)
    recorder.startRecording()
  }

  function cancelRecording() {
    recorder.cancelRecording()
    setRecordingAction(null)
  }

  return (
    <div>
      <SectionHeader
        title="Shortcuts"
        description="Keyboard shortcuts for common actions. Click edit to record a new binding."
      />

      <div className="rounded-lg border border-zinc-800 overflow-hidden">
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-3 py-1.5 bg-zinc-900/50 border-b border-zinc-800">
          <span className="text-[10px] font-medium text-zinc-500">Action</span>
          <span className="text-[10px] font-medium text-zinc-500">Keybinding</span>
          <span />
        </div>
        {shortcuts.map((shortcut, i) => {
          const isRecording = recordingAction === shortcut.action
          return (
            <div
              key={shortcut.action}
              className={`grid grid-cols-[1fr_auto_auto] gap-x-4 items-center px-3 py-1.5 ${
                i < shortcuts.length - 1 ? 'border-b border-zinc-800/50' : ''
              } ${isRecording ? 'bg-zinc-800/50' : ''}`}
            >
              <span className="text-xs text-zinc-300">{shortcut.label}</span>
              {isRecording ? (
                <Badge variant="outline" className="font-mono animate-pulse border-amber-500/50 text-amber-400">
                  {recorder.recordedHotkey ?? 'Press keys…'}
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className={`font-mono ${shortcut.isOverridden ? 'border-blue-500/50 text-blue-300' : ''}`}
                >
                  {shortcut.binding}
                </Badge>
              )}
              <div className="flex gap-0.5">
                {isRecording ? (
                  <Button variant="ghost" size="icon" onClick={cancelRecording} title="Cancel">
                    <RiCloseLine className="size-3" />
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => startRecording(shortcut.action)}
                      title="Record new binding"
                    >
                      <RiEditLine className="size-3" />
                    </Button>
                    {shortcut.isOverridden && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onReset(shortcut.action)}
                        title="Reset to default"
                      >
                        <RiResetLeftLine className="size-3" />
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

interface AgentSectionProps {
  command: string
  onChange: (value: string) => void
  onSave: () => void
}

export function AgentSection({ command, onChange, onSave }: AgentSectionProps) {
  return (
    <div>
      <SectionHeader title="Agent" description="Configure the AI agent launched by ⌘K." />

      <FieldRow label="Agent command" description="CLI command to launch (e.g. codex app-server)">
        <Input
          className="w-56"
          value={command}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onSave}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSave()
          }}
          placeholder="claude"
        />
      </FieldRow>
    </div>
  )
}
