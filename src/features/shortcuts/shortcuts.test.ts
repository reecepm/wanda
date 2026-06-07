import { describe, expect, it } from 'vitest'
import {
  buildActionMap,
  getBinding,
  getFocusIndex,
  isAppShortcut,
  matchShortcutEvent,
} from '@/features/shortcuts/shortcuts'

function makeKeyEvent(
  key: string,
  opts: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; code?: string } = {},
): KeyboardEvent {
  return {
    key,
    code: opts.code ?? '',
    metaKey: opts.metaKey ?? false,
    ctrlKey: opts.ctrlKey ?? false,
    shiftKey: opts.shiftKey ?? false,
    altKey: opts.altKey ?? false,
  } as unknown as KeyboardEvent
}

describe('getBinding', () => {
  it('returns default binding when no override', () => {
    // grid:focus-1 was remapped to Ctrl+1 so it doesn't clash with
    // tab:focus-1 (Mod+1). See src/features/shortcuts/shortcuts.ts.
    expect(getBinding('grid:focus-1', {})).toBe('Ctrl+1')
  })

  it('returns override when present', () => {
    expect(getBinding('grid:focus-1', { 'grid:focus-1': 'Alt+1' })).toBe('Alt+1')
  })
})

describe('buildActionMap', () => {
  it('builds map from defaults', () => {
    const map = buildActionMap({})
    // One entry per DEFAULT_SHORTCUTS — lock the count so accidental
    // additions/removals fail loudly.
    expect(map.size).toBe(35)
    expect(map.get('Ctrl+1')).toBe('grid:focus-1')
    expect(map.get('Mod+1')).toBe('tab:focus-1')
    expect(map.get('Mod+]')).toBe('grid:next-pane')
    expect(map.get('Mod+[')).toBe('grid:prev-pane')
    expect(map.get('Mod+Shift+Enter')).toBe('grid:toggle-maximize')
  })

  it('applies overrides', () => {
    const map = buildActionMap({ 'grid:focus-1': 'Alt+1' })
    expect(map.get('Alt+1')).toBe('grid:focus-1')
    expect(map.has('Ctrl+1')).toBe(false)
  })
})

describe('isAppShortcut', () => {
  it('matches Mod+1 (tab:focus-1) on macOS', () => {
    const event = makeKeyEvent('1', { metaKey: true })
    expect(isAppShortcut(event, {})).toBe(true)
  })

  it('returns false for unmatched event', () => {
    const event = makeKeyEvent('a', { metaKey: true })
    expect(isAppShortcut(event, {})).toBe(false)
  })
})

describe('matchShortcutEvent', () => {
  it('matches Mod+1 as tab:focus-1', () => {
    const event = makeKeyEvent('1', { metaKey: true })
    expect(matchShortcutEvent(event, {})).toBe('tab:focus-1')
  })

  it('returns null for unmatched event', () => {
    const event = makeKeyEvent('a', { metaKey: true })
    expect(matchShortcutEvent(event, {})).toBeNull()
  })

  it('returns null when modifiers do not match', () => {
    const event = makeKeyEvent('1', {})
    expect(matchShortcutEvent(event, {})).toBeNull()
  })
})

describe('getFocusIndex', () => {
  it('extracts digit from grid:focus-N', () => {
    expect(getFocusIndex('grid:focus-1')).toBe(1)
    expect(getFocusIndex('grid:focus-9')).toBe(9)
  })

  it('returns null for non-focus actions', () => {
    expect(getFocusIndex('grid:next-pane')).toBeNull()
    expect(getFocusIndex('grid:toggle-maximize')).toBeNull()
  })
})
