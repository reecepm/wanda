import { formatForDisplay } from '@tanstack/hotkeys'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { TemplatesScreen } from '@/features/pod/components/templates-screen'
import { buildSessionAgentOptions, CLI_AGENT_OPTIONS } from '@/features/pod/utils/agent-options'
import { MachinesScreen } from '@/features/servers/components/machines-screen'
import { DEFAULT_SHORTCUTS } from '@/features/shortcuts/shortcuts'
import {
  AGENT_MENU_CONFIG_SETTING_KEY,
  DEFAULT_ITEM_MENU_ORDER,
  ITEM_MENU_ORDER_SETTING_KEY,
  type ItemMenuItemId,
  parseAgentMenuConfig,
  parseItemMenuOrder,
  serializeAgentMenuConfig,
  serializeItemMenuOrder,
} from '@/features/view/utils/item-menu-order'
import { WorkenvTemplatesScreen } from '@/features/workenv'
import {
  type RemixiconComponentType,
  RiBox3Line,
  RiGitBranchLine,
  RiGroupLine,
  RiKeyboardBoxLine,
  RiLayoutGridLine,
  RiMenu2Line,
  RiPaletteLine,
  RiServerLine,
  RiSettings3Line,
  RiSparklingLine,
} from '@/lib/icons'
import { orpcUtils } from '@/shared/orpc'
import { cn } from '@/shared/utils'
import { useShortcutStore } from '@/stores/shortcut-store'
import { AgentCliConfigSection } from './claude-config-section'
import { GitSection } from './git-section'
import {
  AgentSection,
  AppearanceSection,
  GeneralSection,
  ItemMenuOrderSection,
  ShortcutsSection,
} from './settings-content'
import { TaskPeersSection } from './task-peers-section'

const WANDA_MCP_POLICY_SETTING_KEY = 'agents.wandaMcp.policy'

interface SectionDef {
  id: string
  label: string
  icon: RemixiconComponentType
  /** When true the section renders its own full-bleed content (own header
   *  + scroll), so SettingsScreen skips its content padding. */
  fullBleed?: boolean
}

const SECTIONS = [
  { id: 'general', label: 'General', icon: RiSettings3Line },
  { id: 'templates', label: 'Templates', icon: RiLayoutGridLine, fullBleed: true },
  { id: 'envs', label: 'Environments', icon: RiBox3Line, fullBleed: true },
  { id: 'machines', label: 'Machines', icon: RiServerLine, fullBleed: true },
  { id: 'appearance', label: 'Appearance', icon: RiPaletteLine },
  { id: 'menus', label: 'Menus', icon: RiMenu2Line },
  { id: 'shortcuts', label: 'Shortcuts', icon: RiKeyboardBoxLine },
  { id: 'git', label: 'Git', icon: RiGitBranchLine },
  { id: 'agent', label: 'Agent', icon: RiSparklingLine },
  { id: 'task-peers', label: 'Task Peers', icon: RiGroupLine },
] as const satisfies readonly SectionDef[]

type SectionId = (typeof SECTIONS)[number]['id']

function ConnectedGeneral() {
  const queryClient = useQueryClient()
  const setSettingMutation = useMutation({
    ...orpcUtils.settings.set.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpcUtils.settings.getMany.key() })
    },
  })
  const { data: settings } = useQuery(
    orpcUtils.settings.getMany.queryOptions({
      input: { keys: ['container.lifecycle', 'app.closeToTray', 'editor.default', WANDA_MCP_POLICY_SETTING_KEY] },
    }),
  )
  const { data: detectedEditors = [] } = useQuery({
    ...orpcUtils.pod.detectEditors.queryOptions({}),
    staleTime: 60_000,
  })

  const containerLifecycle = settings?.['container.lifecycle'] ?? 'keep-running'
  const wandaMcpPolicy = settings?.[WANDA_MCP_POLICY_SETTING_KEY] ?? 'include'
  const closeToTray = settings?.['app.closeToTray'] === 'true'
  const defaultEditor = settings?.['editor.default'] ?? null

  function handleLifecycleChange(value: string) {
    setSettingMutation.mutate({ key: 'container.lifecycle', value })
  }

  function handleCloseToTrayChange(value: boolean) {
    setSettingMutation.mutate({ key: 'app.closeToTray', value: value ? 'true' : 'false' })
  }

  function handleWandaMcpPolicyChange(value: string) {
    setSettingMutation.mutate({ key: WANDA_MCP_POLICY_SETTING_KEY, value })
  }

  function handleDefaultEditorChange(value: string) {
    setSettingMutation.mutate(
      { key: 'editor.default', value },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: orpcUtils.settings.get.key() })
        },
      },
    )
  }

  const refreshIconsMutation = useMutation({
    ...orpcUtils.workspace.refreshAllIcons.mutationOptions(),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: orpcUtils.workspace.list.key() })
      const updated = (result as { updated?: number } | null | undefined)?.updated ?? 0
      toast.success(updated > 0 ? `Refreshed ${updated} workspace icon${updated === 1 ? '' : 's'}` : 'Icons up to date')
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to refresh icons')
    },
  })

  return (
    <GeneralSection
      containerLifecycle={containerLifecycle}
      onContainerLifecycleChange={handleLifecycleChange}
      wandaMcpPolicy={wandaMcpPolicy}
      onWandaMcpPolicyChange={handleWandaMcpPolicyChange}
      closeToTray={closeToTray}
      onCloseToTrayChange={handleCloseToTrayChange}
      detectedEditors={detectedEditors}
      defaultEditor={defaultEditor}
      onDefaultEditorChange={handleDefaultEditorChange}
      onRefreshAllWorkspaceIcons={() => refreshIconsMutation.mutate({})}
      refreshAllWorkspaceIconsBusy={refreshIconsMutation.isPending}
    />
  )
}

function ConnectedShortcuts() {
  const overrides = useShortcutStore((state) => state.overrides)
  const setOverride = useShortcutStore((state) => state.setOverride)
  const removeOverride = useShortcutStore((state) => state.removeOverride)

  const shortcuts = DEFAULT_SHORTCUTS.map((definition) => ({
    action: definition.action,
    label: definition.label,
    binding: formatForDisplay(overrides[definition.action] ?? definition.defaultBinding),
    isOverridden: definition.action in overrides,
  }))

  return (
    <ShortcutsSection
      shortcuts={shortcuts}
      onRecord={(action, binding) => setOverride(action, binding)}
      onReset={(action) => removeOverride(action)}
    />
  )
}

function ConnectedMenus() {
  const queryClient = useQueryClient()
  const setSettingMutation = useMutation({
    ...orpcUtils.settings.set.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpcUtils.settings.get.key() })
    },
  })
  const { data: savedOrder } = useQuery(
    orpcUtils.settings.get.queryOptions({ input: { key: ITEM_MENU_ORDER_SETTING_KEY } }),
  )
  const { data: savedAgentConfig } = useQuery(
    orpcUtils.settings.get.queryOptions({ input: { key: AGENT_MENU_CONFIG_SETTING_KEY } }),
  )
  const providerManifests = useQuery({
    ...orpcUtils.agent.providers.list.queryOptions(),
    staleTime: 30_000,
  })
  const installedProviders = useQuery({
    ...orpcUtils.agent.providers.installed.queryOptions(),
    staleTime: 30_000,
  })
  const order = parseItemMenuOrder(savedOrder)
  const agentConfig = parseAgentMenuConfig(savedAgentConfig)
  const agentOptions = [
    ...buildSessionAgentOptions({
      providers: providerManifests.data,
      installed: installedProviders.data,
    }),
    ...CLI_AGENT_OPTIONS,
  ]

  function saveOrder(next: ItemMenuItemId[]) {
    setSettingMutation.mutate({ key: ITEM_MENU_ORDER_SETTING_KEY, value: serializeItemMenuOrder(next) })
  }

  function resetOrder() {
    setSettingMutation.mutate({
      key: ITEM_MENU_ORDER_SETTING_KEY,
      value: serializeItemMenuOrder(DEFAULT_ITEM_MENU_ORDER),
    })
  }

  function saveAgentOptions(nextOrder: string[], nextHidden: string[]) {
    setSettingMutation.mutate({
      key: AGENT_MENU_CONFIG_SETTING_KEY,
      value: serializeAgentMenuConfig({ order: nextOrder, hidden: nextHidden }),
    })
  }

  function resetAgentOptions() {
    setSettingMutation.mutate({ key: AGENT_MENU_CONFIG_SETTING_KEY, value: null })
  }

  return (
    <ItemMenuOrderSection
      order={order}
      agentOptions={agentOptions}
      agentOptionOrder={agentConfig.order}
      hiddenAgentOptions={agentConfig.hidden}
      onChange={saveOrder}
      onAgentOptionsChange={saveAgentOptions}
      onReset={resetOrder}
      onAgentOptionsReset={resetAgentOptions}
    />
  )
}

function ConnectedAgent() {
  const { data: savedCommand } = useQuery(orpcUtils.settings.get.queryOptions({ input: { key: 'agent.command' } }))
  const queryClient = useQueryClient()
  const setSettingMutation = useMutation({
    ...orpcUtils.settings.set.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpcUtils.settings.get.key() })
    },
  })

  function handleSave(command: string) {
    const trimmed = command.trim()
    setSettingMutation.mutate({ key: 'agent.command', value: trimmed || null })
  }

  return <ConnectedAgentForm key={savedCommand ?? ''} initialCommand={savedCommand ?? ''} onSave={handleSave} />
}

function ConnectedAgentForm({ initialCommand, onSave }: { initialCommand: string; onSave: (command: string) => void }) {
  const [command, setCommand] = useState(initialCommand)

  return (
    <div className="flex flex-col gap-6">
      <AgentSection command={command} onChange={setCommand} onSave={() => onSave(command)} />
      <div className="border-zinc-800 border-t pt-5">
        <div className="mb-3">
          <h3 className="font-semibold text-sm text-zinc-200">CLI agents</h3>
          <p className="mt-0.5 text-xs text-zinc-500">
            Default launch behaviour for terminal agents. Workspaces and pods can override these.
          </p>
        </div>
        <div className="flex flex-col gap-6">
          <AgentCliConfigSection scope="global" agentType="claude" />
          <AgentCliConfigSection scope="global" agentType="codex" />
          <AgentCliConfigSection scope="global" agentType="opencode" />
        </div>
      </div>
    </div>
  )
}

function SettingsNav({ active, onChange }: { active: SectionId; onChange: (id: SectionId) => void }) {
  return (
    <div role="tablist" aria-label="Settings sections" className="w-44 shrink-0 flex flex-col gap-0.5 px-2 pt-4 pb-3">
      {SECTIONS.map((section) => {
        const Icon = section.icon
        const isActive = active === section.id
        return (
          <button
            key={section.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(section.id)}
            className={cn(
              'flex items-center gap-2 px-2 py-1.5 rounded-md text-[12px] transition-colors text-left',
              isActive
                ? 'bg-white/[0.07] text-zinc-100 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.03]',
            )}
          >
            <Icon className={cn('size-4 shrink-0', isActive ? 'text-zinc-200' : 'text-zinc-500')} />
            <span className="font-medium leading-none">{section.label}</span>
          </button>
        )
      })}
    </div>
  )
}

export function SettingsScreen() {
  const [active, setActive] = useState<SectionId>('general')
  const activeSection = SECTIONS.find((s) => s.id === active)!
  const isFullBleed = 'fullBleed' in activeSection && activeSection.fullBleed

  return (
    <div className="flex h-full">
      <SettingsNav active={active} onChange={setActive} />
      <div className="flex-1 min-w-0 flex flex-col">
        {isFullBleed ? (
          <SettingsFullBleed sectionId={active} />
        ) : (
          <div role="tabpanel" aria-label={`${activeSection.label} settings`} className="flex-1 overflow-y-auto p-6">
            {active === 'general' && <ConnectedGeneral />}
            {active === 'appearance' && <AppearanceSection />}
            {active === 'menus' && <ConnectedMenus />}
            {active === 'shortcuts' && <ConnectedShortcuts />}
            {active === 'git' && <GitSection />}
            {active === 'agent' && <ConnectedAgent />}
            {active === 'task-peers' && <TaskPeersSection />}
          </div>
        )}
      </div>
    </div>
  )
}

function SettingsFullBleed({ sectionId }: { sectionId: SectionId }) {
  if (sectionId === 'templates') return <TemplatesScreen />
  if (sectionId === 'envs') return <WorkenvTemplatesScreen />
  if (sectionId === 'machines') return <MachinesScreen />
  return null
}
