import { Context, Effect, Layer } from 'effect'
import { DatabaseService } from '../../../infra/database'
import { log } from '../../../packages/logger'
import {
  deleteItem,
  getAllItems,
  getItemById,
  insertItem,
  listItemsByPod,
  type PodItemRow,
  type PodItemUpdateInput,
  runViewSystemV2Migration,
  updateItem,
} from '../repository'
import type { PodItemConfig } from '../types'

interface PodItemControllerShape {
  readonly listByPod: (podId: string) => Effect.Effect<PodItemRow[]>
  readonly getById: (id: string) => Effect.Effect<PodItemRow | undefined>
  readonly create: (input: {
    podId: string
    contentType: string
    label: string
    labelSource?: string
    config: PodItemConfig
    sortOrder?: number
  }) => Effect.Effect<PodItemRow>
  readonly update: (id: string, input: PodItemUpdateInput) => Effect.Effect<PodItemRow>
  readonly updateConfig: (id: string, config: PodItemConfig) => Effect.Effect<PodItemRow>
  readonly delete: (id: string) => Effect.Effect<void>
  readonly deleteByPodTerminalId: (podTerminalId: string) => Effect.Effect<void>
  readonly deleteByPodCommandId: (podCommandId: string) => Effect.Effect<void>
  readonly createFromTerminals: (
    podId: string,
    terminals: Array<{ id: string; name: string; sortOrder: number }>,
  ) => Effect.Effect<PodItemRow[]>
}

export class PodItemController extends Context.Tag('PodItemController')<PodItemController, PodItemControllerShape>() {}

export const PodItemControllerLive = Layer.effect(
  PodItemController,
  Effect.gen(function* () {
    const db = yield* DatabaseService

    if (runViewSystemV2Migration(db)) {
      log.pod.debug('View system v2 data migration complete')
    }

    return {
      listByPod: (podId) => Effect.sync(() => listItemsByPod(db, podId)),
      getById: (id) => Effect.sync(() => getItemById(db, id)),
      create: (input) => Effect.sync(() => insertItem(db, input)),
      update: (id, input) => Effect.sync(() => updateItem(db, id, input)),
      updateConfig: (id, config) => Effect.sync(() => updateItem(db, id, { config })),
      delete: (id) => Effect.sync(() => deleteItem(db, id)),

      deleteByPodTerminalId: (podTerminalId) =>
        Effect.sync(() => {
          const all = getAllItems(db)
          for (const item of all) {
            if (
              (item.contentType === 'terminal' || item.contentType === 'agent') &&
              'podTerminalId' in item.config &&
              item.config.podTerminalId === podTerminalId
            ) {
              deleteItem(db, item.id)
            }
          }
        }),

      deleteByPodCommandId: (podCommandId) =>
        Effect.sync(() => {
          const all = getAllItems(db)
          for (const item of all) {
            if (
              item.contentType === 'command' &&
              'podCommandId' in item.config &&
              item.config.podCommandId === podCommandId
            ) {
              deleteItem(db, item.id)
            }
          }
        }),

      createFromTerminals: (podId, terminals) =>
        Effect.sync(() => {
          const created: PodItemRow[] = []
          for (const terminal of terminals) {
            created.push(
              insertItem(db, {
                podId,
                contentType: 'terminal',
                label: terminal.name,
                labelSource: 'default',
                config: { podTerminalId: terminal.id },
                sortOrder: terminal.sortOrder,
              }),
            )
          }
          return created
        }),
    }
  }),
)
