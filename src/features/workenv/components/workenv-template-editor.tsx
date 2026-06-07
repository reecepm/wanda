// WorkenvTemplateEditor — visual editor for a workenv template.
//
// A template is a `Partial<WorkenvConfig>` reusable across workenvs. The
// primary authoring path is the LayerEditor (compose base/tool/auth/service
// layers); raw JSON is available behind an "Advanced" toggle for power users
// editing fields beyond layers.
//
// Built-in templates are read-only — the form locks all controls when
// `readOnly` is set.

import { type RefObject, useEffect, useMemo, useState } from 'react'
import type { WorkenvConfig, WorkenvLayer, WorkenvRuntime } from '@/types/schema'
import { workenvConfigSchema } from '@/types/schema'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { LayerEditor } from './layer-editor'

export interface TemplateEditorValue {
  name: string
  description: string | null
  runtime: WorkenvRuntime
  configJson: string
}

export function WorkenvTemplateEditor({
  initial,
  readOnly,
  submitting,
  onSubmit,
  onCancel,
  submitLabel = 'Save',
  portalContainer,
}: {
  initial: TemplateEditorValue
  readOnly?: boolean
  submitting?: boolean
  onSubmit: (value: TemplateEditorValue) => void
  onCancel?: () => void
  submitLabel?: string
  portalContainer?: RefObject<HTMLDivElement | null>
}) {
  const [name, setName] = useState(initial.name)
  const [description, setDescription] = useState(initial.description ?? '')
  const [runtime, setRuntime] = useState<WorkenvRuntime>(initial.runtime)
  const [layers, setLayers] = useState<WorkenvLayer[]>(() => parseLayersFromConfig(initial.configJson))
  const [extraConfigJson, setExtraConfigJson] = useState(() => stringifyConfigWithoutLayers(initial.configJson))
  const [advanced, setAdvanced] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setName(initial.name)
    setDescription(initial.description ?? '')
    setRuntime(initial.runtime)
    setLayers(parseLayersFromConfig(initial.configJson))
    setExtraConfigJson(stringifyConfigWithoutLayers(initial.configJson))
    setAdvanced(false)
  }, [initial])

  // Live preview of the merged JSON the server will receive.
  const mergedConfigJson = useMemo(() => {
    let extra: Partial<WorkenvConfig> = {}
    try {
      extra = JSON.parse(extraConfigJson || '{}')
    } catch {
      // ignore — surface on submit instead
    }
    const merged: Partial<WorkenvConfig> = {
      ...extra,
      ...(layers.length > 0 ? { layers } : {}),
    }
    return JSON.stringify(merged, null, 2)
  }, [extraConfigJson, layers])

  function handleSubmit() {
    setError(null)
    if (!name.trim()) {
      setError('Name is required.')
      return
    }
    let parsedExtra: unknown
    try {
      parsedExtra = JSON.parse(extraConfigJson || '{}')
    } catch (err) {
      setError(`Invalid advanced JSON: ${err instanceof Error ? err.message : String(err)}`)
      return
    }
    const merged: Record<string, unknown> = {
      ...(parsedExtra as Record<string, unknown>),
      ...(layers.length > 0 ? { layers } : {}),
    }
    const result = workenvConfigSchema.partial().safeParse(merged)
    if (!result.success) {
      setError(`Config validation failed: ${result.error.issues[0]?.message ?? 'unknown error'}`)
      return
    }
    onSubmit({
      name: name.trim(),
      description: description.trim() || null,
      runtime,
      configJson: JSON.stringify(merged, null, 2),
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <Field label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} disabled={readOnly} placeholder="e.g. My stack" />
      </Field>

      <Field label="Description" hint="Shown in the template picker.">
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={readOnly}
          placeholder="Optional"
        />
      </Field>

      <div className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wide text-zinc-500">Layers</span>
        <span className="text-[10px] text-zinc-600 mb-1">
          Composable building blocks — base + tools + auth + services. Pick from the catalog or author custom.
        </span>
        {readOnly ? (
          <ReadOnlyLayerList layers={layers} />
        ) : (
          <LayerEditor value={layers} onChange={setLayers} portalContainer={portalContainer} />
        )}
      </div>

      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={() => setAdvanced(!advanced)}
          className="text-[10px] uppercase tracking-wide text-zinc-500 hover:text-zinc-300 self-start"
        >
          {advanced ? '▾ Advanced (extra JSON)' : '▸ Advanced (extra JSON)'}
        </button>
        {advanced && (
          <>
            <span className="text-[10px] text-zinc-600">
              Extra fields include <code>prebuild</code>, <code>postStart</code>, <code>healthcheck</code>,{' '}
              <code>resources</code>, and <code>requires</code>. Runtime steps can use <code>skipWhenPrebuilt</code>.
            </span>
            <textarea
              value={extraConfigJson}
              onChange={(e) => setExtraConfigJson(e.target.value)}
              readOnly={readOnly}
              spellCheck={false}
              className="font-mono text-xs text-zinc-200 p-3 rounded-md border border-zinc-800 bg-zinc-950/60 min-h-32 max-h-64 overflow-auto resize-y"
            />
            <span className="text-[10px] text-zinc-500 mt-2">Final merged config:</span>
            <pre className="font-mono text-[10px] text-zinc-400 p-3 rounded-md border border-zinc-800 bg-zinc-950/60 max-h-48 overflow-auto">
              {mergedConfigJson}
            </pre>
          </>
        )}
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {!readOnly && (
        <div className="flex justify-end gap-2">
          {onCancel && (
            <Button variant="ghost" onClick={onCancel} disabled={submitting}>
              Cancel
            </Button>
          )}
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Saving…' : submitLabel}
          </Button>
        </div>
      )}
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</span>
      {children}
      {hint && <span className="text-[10px] text-zinc-600">{hint}</span>}
    </label>
  )
}

function ReadOnlyLayerList({ layers }: { layers: readonly WorkenvLayer[] }) {
  if (layers.length === 0) {
    return <p className="text-xs text-zinc-500 italic">No layers.</p>
  }
  return (
    <ul className="flex flex-col gap-1">
      {layers.map((l, i) => (
        <li
          key={`${l.id}-${i}`}
          className="px-2 py-1.5 rounded border border-zinc-800 bg-zinc-900/40 flex items-center gap-2"
        >
          <span className="text-[10px] font-mono uppercase tracking-wide text-zinc-500 shrink-0">{l.kind}</span>
          <code className="text-[11px] text-zinc-300 font-mono truncate">{l.id}</code>
        </li>
      ))}
    </ul>
  )
}

function parseLayersFromConfig(configJson: string): WorkenvLayer[] {
  try {
    const parsed = JSON.parse(configJson) as { layers?: WorkenvLayer[] }
    return parsed.layers ?? []
  } catch {
    return []
  }
}

/** Strip `layers` from the JSON for the advanced extra-fields view. */
function stringifyConfigWithoutLayers(configJson: string): string {
  try {
    const parsed = JSON.parse(configJson) as Record<string, unknown>
    const { layers: _layers, ...rest } = parsed
    if (Object.keys(rest).length === 0) return ''
    return JSON.stringify(rest, null, 2)
  } catch {
    return configJson
  }
}

export const EMPTY_TEMPLATE_CONFIG_JSON = JSON.stringify({}, null, 2)
