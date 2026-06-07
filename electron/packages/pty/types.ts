export interface PtyConfig {
  cwd: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  cols?: number
  rows?: number
  onExit?: (id: string, exitCode: number) => void
}
