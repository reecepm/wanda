import { useMutation, useQueryClient } from '@tanstack/react-query'
import { RiCheckLine, RiTimeLine } from '@/lib/icons'
import { orpcUtils } from '@/shared/orpc'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu'

const TTL_OPTIONS: { value: number | null; label: string }[] = [
  { value: 7, label: '7 days' },
  { value: 14, label: '14 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
  { value: null, label: 'Never' },
]

export function PlanTtlControl({
  planId,
  expectedVersion,
  staleAfterDays,
}: {
  planId: string
  expectedVersion: number
  staleAfterDays: number | null
}) {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    ...orpcUtils.plan.update.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpcUtils.plan.get.key({ input: { id: planId } }) })
    },
  })

  const label = staleAfterDays === null ? 'TTL: never' : `TTL: ${staleAfterDays}d`

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={mutation.isPending}
        className="inline-flex items-center gap-1 rounded-full bg-zinc-800/60 px-2 py-0.5 text-[10px] font-medium text-zinc-400 outline-none hover:bg-zinc-800"
      >
        <RiTimeLine className="h-3 w-3" />
        {label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[140px]">
        {TTL_OPTIONS.map((opt) => (
          <DropdownMenuItem
            key={opt.label}
            onSelect={() => {
              if (opt.value !== staleAfterDays) {
                mutation.mutate({ id: planId, expectedVersion, staleAfterDays: opt.value })
              }
            }}
            className="flex items-center justify-between gap-2 text-xs"
          >
            <span>{opt.label}</span>
            {opt.value === staleAfterDays && <RiCheckLine className="h-3.5 w-3.5 text-zinc-400" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
