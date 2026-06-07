import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { AgentStatusService, AgentStatusServiceLive, type AgentStatusServiceShape } from './status-service'

describe('AgentStatusService', () => {
  async function withService<A>(fn: (svc: AgentStatusServiceShape) => A | Promise<A>): Promise<A> {
    return Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* AgentStatusService
        return yield* Effect.promise(() => Promise.resolve(fn(svc)))
      }).pipe(Effect.provide(AgentStatusServiceLive)),
    )
  }

  it('registers launched agent terminals as idle', async () => {
    await withService((svc) => {
      svc.register('terminal-1', 'claude', '/workspace')

      expect(svc.get('terminal-1')?.status).toBe('idle')
      expect(svc.get('terminal-1')?.lastEvent).toBe('registered')
    })
  })

  it('keeps session lifecycle events idle until work starts', async () => {
    await withService((svc) => {
      svc.register('terminal-1', 'claude', '/workspace')

      svc.update({
        terminalId: 'terminal-1',
        agentType: 'claude',
        cwd: '/workspace',
        sessionId: 'session-1',
        event: 'SessionStart',
      })

      expect(svc.get('terminal-1')?.status).toBe('idle')

      svc.update({
        terminalId: 'terminal-1',
        agentType: 'claude',
        cwd: '/workspace',
        sessionId: 'session-1',
        event: 'UserPromptSubmit',
      })

      expect(svc.get('terminal-1')?.status).toBe('working')
    })
  })

  it('returns to idle after the agent turn completes', async () => {
    await withService((svc) => {
      svc.register('terminal-1', 'codex', '/workspace')
      svc.update({
        terminalId: 'terminal-1',
        agentType: 'codex',
        cwd: '/workspace',
        turnId: 'turn-1',
        event: 'PreToolUse',
      })

      expect(svc.get('terminal-1')?.status).toBe('working')

      svc.update({
        terminalId: 'terminal-1',
        agentType: 'codex',
        cwd: '/workspace',
        turnId: 'turn-1',
        event: 'Stop',
      })

      expect(svc.get('terminal-1')?.status).toBe('idle')
    })
  })

  it('ignores delayed work events for a Codex turn after Stop has idled it', async () => {
    await withService((svc) => {
      svc.register('terminal-1', 'codex', '/workspace')
      svc.update({
        terminalId: 'terminal-1',
        agentType: 'codex',
        cwd: '/workspace',
        turnId: 'turn-1',
        event: 'UserPromptSubmit',
      })
      svc.update({
        terminalId: 'terminal-1',
        agentType: 'codex',
        cwd: '/workspace',
        turnId: 'turn-1',
        event: 'Stop',
      })

      expect(svc.get('terminal-1')?.status).toBe('idle')

      svc.update({
        terminalId: 'terminal-1',
        agentType: 'codex',
        cwd: '/workspace',
        turnId: 'turn-1',
        event: 'PostToolUse',
      })

      expect(svc.get('terminal-1')?.status).toBe('idle')
    })
  })
})
