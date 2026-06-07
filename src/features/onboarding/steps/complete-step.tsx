import { motion } from 'motion/react'
import { RiCheckLine } from '@/lib/icons'
import { orpcUtils } from '@/shared/orpc'
import { Button } from '@/ui/button'
import type { OnboardingStepProps } from '../config'
import { useOnboardingStore } from '../store'

/**
 * Final step. Confirms the user is set up and hands off to the main app.
 *
 * This is also where the entire onboarding session gets committed to the
 * backend. Template creation, workspace creation, and workspace-settings
 * writes all happen here, in order, when the user clicks "Open Wanda".
 * We fire them in the background and call `onFinish()` immediately for an
 * optimistic transition — the user never sees a loading state.
 *
 * The commit is intentionally best-effort: if any step errors, we log and
 * proceed. Worst case the user lands in the main app and has to set up
 * their workspace manually, which is strictly better than being stuck on
 * a "Creating..." screen.
 */
export function CompleteStep({ onFinish }: OnboardingStepProps) {
  function handleOpen() {
    // Snapshot the store state NOW, because onFinish() eventually calls
    // resetStore() which wipes it. We want the commit to use the snapshot.
    const { selectedPresetKey, workspaceName, workspaceCwd } = useOnboardingStore.getState()

    void commitOnboarding({ selectedPresetKey, workspaceName, workspaceCwd })
    onFinish()
  }

  return (
    <div className="flex flex-col items-center gap-8 text-center">
      <motion.div
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', damping: 14, stiffness: 200 }}
        className="relative"
      >
        <div className="absolute inset-0 -z-10 rounded-full bg-emerald-500/15 blur-2xl" />
        <div className="rounded-full border border-emerald-500/40 bg-emerald-500/10 p-5">
          <RiCheckLine className="size-10 text-emerald-300" />
        </div>
      </motion.div>

      <div className="flex flex-col items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">You're all set</h1>
        <p className="max-w-md text-xs leading-relaxed text-zinc-500">
          Your default template and workspace are ready. Jump in and start building. You can change any of this later in
          settings.
        </p>
      </div>

      <Button size="lg" onClick={handleOpen} className="min-w-36">
        Open Wanda
      </Button>
    </div>
  )
}

/**
 * Commits the onboarding session in the correct order: template first
 * (so we have its id), then workspace, then wire the template as the
 * workspace's default. Each step is independent — if the user skipped
 * the workspace step, `workspaceName` is empty and we skip that block.
 */
async function commitOnboarding(state: {
  selectedPresetKey: string | null
  workspaceName: string
  workspaceCwd: string
}) {
  try {
    let templateId: string | null = null

    if (state.selectedPresetKey) {
      const template = await orpcUtils.onboarding.createPresetTemplate.call({
        presetKey: state.selectedPresetKey,
      })
      templateId = template.id
    }

    const trimmedName = state.workspaceName.trim()
    if (trimmedName) {
      const workspace = await orpcUtils.workspace.create.call({
        name: trimmedName,
        cwd: state.workspaceCwd.trim(),
      })
      if (templateId) {
        await orpcUtils.workspaceSettings.update.call({
          workspaceId: workspace.id,
          defaultTemplatePodId: templateId,
        })
      }
    }
  } catch (err) {
    console.error('[onboarding] commit failed', err)
  }
}
