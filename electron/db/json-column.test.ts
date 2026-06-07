import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { JsonColumnError, jsonColumn, parseJsonColumn } from './json-column'

const schema = z.object({ a: z.string(), b: z.number() })

const fixture = sqliteTable('json_column_fixture', {
  id: text('id').primaryKey(),
  config: jsonColumn('config', schema),
})

const column = fixture.config
const fromDriver = (raw: string) => column.mapFromDriverValue(raw)
const toDriver = (value: z.infer<typeof schema>) => column.mapToDriverValue(value)

describe('jsonColumn', () => {
  it('emits a plain text SQL type so DDL is unchanged', () => {
    expect(column.getSQLType()).toBe('text')
  })

  it('parses and validates a well-formed payload on read', () => {
    expect(fromDriver(JSON.stringify({ a: 'x', b: 1 }))).toEqual({ a: 'x', b: 1 })
  })

  it('throws JsonColumnError on a malformed payload instead of a silent bad cast', () => {
    expect(() => fromDriver(JSON.stringify({ a: 'x', b: 'not-a-number' }))).toThrowError(JsonColumnError)
  })

  it('throws JsonColumnError on non-JSON text on read', () => {
    expect(() => fromDriver('}{')).toThrowError(JsonColumnError)
  })

  it('names the column and offending path in the error message', () => {
    try {
      fromDriver(JSON.stringify({ a: 'x', b: 'bad' }))
      expect.unreachable('expected throw')
    } catch (error) {
      expect(error).toBeInstanceOf(JsonColumnError)
      const e = error as JsonColumnError
      expect(e._tag).toBe('JsonColumnError')
      expect(e.column).toBe('config')
      expect(e.message).toContain('config')
      expect(e.message).toContain('b')
      expect(e.issues.length).toBeGreaterThan(0)
    }
  })

  it('validates and serializes on write, rejecting malformed values', () => {
    expect(toDriver({ a: 'x', b: 2 })).toBe(JSON.stringify({ a: 'x', b: 2 }))
    expect(() => toDriver({ a: 'x', b: 'no' } as unknown as z.infer<typeof schema>)).toThrowError(JsonColumnError)
  })
})

describe('parseJsonColumn', () => {
  it('returns a typed ok result for valid stored JSON strings', () => {
    const result = parseJsonColumn(schema, JSON.stringify({ a: 'x', b: 1 }), 'config')
    expect(result).toEqual({ ok: true, value: { a: 'x', b: 1 } })
  })

  it('accepts already-parsed objects', () => {
    expect(parseJsonColumn(schema, { a: 'x', b: 1 }).ok).toBe(true)
  })

  it('returns an error result instead of throwing on malformed data', () => {
    const result = parseJsonColumn(schema, JSON.stringify({ a: 'x' }), 'config')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(JsonColumnError)
      expect(result.error.column).toBe('config')
    }
  })
})
