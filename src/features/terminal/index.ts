export { TerminalGrid } from './components/terminal-grid'
export { TerminalStatusBadge } from './components/terminal-status-badge'
export { TerminalView } from './components/terminal-view'
export { useTerminal } from './hooks/use-terminal'
export type { AcquireOptions, ManagedTerminal } from './terminal-registry'
export { TERMINAL_THEME, TerminalRegistry, terminalRegistry } from './terminal-registry'
export {
  canOpenExternalUrls,
  forgetAllForServer,
  getTransportFor,
  onTerminalUrlDetected,
  onTerminalZoom,
  openExternalUrl,
  registerRemotePodScope,
  registerRemoteTerminal,
  unregisterRemotePodScope,
  unregisterRemoteTerminal,
} from './terminal-transport'
