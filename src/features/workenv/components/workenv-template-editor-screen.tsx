import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  RiArrowLeftLine,
  RiCheckLine,
  RiCloseLine,
  RiDeleteBinLine,
  RiFileCopyLine,
  RiLoader4Line,
  RiRefreshLine,
} from '@/lib/icons'
import { Button } from '@/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog'
import { useWorkenvPrebuildSignals } from '../hooks/use-workenv-list'
import { useWorkenvTemplateActions } from '../hooks/use-workenv-template-actions'
import { useWorkenvTemplate, useWorkenvTemplatePrebuildStatus } from '../hooks/use-workenv-templates'
import { WorkenvAdapterBadge } from './workenv-adapter-badge'
import { WorkenvPrebuildStatusBadge } from './workenv-prebuild-status-badge'
import { WorkenvTemplateEditor } from './workenv-template-editor'

export function WorkenvTemplateEditorScreen({ templateId }: { templateId: string }) {
  const navigate = useNavigate()
  const { data: template, isLoading, isError } = useWorkenvTemplate(templateId)
  const { data: prebuildStatus } = useWorkenvTemplatePrebuildStatus(templateId)
  const { update, remove, prebuild, exportYaml } = useWorkenvTemplateActions()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [copiedYaml, setCopiedYaml] = useState(false)
  const [prebuildRunId, setPrebuildRunId] = useState(0)

  const initial = useMemo(() => {
    if (!template) return null
    return {
      name: template.name,
      description: template.description ?? null,
      runtime: template.runtime,
      configJson: JSON.stringify(template.config, null, 2),
    }
  }, [template])

  if (isLoading) {
    return (
      <div className="p-6">
        <p className="text-xs text-zinc-500">Loading...</p>
      </div>
    )
  }

  if (isError || !template || !initial) {
    return (
      <div className="flex flex-col gap-3 p-6">
        <p className="text-sm text-zinc-300">Template not found.</p>
        <Link to="/workenv-templates" className="text-xs text-zinc-500 hover:text-zinc-200">
          Back to templates
        </Link>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="max-w-3xl flex-1 overflow-y-auto p-6">
        <Link
          to="/workenv-templates"
          className="mb-4 inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-200"
        >
          <RiArrowLeftLine className="size-3" />
          Back to templates
        </Link>

        <header className="mb-6 flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-2">
            <h1 className="truncate font-semibold text-xl text-zinc-100">{template.name}</h1>
            <div className="flex items-center gap-2 text-[11px] text-zinc-500">
              <WorkenvAdapterBadge runtime={template.runtime} />
              {template.builtIn && (
                <span className="rounded border border-amber-900/60 bg-amber-950/40 px-1.5 py-0.5 text-[9px] text-amber-300 uppercase tracking-wide">
                  built-in (read-only)
                </span>
              )}
              <WorkenvPrebuildStatusBadge state={prebuild.isPending ? 'creating' : prebuildStatus?.state} />
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                exportYaml.mutate(template.id, {
                  onSuccess: (yaml) => {
                    void navigator.clipboard.writeText(yaml).then(() => {
                      setCopiedYaml(true)
                      window.setTimeout(() => setCopiedYaml(false), 1500)
                    })
                  },
                })
              }}
              disabled={exportYaml.isPending}
            >
              {copiedYaml ? <RiCheckLine className="size-3.5" /> : <RiFileCopyLine className="size-3.5" />}
              {copiedYaml ? 'Copied YAML' : 'Copy YAML'}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setPrebuildRunId((id) => id + 1)
                prebuild.mutate(template.id)
              }}
              disabled={prebuild.isPending || update.isPending}
            >
              {prebuild.isPending ? (
                <RiLoader4Line className="size-3.5 animate-spin" />
              ) : (
                <RiRefreshLine className="size-3.5" />
              )}
              {prebuild.isPending
                ? 'Building cache...'
                : prebuildStatus?.state === 'ready'
                  ? 'Rebuild cache'
                  : 'Build cache'}
            </Button>
            {!template.builtIn && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmDelete(true)}
                disabled={remove.isPending}
                className="text-red-400 hover:bg-red-950/30 hover:text-red-300"
              >
                <RiDeleteBinLine className="size-3.5" />
                Delete
              </Button>
            )}
          </div>
        </header>

        <WorkenvTemplateEditor
          initial={initial}
          readOnly={template.builtIn}
          submitting={update.isPending}
          submitLabel="Save changes"
          onSubmit={(value) => {
            update.mutate({
              id: template.id,
              name: value.name,
              description: value.description,
              runtime: value.runtime,
              config: JSON.parse(value.configJson),
            })
          }}
        />

        {update.error && (
          <p className="mt-2 text-red-400 text-xs">
            {update.error instanceof Error ? update.error.message : String(update.error)}
          </p>
        )}
        {prebuild.error && (
          <p className="mt-2 text-red-400 text-xs">
            {prebuild.error instanceof Error ? prebuild.error.message : String(prebuild.error)}
          </p>
        )}
        {exportYaml.error && (
          <p className="mt-2 text-red-400 text-xs">
            {exportYaml.error instanceof Error ? exportYaml.error.message : String(exportYaml.error)}
          </p>
        )}
        <TemplatePrebuildLog
          key={`${template.id}:${prebuildRunId}`}
          templateId={template.id}
          active={prebuild.isPending}
        />
      </div>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete template</DialogTitle>
            <DialogDescription>
              Environments that were created from this template keep their compiled config; they won't be affected. This
              only removes the template entry.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                remove.mutate(template.id, {
                  onSuccess: () => {
                    setConfirmDelete(false)
                    void navigate({ to: '/workenv-templates' })
                  },
                })
              }}
              disabled={remove.isPending}
              className="bg-red-600 hover:bg-red-500"
            >
              {remove.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

interface PrebuildStep {
  index: number
  name: string
  status: 'started' | 'succeeded' | 'failed'
}

function TemplatePrebuildLog({ templateId, active }: { templateId: string; active: boolean }) {
  const [hash, setHash] = useState<string | null>(null)
  const [steps, setSteps] = useState<Map<number, PrebuildStep>>(new Map())
  const [log, setLog] = useState('')
  const logRef = useRef<HTMLPreElement>(null)

  const prebuildHandlers = useMemo(
    () => ({
      onProgress: (nextHash: string, index: number, name: string, status: PrebuildStep['status']) => {
        setHash(nextHash)
        setSteps((previous) => {
          const next = new Map(previous)
          next.set(index, { index, name, status })
          return next
        })
      },
      onLog: (nextHash: string, chunk: string) => {
        setHash(nextHash)
        setLog((previous) => `${previous}${chunk}`)
      },
    }),
    [],
  )
  useWorkenvPrebuildSignals(templateId, prebuildHandlers)

  useEffect(() => {
    const node = logRef.current
    if (node) node.scrollTop = node.scrollHeight
  })

  if (!active && steps.size === 0 && !log) return null

  const ordered = [...steps.values()].sort((a, b) => a.index - b.index)

  return (
    <section className="mt-4 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[10px] text-zinc-500 uppercase tracking-wide">Prebuild</h2>
        {hash && <span className="font-mono text-[10px] text-zinc-600">{hash}</span>}
      </div>
      {ordered.length > 0 && (
        <ol className="divide-y divide-zinc-800 rounded-md border border-zinc-800 bg-zinc-900/40">
          {ordered.map((step) => (
            <li key={step.index} className="flex items-center gap-3 px-3 py-2 text-xs">
              {step.status === 'succeeded' ? (
                <RiCheckLine className="size-3.5 text-emerald-400" />
              ) : step.status === 'failed' ? (
                <RiCloseLine className="size-3.5 text-red-400" />
              ) : (
                <RiLoader4Line className="size-3.5 animate-spin text-amber-300" />
              )}
              <span className="min-w-0 flex-1 truncate text-zinc-300">{step.name}</span>
              <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-wide">{step.status}</span>
            </li>
          ))}
        </ol>
      )}
      <pre
        ref={logRef}
        className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-zinc-800 bg-black/40 p-3 text-[10px] text-zinc-300 leading-relaxed"
      >
        {log || 'Waiting for build output...'}
      </pre>
    </section>
  )
}
