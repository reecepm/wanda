import { useTrayData } from '../hooks/use-tray-data'
import { TrayPodItem } from './tray-pod-item'

export function TrayPodList() {
  const { workspaces } = useTrayData()

  const nonEmpty = workspaces.filter((ws) => ws.pods.length > 0)

  if (nonEmpty.length === 0) {
    return <div className="flex flex-1 items-center justify-center p-4 text-xs text-muted-foreground">No pods yet</div>
  }

  return (
    <div className="flex-1 overflow-y-auto px-2 py-1">
      {nonEmpty.map((ws) => (
        <div key={ws.id} className="mb-1">
          <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {ws.name}
          </div>
          <div className="flex flex-col gap-px">
            {ws.pods.map((pod) => (
              <TrayPodItem key={pod.id} pod={pod} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
