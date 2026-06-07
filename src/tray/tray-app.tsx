import { useMcpInvalidation } from '@/features/notifications'
import { TrayAttentionSection } from './components/tray-attention-section'
import { TrayPodList } from './components/tray-pod-list'
import { TrayQuickInput } from './components/tray-quick-input'

export function TrayApp() {
  // Subscribe to orpc:invalidate IPC events to keep queries fresh
  useMcpInvalidation()

  return (
    <div className="flex h-screen flex-col overflow-hidden rounded-lg border border-border/50 bg-background text-foreground">
      <TrayAttentionSection />
      <TrayPodList />
      <TrayQuickInput />
    </div>
  )
}
