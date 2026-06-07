// Machines page.
//
// Shows every wanda server this client can talk to — the local embedded
// server ("this machine") plus any paired remote servers. Cards are
// expandable: open one and see workspaces + pods on that server. Each
// remote workspace has an "Open in editor" action that hands a
// `cursor://vscode-remote/ssh-remote+...` URL to the OS so the user's
// editor handles SSH auth itself (wanda never touches credentials).
//
// Pairing now lives on this page — the button top-right opens an inline
// pair form. The "This machine" card exposes its own pairing URL so
// another Wanda client can pair INTO this server.

import { useState } from 'react'
import { SectionHeader } from '@/layout/section-header'
import { RiAddLine } from '@/lib/icons'
import { Button } from '@/ui/button'
import { useRemoveServer, useServers } from '../use-servers'
import { LocalMachineCard } from './local-machine-card'
import { PairForm } from './pair-form'
import { PairedMachineCard } from './paired-machine-card'

export function MachinesScreen() {
  const { data: paired = [], isLoading } = useServers()
  const removeMutation = useRemoveServer()
  const [pairing, setPairing] = useState(false)

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-6 max-w-5xl">
        <SectionHeader
          title="Machines"
          description="Wanda servers this client can drive. Your local machine is always present — open Wanda on another machine, mint a pairing URL from its Machines page, and paste it here to pair."
          action={
            <Button size="sm" variant="outline" onClick={() => setPairing(true)} disabled={pairing}>
              <RiAddLine className="size-3.5" />
              Pair a server
            </Button>
          }
        />

        {pairing && (
          <div className="mb-4 max-w-lg">
            <PairForm onClose={() => setPairing(false)} />
          </div>
        )}

        <section className="grid gap-3 md:grid-cols-2">
          <LocalMachineCard />
          {paired.map((server) => (
            <PairedMachineCard key={server.id} server={server} onRemove={(id) => removeMutation.mutate(id)} />
          ))}
        </section>
        {!isLoading && paired.length === 0 && !pairing && (
          <p className="text-xs text-zinc-600 mt-4">
            No paired servers yet. Launch Wanda on another machine to have it run its own server, then paste its pairing
            URL above.
          </p>
        )}
      </div>
    </div>
  )
}
