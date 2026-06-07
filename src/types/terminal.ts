export interface RunningTerminal {
  podTerminalId: string
  ptyInstanceId: string
  name: string
}

export interface TerminalConfig {
  id: string
  name: string
  command: string | null
  args: string[] | null
  env: Record<string, string> | null
  restartPolicy: string
}
