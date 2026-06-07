import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockTerminalWrite = vi.fn()
const mockTerminalOpen = vi.fn()
const mockTerminalDispose = vi.fn()
const mockTerminalFocus = vi.fn()
const mockTerminalRefresh = vi.fn()
const mockTerminalReset = vi.fn()
const mockLoadAddon = vi.fn()
const mockAttachCustomKeyEventHandler = vi.fn()
const mockOnData = vi.fn().mockReturnValue({ dispose: vi.fn() })
const mockOnResize = vi.fn().mockReturnValue({ dispose: vi.fn() })
const mockOnTitleChange = vi.fn().mockReturnValue({ dispose: vi.fn() })

vi.mock('@xterm/xterm', () => {
  function MockTerminal() {
    return {
      write: mockTerminalWrite,
      open: mockTerminalOpen,
      dispose: mockTerminalDispose,
      focus: mockTerminalFocus,
      refresh: mockTerminalRefresh,
      reset: mockTerminalReset,
      loadAddon: mockLoadAddon,
      attachCustomKeyEventHandler: mockAttachCustomKeyEventHandler,
      onData: mockOnData,
      onResize: mockOnResize,
      onTitleChange: mockOnTitleChange,
      options: { fontSize: 13 },
      modes: { applicationCursorKeysMode: false },
      rows: 24,
      buffer: { active: { baseY: 0, viewportY: 0 } },
    }
  }
  return { Terminal: MockTerminal }
})

const mockFit = vi.fn()
const mockProposeDimensions = vi.fn().mockReturnValue({ cols: 80, rows: 24 })

vi.mock('@xterm/addon-fit', () => {
  function MockFitAddon() {
    return {
      fit: mockFit,
      proposeDimensions: mockProposeDimensions,
      dispose: vi.fn(),
    }
  }
  return { FitAddon: MockFitAddon }
})

vi.mock('@xterm/addon-web-links', () => {
  function MockWebLinksAddon() {
    return { dispose: vi.fn() }
  }
  return { WebLinksAddon: MockWebLinksAddon }
})

vi.mock('@/shared/orpc', () => ({
  orpc: {
    terminal: {
      getScrollback: vi.fn().mockResolvedValue(null),
    },
  },
  orpcUtils: {
    terminal: {
      getScrollback: { call: vi.fn().mockResolvedValue(null) },
      clear: { call: vi.fn().mockResolvedValue(undefined) },
    },
  },
}))

vi.mock('@/stores/ui-store', () => ({
  useUIStore: Object.assign(vi.fn().mockReturnValue(null), {
    getState: vi.fn().mockReturnValue({
      terminalFontSizes: {},
      setTerminalFontSize: vi.fn(),
      selectedId: null,
    }),
  }),
}))

vi.mock('@/stores/shortcut-store', () => ({
  useShortcutStore: {
    getState: vi.fn().mockReturnValue({ overrides: {} }),
  },
}))

vi.mock('@/features/shortcuts', () => ({
  isAppShortcut: vi.fn().mockReturnValue(false),
}))

const ipcDataCallbacks = new Map<string, Set<(data: string) => void>>()
const ipcExitCallbacks = new Map<string, Set<(code: number) => void>>()

const mockIpcWrite = vi.fn()
const mockIpcResize = vi.fn()
const mockOpenExternal = vi.fn()

function makeMockElement(tag = 'div'): any {
  const children: any[] = []
  const listeners: Record<string, any[]> = {}
  const el: any = {
    tagName: tag.toUpperCase(),
    style: {},
    dataset: {},
    children,
    childNodes: children,
    appendChild(child: any) {
      if (child.parentElement) {
        const idx = child.parentElement.children.indexOf(child)
        if (idx >= 0) child.parentElement.children.splice(idx, 1)
      }
      children.push(child)
      child.parentElement = el
      return child
    },
    contains(child: any): boolean {
      if (child === el) return true
      return children.some((c: any) => c === child || (c.contains && c.contains(child)))
    },
    remove() {
      if (el.parentElement) {
        const idx = el.parentElement.children.indexOf(el)
        if (idx >= 0) el.parentElement.children.splice(idx, 1)
        el.parentElement = null
      }
    },
    querySelector() {
      return null
    },
    querySelectorAll() {
      return []
    },
    addEventListener(type: string, fn: any) {
      if (!listeners[type]) listeners[type] = []
      listeners[type].push(fn)
    },
    removeEventListener(type: string, fn: any) {
      if (listeners[type]) {
        listeners[type] = listeners[type].filter((f: any) => f !== fn)
      }
    },
    parentElement: null as any,
    offsetWidth: 800,
    offsetHeight: 600,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }),
  }
  return el
}

const mockBody = makeMockElement('body')
const mockDocument: any = {
  createElement: vi.fn(() => makeMockElement('div')),
  body: mockBody,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  querySelectorAll: vi.fn(() => []),
  visibilityState: 'visible',
  activeElement: null,
}

;(globalThis as any).document = mockDocument
;(globalThis as any).window = globalThis
;(globalThis as any).wanda = {
  terminal: {
    write: mockIpcWrite,
    resize: mockIpcResize,
    onData: vi.fn((id: string, cb: (data: string) => void) => {
      let set = ipcDataCallbacks.get(id)
      if (!set) {
        set = new Set()
        ipcDataCallbacks.set(id, set)
      }
      set.add(cb)
      return () => {
        set!.delete(cb)
        if (set!.size === 0) ipcDataCallbacks.delete(id)
      }
    }),
    onExit: vi.fn((id: string, cb: (code: number) => void) => {
      let set = ipcExitCallbacks.get(id)
      if (!set) {
        set = new Set()
        ipcExitCallbacks.set(id, set)
      }
      set.add(cb)
      return () => {
        set!.delete(cb)
        if (set!.size === 0) ipcExitCallbacks.delete(id)
      }
    }),
    onZoom: vi.fn().mockReturnValue(() => {}),
  },
  shell: {
    openExternal: mockOpenExternal,
  },
}

// The code accesses window.wanda — in Node, window === globalThis
// so setting globalThis.wanda covers window.wanda.

// Stub ResizeObserver — fires callback synchronously on observe for test simplicity
const resizeObserverCallbacks: (() => void)[] = []
class MockResizeObserver {
  private cb: () => void
  constructor(cb: () => void) {
    this.cb = cb
  }
  observe = vi.fn(() => {
    resizeObserverCallbacks.push(this.cb)
    this.cb()
  })
  unobserve = vi.fn()
  disconnect = vi.fn()
}
globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver

;(globalThis as any).document.fonts = { ready: Promise.resolve() }
;(globalThis as any).requestAnimationFrame = (cb: () => void) => setTimeout(cb, 0)

import { TerminalRegistry } from './terminal-registry'

describe('TerminalRegistry', () => {
  let registry: TerminalRegistry

  beforeEach(() => {
    vi.useFakeTimers()
    mockBody.children.length = 0
    registry = new TerminalRegistry()
    ipcDataCallbacks.clear()
    ipcExitCallbacks.clear()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('acquire', () => {
    it('returns same instance for same ID', () => {
      const a = registry.acquire('pty-1')
      const b = registry.acquire('pty-1')
      expect(a).toBe(b)
    })

    it('returns different instances for different IDs', () => {
      const a = registry.acquire('pty-1')
      const b = registry.acquire('pty-2')
      expect(a).not.toBe(b)
      expect(a.terminal).not.toBe(b.terminal)
    })

    it('does NOT open terminal into container (deferred to mount)', () => {
      registry.acquire('pty-1')
      expect(mockTerminalOpen).not.toHaveBeenCalled()
    })

    it('sets initial state to parked', () => {
      const managed = registry.acquire('pty-1')
      expect(managed.state).toBe('parked')
      expect(managed.opened).toBe(false)
    })
  })

  describe('mount', () => {
    it('appends container to slot element and opens terminal', async () => {
      registry.acquire('pty-1')
      const slot = makeMockElement('div')
      await registry.mount('pty-1', slot)
      const managed = registry.instances.get('pty-1')!
      expect(slot.contains(managed.container)).toBe(true)
      expect(managed.state).toBe('mounted')
      expect(managed.opened).toBe(true)
      expect(mockTerminalOpen).toHaveBeenCalledWith(managed.container)
    })
  })

  describe('park', () => {
    it('moves container to hidden host', async () => {
      registry.acquire('pty-1')
      const slot = makeMockElement('div')
      await registry.mount('pty-1', slot)
      registry.park('pty-1')
      const managed = registry.instances.get('pty-1')!
      expect(managed.state).toBe('parked')
      expect(slot.contains(managed.container)).toBe(false)
    })
  })

  describe('mount after park', () => {
    it('moves container back to new slot', async () => {
      registry.acquire('pty-1')
      const slot1 = makeMockElement('div')
      await registry.mount('pty-1', slot1)
      registry.park('pty-1')

      const slot2 = makeMockElement('div')
      await registry.mount('pty-1', slot2)
      const managed = registry.instances.get('pty-1')!
      expect(slot2.contains(managed.container)).toBe(true)
      expect(slot1.contains(managed.container)).toBe(false)
      expect(managed.state).toBe('mounted')
    })
  })

  describe('destroy', () => {
    it('removes instance and disposes terminal', () => {
      registry.acquire('pty-1')
      expect(registry.has('pty-1')).toBe(true)
      registry.destroy('pty-1')
      expect(registry.has('pty-1')).toBe(false)
      expect(mockTerminalDispose).toHaveBeenCalled()
    })

    it('cleans up IPC listeners', () => {
      registry.acquire('pty-1')
      expect(ipcDataCallbacks.has('pty-1')).toBe(true)
      registry.destroy('pty-1')
      expect(ipcDataCallbacks.has('pty-1')).toBe(false)
    })
  })

  describe('has', () => {
    it('returns true for existing instance', () => {
      registry.acquire('pty-1')
      expect(registry.has('pty-1')).toBe(true)
    })

    it('returns false for non-existing instance', () => {
      expect(registry.has('pty-999')).toBe(false)
    })

    it('returns false after destroy', () => {
      registry.acquire('pty-1')
      registry.destroy('pty-1')
      expect(registry.has('pty-1')).toBe(false)
    })
  })

  describe('focus', () => {
    it('calls terminal.focus()', () => {
      registry.acquire('pty-1')
      registry.focus('pty-1')
      expect(mockTerminalFocus).toHaveBeenCalled()
    })

    it('does nothing for non-existing instance', () => {
      registry.focus('pty-999')
    })
  })

  describe('IPC data while parked', () => {
    it('registers an IPC data listener on acquire', () => {
      // `acquire` installs a transport.onData subscription immediately so
      // live bytes aren't lost between acquire and first mount. Writing
      // into xterm while parked is deferred (a display:none host has
      // zero-dim cells and corrupts xterm's render state).
      registry.acquire('pty-1')
      const callbacks = ipcDataCallbacks.get('pty-1')
      expect(callbacks).toBeDefined()
      expect(callbacks!.size).toBe(1)

      // Data delivered while parked is buffered internally. We don't
      // assert on xterm.write here because the production path drops
      // pre-mount bytes in favour of the server-authoritative scrollback
      // that mount fetches — see terminal-registry.ts `mount()`.
      for (const cb of callbacks!) cb('hello from PTY')
      vi.runAllTimers()
      expect(mockTerminalWrite).not.toHaveBeenCalledWith('hello from PTY')
    })

    it('flushes buffered IPC data after a re-mount (park → mount)', async () => {
      registry.acquire('pty-1')
      const slot1 = makeMockElement('div')
      await registry.mount('pty-1', slot1)
      registry.park('pty-1')
      mockTerminalWrite.mockClear()

      const callbacks = ipcDataCallbacks.get('pty-1')
      for (const cb of callbacks!) cb('hello from PTY')
      vi.runAllTimers()
      expect(mockTerminalWrite).not.toHaveBeenCalledWith('hello from PTY')

      const slot2 = makeMockElement('div')
      await registry.mount('pty-1', slot2)
      vi.runAllTimers()
      expect(mockTerminalWrite).toHaveBeenCalledWith('hello from PTY')
    })
  })
})
