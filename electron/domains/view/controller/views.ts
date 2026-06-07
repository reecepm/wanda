import { Context, Effect, Layer } from 'effect'
import { DatabaseService } from '../../../infra/database'
import { AppError } from '../../../services/errors'
import {
  createView,
  deleteView,
  getViewById,
  listPodItems,
  listViewsByPod,
  setActivePodView,
  updateView,
  type ViewRow,
  type ViewUpdateInput,
} from '../repository'
import type { ViewConfig, ViewItemSettings } from '../types'
import { remapViewConfigItemIds } from '../utils/remap'

/** The template pod has no views to derive a new view from. */
class TemplateHasNoViews extends AppError('TemplateHasNoViews', 'UNPROCESSABLE_CONTENT')<{
  readonly templatePodId: string
}> {}

interface ViewControllerShape {
  readonly listByPod: (podId: string) => Effect.Effect<ViewRow[]>
  readonly getById: (id: string) => Effect.Effect<ViewRow | undefined>
  readonly create: (input: {
    podId: string
    name: string
    viewType?: string
    config?: ViewConfig
    itemSettings?: Record<string, ViewItemSettings>
    sortOrder?: number
  }) => Effect.Effect<ViewRow>
  readonly update: (id: string, input: ViewUpdateInput) => Effect.Effect<ViewRow>
  readonly delete: (id: string) => Effect.Effect<void>
  readonly applyTemplate: (templatePodId: string, podId: string) => Effect.Effect<ViewRow, TemplateHasNoViews>
  readonly copyViews: (
    sourcePodId: string,
    targetPodId: string,
    itemIdMap?: ReadonlyMap<string, string>,
  ) => Effect.Effect<ViewRow[]>
  readonly ensureDefaultView: (podId: string) => Effect.Effect<ViewRow>
}

export class ViewController extends Context.Tag('ViewController')<ViewController, ViewControllerShape>() {}

export const ViewControllerLive = Layer.effect(
  ViewController,
  Effect.gen(function* () {
    const db = yield* DatabaseService

    return {
      listByPod: (podId) => Effect.sync(() => listViewsByPod(db, podId)),
      getById: (id) => Effect.sync(() => getViewById(db, id)),
      create: (input) => Effect.sync(() => createView(db, input)),
      update: (id, input) => Effect.sync(() => updateView(db, id, input)),
      delete: (id) => Effect.sync(() => deleteView(db, id)),

      applyTemplate: (templatePodId, podId) =>
        Effect.gen(function* () {
          const templateViews = listViewsByPod(db, templatePodId)
          const templateView = templateViews[0]
          if (!templateView) {
            return yield* new TemplateHasNoViews({
              templatePodId,
              message: `Template pod ${templatePodId} has no views`,
            })
          }

          const items = listPodItems(db, podId)
          const itemSettings: Record<string, ViewItemSettings> = {}
          for (const item of items) {
            itemSettings[item.id] = { sortOrder: item.sortOrder }
          }

          return createView(db, {
            podId,
            name: templateView.name,
            viewType: templateView.viewType,
            config: templateView.config ?? undefined,
            itemSettings,
          })
        }),

      copyViews: (sourcePodId, targetPodId, providedItemIdMap) =>
        Effect.sync(() => {
          const sourceViews = listViewsByPod(db, sourcePodId)
          if (sourceViews.length === 0) {
            // No views to copy — ensure at least a default
            const items = listPodItems(db, targetPodId)
            const itemSettings: Record<string, ViewItemSettings> = {}
            for (const item of items) {
              itemSettings[item.id] = { sortOrder: item.sortOrder }
            }
            const view = createView(db, {
              podId: targetPodId,
              name: 'Default',
              viewType: 'tabs',
              config: { type: 'tabs' },
              itemSettings,
            })
            setActivePodView(db, targetPodId, view.id)
            return [view]
          }

          // Build source→target item ID mapping by matching contentType + label
          const sourceItems = listPodItems(db, sourcePodId)
          const targetItems = listPodItems(db, targetPodId)
          const itemIdMap = new Map<string, string>(providedItemIdMap)

          const targetByKey = new Map<string, string[]>()
          for (const ti of targetItems) {
            const key = `${ti.contentType}:${ti.label}`
            const arr = targetByKey.get(key) ?? []
            arr.push(ti.id)
            targetByKey.set(key, arr)
          }
          // Track consumption index per key to handle duplicates
          const consumed = new Map<string, number>()
          for (const si of sourceItems) {
            if (itemIdMap.has(si.id)) continue
            const key = `${si.contentType}:${si.label}`
            const idx = consumed.get(key) ?? 0
            const candidates = targetByKey.get(key)
            const match = candidates?.[idx]
            if (match !== undefined) {
              itemIdMap.set(si.id, match)
              consumed.set(key, idx + 1)
            }
          }

          const created: ViewRow[] = []
          let firstViewId: string | null = null

          for (const sv of sourceViews) {
            const sourceSettings = (sv.itemSettings ?? {}) as Record<string, ViewItemSettings>

            const itemSettings: Record<string, ViewItemSettings> = {}
            for (const [srcItemId, settings] of Object.entries(sourceSettings)) {
              const targetItemId = itemIdMap.get(srcItemId)
              if (targetItemId) {
                itemSettings[targetItemId] = { ...settings }
              }
            }
            // Add any target items not covered by the source view
            for (const ti of targetItems) {
              if (!itemSettings[ti.id]) {
                itemSettings[ti.id] = { sortOrder: ti.sortOrder }
              }
            }

            const remappedConfig = remapViewConfigItemIds(sv.config, itemIdMap)
            const view = createView(db, {
              podId: targetPodId,
              name: sv.name,
              viewType: sv.viewType,
              config: remappedConfig ?? undefined,
              itemSettings,
              sortOrder: sv.sortOrder,
            })
            created.push(view)
            if (!firstViewId) firstViewId = view.id
          }

          if (firstViewId) {
            setActivePodView(db, targetPodId, firstViewId)
          }
          return created
        }),

      ensureDefaultView: (podId) =>
        Effect.sync(() => {
          const existing = listViewsByPod(db, podId)
          const firstExisting = existing[0]
          if (firstExisting) {
            const items = listPodItems(db, podId)
            for (const view of existing) {
              const currentSettings = (view.itemSettings ?? {}) as Record<string, ViewItemSettings>
              let changed = false
              for (const item of items) {
                if (!currentSettings[item.id]) {
                  currentSettings[item.id] = { sortOrder: item.sortOrder }
                  changed = true
                }
              }
              if (changed) {
                updateView(db, view.id, { itemSettings: currentSettings })
              }
            }
            return getViewById(db, firstExisting.id) ?? firstExisting
          }

          const items = listPodItems(db, podId)
          const itemSettings: Record<string, ViewItemSettings> = {}
          for (const item of items) {
            itemSettings[item.id] = { sortOrder: item.sortOrder }
          }

          const view = createView(db, {
            podId,
            name: 'Default',
            viewType: 'tabs',
            config: { type: 'tabs' },
            itemSettings,
          })
          setActivePodView(db, podId, view.id)
          return view
        }),
    }
  }),
)
