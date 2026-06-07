import { Context, Effect, Layer } from 'effect'
import { v4 as uuid } from 'uuid'
import { DatabaseService } from '../../../infra/database'
import { AGENT_CLI } from '../../../packages/agent-commands'
import { log } from '../../../packages/logger'
import { ViewController } from '../../view/controller'
import {
  type CommandTagRow,
  copyPodBackingRows,
  createPodCopy,
  createTag,
  createTemplatePod,
  deleteAgentWithTerminal,
  deleteCommand,
  deletePod,
  deleteTag,
  deleteTerminal,
  getAgentById,
  getCommandById,
  getPodById,
  importCommands,
  insertAgentWithTerminal,
  insertCommand,
  insertPod,
  insertTerminal,
  listAgentsWithAttention,
  listCommandsWithTags,
  listPodsByWorkspace,
  listTags,
  listTemplatePods,
  listTerminalsByPod,
  type NotificationRow,
  type PodAgentRow,
  type PodCommandRow,
  type PodCommandUpdateInput,
  type PodCommandWithTags,
  type PodItemRow,
  type PodRow,
  type PodTerminalRow,
  type PodTerminalUpdateInput,
  type PodUpdateInput,
  setActivePodView,
  tagCommand,
  untagCommand,
  updateCommand,
  updatePod,
  updateTerminal,
} from '../repository'
import type { AgentType, CommandArg, PodGitContext, PodRuntime } from '../types'
import { PodItemController } from './items'

interface PodCrudControllerShape {
  readonly listByWorkspace: (workspaceId: string) => Effect.Effect<PodRow[]>
  readonly getById: (id: string) => Effect.Effect<PodRow | undefined>
  readonly create: (input: {
    workspaceId: string
    name: string
    cwd: string
    shell?: string
    env?: Record<string, string>
    runtime?: PodRuntime
    sliceBranch?: string
    containerLifecycle?: 'inherit' | 'keep-running' | 'stop-on-exit'
    gitContext?: PodGitContext | null
    wandaMcpPolicy?: 'inherit' | 'include' | 'exclude' | null
  }) => Effect.Effect<PodRow>
  readonly update: (id: string, input: PodUpdateInput) => Effect.Effect<PodRow>
  readonly deletePod: (id: string) => Effect.Effect<void>
  readonly duplicate: (id: string) => Effect.Effect<PodRow | null>

  // Terminal config CRUD
  readonly addTerminal: (input: {
    podId: string
    name: string
    command?: string
    args?: string[]
    env?: Record<string, string>
    restartPolicy?: 'never' | 'on-failure' | 'always'
  }) => Effect.Effect<PodTerminalRow>
  readonly updateTerminal: (id: string, input: PodTerminalUpdateInput) => Effect.Effect<PodTerminalRow>
  readonly removeTerminal: (id: string) => Effect.Effect<void>
  readonly listTerminals: (podId: string) => Effect.Effect<PodTerminalRow[]>

  // Agent CRUD
  readonly addAgent: (input: { podId: string; name: string; agentType: AgentType }) => Effect.Effect<PodAgentRow>
  readonly removeAgent: (podAgentId: string) => Effect.Effect<void>
  readonly listAgents: (podId: string) => Effect.Effect<
    (PodAgentRow & {
      terminal: PodTerminalRow
      attentionRequests: NotificationRow[]
      needsAttention: boolean
    })[]
  >
  readonly getAgent: (podAgentId: string) => Effect.Effect<PodAgentRow | undefined>

  // Command CRUD
  readonly addCommand: (input: {
    podId: string
    name: string
    command: string
    directory?: string
    directoryMode?: 'absolute' | 'relative'
    autoStart?: boolean
    args?: CommandArg[]
  }) => Effect.Effect<PodCommandRow>
  readonly updateCommand: (id: string, input: PodCommandUpdateInput) => Effect.Effect<PodCommandRow>
  readonly removeCommand: (id: string) => Effect.Effect<void>
  readonly listCommands: (podId: string) => Effect.Effect<PodCommandWithTags[]>
  readonly getCommand: (id: string) => Effect.Effect<PodCommandRow | undefined>
  readonly importCommands: (
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
  ) => Effect.Effect<PodCommandRow[]>

  // Command tags
  readonly listTags: (podId: string) => Effect.Effect<CommandTagRow[]>
  readonly createTag: (podId: string, name: string) => Effect.Effect<CommandTagRow>
  readonly deleteTag: (id: string) => Effect.Effect<void>
  readonly tagCommand: (commandId: string, tagId: string) => Effect.Effect<void>
  readonly untagCommand: (commandId: string, tagId: string) => Effect.Effect<void>

  // Active view
  readonly setActiveView: (podId: string, viewId: string | null) => Effect.Effect<PodRow>

  // Templates
  readonly listTemplates: (workspaceId?: string) => Effect.Effect<PodRow[]>
  readonly createTemplate: (input: {
    name: string
    description?: string
    workspaceId?: string | null
    cwd?: string
    shell?: string
  }) => Effect.Effect<PodRow>
  readonly createTemplateFromPod: (
    podId: string,
    input: { name: string; description?: string; workspaceId?: string | null },
  ) => Effect.Effect<PodRow | null>
  readonly applyTemplateToPod: (podId: string, templatePodId: string) => Effect.Effect<void>
}

export class PodCrudController extends Context.Tag('PodCrudController')<PodCrudController, PodCrudControllerShape>() {}

export const PodCrudControllerLive = Layer.effect(
  PodCrudController,
  Effect.gen(function* () {
    const db = yield* DatabaseService
    const podItemSvc = yield* PodItemController
    const viewSvc = yield* ViewController

    function sourceItemForTerminal(items: PodItemRow[], terminalId: string) {
      return items.find(
        (item) =>
          (item.contentType === 'terminal' || item.contentType === 'agent') &&
          'podTerminalId' in item.config &&
          item.config.podTerminalId === terminalId,
      )
    }

    return {
      listByWorkspace: (workspaceId) => Effect.sync(() => listPodsByWorkspace(db, workspaceId)),

      getById: (id) => Effect.sync(() => getPodById(db, id)),

      create: (input) =>
        Effect.sync(() => {
          const id = uuid()
          return insertPod(db, { id, ...input })
        }),

      update: (id, input) => Effect.sync(() => updatePod(db, id, input)),

      deletePod: (id) =>
        Effect.sync(() => {
          log.pod.debug(`delete: removing pod=${id} from DB`)
          deletePod(db, id)
          log.pod.debug(`delete: completed pod=${id}`)
        }),

      duplicate: (id) =>
        Effect.gen(function* () {
          const copy = createPodCopy(db, id)
          if (!copy) return null
          const newId = copy.targetPod.id
          const itemIdMap = new Map<string, string>()
          const srcItems = yield* podItemSvc.listByPod(id)
          for (const terminalCopy of copy.terminalCopies) {
            const sourceItem = sourceItemForTerminal(srcItems, terminalCopy.sourceTerminal.id)
            if (terminalCopy.targetAgent) {
              const createdItem = yield* podItemSvc.create({
                podId: newId,
                contentType: 'agent',
                label: sourceItem?.label ?? terminalCopy.sourceTerminal.name,
                labelSource: sourceItem?.labelSource,
                config: {
                  podAgentId: terminalCopy.targetAgent.id,
                  podTerminalId: terminalCopy.targetTerminal.id,
                  agentType: terminalCopy.targetAgent.agentType,
                },
                sortOrder: sourceItem?.sortOrder ?? terminalCopy.sourceTerminal.sortOrder,
              })
              if (sourceItem) itemIdMap.set(sourceItem.id, createdItem.id)
            } else {
              const createdItem = yield* podItemSvc.create({
                podId: newId,
                contentType: 'terminal',
                label: sourceItem?.label ?? terminalCopy.sourceTerminal.name,
                labelSource: sourceItem?.labelSource,
                config: { podTerminalId: terminalCopy.targetTerminal.id },
                sortOrder: sourceItem?.sortOrder ?? terminalCopy.sourceTerminal.sortOrder,
              })
              if (sourceItem) itemIdMap.set(sourceItem.id, createdItem.id)
            }
          }

          // Copy generic pod items (browser, markdown, command). Terminal/agent
          // items were already created above when copying their backing rows.
          for (const si of srcItems) {
            if (si.contentType === 'terminal' || si.contentType === 'agent') continue
            let config = si.config
            if (si.contentType === 'command' && 'podCommandId' in si.config) {
              const newCmdId = copy.commandIdMap.get(si.config.podCommandId)
              if (!newCmdId) continue
              config = { podCommandId: newCmdId }
            }
            const createdItem = yield* podItemSvc.create({
              podId: newId,
              contentType: si.contentType,
              label: si.label,
              labelSource: si.labelSource,
              config,
              sortOrder: si.sortOrder,
            })
            itemIdMap.set(si.id, createdItem.id)
          }

          // Copy all views from source pod
          yield* viewSvc.copyViews(id, newId, itemIdMap)
          return copy.targetPod
        }),

      addTerminal: (input) =>
        Effect.gen(function* () {
          const terminal = insertTerminal(db, input)
          yield* podItemSvc.create({
            podId: input.podId,
            contentType: 'terminal',
            label: input.name,
            config: { podTerminalId: terminal.id },
            sortOrder: terminal.sortOrder,
          })
          // Ensure the pod has at least one view (new pods start with none)
          yield* viewSvc.ensureDefaultView(input.podId)
          return terminal
        }),

      updateTerminal: (id, input) => Effect.sync(() => updateTerminal(db, id, input)),

      removeTerminal: (id) =>
        Effect.gen(function* () {
          yield* podItemSvc.deleteByPodTerminalId(id)
          deleteTerminal(db, id)
        }),

      listTerminals: (podId) => Effect.sync(() => listTerminalsByPod(db, podId)),

      setActiveView: (podId, viewId) => Effect.sync(() => setActivePodView(db, podId, viewId)),

      // --- Agent CRUD ---

      addAgent: (input) =>
        Effect.gen(function* () {
          const cli = AGENT_CLI[input.agentType]
          const agent = insertAgentWithTerminal(db, {
            podId: input.podId,
            name: input.name,
            agentType: input.agentType,
            command: cli.command,
            args: cli.args ?? null,
          })

          yield* podItemSvc.create({
            podId: input.podId,
            contentType: 'agent',
            label: input.name,
            config: { podAgentId: agent.id, podTerminalId: agent.podTerminalId, agentType: input.agentType },
          })

          yield* viewSvc.ensureDefaultView(input.podId)
          return agent
        }),

      removeAgent: (podAgentId) =>
        Effect.gen(function* () {
          const agent = getAgentById(db, podAgentId)
          if (!agent) return
          // Delete pod items referencing this terminal, then the agent (cascades terminal via FK)
          yield* podItemSvc.deleteByPodTerminalId(agent.podTerminalId)
          deleteAgentWithTerminal(db, agent)
        }),

      listAgents: (podId) => Effect.sync(() => listAgentsWithAttention(db, podId)),

      getAgent: (podAgentId) => Effect.sync(() => getAgentById(db, podAgentId)),

      // --- Command CRUD ---

      addCommand: (input) => Effect.sync(() => insertCommand(db, input)),

      updateCommand: (id, input) => Effect.sync(() => updateCommand(db, id, input)),

      removeCommand: (id) =>
        Effect.gen(function* () {
          yield* podItemSvc.deleteByPodCommandId(id)
          deleteCommand(db, id)
        }),

      listCommands: (podId) => Effect.sync(() => listCommandsWithTags(db, podId)),

      getCommand: (id) => Effect.sync(() => getCommandById(db, id)),

      importCommands: (podId, commands) => Effect.sync(() => importCommands(db, podId, commands)),

      // --- Tag CRUD ---

      listTags: (podId) => Effect.sync(() => listTags(db, podId)),

      createTag: (podId, name) => Effect.sync(() => createTag(db, podId, name)),

      deleteTag: (id) => Effect.sync(() => deleteTag(db, id)),

      tagCommand: (commandId, tagId) => Effect.sync(() => tagCommand(db, commandId, tagId)),

      untagCommand: (commandId, tagId) => Effect.sync(() => untagCommand(db, commandId, tagId)),

      // --- Templates ---

      createTemplate: (input) =>
        Effect.gen(function* () {
          const template = createTemplatePod(db, input)
          yield* viewSvc.ensureDefaultView(template.id)
          return template
        }),

      listTemplates: (workspaceId) => Effect.sync(() => listTemplatePods(db, workspaceId)),

      createTemplateFromPod: (podId, input) =>
        Effect.gen(function* () {
          const copy = createPodCopy(db, podId, {
            name: input.name,
            workspaceId: input.workspaceId ?? null,
            isTemplate: true,
            templateDescription: input.description,
          })
          if (!copy) return null
          const newId = copy.targetPod.id
          const itemIdMap = new Map<string, string>()
          const srcItems = yield* podItemSvc.listByPod(podId)
          for (const terminalCopy of copy.terminalCopies) {
            const sourceItem = sourceItemForTerminal(srcItems, terminalCopy.sourceTerminal.id)
            if (terminalCopy.targetAgent) {
              const createdItem = yield* podItemSvc.create({
                podId: newId,
                contentType: 'agent',
                label: sourceItem?.label ?? terminalCopy.sourceTerminal.name,
                labelSource: sourceItem?.labelSource,
                config: {
                  podAgentId: terminalCopy.targetAgent.id,
                  podTerminalId: terminalCopy.targetTerminal.id,
                  agentType: terminalCopy.targetAgent.agentType,
                },
                sortOrder: sourceItem?.sortOrder ?? terminalCopy.sourceTerminal.sortOrder,
              })
              if (sourceItem) itemIdMap.set(sourceItem.id, createdItem.id)
            } else {
              const createdItem = yield* podItemSvc.create({
                podId: newId,
                contentType: 'terminal',
                label: sourceItem?.label ?? terminalCopy.sourceTerminal.name,
                labelSource: sourceItem?.labelSource,
                config: { podTerminalId: terminalCopy.targetTerminal.id },
                sortOrder: sourceItem?.sortOrder ?? terminalCopy.sourceTerminal.sortOrder,
              })
              if (sourceItem) itemIdMap.set(sourceItem.id, createdItem.id)
            }
          }

          // Duplicate generic pod items (browser, markdown, command). Terminal
          // and agent items were already created while copying backing rows.
          for (const si of srcItems) {
            if (si.contentType === 'terminal' || si.contentType === 'agent') continue
            let config = si.config
            if (si.contentType === 'command' && 'podCommandId' in si.config) {
              const newCmdId = copy.commandIdMap.get(si.config.podCommandId)
              if (!newCmdId) continue
              config = { podCommandId: newCmdId }
            }
            const createdItem = yield* podItemSvc.create({
              podId: newId,
              contentType: si.contentType,
              label: si.label,
              labelSource: si.labelSource,
              config,
              sortOrder: si.sortOrder,
            })
            itemIdMap.set(si.id, createdItem.id)
          }

          // Copy all views from the source pod
          yield* viewSvc.copyViews(podId, newId, itemIdMap)
          return copy.targetPod
        }),

      applyTemplateToPod: (podId, templatePodId) =>
        Effect.gen(function* () {
          const copy = copyPodBackingRows(db, templatePodId, podId)
          const srcItems = yield* podItemSvc.listByPod(templatePodId)
          const itemIdMap = new Map<string, string>()
          for (const terminalCopy of copy.terminalCopies) {
            const sourceItem = sourceItemForTerminal(srcItems, terminalCopy.sourceTerminal.id)
            if (terminalCopy.targetAgent) {
              const createdItem = yield* podItemSvc.create({
                podId,
                contentType: 'agent',
                label: sourceItem?.label ?? terminalCopy.sourceTerminal.name,
                labelSource: sourceItem?.labelSource,
                config: {
                  podAgentId: terminalCopy.targetAgent.id,
                  podTerminalId: terminalCopy.targetTerminal.id,
                  agentType: terminalCopy.targetAgent.agentType,
                },
                sortOrder: sourceItem?.sortOrder ?? terminalCopy.sourceTerminal.sortOrder,
              })
              if (sourceItem) itemIdMap.set(sourceItem.id, createdItem.id)
            } else {
              const createdItem = yield* podItemSvc.create({
                podId,
                contentType: 'terminal',
                label: sourceItem?.label ?? terminalCopy.sourceTerminal.name,
                labelSource: sourceItem?.labelSource,
                config: { podTerminalId: terminalCopy.targetTerminal.id },
                sortOrder: sourceItem?.sortOrder ?? terminalCopy.sourceTerminal.sortOrder,
              })
              if (sourceItem) itemIdMap.set(sourceItem.id, createdItem.id)
            }
          }

          // Copy generic pod items (browser, markdown, command). Terminal/agent
          // items were already created above when copying their backing rows.
          for (const si of srcItems) {
            if (si.contentType === 'terminal' || si.contentType === 'agent') continue
            let config = si.config
            if (si.contentType === 'command' && 'podCommandId' in si.config) {
              const newCmdId = copy.commandIdMap.get(si.config.podCommandId)
              if (!newCmdId) continue
              config = { podCommandId: newCmdId }
            }
            const createdItem = yield* podItemSvc.create({
              podId,
              contentType: si.contentType,
              label: si.label,
              labelSource: si.labelSource,
              config,
              sortOrder: si.sortOrder,
            })
            itemIdMap.set(si.id, createdItem.id)
          }

          // Copy all views from template
          yield* viewSvc.copyViews(templatePodId, podId, itemIdMap)
        }),
    }
  }),
)
