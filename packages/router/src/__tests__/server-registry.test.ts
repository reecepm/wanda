import { afterEach, describe, expect, it } from 'vitest'
import { ServerNotFoundError } from '../errors.ts'
import { reopen, type TempRouter, tempRouter } from './helpers.ts'

describe('ServerRegistry', () => {
  let ctx: TempRouter
  afterEach(() => ctx?.cleanup())

  describe('pair', () => {
    it('inserts a new row and returns the PairedServer', () => {
      ctx = tempRouter({ now: () => 123 })
      const s = ctx.registry.pair({
        serverId: 'srv-abc',
        baseUrl: 'http://10.0.0.5:51180',
        label: 'Mac mini',
      })
      expect(s.registryId.length).toBeGreaterThan(0)
      expect(s.pairedAt).toBe(123)
      expect(ctx.registry.list()).toHaveLength(1)
    })

    it('returns the existing entry when the serverId is already paired', () => {
      ctx = tempRouter()
      const a = ctx.registry.pair({ serverId: 'srv-1', baseUrl: 'u', label: 'x' })
      const b = ctx.registry.pair({ serverId: 'srv-1', baseUrl: 'u2', label: 'y' })
      expect(b.registryId).toBe(a.registryId)
      expect(ctx.registry.list()).toHaveLength(1)
    })

    it('rejects missing fields', () => {
      ctx = tempRouter()
      expect(() => ctx.registry.pair({ serverId: '', baseUrl: 'u', label: 'l' })).toThrow()
      expect(() => ctx.registry.pair({ serverId: 's', baseUrl: '', label: 'l' })).toThrow()
      expect(() => ctx.registry.pair({ serverId: 's', baseUrl: 'u', label: '' })).toThrow()
    })
  })

  describe('lookup', () => {
    it('finds by registryId and serverId', () => {
      ctx = tempRouter()
      const s = ctx.registry.pair({ serverId: 'srv-1', baseUrl: 'u', label: 'x' })
      expect(ctx.registry.findByRegistryId(s.registryId)?.serverId).toBe('srv-1')
      expect(ctx.registry.findByServerId('srv-1')?.registryId).toBe(s.registryId)
      expect(ctx.registry.findByRegistryId('ghost')).toBeNull()
      expect(ctx.registry.findByServerId('ghost')).toBeNull()
    })
  })

  describe('unpair', () => {
    it('removes the row', () => {
      ctx = tempRouter()
      const s = ctx.registry.pair({ serverId: 'srv-1', baseUrl: 'u', label: 'x' })
      expect(ctx.registry.unpair(s.registryId)).toBe(true)
      expect(ctx.registry.list()).toHaveLength(0)
      expect(ctx.registry.unpair(s.registryId)).toBe(false)
    })
  })

  describe('updateBaseUrl', () => {
    it('writes a new baseUrl', () => {
      ctx = tempRouter()
      const s = ctx.registry.pair({ serverId: 'srv-1', baseUrl: 'http://old', label: 'x' })
      ctx.registry.updateBaseUrl(s.registryId, 'http://new')
      expect(ctx.registry.findByRegistryId(s.registryId)?.baseUrl).toBe('http://new')
    })

    it('throws on unknown registryId', () => {
      ctx = tempRouter()
      expect(() => ctx.registry.updateBaseUrl('ghost', 'x')).toThrow(ServerNotFoundError)
    })
  })

  describe('detectStale', () => {
    it('returns false for matching serverId', () => {
      ctx = tempRouter()
      const s = ctx.registry.pair({ serverId: 'srv-1', baseUrl: 'u', label: 'x' })
      expect(ctx.registry.detectStale(s.registryId, 'srv-1')).toBe(false)
      expect(ctx.registry.findByRegistryId(s.registryId)).not.toBeNull()
    })

    it('returns true and deletes the row when serverId differs', () => {
      ctx = tempRouter()
      const s = ctx.registry.pair({ serverId: 'srv-1', baseUrl: 'u', label: 'x' })
      expect(ctx.registry.detectStale(s.registryId, 'srv-DIFFERENT')).toBe(true)
      expect(ctx.registry.findByRegistryId(s.registryId)).toBeNull()
    })

    it('returns false for unknown registryId', () => {
      ctx = tempRouter()
      expect(ctx.registry.detectStale('ghost', 'whatever')).toBe(false)
    })
  })

  describe('persistence across restart', () => {
    it('retains paired servers', () => {
      ctx = tempRouter()
      const s = ctx.registry.pair({ serverId: 'srv-1', baseUrl: 'u', label: 'x' })
      ctx = reopen(ctx)
      expect(ctx.registry.list()).toHaveLength(1)
      expect(ctx.registry.findByRegistryId(s.registryId)?.serverId).toBe('srv-1')
    })
  })
})
