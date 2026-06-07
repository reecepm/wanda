// Pairing-in surface for the "This machine" card: the list of devices that
// have paired INTO this server, plus the panel that mints a pairing URL so
// another Wanda client can pair into it.

import { useState } from 'react'
import { RiLoader4Line, RiRefreshLine } from '@/lib/icons'
import { Button } from '@/ui/button'
import type { LocalPairingUrl, LocalServerInfo } from '../../../../shared/contracts/servers'
import { useIncomingSessions } from '../machines-inventory'
import { issueLocalPairingUrl, revokeIncomingSession } from '../use-servers'
import { CopyButton } from './copy-button'

export function IncomingSessionsPanel() {
  const sessions = useIncomingSessions()
  const [revoking, setRevoking] = useState<string | null>(null)

  async function handleRevoke(sessionId: string) {
    setRevoking(sessionId)
    try {
      await revokeIncomingSession(sessionId)
      await sessions.refetch()
    } finally {
      setRevoking(null)
    }
  }

  const list = sessions.data ?? []
  if (list.length === 0) {
    return <p className="text-[10px] text-zinc-600">No devices have paired into this server yet.</p>
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">Paired in · {list.length}</div>
      {list.map((s) => (
        <div
          key={s.sessionId}
          className="flex items-center gap-2 p-2 rounded-md border border-zinc-800 bg-zinc-900/40 text-[11px]"
        >
          <span className="size-1.5 rounded-full bg-emerald-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-zinc-200 truncate">{s.device.deviceName}</div>
            <div className="text-[10px] text-zinc-600 font-mono">
              {s.device.os} · {s.device.appVersion} · since {new Date(s.issuedAt).toLocaleString()}
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => handleRevoke(s.sessionId)}
            disabled={revoking === s.sessionId}
            className="text-[10px] text-zinc-500 hover:text-red-400"
          >
            {revoking === s.sessionId ? 'Revoking…' : 'Revoke'}
          </Button>
        </div>
      ))}
    </div>
  )
}

export function LocalPairingPanel({ info }: { info: LocalServerInfo }) {
  const [minted, setMinted] = useState<LocalPairingUrl | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleMint() {
    setPending(true)
    setError(null)
    try {
      const result = await issueLocalPairingUrl()
      if (!result) {
        setError('Pairing is unavailable in subprocess mode.')
        return
      }
      setMinted(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mint pairing URL')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 pt-2 border-t border-zinc-800/60">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] text-zinc-400">
          Pair another device into this server
          <span className="text-zinc-600"> · serverId </span>
          <span className="font-mono text-zinc-500">{info.serverId.slice(0, 12)}</span>
        </div>
        {!minted && (
          <Button size="sm" variant="outline" onClick={handleMint} disabled={pending}>
            {pending ? (
              <>
                <RiLoader4Line className="size-3 animate-spin" /> Minting…
              </>
            ) : (
              'Generate pairing URL'
            )}
          </Button>
        )}
      </div>

      {!info.exposed && (
        <p className="text-[10px] text-amber-400/80 leading-relaxed">
          This server is bound to <span className="font-mono text-amber-300">{info.listenHost}</span> and only reachable
          on this machine. To pair from another device, restart with{' '}
          <code className="font-mono text-[10px] text-zinc-300 bg-zinc-800 px-1 rounded">
            WANDA_LISTEN_HOST=0.0.0.0
          </code>{' '}
          so it binds to the network.
        </p>
      )}

      {info.exposed && info.networkHosts.length > 0 && (
        <div className="text-[10px] text-zinc-500 font-mono leading-relaxed">
          Reachable at:{' '}
          {info.networkHosts.map((h, i) => (
            <span key={h}>
              {i > 0 && ', '}
              <span className="text-zinc-400">
                {h}:{info.port}
              </span>
            </span>
          ))}
        </div>
      )}

      {error && <p className="text-[11px] text-red-400">{error}</p>}

      {minted && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-start gap-2 p-2 rounded-md border border-zinc-800 bg-zinc-900/60">
            <code className="flex-1 text-[10px] text-zinc-200 font-mono break-all leading-relaxed">{minted.url}</code>
            <CopyButton value={minted.url} label="Copy URL" />
          </div>
          <div className="flex items-center justify-between text-[10px] text-zinc-600">
            <span>
              Expires <span className="font-mono text-zinc-500">{new Date(minted.expiresAt).toLocaleTimeString()}</span>
            </span>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={handleMint}
              className="text-zinc-500 hover:text-zinc-200"
            >
              <RiRefreshLine className="size-3" />
              New URL
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
