import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm'
import { v4 as uuid } from 'uuid'
import type { AppDatabase } from '../../../db/connection'
import { commandTags, podAgents, podCommands, podCommandTags, pods, podTerminals } from '../../../db/schema'
import type { PodAgentRow } from './agents'
import type { PodRow } from './pods'
import type { PodTerminalRow } from './terminals'

interface TerminalCopy {
  readonly sourceTerminal: PodTerminalRow
  readonly targetTerminal: PodTerminalRow
  readonly sourceAgent: PodAgentRow | undefined
  readonly targetAgent: PodAgentRow | undefined
}

interface PodBackingCopy {
  readonly terminalCopies: TerminalCopy[]
  readonly commandIdMap: Map<string, string>
}

interface CreatedPodBackingCopy extends PodBackingCopy {
  readonly sourcePod: PodRow
  readonly targetPod: PodRow
}

function copyTerminalRows(db: AppDatabase, sourcePodId: string, targetPodId: string): TerminalCopy[] {
  const copies: TerminalCopy[] = []
  const terminals = db.select().from(podTerminals).where(eq(podTerminals.podId, sourcePodId)).all()
  for (const sourceTerminal of terminals) {
    const terminalId = uuid()
    db.insert(podTerminals)
      .values({
        id: terminalId,
        podId: targetPodId,
        name: sourceTerminal.name,
        command: sourceTerminal.command,
        args: sourceTerminal.args,
        env: sourceTerminal.env,
        restartPolicy: sourceTerminal.restartPolicy,
        sortOrder: sourceTerminal.sortOrder,
      })
      .run()
    const targetTerminal = db.select().from(podTerminals).where(eq(podTerminals.id, terminalId)).get()!

    const sourceAgent = db.select().from(podAgents).where(eq(podAgents.podTerminalId, sourceTerminal.id)).get()
    let targetAgent: PodAgentRow | undefined
    if (sourceAgent) {
      const agentId = uuid()
      db.insert(podAgents)
        .values({
          id: agentId,
          podId: targetPodId,
          podTerminalId: terminalId,
          agentType: sourceAgent.agentType,
        })
        .run()
      targetAgent = db.select().from(podAgents).where(eq(podAgents.id, agentId)).get()
    }

    copies.push({ sourceTerminal, targetTerminal, sourceAgent, targetAgent })
  }
  return copies
}

function copyCommandRows(db: AppDatabase, sourcePodId: string, targetPodId: string): Map<string, string> {
  const commandIdMap = new Map<string, string>()
  const commands = db.select().from(podCommands).where(eq(podCommands.podId, sourcePodId)).all()
  for (const command of commands) {
    const commandId = uuid()
    commandIdMap.set(command.id, commandId)
    db.insert(podCommands)
      .values({
        id: commandId,
        podId: targetPodId,
        name: command.name,
        command: command.command,
        directory: command.directory,
        directoryMode: command.directoryMode,
        args: command.args,
        autoStart: command.autoStart,
        sortOrder: command.sortOrder,
      })
      .run()
  }

  const sourceTags = db.select().from(commandTags).where(eq(commandTags.podId, sourcePodId)).all()
  const tagIdMap = new Map<string, string>()
  for (const tag of sourceTags) {
    const tagId = uuid()
    tagIdMap.set(tag.id, tagId)
    db.insert(commandTags).values({ id: tagId, podId: targetPodId, name: tag.name }).run()
  }

  if (commandIdMap.size > 0) {
    const sourceAssociations = db
      .select()
      .from(podCommandTags)
      .where(inArray(podCommandTags.commandId, [...commandIdMap.keys()]))
      .all()
    for (const association of sourceAssociations) {
      const commandId = commandIdMap.get(association.commandId)
      const tagId = tagIdMap.get(association.tagId)
      if (commandId && tagId) {
        db.insert(podCommandTags).values({ commandId, tagId }).onConflictDoNothing().run()
      }
    }
  }

  return commandIdMap
}

export function copyPodBackingRows(db: AppDatabase, sourcePodId: string, targetPodId: string): PodBackingCopy {
  return {
    terminalCopies: copyTerminalRows(db, sourcePodId, targetPodId),
    commandIdMap: copyCommandRows(db, sourcePodId, targetPodId),
  }
}

export function createPodCopy(
  db: AppDatabase,
  sourcePodId: string,
  input: {
    name?: string
    workspaceId?: string | null
    isTemplate?: boolean
    templateDescription?: string
  } = {},
): CreatedPodBackingCopy | null {
  const sourcePod = db.select().from(pods).where(eq(pods.id, sourcePodId)).get()
  if (!sourcePod) return null

  const targetPodId = uuid()
  db.insert(pods)
    .values({
      id: targetPodId,
      workspaceId: input.workspaceId ?? sourcePod.workspaceId,
      name: input.name ?? `${sourcePod.name} (copy)`,
      cwd: sourcePod.cwd,
      shell: sourcePod.shell,
      env: sourcePod.env,
      runtime: sourcePod.runtime,
      containerLifecycle: sourcePod.containerLifecycle,
      sliceBranch: sourcePod.sliceBranch,
      wandaMcpPolicy: sourcePod.wandaMcpPolicy,
      isTemplate: input.isTemplate ?? false,
      templateDescription: input.templateDescription,
    })
    .run()

  const targetPod = db.select().from(pods).where(eq(pods.id, targetPodId)).get()!
  return {
    sourcePod,
    targetPod,
    ...copyPodBackingRows(db, sourcePodId, targetPodId),
  }
}

export function createTemplatePod(
  db: AppDatabase,
  input: {
    name: string
    description?: string
    workspaceId?: string | null
    cwd?: string
    shell?: string
  },
): PodRow {
  const id = uuid()
  db.insert(pods)
    .values({
      id,
      workspaceId: input.workspaceId ?? null,
      name: input.name,
      cwd: input.cwd ?? '',
      shell: input.shell,
      isTemplate: true,
      templateDescription: input.description,
    })
    .run()
  return db.select().from(pods).where(eq(pods.id, id)).get()!
}

export function listTemplatePods(db: AppDatabase, workspaceId?: string): PodRow[] {
  if (workspaceId) {
    return db
      .select()
      .from(pods)
      .where(and(eq(pods.isTemplate, true), or(isNull(pods.workspaceId), eq(pods.workspaceId, workspaceId))))
      .orderBy(asc(pods.sortOrder))
      .all()
  }
  return db.select().from(pods).where(eq(pods.isTemplate, true)).orderBy(asc(pods.sortOrder)).all()
}
