import { useState } from 'react'
import { canOpenExternalUrls } from '@/features/terminal'
import { Button } from '@/ui/button'
import type { PairedServerView } from '../../../../shared/contracts/servers'
import { usePairedCapabilities, usePairedInventory } from '../machines-inventory'
import { InventorySummary } from './inventory-summary'
import { MachineCard } from './machine-card'
import { PairedDiagnostics } from './paired-diagnostics'

export function PairedMachineCard({ server, onRemove }: { server: PairedServerView; onRemove: (id: string) => void }) {
  // Default to expanded so users see inventory without an extra click — the
  // list is the main signal that pairing is actually working.
  const [expanded, setExpanded] = useState(true)
  const [showDiag, setShowDiag] = useState(false)
  const inventory = usePairedInventory(server, expanded)
  const caps = usePairedCapabilities(server)
  const canOpenExternal = canOpenExternalUrls()
  const state: 'online' | 'offline' | 'loading' =
    inventory.isLoading && expanded ? 'loading' : inventory.isError ? 'offline' : 'online'
  const ssh = caps.data?.ssh ?? null

  return (
    <MachineCard
      icon="remote"
      title={server.label}
      subtitle={server.baseUrl}
      state={state}
      expanded={expanded}
      onToggle={() => setExpanded((v) => !v)}
      footer={
        <>
          {(ssh || server.lastConnectedAt != null) && (
            <div className="flex flex-col gap-1 text-[10px] text-zinc-500 font-mono">
              {ssh?.host && (
                <div className="truncate">
                  ssh <span className="text-zinc-400">{ssh.user ? `${ssh.user}@${ssh.host}` : ssh.host}</span>
                </div>
              )}
              {server.lastConnectedAt != null && (
                <div>
                  last seen <span className="text-zinc-400">{new Date(server.lastConnectedAt).toLocaleString()}</span>
                </div>
              )}
            </div>
          )}
          {state === 'offline' && (
            <p className="text-[11px] text-amber-400/80">
              Unreachable at <span className="font-mono">{server.baseUrl}</span>. Check Tailscale / network or the
              server process.
            </p>
          )}
          <div className="flex justify-end">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => onRemove(server.id)}
              className="text-[10px] text-zinc-500 hover:text-red-400"
            >
              Unpair
            </Button>
          </div>
        </>
      }
    >
      <InventorySummary
        inventory={inventory.data}
        isLoading={inventory.isLoading}
        isError={inventory.isError}
        error={inventory.error}
        sshFor={() => ssh}
        canOpenExternal={canOpenExternal}
      />
      <div className="pt-2 border-t border-zinc-800/60 flex flex-col gap-1.5">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => setShowDiag((v) => !v)}
          className="justify-start text-[10px] text-zinc-500 hover:text-zinc-300"
        >
          {showDiag || inventory.isError ? 'Diagnostics ▾' : 'Show diagnostics ▸'}
        </Button>
        {(showDiag || inventory.isError) && <PairedDiagnostics server={server} autoRun={inventory.isError} />}
      </div>
    </MachineCard>
  )
}
