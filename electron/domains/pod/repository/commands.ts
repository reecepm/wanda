import { and, asc, eq, inArray } from 'drizzle-orm'
import { v4 as uuid } from 'uuid'
import type { AppDatabase } from '../../../db/connection'
import { commandTags, podCommands, podCommandTags } from '../../../db/schema'
import type { CommandArg } from '../types'

export type PodCommandRow = typeof podCommands.$inferSelect
export type CommandTagRow = typeof commandTags.$inferSelect
export type PodCommandWithTags = PodCommandRow & { tags: string[] }

export type PodCommandUpdateInput = Partial<
  Pick<
    typeof podCommands.$inferInsert,
    'name' | 'command' | 'directory' | 'directoryMode' | 'autoStart' | 'sortOrder' | 'args'
  >
>

export function insertCommand(
  db: AppDatabase,
  input: {
    podId: string
    name: string
    command: string
    directory?: string
    directoryMode?: 'absolute' | 'relative'
    autoStart?: boolean
    args?: CommandArg[]
  },
) {
  const id = uuid()
  db.insert(podCommands)
    .values({
      id,
      podId: input.podId,
      name: input.name,
      command: input.command,
      directory: input.directory ?? null,
      directoryMode: input.directoryMode ?? 'absolute',
      args: input.args ?? null,
      autoStart: input.autoStart ?? false,
    })
    .run()
  return db.select().from(podCommands).where(eq(podCommands.id, id)).get()!
}

export function updateCommand(db: AppDatabase, id: string, input: PodCommandUpdateInput) {
  db.update(podCommands)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(podCommands.id, id))
    .run()
  return db.select().from(podCommands).where(eq(podCommands.id, id)).get()!
}

export function deleteCommand(db: AppDatabase, id: string) {
  db.delete(podCommands).where(eq(podCommands.id, id)).run()
}

export function getCommandById(db: AppDatabase, id: string) {
  return db.select().from(podCommands).where(eq(podCommands.id, id)).get()
}

export function listCommandsByPod(db: AppDatabase, podId: string): PodCommandRow[] {
  return db.select().from(podCommands).where(eq(podCommands.podId, podId)).all()
}

export function listCommandsWithTags(db: AppDatabase, podId: string): PodCommandWithTags[] {
  const commands = db
    .select()
    .from(podCommands)
    .where(eq(podCommands.podId, podId))
    .orderBy(asc(podCommands.sortOrder))
    .all()
  if (commands.length === 0) return []

  const tagRows = db
    .select({ commandId: podCommandTags.commandId, name: commandTags.name })
    .from(podCommandTags)
    .innerJoin(commandTags, eq(podCommandTags.tagId, commandTags.id))
    .where(
      inArray(
        podCommandTags.commandId,
        commands.map((command) => command.id),
      ),
    )
    .all()

  const tagsByCommand = new Map<string, string[]>()
  for (const row of tagRows) {
    const tags = tagsByCommand.get(row.commandId) ?? []
    tags.push(row.name)
    tagsByCommand.set(row.commandId, tags)
  }

  return commands.map((command) => ({ ...command, tags: tagsByCommand.get(command.id) ?? [] }))
}

export function importCommands(
  db: AppDatabase,
  podId: string,
  commands: Array<{
    name: string
    command: string
    directory?: string
    directoryMode?: 'absolute' | 'relative'
    autoStart?: boolean
    args?: CommandArg[]
    tagNames?: string[]
  }>,
) {
  const results: PodCommandRow[] = []
  for (const command of commands) {
    const inserted = insertCommand(db, { podId, ...command })

    for (const tagName of command.tagNames ?? []) {
      const tag = createTag(db, podId, tagName)
      tagCommand(db, inserted.id, tag.id)
    }

    results.push(inserted)
  }
  return results
}

export function listTags(db: AppDatabase, podId: string) {
  return db.select().from(commandTags).where(eq(commandTags.podId, podId)).all()
}

export function createTag(db: AppDatabase, podId: string, name: string) {
  const existing = listTags(db, podId).find((tag) => tag.name === name)
  if (existing) return existing
  const id = uuid()
  db.insert(commandTags).values({ id, podId, name }).run()
  return db.select().from(commandTags).where(eq(commandTags.id, id)).get()!
}

export function deleteTag(db: AppDatabase, id: string) {
  db.delete(commandTags).where(eq(commandTags.id, id)).run()
}

export function tagCommand(db: AppDatabase, commandId: string, tagId: string) {
  db.insert(podCommandTags).values({ commandId, tagId }).onConflictDoNothing().run()
}

export function untagCommand(db: AppDatabase, commandId: string, tagId: string) {
  db.delete(podCommandTags)
    .where(and(eq(podCommandTags.commandId, commandId), eq(podCommandTags.tagId, tagId)))
    .run()
}
