import { Badge } from '@/ui/badge'

export function WorkenvPrebuildStatusBadge({ state }: { state: string | undefined }) {
  if (state === 'ready') {
    return (
      <Badge variant="outline" className="border-emerald-900/70 bg-emerald-950/30 text-emerald-300">
        Prebuilt
      </Badge>
    )
  }
  if (state === 'creating') {
    return (
      <Badge variant="outline" className="border-amber-900/70 bg-amber-950/30 text-amber-300">
        Building
      </Badge>
    )
  }
  if (state === 'error') {
    return (
      <Badge variant="outline" className="border-red-900/70 bg-red-950/30 text-red-300">
        Failed
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="border-zinc-800 bg-zinc-900/50 text-zinc-500">
      Not built
    </Badge>
  )
}
