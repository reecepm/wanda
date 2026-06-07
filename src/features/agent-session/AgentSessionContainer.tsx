// -----------------------------------------------------------------------------
// Mountable <AgentSessionContainer sessionId> that:
//   - installs `AgentUIProvider` with a renderer-side transport
//   - calls `agent.session.get` on mount (rehydrates cold sessions server-side)
//   - seeds the store with a synthetic `session.started` event built from the
//     detail response so the UI has capabilities/modes/models before the
//     first live event arrives. Persisted replay handles missed events after
//     the store's last applied seq; the synthetic event fills the initial
//     capability/options shape for cold mounts.
//   - opens a WS subscription for the given session
//   - feeds incoming envelopes into the session's `ChatStoreHandle`
//   - renders `<ChatView>`
//
// Intentionally self-contained: a route / podItem view kind / Storybook
// wrapper can mount this without knowing anything about the underlying
// subscription plumbing.
// -----------------------------------------------------------------------------

import { useQuery } from '@tanstack/react-query'
import type { AgentEvent, ModeId, ModelId, SessionId } from '@wanda/agent-protocol'
import { ProviderIdSchema } from '@wanda/agent-protocol'
import type { ChatStoreHandle } from '@wanda/agent-store'
import { AgentUIProvider, type AgentUITransport, ChatView, installDefaultToolRenderers } from '@wanda/agent-ui'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { orpcForPod } from '@/shared/orpc'
import { createAgentSessionTransport } from './transport'

// Tool registry is global — register once on module load. Consumers can
// override specific kinds afterwards by calling `registerToolRenderer` in
// their own init.
installDefaultToolRenderers()

interface Props {
  readonly sessionId: SessionId
  readonly podId?: string | null
  readonly transport?: AgentUITransport
  readonly className?: string
}

export function AgentSessionContainer({ sessionId, podId, transport, className }: Props) {
  const transportRef = useMemo(() => transport ?? createAgentSessionTransport({ podId }), [transport, podId])

  // Fire-and-check: `agent.session.get` triggers server-side rehydration
  // when the session lives only in the DB (e.g. after a restart) — without
  // this call the WS subscription would attach to a session that never came
  // back alive. We don't render anything from the result; the store is
  // populated via event replay + live subscription.
  const detail = useQuery({
    queryKey: ['agent-session', 'detail', podId ?? 'local', sessionId],
    queryFn: () =>
      orpcForPod(podId).agent.session.get({
        sessionId,
      }),
    retry: false,
  })

  // Bind the WS subscription to the ChatStoreHandle the Provider lazily
  // creates. `onStoreCreated` fires once per sessionId; we use a ref so the
  // closure captures the right store across re-renders.
  const subscriptionsRef = useRef(new Map<SessionId, () => void>())
  const seededRef = useRef(new Set<SessionId>())
  const storesRef = useRef(new Map<SessionId, ChatStoreHandle>())

  useEffect(() => {
    const subscriptions = subscriptionsRef.current
    const seeded = seededRef.current
    const stores = storesRef.current
    return () => {
      for (const unsub of subscriptions.values()) {
        try {
          unsub()
        } catch {
          /* best-effort */
        }
      }
      subscriptions.clear()
      seeded.clear()
      stores.clear()
    }
  }, [])

  const hydrateMetadataFromDetail = useCallback(
    (sid: SessionId, store: ChatStoreHandle): void => {
      if (sid !== sessionId) return
      if (!detail.data) return
      if (seededRef.current.has(sid)) return
      const synthetic: Extract<AgentEvent, { kind: 'session.started' }> = {
        kind: 'session.started',
        sessionId: sid,
        providerId: ProviderIdSchema.parse(detail.data.providerId),
        capabilities: detail.data.capabilities,
        modes: [...detail.data.modes],
        modelOptions: [...detail.data.modelOptions],
        currentModeId: detail.data.currentModeId as ModeId | undefined,
        modelId: detail.data.currentModelId as ModelId | undefined,
        reasoningEffort: detail.data.currentReasoningEffort ?? undefined,
        persistenceHandle: { variant: 'bootstrap' },
      }
      store.hydrateSessionMetadata(synthetic)
      seededRef.current.add(sid)
    },
    [detail.data, sessionId],
  )

  function onStoreCreated(sid: SessionId, store: ChatStoreHandle): void {
    storesRef.current.set(sid, store)
    hydrateMetadataFromDetail(sid, store)
    if (subscriptionsRef.current.has(sid)) return
    const unsub = transportRef.subscribeToSession(
      sid,
      (envelope) => {
        // Route through the store: delta kinds land on the streaming atom,
        // persisted kinds bump `appliedSeq` and update messages/turns.
        store.applyLiveEvent(envelope.payload, envelope.seq)
      },
      { replayFromSeq: store.getState().appliedSeq },
    )
    subscriptionsRef.current.set(sid, unsub)
  }

  // Seed the store from `agent.session.get` once both the detail response
  // and the lazily-created store exist. The detail response often resolves
  // before `<ChatView>` mounts the provider store, so `onStoreCreated` also
  // calls this helper; otherwise model/thinking controls can stay hidden
  // until a future live event happens to carry metadata.
  useEffect(() => {
    const store = storesRef.current.get(sessionId)
    if (!store) return
    hydrateMetadataFromDetail(sessionId, store)
  }, [hydrateMetadataFromDetail, sessionId])

  return (
    <AgentUIProvider transport={transportRef} onStoreCreated={onStoreCreated}>
      {detail.isError ? (
        <SessionLoadError message={(detail.error as Error).message} />
      ) : detail.isLoading ? (
        <SessionLoading />
      ) : (
        <ChatView sessionId={sessionId} className={className} />
      )}
    </AgentUIProvider>
  )
}

function SessionLoading() {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="inline-block size-3 animate-pulse rounded-full bg-muted-foreground/40" />
        Connecting to agent…
      </div>
    </div>
  )
}

function SessionLoadError({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-sm rounded-md border border-border bg-muted/50 p-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Session unavailable</p>
        <p className="mt-1">{message}</p>
      </div>
    </div>
  )
}
