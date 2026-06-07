// -----------------------------------------------------------------------------
// Dotted procedure-path union derived from the oRPC router type.
//
// `AppRouter` is a nested tree whose leaves are `Procedure` and whose branches
// are plain objects keyed by namespace. `RouterProcedurePath` walks that tree
// at the type level and produces the union of every leaf path joined with `.`
// (e.g. `'pod.create'`, `'agent.session.prompt'`). Anything typed against this
// union — like the mutation registry in `runtime.ts` — is checked against the
// real router shape, so a renamed or removed procedure becomes a compile error.
// -----------------------------------------------------------------------------

import type { AnyProcedure } from '@orpc/server'
import type { AppRouter } from '../router/index'

type RouterProcedurePath<T> = T extends AnyProcedure
  ? ''
  : {
      [K in keyof T & string]: RouterProcedurePath<T[K]> extends infer R extends string
        ? R extends ''
          ? K
          : `${K}.${R}`
        : never
    }[keyof T & string]

export type AppRouterProcedurePath = RouterProcedurePath<AppRouter>
