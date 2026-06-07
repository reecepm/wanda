import vm from 'node:vm'
import type { WandaRuntime } from './runtime.js'

const TIMEOUT_MS = 30_000

export async function executeSandboxed(
  code: string,
  runtime: WandaRuntime,
): Promise<{ result?: unknown; logs: string[] }> {
  const logs: string[] = []

  const sandbox = {
    wanda: runtime,
    console: {
      log: (...args: unknown[]) => logs.push(args.map(String).join(' ')),
      error: (...args: unknown[]) => logs.push(`[error] ${args.map(String).join(' ')}`),
      warn: (...args: unknown[]) => logs.push(`[warn] ${args.map(String).join(' ')}`),
    },
  }

  const context = vm.createContext(sandbox)

  // Wrap in async IIFE so top-level await works
  const wrapped = `(async () => {\n${code}\n})()`

  try {
    const script = new vm.Script(wrapped, { filename: 'mcp-execute.js' })
    const result = await script.runInContext(context, { timeout: TIMEOUT_MS })
    return { result, logs }
  } catch (err: unknown) {
    return { result: { error: err instanceof Error ? err.message : String(err) }, logs }
  }
}
