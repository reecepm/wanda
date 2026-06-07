import { useSettingsFormContext } from './context'
import { SectionHeading, TextAreaField } from './fields'

export function ScriptsSection() {
  const { state, set } = useSettingsFormContext()
  return (
    <section>
      <SectionHeading>Scripts</SectionHeading>
      <div className="flex flex-col gap-3">
        <TextAreaField
          label="Setup script"
          value={state.scriptSetup}
          onChange={(scriptSetup) => set({ scriptSetup })}
          placeholder="e.g. npm install"
          hint="Runs after pod creation."
        />
        <TextAreaField
          label="Run script"
          value={state.scriptRun}
          onChange={(scriptRun) => set({ scriptRun })}
          placeholder="e.g. npm run dev"
          hint="Runs on pod start."
        />
        <TextAreaField
          label="Archive script"
          value={state.scriptArchive}
          onChange={(scriptArchive) => set({ scriptArchive })}
          placeholder="e.g. rm -rf node_modules"
          hint="Runs before pod deletion."
        />
      </div>
    </section>
  )
}
