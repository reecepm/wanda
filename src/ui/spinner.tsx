import { RiLoaderLine } from '@/lib/icons'
import { cn } from '@/shared/utils'

function Spinner({ className }: { className?: string }) {
  return <RiLoaderLine role="status" aria-label="Loading" className={cn('size-4 animate-spin', className)} />
}

export { Spinner }
