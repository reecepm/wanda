import { and, eq, isNull } from 'drizzle-orm'
import { v4 as uuid } from 'uuid'
import type { AppDatabase } from '../../../db/connection'
import { notifications, podAgents, podTerminals } from '../../../db/schema'
import type { AgentType } from '../types'
import type { PodTerminalRow } from './terminals'

export type PodAgentRow = typeof podAgents.$inferSelect
export type NotificationRow = typeof notifications.$inferSelect

type PodAgentWithAttention = PodAgentRow & {
  terminal: PodTerminalRow
  attentionRequests: NotificationRow[]
  needsAttention: boolean
}

export function insertAgentWithTerminal(
  db: AppDatabase,
  input: {
    podId: string
    name: string
    agentType: AgentType
    command: string
    args?: string[] | null
  },
) {
  const terminalId = uuid()
  db.insert(podTerminals)
    .values({
      id: terminalId,
      podId: input.podId,
      name: input.name,
      command: input.command,
      args: input.args ?? null,
      restartPolicy: 'never',
    })
    .run()

  const agentId = uuid()
  db.insert(podAgents)
    .values({
      id: agentId,
      podId: input.podId,
      podTerminalId: terminalId,
      agentType: input.agentType,
    })
    .run()

  return db.select().from(podAgents).where(eq(podAgents.id, agentId)).get()!
}

export function getAgentById(db: AppDatabase, id: string) {
  return db.select().from(podAgents).where(eq(podAgents.id, id)).get()
}

export function getAgentByTerminalId(db: AppDatabase, terminalId: string) {
  return db.select().from(podAgents).where(eq(podAgents.podTerminalId, terminalId)).get()
}

export function listAgentsByPod(db: AppDatabase, podId: string): PodAgentRow[] {
  return db.select().from(podAgents).where(eq(podAgents.podId, podId)).all()
}

export function listAgentTerminalTypesByPod(db: AppDatabase, podId: string): { tid: string; agentType: AgentType }[] {
  return db
    .select({ tid: podAgents.podTerminalId, agentType: podAgents.agentType })
    .from(podAgents)
    .where(eq(podAgents.podId, podId))
    .all()
}

export function deleteAgentWithTerminal(db: AppDatabase, agent: PodAgentRow) {
  db.delete(podAgents).where(eq(podAgents.id, agent.id)).run()
  db.delete(podTerminals).where(eq(podTerminals.id, agent.podTerminalId)).run()
}

export function listAgentsWithAttention(db: AppDatabase, podId: string): PodAgentWithAttention[] {
  const agents = db.select().from(podAgents).where(eq(podAgents.podId, podId)).all()
  return agents.map((agent) => {
    const terminal = db.select().from(podTerminals).where(eq(podTerminals.id, agent.podTerminalId)).get()!
    const attentionRequests = db
      .select()
      .from(notifications)
      .where(and(eq(notifications.podTerminalId, agent.podTerminalId), isNull(notifications.resolvedAt)))
      .all()
    return { ...agent, terminal, attentionRequests, needsAttention: attentionRequests.length > 0 }
  })
}
