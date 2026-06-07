import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal } from '@xterm/xterm'
import { isAppShortcut } from '@/features/shortcuts'
import { useShortcutStore } from '@/stores/shortcut-store'
import { useUIStore } from '@/stores/ui-store'
import { getTransportFor, onTerminalZoom, openExternalUrl } from './terminal-transport'

export const TERMINAL_THEME = {
  background: '#09090b',
  foreground: '#d4d4d8',
  cursor: '#d4d4d8',
  cursorAccent: '#09090b',
  selectionBackground: '#3f3f46',
  selectionForeground: '#fafafa',
  black: '#27272a',
  red: '#f87171',
  green: '#4ade80',
  yellow: '#facc15',
  blue: '#60a5fa',
  magenta: '#c084fc',
  cyan: '#22d3ee',
  white: '#d4d4d8',
  brightBlack: '#52525b',
  brightRed: '#fca5a5',
  brightGreen: '#86efac',
  brightYellow: '#fde68a',
  brightBlue: '#93c5fd',
  brightMagenta: '#d8b4fe',
  brightCyan: '#67e8f9',
  brightWhite: '#fafafa',
} as const

export interface ManagedTerminal {
  terminal: Terminal
  container: HTMLDivElement
  fitAddon: FitAddon
  ipcCleanup: (() => void)[]
  state: 'mounted' | 'parked'
  opened: boolean
  scrollbackLoaded: boolean
  resizeObserver: ResizeObserver | null
  /** Flush any data buffered while parked — call after remount + resize. */
  flushPendingWrites: () => void
  /** Drop buffered live data + cancel pending flush — used before applying a server snapshot. */
  discardPendingWrites: () => void
}

export interface AcquireOptions {
  fontSize?: number
  onTitleChange?: (title: string) => void
}

export class TerminalRegistry {
  readonly instances = new Map<string, ManagedTerminal>()
  private _hiddenHost: HTMLDivElement | null = null

  private get hiddenHost(): HTMLDivElement {
    if (!this._hiddenHost) {
      this._hiddenHost = document.createElement('div')
      this._hiddenHost.style.display = 'none'
      this._hiddenHost.dataset.terminalRegistryHost = 'true'
      document.body.appendChild(this._hiddenHost)
    }
    return this._hiddenHost
  }

  has(ptyInstanceId: string): boolean {
    return this.instances.has(ptyInstanceId)
  }

  acquire(ptyInstanceId: string, options?: AcquireOptions): ManagedTerminal {
    const existing = this.instances.get(ptyInstanceId)
    if (existing) return existing

    const fontSize = options?.fontSize ?? 13
    const storedSize = useUIStore.getState().terminalFontSizes[ptyInstanceId]
    const initialFontSize = storedSize ?? fontSize

    const term = new Terminal({
      cursorBlink: true,
      fontSize: initialFontSize,
      fontFamily: '"JetBrainsMono NFM", "JetBrains Mono Variable", monospace',
      allowTransparency: false,
      reflowCursorLine: true,
      theme: TERMINAL_THEME,
      scrollback: 10000,
    })

    const fitAddon = new FitAddon()
    // xterm-addon-web-links only fires `activate` when the platform's
    // link-modifier is held (Cmd on macOS, Ctrl elsewhere), so any
    // invocation here is already a deliberate Cmd/Ctrl+click. Always
    // route to the OS browser via shell.openExternal — never the
    // embedded webview, even if the URL was also surfaced via the
    // url-detected toast.
    const webLinksAddon = new WebLinksAddon((_event, url) => {
      openExternalUrl(url)
    })
    term.loadAddon(fitAddon)
    term.loadAddon(webLinksAddon)

    const container = document.createElement('div')
    container.style.width = '100%'
    container.style.height = '100%'
    container.style.overflow = 'hidden'
    container.style.backgroundColor = TERMINAL_THEME.background

    // Pick the transport for this terminal. Defaults to the local preload
    // WS; if the pod page marked this terminal as remote before we
    // acquired the xterm, it routes through a PairedTerminalBridge over
    // the paired server's /events WS.
    const transport = getTransportFor(ptyInstanceId)

    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true
      if (event.shiftKey && event.key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault()
        event.stopImmediatePropagation()
        event.stopPropagation()
        transport.write(ptyInstanceId, '\x0a')
        return false
      }
      if (event.metaKey && event.key === 'Backspace') {
        transport.write(ptyInstanceId, '\x15')
        return false
      }
      if (event.metaKey && event.key === 'ArrowLeft') {
        const seq = term.modes.applicationCursorKeysMode ? '\x1bOH' : '\x1b[H'
        transport.write(ptyInstanceId, seq)
        return false
      }
      if (event.metaKey && event.key === 'ArrowRight') {
        const seq = term.modes.applicationCursorKeysMode ? '\x1bOF' : '\x1b[F'
        transport.write(ptyInstanceId, seq)
        return false
      }
      const { overrides } = useShortcutStore.getState()
      if (isAppShortcut(event, overrides)) {
        return false
      }
      return true
    })

    term.onData((data) => {
      transport.write(ptyInstanceId, data)
    })

    // Data is buffered while the terminal is parked (in display:none host)
    // to prevent xterm from processing writes with zero-dimension cells,
    // which corrupts its internal render state.
    let pendingWrite = ''
    let flushTimer: ReturnType<typeof setTimeout> | null = null
    const flushWrites = () => {
      flushTimer = null
      if (!pendingWrite) return
      if (managed.state !== 'mounted') return
      term.write(pendingWrite)
      pendingWrite = ''
    }
    const queueWrite = (data: string) => {
      pendingWrite += data
      if (managed.state !== 'mounted') return
      if (flushTimer !== null) return
      flushTimer = setTimeout(flushWrites, 16)
    }

    const ipcCleanup: (() => void)[] = []

    const removeDataListener = transport.onData(ptyInstanceId, (data) => {
      queueWrite(data)
    })
    ipcCleanup.push(removeDataListener)

    const removeExitListener = transport.onExit(ptyInstanceId, (code) => {
      queueWrite(`\r\n\x1b[90m[Process exited with code ${code}]\x1b[0m\r\n`)
    })
    ipcCleanup.push(removeExitListener)

    const removeZoomListener = onTerminalZoom((direction) => {
      if (!container.contains(document.activeElement)) return
      const current = term.options.fontSize ?? 14
      let newSize: number
      if (direction === 'in') {
        newSize = Math.min(current + 2, 40)
      } else if (direction === 'out') {
        newSize = Math.max(current - 2, 8)
      } else {
        newSize = fontSize
      }
      term.options.fontSize = newSize
      useUIStore.getState().setTerminalFontSize(ptyInstanceId, newSize)
      fitAddon.fit()
    })
    ipcCleanup.push(removeZoomListener)

    const titleDisposable = term.onTitleChange((title) => {
      options?.onTitleChange?.(title)
    })
    ipcCleanup.push(() => titleDisposable.dispose())

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        term.refresh(0, term.rows - 1)
        fitAddon.fit()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    ipcCleanup.push(() => document.removeEventListener('visibilitychange', handleVisibilityChange))

    // Mouse coord fix for CSS-scaled containers (ReactFlow zoom).
    function adjustMouseCoords(e: MouseEvent) {
      const screenEl = container.querySelector('.xterm-screen') as HTMLElement | null
      if (!screenEl) return
      const rect = screenEl.getBoundingClientRect()
      const scaleX = screenEl.offsetWidth / rect.width
      const scaleY = screenEl.offsetHeight / rect.height
      if (Math.abs(scaleX - 1) < 0.01 && Math.abs(scaleY - 1) < 0.01) return
      Object.defineProperty(e, 'clientX', { value: rect.left + (e.clientX - rect.left) * scaleX })
      Object.defineProperty(e, 'clientY', { value: rect.top + (e.clientY - rect.top) * scaleY })
    }
    const adjustedEvents = ['mousedown', 'mousemove', 'mouseup', 'dblclick'] as const
    for (const evt of adjustedEvents) {
      container.addEventListener(evt, adjustMouseCoords as EventListener, { capture: true })
    }
    ipcCleanup.push(() => {
      for (const evt of adjustedEvents) {
        container.removeEventListener(evt, adjustMouseCoords as EventListener, { capture: true })
      }
    })

    // Stop wheel propagation to prevent d3-zoom interference.
    function stopWheelBubble(e: WheelEvent) {
      e.stopPropagation()
    }
    container.addEventListener('wheel', stopWheelBubble)
    ipcCleanup.push(() => container.removeEventListener('wheel', stopWheelBubble))

    const resizeDisposable = term.onResize(({ cols, rows }) => {
      if (managed.state === 'mounted' && managed.opened) {
        transport.resize(ptyInstanceId, cols, rows)
      }
    })
    ipcCleanup.push(() => resizeDisposable.dispose())

    ipcCleanup.push(() => {
      if (flushTimer !== null) clearTimeout(flushTimer)
    })

    const managed: ManagedTerminal = {
      terminal: term,
      container,
      fitAddon,
      ipcCleanup,
      state: 'parked',
      opened: false,
      scrollbackLoaded: false,
      resizeObserver: null,
      flushPendingWrites() {
        if (flushTimer !== null) {
          clearTimeout(flushTimer)
          flushTimer = null
        }
        if (pendingWrite) {
          term.write(pendingWrite)
          pendingWrite = ''
        }
      },
      discardPendingWrites() {
        if (flushTimer !== null) {
          clearTimeout(flushTimer)
          flushTimer = null
        }
        pendingWrite = ''
      },
    }
    this.instances.set(ptyInstanceId, managed)

    return managed
  }

  async mount(ptyInstanceId: string, slot: HTMLElement): Promise<void> {
    const managed = this.instances.get(ptyInstanceId)
    if (!managed) return

    managed.state = 'mounted'

    if (managed.opened) {
      // Remount: reparent, fit, flush. Synchronous — no waiting.
      slot.appendChild(managed.container)
      managed.fitAddon.fit()
      const dims = managed.fitAddon.proposeDimensions()
      if (dims) {
        getTransportFor(ptyInstanceId).resize(ptyInstanceId, dims.cols, dims.rows)
      }
      // Flush data that accumulated while parked — now at correct dimensions
      managed.flushPendingWrites()
    } else {
      slot.appendChild(managed.container)
      await document.fonts.ready
      if (!this.instances.has(ptyInstanceId) || managed.state !== 'mounted') return
      managed.terminal.open(managed.container)
      managed.opened = true

      // Wait for browser layout so fitAddon gets correct dimensions
      await new Promise<void>((resolve) => {
        const layoutObserver = new ResizeObserver(() => {
          layoutObserver.disconnect()
          resolve()
        })
        layoutObserver.observe(managed.container)
      })
      if (!this.instances.has(ptyInstanceId) || managed.state !== 'mounted') return

      managed.fitAddon.fit()
      const dims = managed.fitAddon.proposeDimensions()
      if (dims) {
        getTransportFor(ptyInstanceId).resize(ptyInstanceId, dims.cols, dims.rows)
      }

      // Fetch scrollback after fit so it reflows at correct width.
      // Routes through the same transport we use for live data — local
      // pods hit `orpc.terminal.getScrollback`, remote pods hit the
      // paired server's scrollback endpoint via a paired oRPC client.
      if (!managed.scrollbackLoaded) {
        managed.scrollbackLoaded = true
        const scrollback = await getTransportFor(ptyInstanceId).getScrollback(ptyInstanceId)
        if (!this.instances.has(ptyInstanceId)) return
        if (scrollback) {
          // Snapshot already represents live data queued during the awaits above.
          // Reset xterm + drop pendingWrite to avoid duplicating those lines into scrollback.
          managed.discardPendingWrites()
          managed.terminal.reset()
          managed.terminal.write(scrollback)
        }
      }
    }

    // Start continuous resize tracking (reconnected on each mount)
    this.startResizeTracking(managed)

    // Apply focus if this terminal is the currently selected one. The focus
    // effect in use-terminal.ts may have fired before term.open() created the
    // textarea, making that earlier focus() call a no-op. Re-applying here
    // ensures focus lands once the DOM actually exists.
    if (useUIStore.getState().selectedId === ptyInstanceId) {
      managed.terminal.focus()
    }
  }

  private startResizeTracking(managed: ManagedTerminal): void {
    if (managed.resizeObserver) managed.resizeObserver.disconnect()
    let fitPending = false
    managed.resizeObserver = new ResizeObserver(() => {
      if (fitPending) return
      fitPending = true
      requestAnimationFrame(() => {
        fitPending = false
        if (managed.state === 'mounted' && managed.opened) {
          managed.fitAddon.fit()
        }
      })
    })
    managed.resizeObserver.observe(managed.container)
  }

  park(ptyInstanceId: string): void {
    const managed = this.instances.get(ptyInstanceId)
    if (!managed) return

    if (managed.resizeObserver) {
      managed.resizeObserver.disconnect()
      managed.resizeObserver = null
    }
    this.hiddenHost.appendChild(managed.container)
    managed.state = 'parked'
  }

  destroy(ptyInstanceId: string): void {
    const managed = this.instances.get(ptyInstanceId)
    if (!managed) return

    if (managed.resizeObserver) {
      managed.resizeObserver.disconnect()
    }
    for (const cleanup of managed.ipcCleanup) {
      cleanup()
    }
    managed.terminal.dispose()
    managed.container.remove()
    this.instances.delete(ptyInstanceId)
  }

  focus(ptyInstanceId: string): void {
    const managed = this.instances.get(ptyInstanceId)
    if (!managed) return
    managed.terminal.focus()
  }

  /**
   * Clear scrollback both client-side (xterm buffer) and server-side
   * (headless + on-disk snapshot). The PTY process keeps running — only
   * the captured history is dropped. Pending queued data is also
   * discarded so old bytes don't replay if the registry was parked.
   */
  async clear(ptyInstanceId: string): Promise<void> {
    const managed = this.instances.get(ptyInstanceId)
    if (!managed) return
    managed.discardPendingWrites()
    managed.terminal.clear()
    await getTransportFor(ptyInstanceId).clear(ptyInstanceId)
  }

  /**
   * Refetch scrollback for a mounted terminal and replay it. Drives the
   * post-reconnect repaint for paired terminals: when the WS to a paired
   * server flaps, `data` subscribers resume from `seq` but the frames
   * that dropped during the outage are lost to the client — only the
   * server's cumulative scrollback knows what the screen should look
   * like. Fetch it through the same transport the terminal is already
   * using (local or paired), discard buffered writes so replayed bytes
   * don't duplicate, reset xterm, write the snapshot.
   */
  async resyncScrollback(ptyInstanceId: string): Promise<void> {
    const managed = this.instances.get(ptyInstanceId)
    if (!managed || !managed.opened) return
    const snapshot = await getTransportFor(ptyInstanceId).getScrollback(ptyInstanceId)
    if (!this.instances.has(ptyInstanceId)) return
    if (snapshot === null || snapshot === undefined) return
    managed.discardPendingWrites()
    managed.terminal.reset()
    managed.terminal.write(snapshot)
  }
}

export const terminalRegistry = new TerminalRegistry()
