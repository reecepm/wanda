import { useMemo, useRef, useState } from 'react'
import { RiCloseLine } from '@/lib/icons'
import type { WorkenvConfig, WorkenvLayer, WorkenvRuntime } from '@/types/schema'
import { Button } from '@/ui/button'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/ui/drawer'
import { Input } from '@/ui/input'
import { useWorkenvActions } from '../hooks/use-workenv-actions'
import { LayerEditor } from './layer-editor'

// Fields classified the same way the server classifier works. Kept here
// so the dialog can preview impact without round-tripping to the server
// on every keystroke.
const RECREATE_KEYS = new Set<keyof WorkenvConfig>([
  'runtime',
  'worktreePath',
  'resources',
  'mounts',
  'base',
  'extends',
])
const RESTART_KEYS = new Set<keyof WorkenvConfig>([
  'env',
  'bootstrap',
  'ports',
  'workdir',
  'healthcheck',
  'requires',
  'layers',
  'postStart',
])
const PREBUILD_KEYS = new Set<keyof WorkenvConfig>(['prebuild'])

type Impact = 'live' | 'restart' | 'recreate'

export function WorkenvEditDialog({
  workenvId,
  initialName,
  initialConfig,
  open,
  onOpenChange,
}: {
  workenvId: string
  initialName: string
  initialConfig: WorkenvConfig
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Drawer direction="right" open={open} onOpenChange={onOpenChange}>
      {open && (
        <WorkenvEditDialogContent
          key={workenvId}
          workenvId={workenvId}
          initialName={initialName}
          initialConfig={initialConfig}
          onOpenChange={onOpenChange}
        />
      )}
    </Drawer>
  )
}

function WorkenvEditDialogContent({
  workenvId,
  initialName,
  initialConfig,
  onOpenChange,
}: {
  workenvId: string
  initialName: string
  initialConfig: WorkenvConfig
  onOpenChange: (open: boolean) => void
}) {
  const { update } = useWorkenvActions()
  const portalRef = useRef<HTMLDivElement>(null)

  const initialConfigText = useMemo(() => JSON.stringify(initialConfig, null, 2), [initialConfig])
  const [name, setName] = useState(initialName)
  const [layers, setLayers] = useState<WorkenvLayer[]>(initialConfig.layers ?? [])
  const [configTextDraft, setConfigTextDraft] = useState(initialConfigText)
  const [advanced, setAdvanced] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<Impact | null>(null)

  const structuredConfigText = useMemo(() => {
    return JSON.stringify({ ...initialConfig, layers }, null, 2)
  }, [layers, initialConfig])
  const effectiveConfigText = advanced ? configTextDraft : structuredConfigText

  const parsedConfig = useMemo(() => {
    try {
      return { ok: true, config: JSON.parse(effectiveConfigText) as WorkenvConfig, error: null }
    } catch (err) {
      return { ok: false, config: null, error: err instanceof Error ? err.message : 'invalid JSON' }
    }
  }, [effectiveConfigText])

  const impactPreview: Impact = useMemo(() => {
    if (!parsedConfig.ok || !parsedConfig.config) return 'live'
    const next = parsedConfig.config
    let impact: Impact = 'live'
    const seen = new Set<string>([...Object.keys(initialConfig), ...Object.keys(next)])
    for (const k of seen as Set<keyof WorkenvConfig>) {
      if (JSON.stringify(initialConfig[k]) === JSON.stringify(next[k])) continue
      if (RECREATE_KEYS.has(k)) return 'recreate'
      if (PREBUILD_KEYS.has(k)) return 'recreate'
      if (RESTART_KEYS.has(k)) impact = 'restart'
    }
    return impact
  }, [parsedConfig, initialConfig])

  const dirty = name !== initialName || effectiveConfigText !== initialConfigText
  const canSubmit = dirty && parsedConfig.ok && !update.isPending

  async function handleSave() {
    setError(null)
    if (!parsedConfig.ok || !parsedConfig.config) {
      setError(parsedConfig.error)
      return
    }
    try {
      const res = await update.mutateAsync({
        id: workenvId,
        name: name !== initialName ? name : undefined,
        config: effectiveConfigText !== initialConfigText ? parsedConfig.config : undefined,
      })
      setSaved(res.report.impact)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <DrawerContent className="h-full w-[640px] sm:max-w-[640px]">
      <div ref={portalRef} className="absolute" />
      <DrawerHeader className="flex flex-row items-center justify-between gap-2 px-3 py-2 border-b border-zinc-800">
        <div className="min-w-0">
          <DrawerTitle className="text-xs font-medium text-zinc-200 truncate">Edit environment</DrawerTitle>
          <DrawerDescription className="text-[10px] text-zinc-500">
            Live updates apply now. Some changes need restart or recreate.
          </DrawerDescription>
        </div>
        <DrawerClose aria-label="Close" className="p-1 text-zinc-500 hover:text-zinc-300 shrink-0">
          <RiCloseLine className="size-4" />
        </DrawerClose>
      </DrawerHeader>

      <div className="flex flex-col gap-4 p-3 overflow-y-auto flex-1">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-zinc-500">Name</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </label>

        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wide text-zinc-500">Layers</span>
            <ImpactBadge impact={impactPreview} dirty={dirty && effectiveConfigText !== initialConfigText} />
          </div>
          <LayerEditor value={layers} onChange={setLayers} portalContainer={portalRef} />
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                if (!advanced) setConfigTextDraft(structuredConfigText)
                setAdvanced(!advanced)
              }}
              className="text-[10px] uppercase tracking-wide text-zinc-500 hover:text-zinc-300"
            >
              {advanced ? '▾ Advanced (JSON)' : '▸ Advanced (JSON)'}
            </button>
            {advanced && <span className="text-[10px] text-amber-400">Edits here override the layer editor.</span>}
          </div>
          {advanced && (
            <>
              <textarea
                value={configTextDraft}
                onChange={(e) => setConfigTextDraft(e.target.value)}
                spellCheck={false}
                className="min-h-[240px] w-full rounded-md border border-zinc-800 bg-zinc-950 p-2 font-mono text-[11px] text-zinc-200 focus:outline-none focus:border-zinc-600"
              />
              {!parsedConfig.ok && <span className="text-[10px] text-red-400">JSON: {parsedConfig.error}</span>}
            </>
          )}
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}
        {saved && <SavedNotice impact={saved} runtime={initialConfig.runtime} />}
      </div>

      <DrawerFooter className="flex-row justify-end gap-2 border-t border-zinc-800 px-3 py-2">
        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={update.isPending}>
          Close
        </Button>
        <Button onClick={handleSave} disabled={!canSubmit}>
          {update.isPending ? 'Saving…' : 'Save'}
        </Button>
      </DrawerFooter>
    </DrawerContent>
  )
}

function ImpactBadge({ impact, dirty }: { impact: Impact; dirty: boolean }) {
  if (!dirty) return null
  const label = impact === 'recreate' ? 'Recreate required' : impact === 'restart' ? 'Restart required' : 'Live update'
  const color =
    impact === 'recreate'
      ? 'border-red-900/60 text-red-300 bg-red-950/30'
      : impact === 'restart'
        ? 'border-amber-900/60 text-amber-300 bg-amber-950/30'
        : 'border-emerald-900/60 text-emerald-300 bg-emerald-950/30'
  return <span className={`rounded border px-1.5 py-0.5 text-[10px] ${color}`}>{label}</span>
}

function SavedNotice({ impact, runtime }: { impact: Impact; runtime: WorkenvRuntime }) {
  if (impact === 'live') {
    return <p className="text-xs text-emerald-400">Saved — no VM action needed.</p>
  }
  if (impact === 'restart') {
    return <p className="text-xs text-amber-300">Saved. Restart the environment to apply the changes ({runtime}).</p>
  }
  return (
    <p className="text-xs text-red-300">
      Saved. These changes require a full recreate (destroy + create) to take effect on the {runtime} VM.
    </p>
  )
}
