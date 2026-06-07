import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { restoreGitDiffSettings } from './features/git/store/git-diff-store'
import { OnboardingApp } from './features/onboarding'
import { router } from './router'
import { waitForServicesReady } from './shared/app-bridge'
import { ConnectionStatusIndicator } from './shared/connection-status'
import { orpcUtils } from './shared/orpc'
import { preloadBootstrap } from './shared/preload-bootstrap'
import { createQueryClient } from './shared/query-client'
import { DiffWorkerPoolProvider } from './shared/worker-pool-provider'
import { restoreAppearance } from './stores/appearance-store'
import { restoreShortcuts } from './stores/shortcut-store'
import { restoreUIState } from './stores/ui-store'
import { installTestHooks } from './test-hooks'
import { TooltipProvider } from './ui/tooltip'

import './index.css'
import '@wanda/agent-ui/agent-ui.css'

const queryClient = createQueryClient()
installTestHooks(queryClient)

type OnboardingStatus = Awaited<ReturnType<typeof orpcUtils.onboarding.getStatus.call>>

/**
 * Renders the normal app (router + providers). This is EXACTLY the tree
 * main.tsx used to mount before the onboarding flow existed — we just
 * optionally render the onboarding flow instead on first launch.
 */
function renderMainApp(root: Root) {
  root.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <DiffWorkerPoolProvider>
          <TooltipProvider delay={250}>
            <ConnectionStatusIndicator />
            <RouterProvider router={router} />
          </TooltipProvider>
        </DiffWorkerPoolProvider>
      </QueryClientProvider>
    </StrictMode>,
  )
}

/**
 * Renders the onboarding flow. When the user finishes or skips, the onComplete
 * callback re-renders the same React root with the normal app tree. We swap by
 * calling `root.render()` again rather than by conditionally rendering inside a
 * shared component, to keep the two trees fully independent — no shared state,
 * no hook ordering surprises, and no risk of the onboarding tree "overtaking"
 * the normal app tree.
 */
function renderOnboarding(root: Root, initialStatus: OnboardingStatus) {
  root.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <OnboardingApp initialStatus={initialStatus} onComplete={() => renderMainApp(root)} />
      </QueryClientProvider>
    </StrictMode>,
  )
}

async function main() {
  await Promise.all([
    waitForServicesReady(),
    restoreUIState(),
    restoreShortcuts(),
    restoreAppearance(),
    restoreGitDiffSettings(),
  ])

  const onboardingStatus = await orpcUtils.onboarding.getStatus.call({}).catch((err) => {
    console.error('[main] onboarding.getStatus failed', err)
    return { completed: true, defaultTemplateId: null, presets: [] } satisfies OnboardingStatus
  })

  // Preload sidebar/pod data + warm local PTY pods before the splash fades.
  // Skip for onboarding since the main app isn't mounted yet.
  if (onboardingStatus.completed) {
    await preloadBootstrap(queryClient).catch((err) => {
      console.error('[main] preloadBootstrap failed', err)
    })
  }

  const root = createRoot(document.getElementById('root')!)

  if (onboardingStatus.completed) {
    renderMainApp(root)
  } else {
    renderOnboarding(root, onboardingStatus)
  }

  const splash = document.getElementById('splash')
  if (splash) {
    splash.classList.add('fade-out')
    splash.addEventListener('transitionend', () => splash.remove())
  }
}

main().catch((err) => {
  console.error('[main] fatal startup error', err)
  const splash = document.getElementById('splash')
  if (splash) splash.remove()
  const root = document.getElementById('root')
  if (root) {
    root.innerHTML = `
      <div style="position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:oklch(0.17 0.004 260);color:#e4e4e7;font-family:system-ui;gap:12px;padding:32px;">
        <div style="font-size:14px;font-weight:500;">Wanda failed to start.</div>
        <pre style="max-width:560px;overflow:auto;border:1px solid #27272a;background:rgba(24,24,27,0.6);padding:12px;font-size:10px;color:#fca5a5;">${err instanceof Error ? err.message : String(err)}</pre>
      </div>
    `
  }
})
