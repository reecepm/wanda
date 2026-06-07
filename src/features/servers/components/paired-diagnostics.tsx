// Diagnostic probe — when a paired card says "Couldn't reach server" this shows
// exactly which step of the chain failed (session token retrieval →
// capabilities HTTP → workspace.list via RPCLink).

import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/shared/utils'
import { Button } from '@/ui/button'
import type { PairedServerView } from '../../../../shared/contracts/servers'
import { probePairedServerConnection, type ServerProbeResult } from '../use-servers'

export function PairedDiagnostics({ server, autoRun = false }: { server: PairedServerView; autoRun?: boolean }) {
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<ServerProbeResult[]>([])
  const ranFor = useRef<string | null>(null)

  const runProbe = useCallback(async () => {
    setRunning(true)
    setResults([])
    try {
      const steps: ServerProbeResult[] = []
      await probePairedServerConnection(server, (result) => {
        steps.push(result)
        setResults([...steps])
      })
    } finally {
      setRunning(false)
    }
  }, [server])

  useEffect(() => {
    if (!autoRun) return
    const key = `${server.id}:${server.baseUrl}`
    if (ranFor.current === key) return
    ranFor.current = key
    void runProbe()
  }, [autoRun, runProbe, server.id, server.baseUrl])

  return (
    <div className="flex flex-col gap-1.5 p-2 rounded-md border border-zinc-800 bg-zinc-950/40 text-[10px] font-mono">
      <div className="flex items-center justify-between">
        <span className="text-zinc-500">
          Base URL: <span className="text-zinc-300">{server.baseUrl}</span>
        </span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={runProbe}
          disabled={running}
          className="text-zinc-400 hover:text-zinc-100"
        >
          {running ? 'Probing…' : 'Run probe'}
        </Button>
      </div>
      {results.map((r) => (
        <div key={`${r.step}:${r.detail}`} className={cn('flex gap-1.5', r.ok ? 'text-emerald-400' : 'text-red-400')}>
          <span>{r.ok ? '✓' : '✗'}</span>
          <span className="text-zinc-400">{r.step}</span>
          <span className="text-zinc-500 break-all">{r.detail}</span>
        </div>
      ))}
      {!running && results.length === 0 && (
        <p className="text-zinc-600">
          Click "Run probe" to test each step of the pairing chain. Output shows exactly which call fails.
        </p>
      )}
    </div>
  )
}
