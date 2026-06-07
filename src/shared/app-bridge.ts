export type ConnectionStatus = Parameters<Parameters<typeof window.wanda.app.onConnectionStatus>[0]>[0]
export type AppNavigateOptions = Parameters<Parameters<typeof window.wanda.app.onNavigate>[0]>[1]
export type TrayNavigateOptions = Parameters<typeof window.wanda.tray.navigate>[1]
export type NotificationChangedHandler = Parameters<typeof window.wanda.notification.onChanged>[0]
export type PodStatusChangeHandler = Parameters<typeof window.wanda.pod.onStatusChange>[0]
export type PodRecoveredHandler = Parameters<typeof window.wanda.pod.onRecovered>[0]
export type ShortcutForwardHandler = Parameters<typeof window.wanda.shortcut.onForward>[0]
export type WorkenvIdHandler = (id: string) => void
export type WorkenvStateChangedHandler = Parameters<typeof window.wanda.workenv.onStateChanged>[0]
export type WorkenvHealthHandler = Parameters<typeof window.wanda.workenv.onHealth>[0]
export type WorkenvBootstrapProgressHandler = Parameters<typeof window.wanda.workenv.onBootstrapProgress>[0]
export type WorkenvEventAddedHandler = Parameters<typeof window.wanda.workenv.onEventAdded>[0]
export type WorkenvPrebuildProgressHandler = Parameters<typeof window.wanda.workenv.onPrebuildProgress>[0]
export type WorkenvPrebuildLogHandler = Parameters<typeof window.wanda.workenv.onPrebuildLog>[0]
export type GitStatusChangeHandler = Parameters<typeof window.wanda.git.onStatusChange>[0]
export type FileChangeHandler = Parameters<typeof window.wanda.file.onChange>[1]

export function waitForServicesReady(): Promise<void> {
  return window.wanda.app.waitForServicesReady()
}

export function presentAttentionWindow(): void {
  window.wanda.app.attentionPresent()
}

export function dismissAttentionWindow(): void {
  window.wanda.app.attentionDismiss()
}

export function onAppNavigate(handler: (route: string, opts: AppNavigateOptions) => void): () => void {
  return window.wanda.app.onNavigate(handler)
}

export function onConnectionStatus(handler: (status: ConnectionStatus) => void): () => void {
  return window.wanda.app.onConnectionStatus(handler)
}

export function onShellReconnect(handler: () => void): () => void {
  return window.wanda.app.onShellReconnect(handler)
}

export function invalidateTrayQuery(namespace: string, method: string): void {
  window.wanda.tray.invalidate(namespace, method)
}

export function navigateMainWindow(route: string, opts?: TrayNavigateOptions): void {
  window.wanda.tray.navigate(route, opts)
}

export function onNotificationChanged(handler: NotificationChangedHandler): () => void {
  return window.wanda.notification.onChanged(handler)
}

export function onPodStatusChange(handler: PodStatusChangeHandler): () => void {
  return window.wanda.pod.onStatusChange(handler)
}

export function onPodRecovered(handler: PodRecoveredHandler): () => void {
  return window.wanda.pod.onRecovered(handler)
}

export function onShortcutForward(handler: ShortcutForwardHandler): () => void {
  return window.wanda.shortcut.onForward(handler)
}

export function onWorkenvCreated(handler: WorkenvIdHandler): () => void {
  return window.wanda.workenv.onCreated(handler)
}

export function onWorkenvUpdated(handler: WorkenvIdHandler): () => void {
  return window.wanda.workenv.onUpdated(handler)
}

export function onWorkenvDestroyed(handler: WorkenvIdHandler): () => void {
  return window.wanda.workenv.onDestroyed(handler)
}

export function onWorkenvStateChanged(handler: WorkenvStateChangedHandler): () => void {
  return window.wanda.workenv.onStateChanged(handler)
}

export function onWorkenvHealth(handler: WorkenvHealthHandler): () => void {
  return window.wanda.workenv.onHealth(handler)
}

export function onWorkenvBootstrapProgress(handler: WorkenvBootstrapProgressHandler): () => void {
  return window.wanda.workenv.onBootstrapProgress(handler)
}

export function onWorkenvEventAdded(handler: WorkenvEventAddedHandler): () => void {
  return window.wanda.workenv.onEventAdded(handler)
}

export function onWorkenvPrebuildProgress(handler: WorkenvPrebuildProgressHandler): () => void {
  return window.wanda.workenv.onPrebuildProgress(handler)
}

export function onWorkenvPrebuildLog(handler: WorkenvPrebuildLogHandler): () => void {
  return window.wanda.workenv.onPrebuildLog(handler)
}

export function watchGitRepoPath(repoPath: string): void {
  window.wanda.git.watchRepo(repoPath)
}

export function onGitStatusChange(handler: GitStatusChangeHandler): () => void {
  return window.wanda.git.onStatusChange(handler)
}

export function watchFile(watchId: string, podId: string, relPath: string): void {
  window.wanda.file.watch(watchId, podId, relPath)
}

export function unwatchFile(watchId: string): void {
  window.wanda.file.unwatch(watchId)
}

export function onFileChange(watchId: string, handler: FileChangeHandler): () => void {
  return window.wanda.file.onChange(watchId, handler)
}
