// -----------------------------------------------------------------------------
// Attach-to-pod: pod.setWorkenv binds a running workenv to a pod so pod
// terminals route through the workenv's exec pipeline. Detach unlinks
// without stopping the workenv. Uses the FakeRuntimeAdapter.
// -----------------------------------------------------------------------------

import { expect, test } from './fixtures'

type WandaAPI = {
  rpc: { call: (path: string[], input: unknown) => Promise<unknown> }
}

interface PodRow {
  id: string
  workenvId: string | null
  name: string
}

test('pod.setWorkenv links the pod, unsetWorkenv clears it', async ({ wandaFake }) => {
  const page = wandaFake.mainWindow

  const { beforeSet, afterSet, afterUnset, workenvId } = await page.evaluate(async () => {
    const w = window as unknown as { wanda: WandaAPI }
    const ws = (await w.wanda.rpc.call(['workspace', 'create'], {
      name: 'e2e-attach-ws',
      cwd: '/tmp/e2e-attach-ws',
    })) as { id: string }
    const pod = (await w.wanda.rpc.call(['pod', 'create'], {
      workspaceId: ws.id,
      name: 'e2e-attach-pod',
      cwd: '/tmp/e2e-attach-ws',
    })) as { id: string }
    const wrk = (await w.wanda.rpc.call(['workenv', 'create'], {
      name: 'e2e-attach-env',
      slug: 'e2e-attach-env',
      config: { runtime: 'orbstack', worktreePath: '/tmp/e2e-attach-ws' },
    })) as { id: string }

    const beforeSet = (await w.wanda.rpc.call(['pod', 'getById'], { id: pod.id })) as PodRow
    await w.wanda.rpc.call(['pod', 'setWorkenv'], { id: pod.id, workenvId: wrk.id })
    const afterSet = (await w.wanda.rpc.call(['pod', 'getById'], { id: pod.id })) as PodRow
    await w.wanda.rpc.call(['pod', 'unsetWorkenv'], { id: pod.id })
    const afterUnset = (await w.wanda.rpc.call(['pod', 'getById'], { id: pod.id })) as PodRow
    return { beforeSet, afterSet, afterUnset, workenvId: wrk.id }
  })

  expect(beforeSet.workenvId).toBeNull()
  expect(afterSet.workenvId).toBe(workenvId)
  expect(afterUnset.workenvId).toBeNull()
})

test('pod.setWorkenv works against a stopped workenv (non-blocking attach)', async ({ wandaFake }) => {
  // Per plan §4 flow #3: attaching is non-blocking — the pod doesn't need
  // to be started first, and the workenv doesn't need to be running. The
  // binding takes effect on the next pod terminal start.
  const page = wandaFake.mainWindow

  const result = await page.evaluate(async () => {
    const w = window as unknown as { wanda: WandaAPI }
    const ws = (await w.wanda.rpc.call(['workspace', 'create'], {
      name: 'e2e-attach-stopped',
      cwd: '/tmp/e2e-attach-stopped',
    })) as { id: string }
    const pod = (await w.wanda.rpc.call(['pod', 'create'], {
      workspaceId: ws.id,
      name: 'e2e-attach-stopped-pod',
      cwd: '/tmp/e2e-attach-stopped',
    })) as { id: string }
    const wrk = (await w.wanda.rpc.call(['workenv', 'create'], {
      name: 'e2e-attach-stopped-env',
      slug: 'e2e-attach-stopped-env',
      config: { runtime: 'orbstack', worktreePath: '/tmp/e2e-attach-stopped' },
    })) as { id: string; state: string }

    // NOTE: we deliberately do NOT start the workenv before attaching.
    await w.wanda.rpc.call(['pod', 'setWorkenv'], { id: pod.id, workenvId: wrk.id })
    const linked = (await w.wanda.rpc.call(['pod', 'getById'], { id: pod.id })) as PodRow
    return { state: wrk.state, linked }
  })

  expect(result.state).toBe('stopped')
  expect(result.linked.workenvId).not.toBeNull()
})
