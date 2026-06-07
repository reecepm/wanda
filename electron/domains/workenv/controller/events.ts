// -----------------------------------------------------------------------------
// WorkenvEvents service.
//
// Thin Effect wrapper over the event repository that also pushes a
// `workenv.event.added` broadcast on every append. The broadcast is a
// cache-invalidation marker — clients re-fetch the event list when they
// see one. The persisted row remains the source of truth; missed
// broadcasts are recoverable.
// -----------------------------------------------------------------------------

import { Context, Effect, Layer } from 'effect'
import { Broadcaster } from '../../../infra/broadcaster'
import { DatabaseService } from '../../../infra/database'
import {
  type AppendEventInput,
  appendWorkenvEvent,
  type ListEventsOptions,
  listEventsForWorkenv,
  type WorkenvEventRow,
} from '../repository/events'

export interface WorkenvEventsShape {
  readonly append: (input: AppendEventInput) => Effect.Effect<WorkenvEventRow>
  readonly listForWorkenv: (workenvId: string, opts?: ListEventsOptions) => Effect.Effect<WorkenvEventRow[]>
}

export class WorkenvEvents extends Context.Tag('WorkenvEvents')<WorkenvEvents, WorkenvEventsShape>() {}

export const WorkenvEventsLive = Layer.effect(
  WorkenvEvents,
  Effect.gen(function* () {
    const db = yield* DatabaseService
    const broadcaster = yield* Broadcaster

    return {
      append: (input) =>
        Effect.sync(() => {
          const row = appendWorkenvEvent(db, input)
          broadcaster.send('workenv.event.added', row.workenvId, row.type)
          return row
        }),

      listForWorkenv: (workenvId, opts) => Effect.sync(() => listEventsForWorkenv(db, workenvId, opts)),
    }
  }),
)
