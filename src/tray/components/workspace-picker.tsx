import { useEffect } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { useTrayData } from '../hooks/use-tray-data'
import { useTrayStore } from '../tray-store'

export function WorkspacePicker() {
  const { workspaces } = useTrayData()
  const selectedWorkspaceId = useTrayStore((s) => s.selectedWorkspaceId)
  const setSelectedWorkspaceId = useTrayStore((s) => s.setSelectedWorkspaceId)

  // Auto-select first workspace if none selected
  useEffect(() => {
    const firstWorkspace = workspaces[0]
    if (!selectedWorkspaceId && firstWorkspace) {
      setSelectedWorkspaceId(firstWorkspace.id)
    }
  }, [selectedWorkspaceId, workspaces, setSelectedWorkspaceId])

  return (
    <Select value={selectedWorkspaceId ?? ''} onValueChange={(val) => setSelectedWorkspaceId(val as string)}>
      <SelectTrigger size="sm" className="w-full text-[11px]">
        <SelectValue placeholder="Select workspace...">
          {(value: string | null) => {
            const ws = workspaces.find((w) => w.id === value)
            return ws?.name ?? 'Select workspace...'
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {workspaces.map((ws) => (
          <SelectItem key={ws.id} value={ws.id}>
            {ws.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
