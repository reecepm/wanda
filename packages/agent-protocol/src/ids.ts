// -----------------------------------------------------------------------------
// Branded ids for the agent subsystem.
//
// Types are derived from the Zod schemas (`z.output<typeof *Schema>`) so that
// factory-produced values and Zod-parsed values share a single nominal brand.
// Zod 4 uses a symbol-keyed `$brand<'X'>` marker; we do not duplicate it
// with a hand-declared `unique symbol` — mixing the two did not compose
// (01 §2 v3→v4 gotcha). Factories cast `unknown → Branded` at the boundary.
// -----------------------------------------------------------------------------

import { z } from 'zod'

const nonEmptyString = z.string().min(1).max(256)

export const SessionIdSchema = nonEmptyString.brand<'SessionId'>()
export const TurnIdSchema = nonEmptyString.brand<'TurnId'>()
export const MessageIdSchema = nonEmptyString.brand<'MessageId'>()
export const ToolCallIdSchema = nonEmptyString.brand<'ToolCallId'>()
export const RequestIdSchema = nonEmptyString.brand<'RequestId'>()
export const QuestionIdSchema = nonEmptyString.brand<'QuestionId'>()
export const PlanItemIdSchema = nonEmptyString.brand<'PlanItemId'>()
export const AttachmentIdSchema = nonEmptyString.brand<'AttachmentId'>()
export const ProviderIdSchema = nonEmptyString.brand<'ProviderId'>()
export const ModeIdSchema = nonEmptyString.brand<'ModeId'>()
export const ModelIdSchema = nonEmptyString.brand<'ModelId'>()

export type SessionId = z.output<typeof SessionIdSchema>
export type TurnId = z.output<typeof TurnIdSchema>
export type MessageId = z.output<typeof MessageIdSchema>
export type ToolCallId = z.output<typeof ToolCallIdSchema>
export type RequestId = z.output<typeof RequestIdSchema>
export type QuestionId = z.output<typeof QuestionIdSchema>
export type PlanItemId = z.output<typeof PlanItemIdSchema>
export type AttachmentId = z.output<typeof AttachmentIdSchema>
export type ProviderId = z.output<typeof ProviderIdSchema>
export type ModeId = z.output<typeof ModeIdSchema>
export type ModelId = z.output<typeof ModelIdSchema>

// --- Factories ----------------------------------------------------------------

const uuid = () => globalThis.crypto.randomUUID()

export const newSessionId = (): SessionId => uuid() as SessionId
export const newTurnId = (): TurnId => uuid() as TurnId
export const newMessageId = (): MessageId => uuid() as MessageId
export const newToolCallId = (): ToolCallId => uuid() as ToolCallId
export const newRequestId = (): RequestId => uuid() as RequestId
export const newQuestionId = (): QuestionId => uuid() as QuestionId
export const newPlanItemId = (): PlanItemId => uuid() as PlanItemId
export const newAttachmentId = (): AttachmentId => uuid() as AttachmentId
