// -----------------------------------------------------------------------------
// ToolCallDetail — payloads carried by tool events.
//
// Renderers route on `kind` via the tool registry. Each variant is small
// enough to render inline; giant outputs flow through `attachmentId` instead
// of inlining.
// -----------------------------------------------------------------------------

import { z } from 'zod'

export const FileLocationSchema = z.object({
  path: z.string().min(1).max(4096),
  line: z.number().int().min(0).optional(),
  column: z.number().int().min(0).optional(),
})
export type FileLocation = z.infer<typeof FileLocationSchema>

export const ShellDetailSchema = z.object({
  kind: z.literal('shell'),
  command: z.string().min(1).max(16_000),
  cwd: z.string().max(4096).optional(),
  argv: z.array(z.string().max(4096)).max(256).optional(),
})

export const DiffDetailSchema = z.object({
  kind: z.literal('diff'),
  unifiedDiff: z.string().max(1_000_000).optional(),
  attachmentId: z.string().min(1).optional(),
  path: z.string().min(1).max(4096),
  oldSha: z.string().max(64).optional(),
  newSha: z.string().max(64).optional(),
})

export const ReadDetailSchema = z.object({
  kind: z.literal('read'),
  path: z.string().min(1).max(4096),
  range: z
    .object({
      startLine: z.number().int().min(0),
      endLine: z.number().int().min(0),
    })
    .optional(),
})

export const SearchDetailSchema = z.object({
  kind: z.literal('search'),
  query: z.string().min(1).max(4096),
  scope: z.string().max(4096).optional(),
  isRegex: z.boolean().default(false),
})

export const FetchDetailSchema = z.object({
  kind: z.literal('fetch'),
  url: z.url().max(8192),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'PATCH', 'OPTIONS']).default('GET'),
})

export const TerminalDetailSchema = z.object({
  kind: z.literal('terminal'),
  /** Points at a Wanda terminal resource so the renderer can attach xterm.js. */
  terminalId: z.string().min(1),
  label: z.string().max(256).optional(),
})

export const ThinkDetailSchema = z.object({
  kind: z.literal('think'),
  topic: z.string().max(256).optional(),
})

export const OtherDetailSchema = z.object({
  kind: z.literal('other'),
  /** Provider-declared tool name for renderer-registry lookup. */
  toolName: z.string().min(1).max(256),
  payload: z.unknown(),
})

export const ToolCallDetailSchema = z.discriminatedUnion('kind', [
  ShellDetailSchema,
  DiffDetailSchema,
  ReadDetailSchema,
  SearchDetailSchema,
  FetchDetailSchema,
  TerminalDetailSchema,
  ThinkDetailSchema,
  OtherDetailSchema,
])
export type ToolCallDetail = z.infer<typeof ToolCallDetailSchema>
