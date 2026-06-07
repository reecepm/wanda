// -----------------------------------------------------------------------------
// `agent.session.*` oRPC procedures.
//
// Every handler is a thin `effectOs.effect()` caller into `AgentRuntime`.
// Input schemas are the shared ones from `@wanda/agent-protocol` (router
// input is loosened to `z.string().min(1)` for branded ids — runtime code
// still validates by existence).
// -----------------------------------------------------------------------------

import { ORPCError } from '@orpc/client'
import {
  type AttachmentId,
  DecisionSchema,
  type ModeId,
  type ModelId,
  PromptBlockSchema,
  type ProviderId,
  QuestionAnswerSchema,
  type QuestionId,
  ReasoningEffortSchema,
  type RequestId,
  type SessionId,
  type TurnId,
} from '@wanda/agent-protocol'
import { AgentRuntime } from '@wanda/agent-runtime'
import { Effect } from 'effect'
import { z } from 'zod'
import { AgentAttachmentService } from '../../domains/agent-attachment'
import { log } from '../../packages/logger'
import type { AppRouterDeps } from '../index'
import { fromRuntimeError } from './errors'

// --- Input schemas (router-side — loose brands) ------------------------------

const SessionIdInput = z.string().min(1)
const TurnIdInput = z.string().min(1)
const ProviderIdInput = z.string().min(1)
const ModeIdInput = z.string().min(1)
const ModelIdInput = z.string().min(1)
const RequestIdInput = z.string().min(1)
const QuestionIdInput = z.string().min(1)

const CreateInput = z.object({
  providerId: ProviderIdInput,
  cwd: z.string().min(1).max(4096),
  workspaceId: z.string().min(1).nullable().default(null),
  resumeHandle: z.unknown().optional(),
  modeId: ModeIdInput.optional(),
  modelId: ModelIdInput.optional(),
  reasoningEffort: ReasoningEffortSchema.optional(),
})

const PromptInputSchema = z.object({
  sessionId: SessionIdInput,
  content: z.array(PromptBlockSchema).min(1),
  options: z
    .object({
      modeId: ModeIdInput.optional(),
    })
    .optional(),
})

const CancelInput = z.object({
  sessionId: SessionIdInput,
  turnId: TurnIdInput.optional(),
})

const SetModeInput = z.object({
  sessionId: SessionIdInput,
  modeId: ModeIdInput,
})

const SetModelInput = z.object({
  sessionId: SessionIdInput,
  modelId: ModelIdInput,
})

const SetReasoningEffortInput = z.object({
  sessionId: SessionIdInput,
  reasoningEffort: ReasoningEffortSchema,
})

const ReviewTargetSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('uncommittedChanges') }),
  z.object({ type: z.literal('baseBranch'), branch: z.string().min(1) }),
  z.object({
    type: z.literal('commit'),
    sha: z.string().min(1),
    title: z.string().max(512).optional(),
  }),
  z.object({ type: z.literal('custom'), instructions: z.string().min(1).max(8192) }),
])

const StartReviewInput = z.object({
  sessionId: SessionIdInput,
  target: ReviewTargetSchema,
})

const RespondPermissionInput = z.object({
  sessionId: SessionIdInput,
  requestId: RequestIdInput,
  decision: DecisionSchema,
})

const RespondQuestionInput = z.object({
  sessionId: SessionIdInput,
  questionId: QuestionIdInput,
  answer: QuestionAnswerSchema,
})

const CloseInput = z.object({ sessionId: SessionIdInput })
const GetInput = z.object({ sessionId: SessionIdInput })
const ListPersistedInput = z
  .object({
    workspaceId: z.string().min(1).nullable().optional(),
    includeArchived: z.boolean().optional(),
  })
  .optional()
const ArchiveInput = z.object({ sessionId: SessionIdInput })
const RenameInput = z.object({
  sessionId: SessionIdInput,
  title: z.string().trim().min(1).max(60),
})

// --- Route factory -----------------------------------------------------------

export function agentSessionRoutes({ effectOs }: AppRouterDeps) {
  return {
    create: effectOs.input(CreateInput).effect(function* ({ input }) {
      const runtime = yield* AgentRuntime
      return yield* Effect.mapError(
        runtime.create({
          providerId: input.providerId as ProviderId,
          cwd: input.cwd,
          workspaceId: input.workspaceId,
          resumeHandle: input.resumeHandle,
          modeId: input.modeId as ModeId | undefined,
          modelId: input.modelId as ModelId | undefined,
          reasoningEffort: input.reasoningEffort,
        }),
        fromRuntimeError,
      )
    }),

    get: effectOs.input(GetInput).effect(function* ({ input }) {
      const runtime = yield* AgentRuntime
      return yield* Effect.mapError(runtime.get(input.sessionId as SessionId), fromRuntimeError)
    }),

    list: effectOs.effect(function* () {
      const runtime = yield* AgentRuntime
      return yield* Effect.mapError(runtime.list, fromRuntimeError)
    }),

    listPersisted: effectOs.input(ListPersistedInput).effect(function* ({ input }) {
      const runtime = yield* AgentRuntime
      return yield* Effect.mapError(runtime.listPersisted(input), fromRuntimeError)
    }),

    archive: effectOs.input(ArchiveInput).effect(function* ({ input }) {
      const runtime = yield* AgentRuntime
      yield* Effect.mapError(runtime.archive(input.sessionId as SessionId), fromRuntimeError)
      return { archived: true }
    }),

    unarchive: effectOs.input(ArchiveInput).effect(function* ({ input }) {
      const runtime = yield* AgentRuntime
      yield* Effect.mapError(runtime.unarchive(input.sessionId as SessionId), fromRuntimeError)
      return { archived: false }
    }),

    rename: effectOs.input(RenameInput).effect(function* ({ input }) {
      const runtime = yield* AgentRuntime
      yield* Effect.mapError(runtime.rename(input.sessionId as SessionId, input.title), fromRuntimeError)
      return { renamed: true }
    }),

    prompt: effectOs.input(PromptInputSchema).effect(function* ({ input }) {
      log.agent.debug('agent-session.prompt:start', {
        sessionId: input.sessionId,
        blocks: input.content.map((block) => block.kind),
        modeId: input.options?.modeId ?? null,
      })
      // Validate any attachment refs in the prompt content: the session must
      // be allowed to use them (bound to this session or unbound), and
      // unbound refs get bound to this session as part of the prompt call
      // so a future GC doesn't reap them as orphans.
      //
      // `ensureBoundToSession` is a single atomic UPDATE — no TOCTOU
      // between a read-to-check-ownership and a write-to-bind.
      const sessionId = input.sessionId as SessionId
      const attachmentSvc = yield* AgentAttachmentService
      for (const block of input.content) {
        if (block.kind !== 'attachment' && block.kind !== 'image') continue
        const ok = yield* attachmentSvc.ensureBoundToSession(block.id as AttachmentId, sessionId)
        if (!ok) {
          return yield* Effect.fail(
            new ORPCError('NOT_FOUND', {
              message: `Attachment ${block.id} not found for this session`,
            }),
          )
        }
      }

      const runtime = yield* AgentRuntime
      return yield* Effect.mapError(
        runtime
          .prompt({
            sessionId,
            content: input.content,
            options: input.options ? { modeId: input.options.modeId as ModeId | undefined } : undefined,
          })
          .pipe(
            Effect.tap((result) =>
              Effect.sync(() => {
                log.agent.debug('agent-session.prompt:accepted', {
                  sessionId,
                  turnId: result.turnId,
                })
              }),
            ),
          ),
        (err) => {
          log.agent.warn('agent-session.prompt:error', {
            sessionId,
            message: err instanceof Error ? err.message : String(err),
          })
          return fromRuntimeError(err)
        },
      )
    }),

    cancel: effectOs.input(CancelInput).effect(function* ({ input }) {
      const runtime = yield* AgentRuntime
      return yield* Effect.mapError(
        runtime.cancel({
          sessionId: input.sessionId as SessionId,
          turnId: input.turnId as TurnId | undefined,
        }),
        fromRuntimeError,
      )
    }),

    setMode: effectOs.input(SetModeInput).effect(function* ({ input }) {
      const runtime = yield* AgentRuntime
      return yield* Effect.mapError(
        runtime.setMode({
          sessionId: input.sessionId as SessionId,
          modeId: input.modeId as ModeId,
        }),
        fromRuntimeError,
      )
    }),

    startReview: effectOs.input(StartReviewInput).effect(function* ({ input }) {
      const runtime = yield* AgentRuntime
      return yield* Effect.mapError(
        runtime.startReview({
          sessionId: input.sessionId as SessionId,
          target: input.target,
        }),
        fromRuntimeError,
      )
    }),

    setModel: effectOs.input(SetModelInput).effect(function* ({ input }) {
      const runtime = yield* AgentRuntime
      return yield* Effect.mapError(
        runtime.setModel({
          sessionId: input.sessionId as SessionId,
          modelId: input.modelId as ModelId,
        }),
        fromRuntimeError,
      )
    }),

    setReasoningEffort: effectOs.input(SetReasoningEffortInput).effect(function* ({ input }) {
      const runtime = yield* AgentRuntime
      return yield* Effect.mapError(
        runtime.setReasoningEffort({
          sessionId: input.sessionId as SessionId,
          reasoningEffort: input.reasoningEffort,
        }),
        fromRuntimeError,
      )
    }),

    respondPermission: effectOs.input(RespondPermissionInput).effect(function* ({ input }) {
      const runtime = yield* AgentRuntime
      return yield* Effect.mapError(
        runtime.respondPermission({
          sessionId: input.sessionId as SessionId,
          requestId: input.requestId as RequestId,
          decision: input.decision,
        }),
        fromRuntimeError,
      )
    }),

    respondQuestion: effectOs.input(RespondQuestionInput).effect(function* ({ input }) {
      const runtime = yield* AgentRuntime
      return yield* Effect.mapError(
        runtime.respondQuestion({
          sessionId: input.sessionId as SessionId,
          questionId: input.questionId as QuestionId,
          answer: input.answer,
        }),
        fromRuntimeError,
      )
    }),

    close: effectOs.input(CloseInput).effect(function* ({ input }) {
      const runtime = yield* AgentRuntime
      return yield* Effect.mapError(runtime.close({ sessionId: input.sessionId as SessionId }), fromRuntimeError)
    }),
  }
}
