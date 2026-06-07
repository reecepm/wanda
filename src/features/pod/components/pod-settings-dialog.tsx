import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { PodWorkenvSection } from '@/features/pod/components/pod-workenv-section'
import { AgentCliConfigSection } from '@/features/settings'
import { orpcForPod, orpcUtils, unwrapPodId } from '@/shared/orpc'

type WandaMcpPolicy = 'inherit' | 'include' | 'exclude'

export interface PodSettingsDialogProps {
  podId: string
  runtime: unknown
  containerLifecycle: string
  onClose: () => void
  onSaved: () => void
}

export function PodSettingsDialog({ podId, runtime, containerLifecycle, onClose, onSaved }: PodSettingsDialogProps) {
  const rt = runtime as { type?: string; ssh?: boolean } | null
  const { data: pod } = useQuery(orpcUtils.pod.getById.queryOptions({ input: { id: podId } }))
  const [lifecycle, setLifecycle] = useState(containerLifecycle)
  const [wandaMcpPolicyDraft, setWandaMcpPolicyDraft] = useState<WandaMcpPolicy | null>(null)
  const [sshEnabled, setSshEnabled] = useState(rt?.type === 'docker' ? rt.ssh !== false : true)
  const [saving, setSaving] = useState(false)
  const wandaMcpPolicy = wandaMcpPolicyDraft ?? ((pod?.wandaMcpPolicy ?? 'inherit') as WandaMcpPolicy)

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  async function handleSave() {
    setSaving(true)
    try {
      const existingRt = (rt?.type === 'docker' ? rt : null) as Record<string, unknown> | null
      const sshFlag = sshEnabled ? undefined : false
      const updatedRuntime = existingRt ? { ...existingRt, ssh: sshFlag } : undefined
      type UpdateInput = Parameters<ReturnType<typeof orpcForPod>['pod']['update']>[0]
      await orpcForPod(podId).pod.update({
        id: unwrapPodId(podId),
        runtime: updatedRuntime as UpdateInput['runtime'],
        containerLifecycle: lifecycle as 'inherit' | 'keep-running' | 'stop-on-exit',
        wandaMcpPolicy,
      })
      onSaved()
    } catch (err) {
      console.error('[pod-settings-dialog] pod.update failed', err)
      setSaving(false)
    }
  }

  const lifecycleOptions = [
    { value: 'inherit', label: 'Inherit' },
    { value: 'keep-running', label: 'Keep running' },
    { value: 'stop-on-exit', label: 'Stop on exit' },
  ] as const
  const wandaMcpOptions = [
    { value: 'inherit', label: 'Inherit' },
    { value: 'include', label: 'Include' },
    { value: 'exclude', label: 'Exclude' },
  ] as const

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-7">
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: Escape handled globally */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismiss */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      <div className="relative z-10 flex flex-col w-full max-w-md bg-zinc-900 border border-zinc-700/50 rounded-xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
          <span className="text-xs font-medium text-zinc-200">Pod Settings</span>
          <span className="text-[10px] text-zinc-600">Restart pod to apply port changes</span>
        </div>
        <div className="p-3 space-y-3">
          <PodWorkenvSection workenvId={pod?.workenvId} />

          <div className="flex items-start justify-between gap-6 border-t border-zinc-800 pt-3">
            <div className="min-w-0">
              <div className="text-xs font-medium text-zinc-300">Container lifecycle</div>
              <div className="text-xs text-zinc-500 mt-0.5">Override global setting for this pod.</div>
            </div>
            <div className="flex gap-1 shrink-0">
              {lifecycleOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setLifecycle(opt.value)}
                  className={`px-2 py-0.5 text-[11px] rounded-md transition-colors ${
                    lifecycle === opt.value
                      ? 'bg-zinc-700 text-zinc-200'
                      : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-start justify-between gap-6 border-t border-zinc-800 pt-3">
            <div className="min-w-0">
              <div className="text-xs font-medium text-zinc-300">Wanda MCP</div>
              <div className="text-xs text-zinc-500 mt-0.5">Override workspace/app setting for this pod.</div>
            </div>
            <div className="flex gap-1 shrink-0">
              {wandaMcpOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setWandaMcpPolicyDraft(opt.value)}
                  className={`px-2 py-0.5 text-[11px] rounded-md transition-colors ${
                    wandaMcpPolicy === opt.value
                      ? 'bg-zinc-700 text-zinc-200'
                      : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          {rt?.type === 'docker' && (
            <div className="flex items-start justify-between gap-6 border-t border-zinc-800 pt-3">
              <div className="min-w-0">
                <div className="text-xs font-medium text-zinc-300">SSH access</div>
                <div className="text-xs text-zinc-500 mt-0.5">Enable sshd + SSH config for remote editors.</div>
              </div>
              <div className="flex gap-1 shrink-0">
                {(['On', 'Off'] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setSshEnabled(opt === 'On')}
                    className={`px-2 py-0.5 text-[11px] rounded-md transition-colors ${
                      (opt === 'On') === sshEnabled
                        ? 'bg-zinc-700 text-zinc-200'
                        : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="border-t border-zinc-800 pt-3">
            <div className="text-xs font-medium text-zinc-300 mb-2">CLI Agents</div>
            <div className="flex flex-col gap-6">
              <AgentCliConfigSection scope="pod" scopeId={podId} agentType="claude" />
              <AgentCliConfigSection scope="pod" scopeId={podId} agentType="codex" />
              <AgentCliConfigSection scope="pod" scopeId={podId} agentType="opencode" />
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-3 py-2 border-t border-zinc-800">
          <button
            type="button"
            onClick={onClose}
            className="px-2.5 py-1 text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-2.5 py-1 text-[11px] bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded-md transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
