import { join } from 'node:path'
import { BrowserWindow, Tray } from 'electron'
import { computeTrayIconState, computeTrayTooltip, getTrayIcon } from './tray-icon'

export class TrayManager {
  #tray: Tray | null = null
  #window: BrowserWindow | null = null
  #runningPodCount = 0
  #blockingNotificationCount = 0
  #preloadPath: string
  #preloadArgs: ReadonlyArray<string>

  constructor(preloadPath: string, preloadArgs: ReadonlyArray<string> = []) {
    this.#preloadPath = preloadPath
    this.#preloadArgs = preloadArgs
  }

  /** Initialize tray icon + popup window. Call once in app.whenReady(). */
  init() {
    this.#tray = new Tray(getTrayIcon('idle'))
    this.#tray.setToolTip('Wanda')

    // macOS: ensure individual clicks fire (not swallowed by double-click detection)
    this.#tray.setIgnoreDoubleClickEvents(true)

    this.#tray.on('click', () => {
      this.toggle()
    })

    this.#createWindow()
  }

  #createWindow() {
    this.#window = new BrowserWindow({
      width: 380,
      height: 520,
      show: false,
      frame: false,
      resizable: false,
      fullscreenable: false,
      transparent: true,
      skipTaskbar: true,
      hasShadow: true,
      type: 'panel',
      vibrancy: 'popover',
      webPreferences: {
        preload: this.#preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        additionalArguments: [...this.#preloadArgs],
      },
    })

    // Hide on blur (unless devtools is open for debugging)
    this.#window.on('blur', () => {
      if (this.#window?.webContents.isDevToolsOpened()) return
      this.hide()
    })

    // The tray window connects directly to the Wanda server via its
    // own WebSocket (preload configured via additionalArguments above),
    // so we no longer need a Broadcaster registration to fan main-process
    // broadcasts to it — the server's WsGateway fans out directly.

    // Load the tray renderer
    if (process.env.ELECTRON_RENDERER_URL) {
      this.#window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/tray.html`)
    } else {
      this.#window.loadFile(join(__dirname, '../renderer/tray.html'))
    }
  }

  /** Toggle visibility of the tray popup. */
  toggle() {
    if (this.#window?.isVisible()) {
      this.hide()
    } else {
      this.show()
    }
  }

  /** Show the popup window positioned below the tray icon. */
  show() {
    if (!this.#window || !this.#tray) return

    const trayBounds = this.#tray.getBounds()
    const windowBounds = this.#window.getBounds()

    const x = Math.round(trayBounds.x + trayBounds.width / 2 - windowBounds.width / 2)
    const y = Math.round(trayBounds.y + trayBounds.height)

    this.#window.setPosition(x, y, false)
    this.#window.show()
    this.#window.focus()
  }

  /** Hide the tray popup. */
  hide() {
    this.#window?.hide()
  }

  /** Send an IPC message to the tray window (used by broadcast() in main.ts). */
  send(channel: string, ...args: unknown[]) {
    if (this.#window && !this.#window.isDestroyed()) {
      this.#window.webContents.send(channel, ...args)
    }
  }

  /** Update running pod count and refresh the icon/tooltip. */
  setRunningPodCount(count: number) {
    this.#runningPodCount = count
    this.#refreshIcon()
  }

  /** Update blocking notification count and refresh the icon. */
  setBlockingNotificationCount(count: number) {
    this.#blockingNotificationCount = count
    this.#refreshIcon()
  }

  #refreshIcon() {
    if (!this.#tray) return
    const newState = computeTrayIconState(this.#runningPodCount, this.#blockingNotificationCount)

    this.#tray.setImage(getTrayIcon(newState))

    // Show count text next to icon in the menu bar (macOS only)
    if (this.#blockingNotificationCount > 0) {
      this.#tray.setTitle(String(this.#blockingNotificationCount), { fontType: 'monospacedDigit' })
    } else {
      this.#tray.setTitle('')
    }

    this.#tray.setToolTip(computeTrayTooltip(this.#runningPodCount))
  }

  /** Clean up tray and window on app quit. */
  destroy() {
    this.#window?.destroy()
    this.#window = null
    this.#tray?.destroy()
    this.#tray = null
  }
}
