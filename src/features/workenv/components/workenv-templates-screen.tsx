import { Link } from '@tanstack/react-router'
import { useMemo, useRef, useState } from 'react'
import { SectionHeader } from '@/layout/section-header'
import { RiAddLine, RiBox3Line, RiCloseLine, RiImportLine } from '@/lib/icons'
import { Button } from '@/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog'
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/ui/drawer'
import { useDefaultLayers } from '../hooks/use-builtin-layers'
import { useWorkenvTemplateActions } from '../hooks/use-workenv-template-actions'
import { useWorkenvTemplatePrebuildStatus, useWorkenvTemplates } from '../hooks/use-workenv-templates'
import { WorkenvAdapterBadge } from './workenv-adapter-badge'
import { WorkenvPrebuildStatusBadge } from './workenv-prebuild-status-badge'
import { WorkenvTemplateEditor } from './workenv-template-editor'

export function WorkenvTemplatesScreen() {
  const { data: templates, isLoading } = useWorkenvTemplates()
  const [creating, setCreating] = useState(false)
  const [importing, setImporting] = useState(false)

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto p-6">
        <SectionHeader
          title="Environments"
          description="Reusable VM recipes for pods. Prebuild one to make future pod creation faster."
          action={
            <>
              <Button variant="secondary" size="sm" onClick={() => setImporting(true)}>
                <RiImportLine className="size-3.5" />
                Import YAML
              </Button>
              <Button size="sm" onClick={() => setCreating(true)}>
                <RiAddLine className="size-3.5" />
                New env
              </Button>
            </>
          }
        />

        {isLoading ? (
          <p className="text-xs text-zinc-500">Loading...</p>
        ) : !templates || templates.length === 0 ? (
          <EmptyState onNew={() => setCreating(true)} />
        ) : (
          <ul className="divide-y divide-zinc-800 rounded-md border border-zinc-800 bg-zinc-900/40">
            {templates.map((template) => (
              <EnvironmentRow key={template.id} template={template} />
            ))}
          </ul>
        )}
      </div>

      <TemplateCreateDialog open={creating} onOpenChange={setCreating} />
      <TemplateImportDialog open={importing} onOpenChange={setImporting} />
    </div>
  )
}

function EnvironmentRow({
  template,
}: {
  template: NonNullable<ReturnType<typeof useWorkenvTemplates>['data']>[number]
}) {
  const { data: prebuildStatus } = useWorkenvTemplatePrebuildStatus(template.id)

  return (
    <li>
      <Link
        to="/workenv-templates/$templateId"
        params={{ templateId: template.id }}
        className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-zinc-900/80"
      >
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 items-center gap-2">
            <RiBox3Line className="size-4 shrink-0 text-zinc-400" />
            <span className="truncate text-sm text-zinc-100">{template.name}</span>
            {template.builtIn && (
              <span className="rounded border border-amber-900/60 bg-amber-950/40 px-1.5 py-0.5 text-[9px] text-amber-300 uppercase tracking-wide">
                built-in
              </span>
            )}
            <WorkenvPrebuildStatusBadge state={prebuildStatus?.state} />
          </div>
          {template.description && <p className="truncate pl-6 text-[11px] text-zinc-500">{template.description}</p>}
        </div>
        <WorkenvAdapterBadge runtime={template.runtime} />
      </Link>
    </li>
  )
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-zinc-800 border-dashed py-16 text-center">
      <div className="flex size-10 items-center justify-center rounded-md border border-zinc-800 bg-zinc-900/60 text-zinc-500">
        <RiBox3Line className="size-5" />
      </div>
      <div className="max-w-sm">
        <h2 className="font-medium text-sm text-zinc-200">No templates yet</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Create one to share bootstrap + env configurations across environments.
        </p>
      </div>
      <Button size="sm" onClick={onNew}>
        <RiAddLine className="size-3.5" />
        New template
      </Button>
    </div>
  )
}

function TemplateImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { importYaml } = useWorkenvTemplateActions()
  const [yaml, setYaml] = useState('')
  const [replaceExisting, setReplaceExisting] = useState(false)
  const placeholder = [
    'kind: wanda.workenv.template',
    'version: 1',
    'name: My stack',
    'runtime: orbstack',
    'config: {}',
  ].join('\n')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import environment YAML</DialogTitle>
          <DialogDescription>
            Paste a shared Wanda environment definition. Existing matching IDs are copied as new environments unless
            replace is enabled.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <textarea
            value={yaml}
            onChange={(event) => setYaml(event.target.value)}
            spellCheck={false}
            placeholder={placeholder}
            className="min-h-72 resize-y rounded-md border border-zinc-800 bg-zinc-950/60 p-3 font-mono text-xs text-zinc-200"
          />
          <label className="flex items-center gap-2 text-xs text-zinc-400">
            <input
              type="checkbox"
              checked={replaceExisting}
              onChange={(event) => setReplaceExisting(event.target.checked)}
              className="size-3.5 rounded border-zinc-700 bg-zinc-950"
            />
            Replace existing environment when the YAML ID already exists
          </label>
          {importYaml.error && (
            <p className="text-red-400 text-xs">
              {importYaml.error instanceof Error ? importYaml.error.message : String(importYaml.error)}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={importYaml.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              importYaml.mutate(
                { yaml, replaceExisting },
                {
                  onSuccess: () => {
                    setYaml('')
                    setReplaceExisting(false)
                    onOpenChange(false)
                  },
                },
              )
            }}
            disabled={importYaml.isPending || yaml.trim().length === 0}
          >
            {importYaml.isPending ? 'Importing...' : 'Import'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TemplateCreateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { create } = useWorkenvTemplateActions()
  const defaultLayers = useDefaultLayers()
  const portalRef = useRef<HTMLDivElement>(null)

  const initialConfigJson = useMemo(
    () => JSON.stringify(defaultLayers.length > 0 ? { layers: defaultLayers } : {}, null, 2),
    [defaultLayers],
  )

  return (
    <Drawer direction="right" open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="h-full w-[640px] sm:max-w-[640px]">
        <div ref={portalRef} className="absolute" />
        <DrawerHeader className="flex flex-row items-center justify-between gap-2 border-zinc-800 border-b px-3 py-2">
          <div className="min-w-0">
            <DrawerTitle className="truncate font-medium text-xs text-zinc-200">New template</DrawerTitle>
            <DrawerDescription className="text-[10px] text-zinc-500">
              Reusable partial config. Omit runtime / worktreePath - they come from the workenv.
            </DrawerDescription>
          </div>
          <DrawerClose aria-label="Close" className="shrink-0 p-1 text-zinc-500 hover:text-zinc-300">
            <RiCloseLine className="size-4" />
          </DrawerClose>
        </DrawerHeader>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-3">
          <WorkenvTemplateEditor
            portalContainer={portalRef}
            initial={{
              name: '',
              description: null,
              runtime: 'orbstack',
              configJson: initialConfigJson,
            }}
            submitting={create.isPending}
            submitLabel="Create template"
            onCancel={() => onOpenChange(false)}
            onSubmit={(value) => {
              create.mutate(
                {
                  name: value.name,
                  description: value.description,
                  runtime: value.runtime,
                  config: JSON.parse(value.configJson),
                },
                { onSuccess: () => onOpenChange(false) },
              )
            }}
          />
          {create.error && (
            <p className="text-red-400 text-xs">
              {create.error instanceof Error ? create.error.message : String(create.error)}
            </p>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
