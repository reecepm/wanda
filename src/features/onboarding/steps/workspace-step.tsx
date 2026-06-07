import { useMutation } from '@tanstack/react-query'
import { useRef } from 'react'
import { RiFolderOpenLine } from '@/lib/icons'
import { orpcUtils } from '@/shared/orpc'
import { Button } from '@/ui/button'
import type { OnboardingStepProps } from '../config'
import { useOnboardingStore } from '../store'

/**
 * Step 3: collect the first workspace's name and directory.
 *
 * This step does NOT commit anything to the backend. It just stashes the
 * user's inputs in the onboarding store. All backend writes (template
 * creation, workspace creation, workspace settings) happen together in the
 * complete step when the user hits "Open Wanda". That way going back to
 * edit something doesn't create duplicates, and the flow is fully
 * idempotent no matter how the user navigates.
 */
export function WorkspaceStep({ onNext, onBack }: OnboardingStepProps) {
  const workspaceName = useOnboardingStore((s) => s.workspaceName)
  const setWorkspaceName = useOnboardingStore((s) => s.setWorkspaceName)
  const workspaceCwd = useOnboardingStore((s) => s.workspaceCwd)
  const setWorkspaceCwd = useOnboardingStore((s) => s.setWorkspaceCwd)

  const inputRef = useRef<HTMLInputElement>(null)
  const selectDirectoryMutation = useMutation(orpcUtils.app.selectDirectory.mutationOptions())

  async function handleBrowse() {
    const dir = await selectDirectoryMutation.mutateAsync({})
    if (dir) {
      setWorkspaceCwd(dir)
      // Auto-fill name from the last path segment if empty.
      if (!workspaceName) {
        const segments = dir.split('/').filter(Boolean)
        const last = segments[segments.length - 1]
        if (last) setWorkspaceName(last)
      }
    }
  }

  function handleContinue() {
    if (!workspaceName.trim()) return
    // Just advance — the commit happens in the complete step.
    onNext()
  }

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-100">Create your first workspace</h1>
        <p className="max-w-lg text-xs leading-relaxed text-zinc-500">
          A workspace holds a set of related pods. Give it a name and point it at a directory. Your chosen template will
          be used when you add new pods.
        </p>
      </div>

      <div className="flex w-full max-w-md flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="onboarding-ws-name" className="text-[11px] text-zinc-400">
            Name
          </label>
          <input
            id="onboarding-ws-name"
            ref={inputRef}
            type="text"
            value={workspaceName}
            onChange={(e) => setWorkspaceName(e.target.value)}
            placeholder="e.g. My App"
            className="h-8 rounded-md border border-zinc-700 bg-zinc-800 px-3 text-xs text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-zinc-500"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="onboarding-ws-cwd" className="text-[11px] text-zinc-400">
            Working directory
          </label>
          <div className="flex gap-1">
            <input
              id="onboarding-ws-cwd"
              type="text"
              value={workspaceCwd}
              onChange={(e) => setWorkspaceCwd(e.target.value)}
              placeholder="/path/to/project"
              className="h-8 flex-1 rounded-md border border-zinc-700 bg-zinc-800 px-3 text-xs text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-zinc-500 font-mono"
            />
            <Button type="button" variant="outline" size="icon-sm" onClick={handleBrowse}>
              <RiFolderOpenLine className="h-3.5 w-3.5" />
            </Button>
          </div>
          <p className="text-[10px] text-zinc-600">Optional. You can set this per-pod later.</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {onBack && (
          <Button variant="ghost" size="sm" onClick={onBack}>
            Back
          </Button>
        )}
        {/*
          "Skip for now" advances to the next onboarding step without saving
          workspace details. It does NOT exit the onboarding entirely (that's
          the top-right "Skip setup" button).
        */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setWorkspaceName('')
            setWorkspaceCwd('')
            onNext()
          }}
        >
          Skip for now
        </Button>
        <Button size="default" onClick={handleContinue} disabled={!workspaceName.trim()}>
          Continue
        </Button>
      </div>
    </div>
  )
}
