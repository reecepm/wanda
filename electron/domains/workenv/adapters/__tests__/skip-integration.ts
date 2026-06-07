// -----------------------------------------------------------------------------
// Integration test skip guard.
//
// Integration tests only run when:
//   1. `WANDA_INTEGRATION=1` is set, AND
//   2. The named binary is present on PATH.
//
// Otherwise the describe block becomes `describe.skip` so CI and ordinary
// local runs stay green without the runtime installed.
// -----------------------------------------------------------------------------

import { execSync } from 'node:child_process'
import { describe } from 'vitest'

type DescribeLike = typeof describe | typeof describe.skip

export function describeIntegration(bin: string): DescribeLike {
  if (process.env.WANDA_INTEGRATION !== '1') return describe.skip
  try {
    execSync(`command -v ${bin}`, { stdio: 'ignore' })
  } catch {
    return describe.skip
  }
  return describe
}
