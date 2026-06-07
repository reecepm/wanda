import { useEffect, useRef, useState } from 'react'
import { RiCheckLine, RiFileCopyLine } from '@/lib/icons'
import { cn } from '@/shared/utils'
import { Button } from '@/ui/button'

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      onClick={() => {
        void navigator.clipboard.writeText(value)
        setCopied(true)
        if (timeoutRef.current) clearTimeout(timeoutRef.current)
        timeoutRef.current = setTimeout(() => setCopied(false), 1500)
      }}
      className={cn(
        'text-[10px]',
        copied ? 'text-emerald-400 bg-emerald-950/30' : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800',
      )}
    >
      {copied ? <RiCheckLine className="size-3" /> : <RiFileCopyLine className="size-3" />}
      {copied ? 'Copied' : label}
    </Button>
  )
}
