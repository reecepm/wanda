import { useQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { WelcomePage } from '@/features/workspace'
import { orpcUtils } from '@/shared/orpc'
import { useUIStore } from '@/stores/ui-store'

export const Route = createFileRoute('/')({
  component: IndexPage,
})

function IndexPage() {
  const navigate = useNavigate()
  const activePodId = useUIStore((s) => s.activePodId)

  const { data: workspaces } = useQuery(orpcUtils.workspace.list.queryOptions({}))

  // Navigate to restored pod on first mount
  useEffect(() => {
    if (activePodId) {
      navigate({ to: '/pods/$podId', params: { podId: activePodId } })
    }
  }, [activePodId, navigate])

  if (activePodId) return null

  if (workspaces !== undefined && workspaces.length === 0) {
    return <WelcomePage />
  }

  return (
    <div className="flex items-center justify-center h-full text-zinc-600 text-sm">
      Select a pod from the sidebar to get started
    </div>
  )
}
