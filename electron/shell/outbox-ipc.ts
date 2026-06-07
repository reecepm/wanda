// -----------------------------------------------------------------------------
// IPC bridge: OutboxService → renderer.
//
// Matches the style of server-registry-ipc: a typed `IpcHost` indirection
// so tests can stub `ipcMain` with a Map-backed fake.
// -----------------------------------------------------------------------------

import type { OutboxService } from './outbox-service'
import type { IpcHost } from './server-registry-ipc'

export const OUTBOX_IPC_CHANNELS = {
  ENQUEUE_AND_FIRE: 'outbox:enqueue-and-fire',
  DRAIN: 'outbox:drain',
  LIST: 'outbox:list',
  REMOVE: 'outbox:remove',
} as const

export interface EnqueueAndFireInput {
  readonly registryId: string
  readonly method: string
  readonly input: unknown
}

export function registerOutboxIpc(host: IpcHost, outbox: OutboxService): () => void {
  host.handle(OUTBOX_IPC_CHANNELS.ENQUEUE_AND_FIRE, async (_evt: unknown, arg: unknown) => {
    const { registryId, method, input } = arg as EnqueueAndFireInput
    return await outbox.enqueueAndFire(registryId, method, input)
  })

  host.handle(OUTBOX_IPC_CHANNELS.DRAIN, async (_evt: unknown, registryId: unknown) => {
    return await outbox.drainForRegistry(registryId as string)
  })

  host.handle(OUTBOX_IPC_CHANNELS.LIST, (_evt: unknown, registryId: unknown) => {
    return outbox.listPending(typeof registryId === 'string' ? registryId : undefined)
  })

  host.handle(OUTBOX_IPC_CHANNELS.REMOVE, (_evt: unknown, id: unknown) => {
    return outbox.removeEntry(id as string)
  })

  return () => {
    host.removeHandler(OUTBOX_IPC_CHANNELS.ENQUEUE_AND_FIRE)
    host.removeHandler(OUTBOX_IPC_CHANNELS.DRAIN)
    host.removeHandler(OUTBOX_IPC_CHANNELS.LIST)
    host.removeHandler(OUTBOX_IPC_CHANNELS.REMOVE)
  }
}
