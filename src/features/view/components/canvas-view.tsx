import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  type OnNodesChange,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  type Node as RFNode,
  useReactFlow,
} from '@xyflow/react'
import { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RiFocusLine, RiGridLine } from '@/lib/icons'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@/ui/context-menu'
import '@xyflow/react/dist/style.css'
import { type AddItemActions, useAddItemActions } from '@/features/pod/utils/add-item-actions'
import { focusItem, requestItemClose } from '@/features/pod/utils/item-utils'
import { useCanvasPan } from '@/features/view/hooks/use-canvas-pan'
import { useFocusBridge } from '@/features/view/hooks/use-focus-bridge'
import { useViewShortcuts } from '@/features/view/hooks/use-view-shortcuts'
import { useViewCallbacks } from '@/features/view/store/view-callbacks'
import {
  useActiveCanvasNodes,
  useActiveCanvasViewport,
  useActiveViewId,
  useFocusedItemId,
  usePodItems,
  useViewStore,
} from '@/features/view/store/view-store'
import { useTerminalRender } from '@/features/view/terminal-render-context'
import type { CanvasNode, CommandItemConfig } from '@/types/schema'
import { AddItemMenuItems, EmptyAddItems } from './add-item-menu'
import { CanvasTerminalNode } from './canvas-terminal-node'

interface CanvasViewProps {
  onNewCommand?: () => void
}

/**
 * Canvas-specific extras that the shared `TerminalRenderContext` does not
 * carry: the row-rename callback and the canvas-scoped add-item actions.
 * Shared terminal-rendering inputs come from `useTerminalRender()`.
 */
export interface CanvasViewContextValue {
  autoRenamePodItem: (podTerminalId: string, label: string) => void
  actions: AddItemActions
}

export const CanvasViewContext = createContext<CanvasViewContextValue | null>(null)

const nodeTypes = { terminal: CanvasTerminalNode }

function toRFNode(node: CanvasNode): RFNode {
  return {
    id: node.itemId,
    type: 'terminal',
    position: { x: node.x, y: node.y },
    data: { itemId: node.itemId },
    style: { width: node.width, height: node.height },
    dragHandle: '.canvas-node-header',
  }
}

function findPlacementPosition(
  canvasNodes: CanvasNode[],
  screenToFlowPosition: (pos: { x: number; y: number }) => { x: number; y: number },
  containerEl: HTMLElement | null,
  viewport: { x: number; y: number; zoom: number },
): { x: number; y: number } {
  let cx: number
  let cy: number
  if (containerEl) {
    const rect = containerEl.getBoundingClientRect()
    const center = screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
    cx = center.x
    cy = center.y
  } else {
    cx = -viewport.x / viewport.zoom
    cy = -viewport.y / viewport.zoom
  }

  const w = 600
  const h = 420
  const overlap = 40 // allowed overlap at edges

  // Origin: top-left of centered new node, snapped to grid
  const ox = Math.round((cx - w / 2) / 20) * 20
  const oy = Math.round((cy - h / 2) / 20) * 20

  // Step by node size minus overlap — keeps candidates tight
  const stepX = w - overlap // 560
  const stepY = h - overlap // 380

  // Collision = overlaps more than the allowed amount (checks against shrunk inner rect)
  function collides(x: number, y: number): boolean {
    return canvasNodes.some(
      (n) =>
        x < n.x + n.width - overlap && x + w > n.x + overlap && y < n.y + n.height - overlap && y + h > n.y + overlap,
    )
  }

  // Spiral outward from viewport center
  for (let ring = 0; ring <= 10; ring++) {
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        if (ring > 0 && Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue
        const x = ox + dx * stepX
        const y = oy + dy * stepY
        if (!collides(x, y)) return { x, y }
      }
    }
  }

  // Fallback: below all existing nodes
  const maxY = canvasNodes.reduce((m, n) => Math.max(m, n.y + n.height), 0)
  return { x: ox, y: Math.round((maxY + overlap) / 20) * 20 }
}

export function CanvasView(props: CanvasViewProps) {
  return (
    <ReactFlowProvider>
      <CanvasViewInner {...props} />
    </ReactFlowProvider>
  )
}

function CanvasViewInner({ onNewCommand }: CanvasViewProps) {
  const { podId, isRunning, terminalConfigs, commandConfigs, runningTerminals, onTerminalsChanged, onTerminalRemoved } =
    useTerminalRender()
  const activeViewId = useActiveViewId()
  const canvasNodes = useActiveCanvasNodes()
  const savedViewport = useActiveCanvasViewport()
  const focusedItemId = useFocusedItemId()
  const podItems = usePodItems()
  const autoRenamePodItem = useViewStore((s) => s.autoRenamePodItem)
  const updateCanvasNode = useViewStore((s) => s.updateCanvasNode)
  const updateCanvasViewport = useViewStore((s) => s.updateCanvasViewport)
  const focusPane = useViewStore((s) => s.focusPane)

  const containerRef = useRef<HTMLDivElement>(null)
  const mouseRef = useRef<{ x: number; y: number } | null>(null)
  const viewportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { screenToFlowPosition, getViewport, fitView, getNode } = useReactFlow()

  // Debounced viewport change handler — saves zoom/pan position.
  // Writes are keyed by the mounting podId so a pending timer from pod A that
  // fires after a pod switch cannot clobber pod B's viewport.
  const onViewportChange = useCallback(
    (vp: { x: number; y: number; zoom: number }) => {
      if (viewportTimerRef.current) clearTimeout(viewportTimerRef.current)
      viewportTimerRef.current = setTimeout(() => {
        updateCanvasViewport(vp, podId)
        viewportTimerRef.current = null
      }, 300)
    },
    [updateCanvasViewport, podId],
  )

  useEffect(() => {
    return () => {
      if (viewportTimerRef.current) clearTimeout(viewportTimerRef.current)
    }
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onMouseMove = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY }
    }
    const onMouseLeave = () => {
      mouseRef.current = null
    }
    el.addEventListener('mousemove', onMouseMove)
    el.addEventListener('mouseleave', onMouseLeave)
    return () => {
      el.removeEventListener('mousemove', onMouseMove)
      el.removeEventListener('mouseleave', onMouseLeave)
    }
  }, [])

  // Register cursor-aware placement for Cmd+T item picker
  const getCanvasNodes = useCallback(() => {
    const state = useViewStore.getState()
    const pod = state.activeEntityId ? state.entities[state.activeEntityId] : undefined
    return pod?.views.find((view) => view.id === activeViewId)?.canvasNodes ?? []
  }, [activeViewId])

  useEffect(() => {
    const { setViewPlaceItem } = useViewCallbacks.getState()
    setViewPlaceItem((itemId: string) => {
      useViewStore.getState().splitPane('horizontal', itemId)

      if (mouseRef.current) {
        const flowPos = screenToFlowPosition(mouseRef.current)
        const currentNodes = getCanvasNodes()

        const hoveredNode = currentNodes.find(
          (n) => flowPos.x >= n.x && flowPos.x <= n.x + n.width && flowPos.y >= n.y && flowPos.y <= n.y + n.height,
        )

        if (hoveredNode) {
          useViewStore.getState().updateCanvasNode(itemId, {
            x: hoveredNode.x + hoveredNode.width + 20,
            y: hoveredNode.y,
          })
        } else {
          useViewStore.getState().updateCanvasNode(itemId, {
            x: flowPos.x - 300,
            y: flowPos.y - 210,
          })
        }
      } else {
        const pos = findPlacementPosition(
          getCanvasNodes().filter((n) => n.itemId !== itemId),
          screenToFlowPosition,
          containerRef.current,
          getViewport(),
        )
        useViewStore.getState().updateCanvasNode(itemId, pos)
      }
    })
    return () => useViewCallbacks.getState().setViewPlaceItem(null)
  }, [getCanvasNodes, getViewport, screenToFlowPosition])

  useEffect(() => {
    const { setCanvasPanToNode } = useViewCallbacks.getState()
    setCanvasPanToNode((itemId: string) => {
      const node = getNode(itemId)
      if (!node) return
      const zoom = getViewport().zoom
      fitView({ nodes: [{ id: itemId }], padding: 0.3, duration: 300, maxZoom: zoom })
    })
    return () => useViewCallbacks.getState().setCanvasPanToNode(null)
  }, [fitView, getNode, getViewport])

  // Filter canvasNodes to only items whose backing config still exists.
  // Terminal items are validated against terminalConfigs; non-terminal items
  // (browser, etc.) are always valid.
  const validTerminalIds = useMemo(() => new Set(terminalConfigs.map((t) => t.id)), [terminalConfigs])
  const validPodItemIds = useMemo(
    () =>
      new Set(
        podItems
          .filter((pi) => {
            if (pi.contentType === 'terminal')
              return validTerminalIds.has((pi.config as { podTerminalId: string }).podTerminalId)
            return true
          })
          .map((pi) => pi.id),
      ),
    [podItems, validTerminalIds],
  )
  const validCanvasNodes = useMemo(
    () => canvasNodes.filter((n) => validPodItemIds.has(n.itemId)),
    [canvasNodes, validPodItemIds],
  )

  const [rfNodes, setRfNodes] = useState<RFNode[]>(() => validCanvasNodes.map(toRFNode))
  const isDragging = useRef(false)
  const isResizing = useRef(false)

  // Sync store → RF nodes (preserving RF internals like measured)
  useEffect(() => {
    if (isDragging.current || isResizing.current) return
    const frame = requestAnimationFrame(() => {
      setRfNodes((prev) => {
        const prevMap = new Map(prev.map((n) => [n.id, n]))
        return validCanvasNodes.map((storeNode) => {
          const prevRf = prevMap.get(storeNode.itemId)
          const newRf = toRFNode(storeNode)
          return prevRf ? { ...prevRf, ...newRf } : newRf
        })
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [validCanvasNodes])

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => {
      setRfNodes((prev) => applyNodeChanges(changes, prev))

      for (const change of changes) {
        if (change.type === 'dimensions') {
          if (change.resizing) {
            isResizing.current = true
          } else if (change.dimensions && change.resizing === false) {
            // Persist resize when done — include position because resizing
            // from the left/top edge moves the node origin.
            isResizing.current = false
            setRfNodes((curr) => {
              const node = curr.find((n) => n.id === change.id)
              if (node) {
                updateCanvasNode(change.id, {
                  x: node.position.x,
                  y: node.position.y,
                  width: change.dimensions!.width,
                  height: change.dimensions!.height,
                })
              }
              return curr
            })
          }
        }
      }
    },
    [updateCanvasNode],
  )

  const onNodeDragStart = useCallback(() => {
    isDragging.current = true
  }, [])

  const onNodeDragStop = useCallback(
    (_: React.MouseEvent, _node: RFNode, draggedNodes: RFNode[]) => {
      isDragging.current = false
      for (const n of draggedNodes) {
        updateCanvasNode(n.id, { x: n.position.x, y: n.position.y })
      }
    },
    [updateCanvasNode],
  )

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: RFNode) => {
      focusPane(node.id)
      const podItem = podItems.find((pi) => pi.id === node.id)
      if (podItem) focusItem(podItem, runningTerminals)
    },
    [focusPane, podItems, runningTerminals],
  )

  const onPaneClick = useCallback(() => {}, [])

  const placeItem = useCallback(
    (item: { id: string }) => {
      useViewStore.getState().splitPane('horizontal', item.id)
      const pos = findPlacementPosition(
        getCanvasNodes().filter((n) => n.itemId !== item.id),
        screenToFlowPosition,
        containerRef.current,
        getViewport(),
      )
      useViewStore.getState().updateCanvasNode(item.id, pos)
    },
    [getCanvasNodes, screenToFlowPosition, getViewport],
  )

  const commandIdsInView = useMemo(
    () =>
      new Set(
        podItems
          .filter((pi) => pi.contentType === 'command' && validPodItemIds.has(pi.id))
          .map((pi) => (pi.config as CommandItemConfig).podCommandId),
      ),
    [podItems, validPodItemIds],
  )

  const actions = useAddItemActions({
    podId,
    isRunning,
    terminalCount: terminalConfigs.length,
    commandConfigs,
    commandIdsInView,
    placeItem,
    onItemsChanged: onTerminalsChanged,
    onNewCommand,
  })

  useViewShortcuts({
    onSplit: () => actions.addTerminal(),
    onClose: (info) => {
      requestItemClose(info.podItem, runningTerminals, { onTerminalRemoved, onItemsChanged: onTerminalsChanged })
    },
  })

  useFocusBridge(focusedItemId, runningTerminals)

  // Gesture-aware pan-on-scroll (replaces ReactFlow's built-in panOnScroll).
  useCanvasPan(containerRef)

  const handleCenterView = useCallback(() => {
    fitView({ padding: 0.15, duration: 300 })
  }, [fitView])

  const handleAutoOrganize = useCallback(() => {
    const nodes = getCanvasNodes()
    if (nodes.length === 0) return
    const cols = Math.ceil(Math.sqrt(nodes.length))
    const gap = 40
    const w = 600
    const h = 420
    const totalW = cols * w + (cols - 1) * gap
    const rows = Math.ceil(nodes.length / cols)
    const totalH = rows * h + (rows - 1) * gap
    const ox = Math.round(-totalW / 2 / 20) * 20
    const oy = Math.round(-totalH / 2 / 20) * 20

    const store = useViewStore.getState()
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      if (!node) continue
      const col = i % cols
      const row = Math.floor(i / cols)
      store.updateCanvasNode(node.itemId, {
        x: ox + col * (w + gap),
        y: oy + row * (h + gap),
        width: w,
        height: h,
      })
    }
    // Fit view after layout settles
    requestAnimationFrame(() => fitView({ padding: 0.15, duration: 300 }))
  }, [fitView, getCanvasNodes])

  const ctxValue = useMemo<CanvasViewContextValue>(() => ({ autoRenamePodItem, actions }), [actions, autoRenamePodItem])

  if (validCanvasNodes.length === 0) {
    return <EmptyAddItems title="Empty canvas" actions={actions} />
  }

  return (
    <CanvasViewContext.Provider value={ctxValue}>
      <ContextMenu>
        <ContextMenuTrigger render={<div ref={containerRef} className="flex-1 min-h-0" />}>
          <ReactFlow
            nodes={rfNodes}
            edges={[]}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onNodeDragStart={onNodeDragStart}
            onNodeDragStop={onNodeDragStop}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            onViewportChange={onViewportChange}
            minZoom={0.2}
            panOnScroll={false}
            zoomOnScroll={false}
            selectionOnDrag={true}
            panOnDrag={false}
            snapToGrid
            snapGrid={[20, 20]}
            deleteKeyCode={[]}
            nodesConnectable={false}
            {...(savedViewport ? { defaultViewport: savedViewport } : { fitView: true })}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#27272a" />
            <Panel position="bottom-right" className="flex items-center gap-1 !m-3">
              <button
                type="button"
                onClick={handleCenterView}
                className="flex items-center justify-center w-8 h-8 rounded-lg bg-zinc-800/80 backdrop-blur-sm border border-zinc-700/50 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/80 transition-colors"
                title="Center view (fit all)"
              >
                <RiFocusLine className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={handleAutoOrganize}
                className="flex items-center justify-center w-8 h-8 rounded-lg bg-zinc-800/80 backdrop-blur-sm border border-zinc-700/50 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/80 transition-colors"
                title="Auto-organize"
              >
                <RiGridLine className="h-4 w-4" />
              </button>
            </Panel>
          </ReactFlow>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <AddItemMenuItems variant="context" actions={actions} />
        </ContextMenuContent>
      </ContextMenu>
    </CanvasViewContext.Provider>
  )
}
