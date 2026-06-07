// LayerEditor — structured editor for `WorkenvConfig.layers[]`.
//
// "Add layer" anchors a dropdown menu with one submenu per kind, fed by
// `workenv.listBuiltinLayers`. No nested dialogs. The custom-layer
// authoring form lives inline below the list as a collapsible section.

import { useQuery } from '@tanstack/react-query'
import { type RefObject, useMemo, useRef, useState } from 'react'
import { RiAddLine, RiArrowDownSLine, RiArrowUpSLine, RiCloseLine, RiPencilLine } from '@/lib/icons'
import { orpcUtils } from '@/shared/orpc'
import { cn } from '@/shared/utils'
import type { WorkenvLayer, WorkenvLayerKind } from '@/types/schema'
import { Button } from '@/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import { Input } from '@/ui/input'

const KIND_ORDER: WorkenvLayerKind[] = ['base', 'pkg', 'tool', 'auth', 'service', 'shell']

const KIND_LABELS: Record<WorkenvLayerKind, string> = {
  base: 'Base',
  pkg: 'Packages',
  tool: 'Tools',
  auth: 'Auth',
  service: 'Services',
  shell: 'Shell',
}

const KIND_COLORS: Record<WorkenvLayerKind, string> = {
  base: 'border-indigo-900/60 bg-indigo-950/40 text-indigo-200',
  pkg: 'border-zinc-800 bg-zinc-900/40 text-zinc-200',
  tool: 'border-emerald-900/60 bg-emerald-950/40 text-emerald-200',
  auth: 'border-amber-900/60 bg-amber-950/40 text-amber-200',
  service: 'border-sky-900/60 bg-sky-950/40 text-sky-200',
  shell: 'border-zinc-700 bg-zinc-900/60 text-zinc-300',
}

export function LayerEditor({
  value,
  onChange,
  portalContainer,
}: {
  value: readonly WorkenvLayer[]
  onChange: (next: WorkenvLayer[]) => void
  /**
   * Stable, out-of-flow element to portal the layer-picker dropdown into.
   * Required when LayerEditor renders inside a vaul Drawer, otherwise vaul's
   * body pointer-events lock + the drawer's transform ancestor cause click
   * pass-through and rapid hover/repaint flicker. Pass a ref to a div placed
   * at the root of DrawerContent.
   */
  portalContainer?: RefObject<HTMLDivElement | null>
}) {
  const [customOpen, setCustomOpen] = useState(false)
  const fallbackRef = useRef<HTMLDivElement>(null)
  const containerRef = portalContainer ?? fallbackRef
  const { data: catalog } = useQuery(orpcUtils.workenv.listBuiltinLayers.queryOptions())

  const grouped = useMemo(() => {
    const out: Record<WorkenvLayerKind, { description: string; layer: WorkenvLayer }[]> = {
      base: [],
      pkg: [],
      tool: [],
      auth: [],
      service: [],
      shell: [],
    }
    for (const e of catalog ?? []) {
      out[e.layer.kind].push({ description: e.description, layer: e.layer })
    }
    return out
  }, [catalog])

  const existingIds = useMemo(() => new Set(value.map((l) => l.id)), [value])

  function move(fromIdx: number, dir: -1 | 1) {
    const toIdx = fromIdx + dir
    if (toIdx < 0 || toIdx >= value.length) return
    const next = [...value]
    const [item] = next.splice(fromIdx, 1)
    if (!item) return
    next.splice(toIdx, 0, item)
    onChange(next)
  }

  function remove(idx: number) {
    onChange(value.filter((_, i) => i !== idx))
  }

  function add(layer: WorkenvLayer) {
    onChange([...value, layer])
  }

  function toggle(layer: WorkenvLayer) {
    const idx = value.findIndex((l) => l.id === layer.id)
    if (idx >= 0) {
      onChange(value.filter((_, i) => i !== idx))
    } else {
      onChange([...value, layer])
    }
  }

  function updateAt(idx: number, patch: Partial<WorkenvLayer>) {
    onChange(value.map((l, i) => (i === idx ? ({ ...l, ...patch } as WorkenvLayer) : l)))
  }

  return (
    <div className="flex flex-col gap-2" ref={portalContainer ? undefined : fallbackRef}>
      {value.length === 0 ? (
        <p className="text-xs text-zinc-500 italic px-2 py-3 border border-dashed border-zinc-800 rounded">
          No layers yet. Add a base + the tools you need below.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {value.map((layer, idx) => (
            <li key={`${layer.id}-${idx}`}>
              <LayerRow
                layer={layer}
                onMoveUp={idx > 0 ? () => move(idx, -1) : undefined}
                onMoveDown={idx < value.length - 1 ? () => move(idx, 1) : undefined}
                onRemove={() => remove(idx)}
                onUpdate={(patch) => updateAt(idx, patch)}
              />
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" size="xs" />}>
            <RiAddLine className="size-3.5" />
            Add layer
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="bottom" container={containerRef} className="w-auto min-w-56">
            {KIND_ORDER.map((k) => {
              const items = grouped[k]
              return (
                <DropdownMenuSub key={k}>
                  <DropdownMenuSubTrigger>
                    <span
                      className={cn(
                        'inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wide',
                        KIND_COLORS[k],
                      )}
                    >
                      {k}
                    </span>
                    <span className="text-xs">{KIND_LABELS[k]}</span>
                    <span className="text-[10px] text-zinc-500 ml-1">{items.length}</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent
                    container={containerRef}
                    className="w-auto min-w-72 max-w-96 max-h-[380px] overflow-y-auto"
                  >
                    {items.length === 0 ? (
                      <div className="px-2 py-1.5 text-[10px] italic text-zinc-500">
                        No built-in {KIND_LABELS[k]} layers yet
                      </div>
                    ) : (
                      items.map((entry) => {
                        const checked = existingIds.has(entry.layer.id)
                        return (
                          <DropdownMenuCheckboxItem
                            key={entry.layer.id}
                            checked={checked}
                            onCheckedChange={() => toggle(entry.layer)}
                            className="flex flex-col items-start gap-0.5 py-1.5 pr-8 pl-2"
                          >
                            <div className="flex items-center gap-2 w-full">
                              <span className="text-xs text-zinc-100 truncate">{layerDisplayName(entry.layer)}</span>
                              <code className="text-[10px] text-zinc-500 font-mono ml-auto">{entry.layer.id}</code>
                            </div>
                            <span className="text-[10px] text-zinc-500 line-clamp-2">{entry.description}</span>
                          </DropdownMenuCheckboxItem>
                        )
                      })
                    )}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )
            })}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setCustomOpen(true)}>
              <RiPencilLine className="size-3.5" />
              <span className="text-xs">Author custom layer…</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {customOpen && (
          <button
            type="button"
            onClick={() => setCustomOpen(false)}
            className="text-[10px] text-zinc-500 hover:text-zinc-300"
          >
            Hide custom form
          </button>
        )}
      </div>

      {customOpen && (
        <CustomLayerForm
          onSave={(layer) => {
            add(layer)
            setCustomOpen(false)
          }}
          onCancel={() => setCustomOpen(false)}
        />
      )}
    </div>
  )
}

function LayerRow({
  layer,
  onMoveUp,
  onMoveDown,
  onRemove,
  onUpdate,
}: {
  layer: WorkenvLayer
  onMoveUp?: () => void
  onMoveDown?: () => void
  onRemove: () => void
  onUpdate: (patch: Partial<WorkenvLayer>) => void
}) {
  const [paramsOpen, setParamsOpen] = useState(false)
  const hasParams = layer.kind === 'tool' && layer.params && Object.keys(layer.params).length > 0

  return (
    <div className="flex items-start gap-2 px-2 py-1.5 rounded border border-zinc-800 bg-zinc-900/40">
      <div className="flex flex-col gap-0.5 mt-0.5">
        <button
          type="button"
          onClick={onMoveUp}
          disabled={!onMoveUp}
          className="p-0.5 text-zinc-500 hover:text-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed"
          title="Move up"
        >
          <RiArrowUpSLine className="size-3" />
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={!onMoveDown}
          className="p-0.5 text-zinc-500 hover:text-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed"
          title="Move down"
        >
          <RiArrowDownSLine className="size-3" />
        </button>
      </div>

      <div className="flex flex-col gap-1 min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={cn(
              'inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wide shrink-0',
              KIND_COLORS[layer.kind],
            )}
          >
            {layer.kind}
          </span>
          <span className="text-sm text-zinc-200 truncate">{layerDisplayName(layer)}</span>
          <code className="text-[10px] text-zinc-500 font-mono truncate">{layer.id}</code>
        </div>

        {hasParams && (
          <button
            type="button"
            onClick={() => setParamsOpen(!paramsOpen)}
            className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300 self-start"
          >
            <RiPencilLine className="size-3" />
            {paramsOpen ? 'Hide params' : 'Edit params'}
          </button>
        )}

        {paramsOpen && layer.kind === 'tool' && layer.params && (
          <div className="flex flex-col gap-1 mt-1 pl-1 border-l border-zinc-800">
            {Object.entries(layer.params).map(([k, v]) => (
              <label key={k} className="flex items-center gap-2 text-[10px]">
                <span className="text-zinc-500 font-mono w-20 shrink-0">{k}</span>
                <Input
                  value={v}
                  onChange={(e) => {
                    if (layer.kind !== 'tool' || !layer.params) return
                    onUpdate({
                      params: { ...layer.params, [k]: e.target.value },
                    })
                  }}
                  className="text-xs h-6"
                />
              </label>
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onRemove}
        className="p-1 text-zinc-500 hover:text-red-400 hover:bg-zinc-800 rounded shrink-0"
        title="Remove layer"
      >
        <RiCloseLine className="size-3.5" />
      </button>
    </div>
  )
}

function CustomLayerForm({ onSave, onCancel }: { onSave: (layer: WorkenvLayer) => void; onCancel: () => void }) {
  const [kind, setKind] = useState<WorkenvLayerKind>('tool')
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [run, setRun] = useState('')
  const [asUser, setAsUser] = useState('')

  function handleSubmit() {
    const trimmedId = id.trim() || `custom:${slugify(name)}`
    if (kind === 'tool') {
      onSave({
        kind: 'tool',
        id: trimmedId,
        name: name.trim() || trimmedId,
        install: [{ run, asUser: asUser.trim() || undefined }],
      })
    } else if (kind === 'shell') {
      onSave({
        kind: 'shell',
        id: trimmedId,
        name: name.trim() || trimmedId,
        steps: [{ run, asUser: asUser.trim() || undefined }],
      })
    }
  }

  return (
    <div className="flex flex-col gap-2 p-3 rounded border border-zinc-800 bg-zinc-950/40">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wide text-zinc-500">Custom layer</span>
        <span className="text-[10px] text-zinc-600">Inline to this config. Save-to-catalog coming soon.</span>
      </div>

      <div className="flex gap-1">
        {(['tool', 'shell'] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={cn(
              'px-2 py-0.5 text-[11px] rounded-md transition-colors',
              kind === k ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800',
            )}
          >
            {KIND_LABELS[k]}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Display name (e.g. AWS CLI)" />
        <Input
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder={kind === 'tool' ? 'tool:awscli' : 'shell:custom'}
          className="font-mono"
        />
      </div>
      <textarea
        value={run}
        onChange={(e) => setRun(e.target.value)}
        spellCheck={false}
        placeholder={'curl -fsSL https://example.com/install.sh | bash'}
        className="min-h-[72px] w-full rounded-md border border-zinc-800 bg-zinc-950 p-2 font-mono text-[11px] text-zinc-200 focus:outline-none focus:border-zinc-600"
      />
      <Input value={asUser} onChange={(e) => setAsUser(e.target.value)} placeholder='asUser (optional, e.g. "wanda")' />
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" size="xs" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="xs" onClick={handleSubmit} disabled={!run.trim()}>
          Add to environment
        </Button>
      </div>
    </div>
  )
}

function layerDisplayName(layer: WorkenvLayer): string {
  switch (layer.kind) {
    case 'base':
      return `${layer.image}${layer.arch ? ` (${layer.arch})` : ''}`
    case 'pkg':
      return `${layer.manager}: ${layer.packages.slice(0, 4).join(', ')}${layer.packages.length > 4 ? '…' : ''}`
    case 'tool':
      return interpolateName(layer.name, layer.params)
    case 'service':
      return `${layer.name} (${layer.image})`
    case 'auth':
      return layer.name
    case 'shell':
      return layer.name ?? layer.id
  }
}

function interpolateName(name: string, params: Record<string, string> | undefined): string {
  if (!params) return name
  return name.replace(/\$\{param\.([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, k) => params[k] ?? _match)
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'custom'
  )
}
