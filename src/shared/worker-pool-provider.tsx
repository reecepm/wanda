import { WorkerPoolContextProvider } from '@pierre/diffs/react'
import type { ReactNode } from 'react'

const poolSize = Math.min(navigator.hardwareConcurrency || 4, 8)

export function DiffWorkerPoolProvider({ children }: { children: ReactNode }) {
  return (
    <WorkerPoolContextProvider
      poolOptions={{
        workerFactory: () => new Worker(new URL('@pierre/diffs/worker/worker.js', import.meta.url), { type: 'module' }),
        poolSize,
      }}
      highlighterOptions={{}}
    >
      {children}
    </WorkerPoolContextProvider>
  )
}
