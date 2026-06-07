import { Context, Effect, Layer } from 'effect'
import type { NotificationEmitInput, NotificationPriority, NotificationType } from '../../../../shared/contracts/events'
import { DatabaseService } from '../../../infra/database'
import {
  dismissAllNotifications,
  insertNotification,
  listRecentNotifications,
  listUnresolvedNotifications,
  listUnresolvedNotificationsOrdered,
  markNotificationRead,
  type NotificationRow,
  resolveNotification,
  resolveNotificationsByIds,
  resolveWorkspaceFromPod,
} from '../repository'

export type { NotificationEmitInput, NotificationPriority, NotificationType }
export type { NotificationRow } from '../repository'

interface PriorityCounts {
  blocking: number
  urgent: number
  info: number
}

interface UnresolvedCounts {
  byPod: Record<string, PriorityCounts>
  byWorkspace: Record<string, PriorityCounts>
  global: PriorityCounts
  totalBlocking: number
  totalUrgent: number
}

export interface NotificationControllerShape {
  readonly emit: (input: NotificationEmitInput) => Effect.Effect<NotificationRow>
  readonly resolve: (id: string, resolution: string) => Effect.Effect<void>
  readonly resolveByPayload: (key: string, value: unknown, resolution: string) => Effect.Effect<number>
  readonly resolveAllPendingPermissions: () => Effect.Effect<number>
  readonly resolvePendingPermissionsForTerminal: (podTerminalId: string, resolution: string) => Effect.Effect<number>
  readonly dismissAll: () => Effect.Effect<number>
  readonly markRead: (id: string) => Effect.Effect<void>
  readonly listUnresolved: () => Effect.Effect<NotificationRow[]>
  readonly listRecent: (limit?: number) => Effect.Effect<NotificationRow[]>
  readonly unresolvedCounts: () => Effect.Effect<UnresolvedCounts>
}

export class NotificationController extends Context.Tag('NotificationController')<
  NotificationController,
  NotificationControllerShape
>() {}

export const NotificationControllerLive = Layer.effect(
  NotificationController,
  Effect.gen(function* () {
    const db = yield* DatabaseService

    return {
      emit: (input) =>
        Effect.sync(() => {
          let { workspaceId } = input
          if (input.podId && !workspaceId) {
            const pod = resolveWorkspaceFromPod(db, input.podId)
            if (pod) workspaceId = pod.workspaceId
          }
          return insertNotification(db, {
            type: input.type,
            priority: input.priority,
            podId: input.podId ?? null,
            podTerminalId: input.podTerminalId ?? null,
            workspaceId: workspaceId ?? null,
            title: input.title,
            body: input.body ?? null,
            payload: input.payload ?? null,
          })
        }),

      resolve: (id, resolution) => Effect.sync(() => resolveNotification(db, id, resolution)),

      resolveByPayload: (key, value, resolution) =>
        Effect.sync(() => {
          const unresolved = listUnresolvedNotifications(db)
          const toResolve: string[] = []
          for (const row of unresolved) {
            const payload = row.payload
            if (payload && payload[key] === value) toResolve.push(row.id)
          }
          resolveNotificationsByIds(db, toResolve, resolution)
          return toResolve.length
        }),

      resolveAllPendingPermissions: () =>
        Effect.sync(() => {
          const unresolved = listUnresolvedNotifications(db)
          const toResolve = unresolved.filter((r) => r.type === 'agent:permission-request').map((r) => r.id)
          resolveNotificationsByIds(db, toResolve, 'accepted')
          return toResolve.length
        }),

      resolvePendingPermissionsForTerminal: (podTerminalId, resolution) =>
        Effect.sync(() => {
          const unresolved = listUnresolvedNotifications(db)
          const toResolve = unresolved
            .filter((r) => r.type === 'agent:permission-request' && r.podTerminalId === podTerminalId)
            .map((r) => r.id)
          resolveNotificationsByIds(db, toResolve, resolution)
          return toResolve.length
        }),

      dismissAll: () => Effect.sync(() => dismissAllNotifications(db)),
      markRead: (id) => Effect.sync(() => markNotificationRead(db, id)),
      listUnresolved: () => Effect.sync(() => listUnresolvedNotificationsOrdered(db)),
      listRecent: (limit = 50) => Effect.sync(() => listRecentNotifications(db, limit)),

      unresolvedCounts: () =>
        Effect.sync(() => {
          const rows = listUnresolvedNotifications(db)
          const result: UnresolvedCounts = {
            byPod: {},
            byWorkspace: {},
            global: { blocking: 0, urgent: 0, info: 0 },
            totalBlocking: 0,
            totalUrgent: 0,
          }
          for (const row of rows) {
            const priority = row.priority
            if (row.podId) {
              const bucket = (result.byPod[row.podId] ??= { blocking: 0, urgent: 0, info: 0 })
              bucket[priority]++
            }
            if (row.workspaceId) {
              const bucket = (result.byWorkspace[row.workspaceId] ??= { blocking: 0, urgent: 0, info: 0 })
              bucket[priority]++
            }
            if (!row.podId) result.global[priority]++
            if (priority === 'blocking') result.totalBlocking++
            if (priority === 'urgent') result.totalUrgent++
          }
          return result
        }),
    }
  }),
)
