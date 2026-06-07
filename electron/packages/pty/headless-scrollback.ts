import { SerializeAddon } from '@xterm/addon-serialize'
import { Terminal } from '@xterm/headless'
import { log } from '../logger'

export interface HeadlessScrollbackOpts {
  cols?: number
  rows?: number
  scrollback?: number
}

const DEFAULT_COLS = 80
const DEFAULT_ROWS = 30
const DEFAULT_SCROLLBACK = 10_000

export class HeadlessScrollback {
  private terminal: Terminal
  private serializeAddon: SerializeAddon
  private pendingWrites = 0

  constructor(opts: HeadlessScrollbackOpts = {}) {
    this.terminal = new Terminal({
      cols: opts.cols ?? DEFAULT_COLS,
      rows: opts.rows ?? DEFAULT_ROWS,
      scrollback: opts.scrollback ?? DEFAULT_SCROLLBACK,
      allowProposedApi: true,
    })
    this.serializeAddon = new SerializeAddon()
    this.terminal.loadAddon(this.serializeAddon)
  }

  write(data: string): void {
    this.pendingWrites++
    this.terminal.write(data, () => {
      this.pendingWrites--
    })
  }

  resize(cols: number, rows: number): void {
    this.terminal.resize(cols, rows)
  }

  serialize(): string {
    if (this.pendingWrites > 0) {
      log.pty.warn(`serialize() called with ${this.pendingWrites} pending writes`)
    }
    return this.serializeAddon.serialize()
  }

  dispose(): void {
    this.terminal.dispose()
  }
}
