import { useQuery } from '@tanstack/react-query'
import { useWorkenvTemplates } from '@/features/workenv'
import { RiCloseLine } from '@/lib/icons'
import { orpcUtils } from '@/shared/orpc'
import { Button } from '@/ui/button'
import { Drawer, DrawerClose, DrawerContent, DrawerFooter, DrawerHeader, DrawerTitle } from '@/ui/drawer'
import { Separator } from '@/ui/separator'
import { CliAgentsSection } from './settings-drawer/cli-agents-section'
import { SettingsFormProvider } from './settings-drawer/context'
import { GeneralSection } from './settings-drawer/general-section'
import { GitSection } from './settings-drawer/git-section'
import { GraphiteSettingsSection } from './settings-drawer/graphite-settings-section'
import { PodDefaultsSection } from './settings-drawer/pod-defaults-section'
import { ScriptsSection } from './settings-drawer/scripts-section'
import { useSettingsForm } from './settings-drawer/use-settings-form'

interface WorkspaceDrawerProps {
  mode: 'create' | 'edit'
  /** Required for edit mode */
  workspaceId?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: () => void
}

export function WorkspaceSettingsDrawer({ mode, workspaceId, open, onOpenChange, onCreated }: WorkspaceDrawerProps) {
  const form = useSettingsForm({ mode, workspaceId, open, onOpenChange, onCreated })
  const { isEdit, loading, buttonText, handleSave } = form

  const { data: templates = [] } = useQuery({
    ...orpcUtils.template.list.queryOptions(workspaceId ? { input: { workspaceId } } : {}),
    enabled: open,
  })
  const { data: workenvTemplates = [] } = useWorkenvTemplates()

  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="right">
      <DrawerContent className="w-96 sm:max-w-96">
        <DrawerHeader className="flex-row items-center justify-between">
          <DrawerTitle>{isEdit ? 'Workspace Settings' : 'New Workspace'}</DrawerTitle>
          <DrawerClose asChild>
            <Button variant="ghost" size="icon-sm">
              <RiCloseLine className="h-4 w-4" />
            </Button>
          </DrawerClose>
        </DrawerHeader>

        <SettingsFormProvider value={form}>
          <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-6">
            <GeneralSection mode={mode} workspaceId={workspaceId} />
            <Separator />
            <GitSection />
            <Separator />
            <PodDefaultsSection templates={templates} workenvTemplates={workenvTemplates} />
            <Separator />
            <GraphiteSettingsSection />

            {isEdit && workspaceId && (
              <>
                <Separator />
                <CliAgentsSection workspaceId={workspaceId} />
              </>
            )}

            <Separator />
            <ScriptsSection />
          </div>
        </SettingsFormProvider>

        <DrawerFooter className="flex-row justify-end gap-2 border-t border-zinc-800">
          <DrawerClose asChild>
            <Button variant="ghost" size="sm" disabled={loading}>
              Cancel
            </Button>
          </DrawerClose>
          <Button size="sm" onClick={handleSave} disabled={loading}>
            {buttonText}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
