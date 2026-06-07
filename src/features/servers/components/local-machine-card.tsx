import { useState } from 'react'
import { canOpenExternalUrls } from '@/features/terminal'
import { useLocalInventory, useLocalServerInfo } from '../machines-inventory'
import { InventorySummary } from './inventory-summary'
import { IncomingSessionsPanel, LocalPairingPanel } from './local-pairing-panel'
import { MachineCard } from './machine-card'

export function LocalMachineCard() {
  const [expanded, setExpanded] = useState(true)
  const inventory = useLocalInventory(expanded)
  const info = useLocalServerInfo()
  const canOpenExternal = canOpenExternalUrls()
  const state: 'online' | 'offline' | 'loading' = inventory.isLoading && expanded ? 'loading' : 'online'

  const subtitle = info.data ? `${info.data.hostname} · ${info.data.listenHost}:${info.data.port}` : 'local · embedded'

  return (
    <MachineCard
      icon="local"
      title="This machine"
      subtitle={subtitle}
      state={state}
      expanded={expanded}
      onToggle={() => setExpanded((v) => !v)}
    >
      <InventorySummary
        inventory={inventory.data}
        isLoading={inventory.isLoading}
        isError={inventory.isError}
        error={inventory.error}
        sshFor={() => null}
        canOpenExternal={canOpenExternal}
      />
      <div className="pt-2 border-t border-zinc-800/60">
        <IncomingSessionsPanel />
      </div>
      {info.data && <LocalPairingPanel info={info.data} />}
    </MachineCard>
  )
}
