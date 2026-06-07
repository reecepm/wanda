import { Context, Effect, Layer } from 'effect'
import { DatabaseService } from '../../../infra/database'
import { PodController } from '../../pod'
import type { ViewConfig } from '../../view/types'
import {
  type AggregatedCommandConfigs,
  type AggregatedItems,
  type AggregatedTerminalConfigs,
  createWorkspaceView,
  deleteWorkspaceView,
  getWorkspaceViewById,
  listAggregatedCommandConfigs,
  listAggregatedItems,
  listAggregatedTerminalConfigs,
  listViewsByWorkspace,
  setActiveWorkspaceView,
  updateWorkspaceView,
  type WorkspaceViewRow,
  type WorkspaceViewUpdateInput,
} from '../repository'

interface WorkspaceViewControllerShape {
  readonly listByWorkspace: (workspaceId: string) => Effect.Effect<WorkspaceViewRow[]>
  readonly getById: (id: string) => Effect.Effect<WorkspaceViewRow | undefined>
  readonly create: (input: {
    workspaceId: string
    name: string
    viewType?: string
    config?: ViewConfig
    sortOrder?: number
  }) => Effect.Effect<WorkspaceViewRow>
  readonly update: (id: string, input: WorkspaceViewUpdateInput) => Effect.Effect<WorkspaceViewRow>
  readonly delete: (id: string) => Effect.Effect<void>
  readonly setActiveView: (workspaceId: string, viewId: string | null) => Effect.Effect<void>
  readonly ensureDefault: (workspaceId: string) => Effect.Effect<WorkspaceViewRow>
  readonly aggregatedItems: (workspaceId: string) => Effect.Effect<AggregatedItems>
  readonly aggregatedConfigs: (workspaceId: string) => Effect.Effect<{
    terminalConfigs: AggregatedTerminalConfigs
    commandConfigs: AggregatedCommandConfigs
  }>
  readonly aggregatedRunningState: (workspaceId: string) => Effect.Effect<{
    runningTerminals: { podTerminalId: string; ptyInstanceId: string; name: string; podId: string }[]
    runningCommands: { podCommandId: string; ptyInstanceId: string; name: string; podId: string }[]
  }>
}

export class WorkspaceViewController extends Context.Tag('WorkspaceViewController')<
  WorkspaceViewController,
  WorkspaceViewControllerShape
>() {}

export const WorkspaceViewControllerLive = Layer.effect(
  WorkspaceViewController,
  Effect.gen(function* () {
    const db = yield* DatabaseService
    const podSvc = yield* PodController

    return {
      listByWorkspace: (workspaceId) => Effect.sync(() => listViewsByWorkspace(db, workspaceId)),
      getById: (id) => Effect.sync(() => getWorkspaceViewById(db, id)),
      create: (input) => Effect.sync(() => createWorkspaceView(db, input)),
      update: (id, input) => Effect.sync(() => updateWorkspaceView(db, id, input)),
      delete: (id) => Effect.sync(() => deleteWorkspaceView(db, id)),
      setActiveView: (workspaceId, viewId) => Effect.sync(() => setActiveWorkspaceView(db, workspaceId, viewId)),

      ensureDefault: (workspaceId) =>
        Effect.sync(() => {
          const existing = listViewsByWorkspace(db, workspaceId)
          const first = existing[0]
          if (first) {
            // Fix up views with null config (from early migration without defaults)
            if (!first.config) {
              updateWorkspaceView(db, first.id, { config: { type: 'columns', rows: [] } })
              return getWorkspaceViewById(db, first.id)!
            }
            return first
          }

          const view = createWorkspaceView(db, {
            workspaceId,
            name: 'Default',
            viewType: 'columns',
            config: { type: 'columns', rows: [] },
          })
          setActiveWorkspaceView(db, workspaceId, view.id)
          return view
        }),

      aggregatedItems: (workspaceId) => Effect.sync(() => listAggregatedItems(db, workspaceId)),

      aggregatedConfigs: (workspaceId) =>
        Effect.sync(() => ({
          terminalConfigs: listAggregatedTerminalConfigs(db, workspaceId),
          commandConfigs: listAggregatedCommandConfigs(db, workspaceId),
        })),

      aggregatedRunningState: (workspaceId) =>
        Effect.gen(function* () {
          const items = listAggregatedItems(db, workspaceId)
          const podIds = [...new Set(items.map((i) => i.podId))]

          const results = yield* Effect.all(
            podIds.map((podId) =>
              Effect.all([podSvc.runningTerminals(podId), podSvc.runningCommands(podId)]).pipe(
                Effect.map(([terminals, commands]) => ({ podId, terminals, commands })),
              ),
            ),
            { concurrency: 'unbounded' },
          )

          return {
            runningTerminals: results.flatMap((r) => r.terminals.map((t) => ({ ...t, podId: r.podId }))),
            runningCommands: results.flatMap((r) => r.commands.map((c) => ({ ...c, podId: r.podId }))),
          }
        }),
    }
  }),
)
