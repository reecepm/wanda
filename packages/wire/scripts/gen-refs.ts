#!/usr/bin/env bun
// -----------------------------------------------------------------------------
// Emit `src/contracts/refs.ts` from `RESOURCE_KINDS` in `src/contracts/resources.ts`.
//
// The output is fully self-contained: branded types, ResourceRef aliases,
// factory functions, and Zod validators. Hand-editing refs.ts is forbidden —
// CI should diff-check gen-refs output against the committed file.
//
// Run: `bun run gen:refs` inside this package.
// -----------------------------------------------------------------------------

import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RESOURCE_KINDS } from '../src/contracts/resources.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(HERE, '../src/contracts/refs.ts')

function cap(kind: string): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1)
}

function generate(): string {
  const lines: string[] = []
  const push = (...xs: string[]) => {
    for (const x of xs) lines.push(x)
  }

  push(
    '// -----------------------------------------------------------------------------',
    '// GENERATED FILE — edit `scripts/gen-refs.ts` (source: `contracts/resources.ts`)',
    '// and re-run `bun run gen:refs`. Hand edits will be clobbered.',
    '//',
    '// Branded types + ResourceRef + per-kind Zod validators + factory functions.',
    '// Every downstream package imports brands from here; the ESLint rule',
    '// `no-local-branded-types` prevents accidental re-declaration elsewhere.',
    '// -----------------------------------------------------------------------------',
    '',
    "import { z } from 'zod'",
    "import { type ResourceKind } from './resources.ts'",
    '',
    '// --- Branded id types ----------------------------------------------------------',
    '',
  )

  for (const kind of RESOURCE_KINDS) {
    const C = cap(kind)
    push(
      `declare const ${C}IdBrand: unique symbol`,
      `export type ${C}Id = string & { readonly [${C}IdBrand]: never }`,
      '',
    )
  }

  push(
    '// --- ResourceRef generic + per-kind aliases -----------------------------------',
    '',
    'export interface ResourceRef<Kind extends ResourceKind, Id extends string> {',
    '  readonly serverId: string',
    '  readonly kind: Kind',
    '  readonly id: Id',
    '}',
    '',
  )

  for (const kind of RESOURCE_KINDS) {
    const C = cap(kind)
    push(`export type ${C}Ref = ResourceRef<'${kind}', ${C}Id>`)
  }
  push('')

  push(
    'export interface ResourceRefMap {',
    ...RESOURCE_KINDS.map((k) => `  ${k}: ${cap(k)}Ref`),
    '}',
    '',
    'export type AnyResourceRef = ResourceRefMap[keyof ResourceRefMap]',
    '',
    '// --- Factories ----------------------------------------------------------------',
    '',
    'const nonEmptyServerId = (serverId: string) => {',
    "  if (typeof serverId !== 'string' || serverId.length === 0) {",
    "    throw new Error('serverId must be a non-empty string')",
    '  }',
    '  return serverId',
    '}',
    '',
    'const nonEmptyId = (id: string) => {',
    "  if (typeof id !== 'string' || id.length === 0) {",
    "    throw new Error('id must be a non-empty string')",
    '  }',
    '  return id',
    '}',
    '',
  )

  for (const kind of RESOURCE_KINDS) {
    const C = cap(kind)
    push(
      `export const ${kind}Ref = (serverId: string, id: string): ${C}Ref => ({`,
      '  serverId: nonEmptyServerId(serverId),',
      `  kind: '${kind}',`,
      `  id: nonEmptyId(id) as ${C}Id,`,
      '})',
      '',
    )
  }

  push(
    '// --- Zod validators -----------------------------------------------------------',
    '',
    'const baseRefShape = {',
    '  serverId: z.string().min(1),',
    '  id: z.string().min(1),',
    '}',
    '',
  )

  for (const kind of RESOURCE_KINDS) {
    const C = cap(kind)
    push(`export const ${C}RefSchema = z.object({ ...baseRefShape, kind: z.literal('${kind}') })`)
  }
  push('')

  push('export const RefSchemaByKind = {')
  for (const kind of RESOURCE_KINDS) {
    push(`  ${kind}: ${cap(kind)}RefSchema,`)
  }
  push('} as const satisfies Record<ResourceKind, z.ZodType>', '')

  push("export const AnyRefSchema = z.discriminatedUnion('kind', [")
  for (const kind of RESOURCE_KINDS) {
    push(`  ${cap(kind)}RefSchema,`)
  }
  push('])', '')

  push(
    '// --- Runtime helpers ----------------------------------------------------------',
    '',
    '/**',
    ' * Validate an unknown value as a ResourceRef of any known kind.',
    ' * Returns null on failure (never throws) — callers decide how to surface.',
    ' */',
    'export function parseRef(value: unknown): AnyResourceRef | null {',
    '  const result = AnyRefSchema.safeParse(value)',
    '  return result.success ? (result.data as AnyResourceRef) : null',
    '}',
    '',
    '/**',
    ' * Type-level narrowing for a specific kind. Runtime + compile-time safe.',
    ' */',
    'export function isRefOfKind<K extends ResourceKind>(',
    '  value: unknown,',
    '  kind: K,',
    '): value is ResourceRefMap[K] {',
    "  if (!value || typeof value !== 'object') return false",
    '  const candidate = value as { kind?: unknown }',
    '  if (candidate.kind !== kind) return false',
    '  return RefSchemaByKind[kind].safeParse(value).success',
    '}',
    '',
  )

  return lines.join('\n')
}

writeFileSync(OUT, generate(), 'utf8')
// eslint-disable-next-line no-console
console.log(`[gen-refs] wrote ${OUT}`)
