import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { orpcUtils } from '@/shared/orpc'
import { AGENT_CLI_FLAG_DEFINITIONS, type AgentConfigPayload, type AgentType } from '@/types/schema'

type Scope = 'global' | 'workspace' | 'pod'
/** Tri-state: `null` = inherit (for workspace/pod scopes); booleans are explicit overrides. */
type TriState = boolean | null

interface AgentCliConfigSectionProps {
  scope: Scope
  agentType: AgentType
  /** Required for workspace/pod scopes. */
  scopeId?: string | null
}

const AGENT_LABELS: Record<AgentType, string> = {
  claude: 'Claude',
  codex: 'Codex',
  opencode: 'OpenCode',
}

export function AgentCliConfigSection({ scope, agentType, scopeId = null }: AgentCliConfigSectionProps) {
  const queryClient = useQueryClient()

  const input = { scope, scopeId, agentType }
  const { data, isLoading } = useQuery(orpcUtils.agentConfig.get.queryOptions({ input }))
  const invalidateConfig = () => {
    queryClient.invalidateQueries({ queryKey: orpcUtils.agentConfig.get.key({ input }) })
  }
  const clearConfigMutation = useMutation({
    ...orpcUtils.agentConfig.clear.mutationOptions(),
    onSuccess: invalidateConfig,
  })
  const setConfigMutation = useMutation({
    ...orpcUtils.agentConfig.set.mutationOptions(),
    onSuccess: invalidateConfig,
  })

  const config = (data ?? null) as AgentConfigPayload | null
  const flags = AGENT_CLI_FLAG_DEFINITIONS[agentType]
  const extraArgs = (config?.extraArgs ?? []).join('\n')

  function cleanConfig(next: AgentConfigPayload) {
    const hasFlags = Object.values(next.flags ?? {}).some((value) => value !== undefined)
    const hasExtraArgs = (next.extraArgs ?? []).length > 0
    if (!hasFlags && !hasExtraArgs) {
      clearConfigMutation.mutate(input)
    } else {
      setConfigMutation.mutate({ ...input, config: next })
    }
  }

  function flagValue(flagId: string): TriState {
    const explicit = config?.flags?.[flagId]
    if (typeof explicit === 'boolean') return explicit
    return scope === 'global' ? false : null
  }

  function saveFlag(flagId: string, next: TriState) {
    const nextFlags = { ...(config?.flags ?? {}) }
    if (next === null) {
      delete nextFlags[flagId]
    } else {
      nextFlags[flagId] = next
    }
    cleanConfig({ ...(config ?? {}), flags: nextFlags })
  }

  function saveExtraArgs(value: string) {
    const args = value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    cleanConfig({ ...(config ?? {}), extraArgs: args })
  }

  const isOverride = scope !== 'global'
  const saving = clearConfigMutation.isPending || setConfigMutation.isPending

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h4 className="text-xs font-medium text-zinc-300">{AGENT_LABELS[agentType]}</h4>
      </div>
      {flags.map((flag) => (
        <div key={flag.id} className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <div className="text-xs font-medium text-zinc-300">{flag.label}</div>
            <div className="text-xs text-zinc-500 mt-0.5">
              {flag.description} {flag.dangerous ? <span>Only enable in trusted, sandboxed environments.</span> : null}
            </div>
          </div>
          <div className="shrink-0">
            <TriStateToggle
              value={flagValue(flag.id)}
              allowInherit={isOverride}
              disabled={isLoading || saving}
              onChange={(next) => saveFlag(flag.id, next)}
            />
          </div>
        </div>
      ))}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-zinc-300">Additional launch args</label>
        <textarea
          key={extraArgs}
          defaultValue={extraArgs}
          disabled={isLoading || saving}
          onBlur={(event) => saveExtraArgs(event.currentTarget.value)}
          rows={3}
          placeholder={agentType === 'codex' ? '--enable\ngoals' : '--flag\nvalue'}
          className="resize-none rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-zinc-300 outline-none placeholder:text-zinc-700 focus:border-zinc-600 disabled:opacity-50"
        />
        <div className="text-[11px] text-zinc-500">One argv entry per line. Saved when the field loses focus.</div>
      </div>
      {flags.length === 0 && (
        <div className="text-xs text-zinc-500">
          No built-in flags are defined for {AGENT_LABELS[agentType]}; use additional args for this CLI.
        </div>
      )}
    </div>
  )
}

interface TriStateToggleProps {
  value: TriState
  allowInherit: boolean
  disabled?: boolean
  onChange: (next: TriState) => void
}

function TriStateToggle({ value, allowInherit, disabled, onChange }: TriStateToggleProps) {
  const options: { key: TriState; label: string }[] = [
    ...(allowInherit ? [{ key: null as TriState, label: 'Inherit' }] : []),
    { key: false as TriState, label: 'Off' },
    { key: true as TriState, label: 'On' },
  ]

  return (
    <div className="flex gap-1 rounded-md bg-zinc-900 p-0.5 border border-zinc-800">
      {options.map((opt) => {
        const selected = value === opt.key
        return (
          <button
            key={String(opt.key)}
            type="button"
            disabled={disabled}
            onClick={() => onChange(opt.key)}
            className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
              selected ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
            } disabled:opacity-50`}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
