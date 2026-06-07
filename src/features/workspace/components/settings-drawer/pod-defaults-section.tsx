import { Checkbox } from '@/ui/checkbox'
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group'
import { useSettingsFormContext } from './context'
import { Field, SectionHeading } from './fields'
import type { WandaMcpPolicy } from './use-settings-form'

interface TemplateOption {
  id: string
  name: string
  workspaceId?: string | null
}

interface WorkenvTemplateOption {
  id: string
  name: string
  builtIn: boolean
}

interface PodDefaultsSectionProps {
  templates: TemplateOption[]
  workenvTemplates: WorkenvTemplateOption[]
}

export function PodDefaultsSection({ templates, workenvTemplates }: PodDefaultsSectionProps) {
  const { state, set } = useSettingsFormContext()
  return (
    <section>
      <SectionHeading>Pod Defaults</SectionHeading>
      <div className="flex flex-col gap-3">
        <Field label="Default template" hint="Template used when creating new pods.">
          <select
            value={state.defaultTemplatePodId}
            onChange={(e) => set({ defaultTemplatePodId: e.target.value })}
            className="h-7 rounded-md border border-zinc-700 bg-zinc-800 px-2 text-xs text-zinc-200 outline-none focus:border-zinc-500"
          >
            <option value="">None</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {!t.workspaceId ? ' (global)' : ''}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Default environment" hint="New pods get an isolated VM from this environment.">
          <select
            value={state.defaultWorkenvTemplateId}
            onChange={(e) => set({ defaultWorkenvTemplateId: e.target.value })}
            className="h-7 rounded-md border border-zinc-700 bg-zinc-800 px-2 text-xs text-zinc-200 outline-none focus:border-zinc-500"
          >
            <option value="">Local shell</option>
            {workenvTemplates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.builtIn ? ' (built-in)' : ''}
              </option>
            ))}
          </select>
        </Field>

        <label className="flex items-center gap-2 cursor-pointer">
          <Checkbox checked={state.autoGeneratePodName} onCheckedChange={(v) => set({ autoGeneratePodName: !!v })} />
          <span className="text-xs text-zinc-300">Auto-generate pod names</span>
        </label>

        <Field label="Wanda MCP" hint="Default for new agent sessions in this workspace.">
          <ToggleGroup
            value={[state.wandaMcpPolicy]}
            onValueChange={(value) => {
              if (value.length) set({ wandaMcpPolicy: value[0] as WandaMcpPolicy })
            }}
            variant="outline"
            size="sm"
          >
            <ToggleGroupItem value="inherit">Inherit</ToggleGroupItem>
            <ToggleGroupItem value="include">Include</ToggleGroupItem>
            <ToggleGroupItem value="exclude">Exclude</ToggleGroupItem>
          </ToggleGroup>
        </Field>
      </div>
    </section>
  )
}
