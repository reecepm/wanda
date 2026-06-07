// Use subpath imports (#xterm-*) mapped in package.json to resolve the
// correct .mjs entry points. The default CJS exports from @xterm/headless
// don't work properly under ESM (Node/tsx).
// @ts-expect-error -- subpath imports resolve at runtime via package.json "imports"
import { Terminal } from '#xterm-headless'
// @ts-expect-error -- subpath imports resolve at runtime via package.json "imports"
import { SerializeAddon } from '#xterm-serialize'

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
    return this.serializeAddon.serialize()
  }

  get hasPendingWrites(): boolean {
    return this.pendingWrites > 0
  }

  dispose(): void {
    this.terminal.dispose()
  }
}
