// Inline pair form — opens from the top-right "Pair a server" button.

import { useEffect, useRef, useState } from 'react'
import { RiLoader4Line } from '@/lib/icons'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { usePairServer } from '../use-servers'
import { pairingUrlErrorMessage, validatePairingUrl } from '../validate-pairing-url'

export function PairForm({ onClose }: { onClose: () => void }) {
  const pairMutation = usePairServer()
  const [url, setUrl] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const validationError = url.length > 0 ? validatePairingUrl(url) : null
  const canSubmit = !validationError && url.length > 0 && !pairMutation.isPending

  async function handleSubmit() {
    if (!canSubmit) return
    try {
      await pairMutation.mutateAsync(url.trim())
      onClose()
    } catch {
      // error surfaces inline below
    }
  }

  return (
    <div className="flex flex-col gap-2 p-3 rounded-lg border border-zinc-800 bg-zinc-900/40">
      <label className="text-[10px] font-medium text-zinc-500">Pairing URL</label>
      <Input
        ref={inputRef}
        type="text"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="http://example-host:9876/pair#token=…"
        className="h-7 border-zinc-700 bg-zinc-800 text-xs text-zinc-200 font-mono placeholder:text-zinc-600 focus-visible:border-zinc-500"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && canSubmit) handleSubmit()
          if (e.key === 'Escape') onClose()
        }}
      />
      {url.length > 0 && validationError && (
        <p className="text-[11px] text-amber-400">{pairingUrlErrorMessage(validationError)}</p>
      )}
      {pairMutation.isError && <p className="text-[11px] text-red-400">{pairMutation.error.message}</p>}
      <p className="text-[10px] text-zinc-600">
        Get a pairing URL from the other machine&apos;s Machines page &rarr; &ldquo;Generate pairing URL&rdquo;.
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" onClick={handleSubmit} disabled={!canSubmit}>
          {pairMutation.isPending ? (
            <>
              <RiLoader4Line className="size-3 animate-spin" />
              Pairing…
            </>
          ) : (
            'Pair'
          )}
        </Button>
      </div>
    </div>
  )
}
