import { createHashHistory, createRouter, Link } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

export const router = createRouter({
  routeTree,
  history: createHashHistory(),
  defaultNotFoundComponent: () => (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-zinc-500 text-sm">
      <span>Page not found</span>
      <Link to="/" className="text-xs text-zinc-400 hover:text-zinc-200 underline underline-offset-2">
        Back to home
      </Link>
    </div>
  ),
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
