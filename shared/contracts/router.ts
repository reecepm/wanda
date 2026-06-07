// -----------------------------------------------------------------------------
// Router type contract.
//
// The single type-level boundary between the server runtime (in electron/)
// and any client that talks to it (renderer, standalone web, CLI tools).
// Import `AppRouter` from here instead of reaching into electron/router —
// this lets us swap the underlying router implementation without touching
// dozens of call sites.
//
// This file has ZERO runtime code — type-only re-exports that disappear at
// compile time. The transitive pull into electron/ is acceptable because tsc
// only follows types, not values. If the web typecheck ever needs to be
// fully independent of the electron program, replace with a standalone
// interface declaration.
// -----------------------------------------------------------------------------

import type { RouterClient } from '@orpc/server'
import type { AppRouter as ServerAppRouter } from '../../electron/router/index'

export type AppRouter = ServerAppRouter
export type AppClient = RouterClient<AppRouter>
