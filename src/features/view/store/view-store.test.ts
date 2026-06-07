import { beforeEach, describe, expect, it, vi } from 'vitest'
import { collectLeafIds } from '@/features/view/utils/split-tree'
import { type PodItem, useViewStore } from './view-store'

const mockViewUpdate = vi.fn().mockResolvedValue(undefined)
const mockPodItemUpdate = vi.fn().mockResolvedValue(undefined)
const mockPodSetActiveView = vi.fn().mockResolvedValue(undefined)

vi.mock('@/shared/orpc', () => {
  const orpc = {
    view: { update: (...args: any[]) => mockViewUpdate(...args) },
    podItem: { update: (...args: any[]) => mockPodItemUpdate(...args) },
    pod: { setActiveView: (...args: any[]) => mockPodSetActiveView(...args) },
  }
  return {
    orpc,
    // persistence-strategy.ts resolves the per-pod client through this
    // helper; in tests every pod points at the same mocked namespace.
    orpcForPod: () => orpc,
    registerPodClient: () => {},
    unregisterPodClient: () => {},
    unwrapPodId: (id: string) => id,
    parseNamespacedId: () => null,
  }
})

function makePodItem(id: string, label?: string): PodItem {
  return {
    id,
    contentType: 'terminal',
    label: label ?? `Terminal ${id}`,
    labelSource: 'default',
    config: { podTerminalId: `pty-${id}` },
    sortOrder: 0,
  }
}

function getActivePod() {
  const s = useViewStore.getState()
  return s.activeEntityId ? s.entities[s.activeEntityId] : undefined
}

function leafIds(viewIndex: number): string[] {
  const view = getActivePod()?.views[viewIndex]
  if (!view?.layout) return []
  return collectLeafIds(view.layout)
}

function viewLayout(viewIndex: number) {
  return getActivePod()?.views[viewIndex]?.layout ?? null
}

/** Set up store with 2 views, each containing item-1 as a single leaf. */
function setupTwoViews() {
  const items = [makePodItem('item-1')]
  useViewStore.getState().load(
    'pod-1',
    [
      { id: 'view-a', name: 'View A', viewType: 'split-pane', config: null, itemSettings: {} },
      { id: 'view-b', name: 'View B', viewType: 'split-pane', config: null, itemSettings: {} },
    ],
    items,
    'view-a',
  )
  expect(leafIds(0)).toEqual(['item-1'])
  expect(leafIds(1)).toEqual(['item-1'])
}

describe('view store cross-view sync', () => {
  beforeEach(() => {
    useViewStore.getState().clear()
  })

  it('splitPane adds new item to ALL views', () => {
    setupTwoViews()

    const items = [makePodItem('item-1'), makePodItem('item-2')]
    useViewStore.getState().updatePodItems(items)
    useViewStore.getState().splitPane('horizontal', 'item-2')

    expect(leafIds(0)).toContain('item-1')
    expect(leafIds(0)).toContain('item-2')

    expect(leafIds(1)).toContain('item-1')
    expect(leafIds(1)).toContain('item-2')
  })

  it('splitPane 3 times: all 4 items in both views', () => {
    setupTwoViews()

    for (let i = 2; i <= 4; i++) {
      const items = Array.from({ length: i }, (_, j) => makePodItem(`item-${j + 1}`))
      useViewStore.getState().updatePodItems(items)
      useViewStore.getState().splitPane('horizontal', `item-${i}`)
    }

    expect(leafIds(0).sort()).toEqual(['item-1', 'item-2', 'item-3', 'item-4'])
    expect(leafIds(1).sort()).toEqual(['item-1', 'item-2', 'item-3', 'item-4'])
  })

  it('reconcile removes deleted item from ALL views', () => {
    setupTwoViews()

    const items3 = [makePodItem('item-1'), makePodItem('item-2'), makePodItem('item-3')]
    useViewStore.getState().updatePodItems(items3)
    useViewStore.getState().splitPane('horizontal', 'item-2')
    useViewStore.getState().splitPane('horizontal', 'item-3')

    expect(leafIds(0).sort()).toEqual(['item-1', 'item-2', 'item-3'])
    expect(leafIds(1).sort()).toEqual(['item-1', 'item-2', 'item-3'])

    const items2 = [makePodItem('item-1'), makePodItem('item-3')]
    useViewStore.getState().reconcile(items2)

    expect(leafIds(0).sort()).toEqual(['item-1', 'item-3'])
    expect(leafIds(1).sort()).toEqual(['item-1', 'item-3'])
  })

  it('full scenario: create 3 on view A, switch to B (all there), delete 1, both updated', () => {
    setupTwoViews()

    for (let i = 2; i <= 4; i++) {
      const items = Array.from({ length: i }, (_, j) => makePodItem(`item-${j + 1}`))
      useViewStore.getState().updatePodItems(items)
      useViewStore.getState().splitPane('horizontal', `item-${i}`)
    }

    useViewStore.getState().switchView('view-b', 'pod-1')

    expect(leafIds(1).sort()).toEqual(['item-1', 'item-2', 'item-3', 'item-4'])

    const remaining = [makePodItem('item-1'), makePodItem('item-2'), makePodItem('item-4')]
    useViewStore.getState().reconcile(remaining)

    expect(leafIds(0).sort()).toEqual(['item-1', 'item-2', 'item-4'])
    expect(leafIds(1).sort()).toEqual(['item-1', 'item-2', 'item-4'])
  })

  it('delete removes from ALL views including inactive ones', () => {
    setupTwoViews()

    for (let i = 2; i <= 4; i++) {
      const items = Array.from({ length: i }, (_, j) => makePodItem(`item-${j + 1}`))
      useViewStore.getState().updatePodItems(items)
      useViewStore.getState().splitPane('horizontal', `item-${i}`)
    }

    useViewStore.getState().switchView('view-b', 'pod-1')
    expect(getActivePod()?.activeViewId).toBe('view-b')

    const remaining = [makePodItem('item-1'), makePodItem('item-3'), makePodItem('item-4')]
    useViewStore.getState().reconcile(remaining)

    expect(leafIds(0).sort()).toEqual(['item-1', 'item-3', 'item-4'])
    expect(leafIds(1).sort()).toEqual(['item-1', 'item-3', 'item-4'])
  })

  it('deleteItem removes from ALL views synchronously', () => {
    setupTwoViews()

    for (let i = 2; i <= 4; i++) {
      const items = Array.from({ length: i }, (_, j) => makePodItem(`item-${j + 1}`))
      useViewStore.getState().updatePodItems(items)
      useViewStore.getState().splitPane('horizontal', `item-${i}`)
    }

    expect(leafIds(0).sort()).toEqual(['item-1', 'item-2', 'item-3', 'item-4'])
    expect(leafIds(1).sort()).toEqual(['item-1', 'item-2', 'item-3', 'item-4'])

    useViewStore.getState().deleteItem('item-2')

    expect(leafIds(0).sort()).toEqual(['item-1', 'item-3', 'item-4'])
    expect(leafIds(1).sort()).toEqual(['item-1', 'item-3', 'item-4'])

    const podItemIds = (getActivePod()?.podItems ?? []).map((pi) => pi.id).sort()
    expect(podItemIds).toEqual(['item-1', 'item-3', 'item-4'])
  })

  it('deleteItem: deleting 1 of 4 removes exactly 1 from all views', () => {
    setupTwoViews()

    for (let i = 2; i <= 4; i++) {
      const items = Array.from({ length: i }, (_, j) => makePodItem(`item-${j + 1}`))
      useViewStore.getState().updatePodItems(items)
      useViewStore.getState().splitPane('horizontal', `item-${i}`)
    }

    useViewStore.getState().deleteItem('item-3')
    expect(leafIds(0).sort()).toEqual(['item-1', 'item-2', 'item-4'])
    expect(leafIds(1).sort()).toEqual(['item-1', 'item-2', 'item-4'])

    useViewStore.getState().deleteItem('item-1')
    expect(leafIds(0).sort()).toEqual(['item-2', 'item-4'])
    expect(leafIds(1).sort()).toEqual(['item-2', 'item-4'])

    useViewStore.getState().deleteItem('item-4')
    expect(leafIds(0)).toEqual(['item-2'])
    expect(leafIds(1)).toEqual(['item-2'])
  })

  it('deleteItem followed by stale reconcile does NOT re-add deleted item', () => {
    setupTwoViews()

    const items3 = [makePodItem('item-1'), makePodItem('item-2'), makePodItem('item-3')]
    useViewStore.getState().updatePodItems(items3)
    useViewStore.getState().splitPane('horizontal', 'item-2')
    useViewStore.getState().splitPane('horizontal', 'item-3')

    useViewStore.getState().deleteItem('item-2')
    expect(leafIds(0).sort()).toEqual(['item-1', 'item-3'])
    expect(leafIds(1).sort()).toEqual(['item-1', 'item-3'])

    useViewStore.getState().reconcile(items3)

    expect(leafIds(0).sort()).toEqual(['item-1', 'item-3'])
    expect(leafIds(1).sort()).toEqual(['item-1', 'item-3'])
  })

  it('load with saved split-pane layout does NOT re-add closed items', () => {
    const items = [makePodItem('item-1'), makePodItem('item-2'), makePodItem('item-3')]
    const savedLayout = {
      type: 'branch' as const,
      direction: 'horizontal' as const,
      children: [
        { type: 'leaf' as const, itemId: 'item-1' },
        { type: 'leaf' as const, itemId: 'item-3' },
      ] as [any, any],
      sizes: [50, 50] as [number, number],
    }

    useViewStore.getState().load(
      'pod-1',
      [
        {
          id: 'view-a',
          name: 'View A',
          viewType: 'split-pane',
          config: { type: 'split-pane', layout: savedLayout },
          itemSettings: { 'item-1': { sortOrder: 0 }, 'item-2': { sortOrder: 1 }, 'item-3': { sortOrder: 2 } },
        },
      ],
      items,
      'view-a',
    )

    expect(leafIds(0).sort()).toEqual(['item-1', 'item-3'])
  })

  it('load removes items from layout that no longer exist in pod', () => {
    const items = [makePodItem('item-1')]
    const savedLayout = {
      type: 'branch' as const,
      direction: 'horizontal' as const,
      children: [
        { type: 'leaf' as const, itemId: 'item-1' },
        { type: 'leaf' as const, itemId: 'item-2' },
      ] as [any, any],
      sizes: [50, 50] as [number, number],
    }

    useViewStore.getState().load(
      'pod-1',
      [
        {
          id: 'view-a',
          name: 'View A',
          viewType: 'split-pane',
          config: { type: 'split-pane', layout: savedLayout },
          itemSettings: { 'item-1': { sortOrder: 0 }, 'item-2': { sortOrder: 1 } },
        },
      ],
      items,
      'view-a',
    )

    expect(leafIds(0)).toEqual(['item-1'])
  })

  it('splitPane creates a leaf when layout is empty (no focused item)', () => {
    useViewStore.getState().load(
      'pod-1',
      [
        { id: 'view-a', name: 'View A', viewType: 'split-pane', config: null, itemSettings: {} },
        { id: 'view-b', name: 'View B', viewType: 'split-pane', config: null, itemSettings: {} },
      ],
      [],
      'view-a',
    )

    expect(viewLayout(0)).toBeNull()
    expect(viewLayout(1)).toBeNull()

    const items = [makePodItem('item-1')]
    useViewStore.getState().updatePodItems(items)
    useViewStore.getState().splitPane('horizontal', 'item-1')

    expect(leafIds(0)).toEqual(['item-1'])
    expect(leafIds(1)).toEqual(['item-1'])
  })

  it('splitPane creates a leaf then splits on second call', () => {
    useViewStore.getState().load(
      'pod-1',
      [
        { id: 'view-a', name: 'View A', viewType: 'split-pane', config: null, itemSettings: {} },
        { id: 'view-b', name: 'View B', viewType: 'split-pane', config: null, itemSettings: {} },
      ],
      [],
      'view-a',
    )

    useViewStore.getState().updatePodItems([makePodItem('item-1')])
    useViewStore.getState().splitPane('horizontal', 'item-1')
    expect(leafIds(0)).toEqual(['item-1'])
    expect(leafIds(1)).toEqual(['item-1'])

    useViewStore.getState().updatePodItems([makePodItem('item-1'), makePodItem('item-2')])
    useViewStore.getState().splitPane('horizontal', 'item-2')
    expect(leafIds(0).sort()).toEqual(['item-1', 'item-2'])
    expect(leafIds(1).sort()).toEqual(['item-1', 'item-2'])

    useViewStore.getState().updatePodItems([makePodItem('item-1'), makePodItem('item-2'), makePodItem('item-3')])
    useViewStore.getState().splitPane('horizontal', 'item-3')
    expect(leafIds(0).sort()).toEqual(['item-1', 'item-2', 'item-3'])
    expect(leafIds(1).sort()).toEqual(['item-1', 'item-2', 'item-3'])
  })

  it('deleteItem from inactive view still removes from all views', () => {
    setupTwoViews()

    for (let i = 2; i <= 4; i++) {
      const items = Array.from({ length: i }, (_, j) => makePodItem(`item-${j + 1}`))
      useViewStore.getState().updatePodItems(items)
      useViewStore.getState().splitPane('horizontal', `item-${i}`)
    }

    useViewStore.getState().switchView('view-b', 'pod-1')

    useViewStore.getState().deleteItem('item-2')

    expect(leafIds(0).sort()).toEqual(['item-1', 'item-3', 'item-4'])
    expect(leafIds(1).sort()).toEqual(['item-1', 'item-3', 'item-4'])
  })

  it('closeFocusedPane removes from ALL views', () => {
    setupTwoViews()

    for (let i = 2; i <= 3; i++) {
      const items = Array.from({ length: i }, (_, j) => makePodItem(`item-${j + 1}`))
      useViewStore.getState().updatePodItems(items)
      useViewStore.getState().splitPane('horizontal', `item-${i}`)
    }

    expect(leafIds(0).sort()).toEqual(['item-1', 'item-2', 'item-3'])
    expect(leafIds(1).sort()).toEqual(['item-1', 'item-2', 'item-3'])

    useViewStore.getState().focusPane('item-2')
    useViewStore.getState().closeFocusedPane()

    expect(leafIds(0).sort()).toEqual(['item-1', 'item-3'])
    expect(leafIds(1).sort()).toEqual(['item-1', 'item-3'])
  })

  it('closeFocusedPane removes exactly 1 item', () => {
    setupTwoViews()

    for (let i = 2; i <= 4; i++) {
      const items = Array.from({ length: i }, (_, j) => makePodItem(`item-${j + 1}`))
      useViewStore.getState().updatePodItems(items)
      useViewStore.getState().splitPane('horizontal', `item-${i}`)
    }

    useViewStore.getState().focusPane('item-3')
    useViewStore.getState().closeFocusedPane()

    expect(leafIds(0).sort()).toEqual(['item-1', 'item-2', 'item-4'])
    expect(leafIds(1).sort()).toEqual(['item-1', 'item-2', 'item-4'])
  })

  it('end-to-end: empty → create 3 → delete 1 → both views in sync', () => {
    useViewStore.getState().load(
      'pod-1',
      [
        { id: 'view-a', name: 'View A', viewType: 'split-pane', config: null, itemSettings: {} },
        { id: 'view-b', name: 'View B', viewType: 'split-pane', config: null, itemSettings: {} },
      ],
      [],
      'view-a',
    )

    for (let i = 1; i <= 3; i++) {
      const items = Array.from({ length: i }, (_, j) => makePodItem(`item-${j + 1}`))
      useViewStore.getState().updatePodItems(items)
      useViewStore.getState().splitPane('horizontal', `item-${i}`)
    }

    expect(leafIds(0).sort()).toEqual(['item-1', 'item-2', 'item-3'])
    expect(leafIds(1).sort()).toEqual(['item-1', 'item-2', 'item-3'])

    useViewStore.getState().deleteItem('item-2')

    expect(leafIds(0).sort()).toEqual(['item-1', 'item-3'])
    expect(leafIds(1).sort()).toEqual(['item-1', 'item-3'])

    useViewStore.getState().switchView('view-b', 'pod-1')
    expect(leafIds(1).sort()).toEqual(['item-1', 'item-3'])

    const staleItems = [makePodItem('item-1'), makePodItem('item-2'), makePodItem('item-3')]
    useViewStore.getState().reconcile(staleItems)
    expect(leafIds(0).sort()).toEqual(['item-1', 'item-3'])
    expect(leafIds(1).sort()).toEqual(['item-1', 'item-3'])

    const correctItems = [makePodItem('item-1'), makePodItem('item-3')]
    useViewStore.getState().reconcile(correctItems)
    expect(leafIds(0).sort()).toEqual(['item-1', 'item-3'])
    expect(leafIds(1).sort()).toEqual(['item-1', 'item-3'])
  })
})

describe('view store persistence (write-through)', () => {
  beforeEach(() => {
    useViewStore.getState().clear()
    mockViewUpdate.mockClear()
    mockPodItemUpdate.mockClear()
    mockPodSetActiveView.mockClear()
  })

  it('splitPane persists all views immediately', () => {
    const items = [makePodItem('item-1')]
    useViewStore.getState().load(
      'pod-1',
      [
        { id: 'view-a', name: 'View A', viewType: 'split-pane', config: null, itemSettings: {} },
        { id: 'view-b', name: 'View B', viewType: 'split-pane', config: null, itemSettings: {} },
      ],
      items,
      'view-a',
    )

    useViewStore.getState().updatePodItems([...items, makePodItem('item-2')])
    useViewStore.getState().splitPane('horizontal', 'item-2')

    expect(mockViewUpdate).toHaveBeenCalledTimes(2)
    const ids = mockViewUpdate.mock.calls.map((c: any[]) => c[0].id).sort()
    expect(ids).toEqual(['view-a', 'view-b'])

    for (const call of mockViewUpdate.mock.calls) {
      expect(call[0].config).toBeDefined()
      expect(call[0].config.type).toBe('split-pane')
    }
  })

  it('renameView persists', () => {
    useViewStore
      .getState()
      .load(
        'pod-1',
        [{ id: 'view-a', name: 'View A', viewType: 'split-pane', config: null, itemSettings: {} }],
        [makePodItem('item-1')],
        'view-a',
      )

    useViewStore.getState().renameView('view-a', 'My New Name')

    expect(mockViewUpdate).toHaveBeenCalledTimes(1)
    expect(mockViewUpdate.mock.calls[0]![0].name).toBe('My New Name')
  })

  it('renamePodItem persists label', () => {
    useViewStore
      .getState()
      .load(
        'pod-1',
        [{ id: 'view-a', name: 'View A', viewType: 'split-pane', config: null, itemSettings: {} }],
        [makePodItem('item-1')],
        'view-a',
      )

    useViewStore.getState().renamePodItem('item-1', 'Custom Name')

    expect(mockPodItemUpdate).toHaveBeenCalledTimes(1)
    expect(mockPodItemUpdate.mock.calls[0]![0]).toEqual({
      id: 'item-1',
      label: 'Custom Name',
      labelSource: 'user',
    })
  })

  it('updatePaneSizes persists via debounce', () => {
    vi.useFakeTimers()
    const items = [makePodItem('item-1'), makePodItem('item-2')]
    useViewStore
      .getState()
      .load(
        'pod-1',
        [{ id: 'view-a', name: 'View A', viewType: 'split-pane', config: null, itemSettings: {} }],
        items,
        'view-a',
      )

    useViewStore.getState().splitPane('horizontal', 'item-2')
    mockViewUpdate.mockClear()

    useViewStore.getState().updatePaneSizes([], [30, 70])

    expect(mockViewUpdate).toHaveBeenCalledTimes(0)

    vi.advanceTimersByTime(300)

    expect(mockViewUpdate).toHaveBeenCalledTimes(1)
    expect(mockViewUpdate.mock.calls[0]![0].id).toBe('view-a')
    vi.useRealTimers()
  })

  it('deleteItem persists all views', () => {
    const items = [makePodItem('item-1'), makePodItem('item-2')]
    useViewStore.getState().load(
      'pod-1',
      [
        { id: 'view-a', name: 'View A', viewType: 'split-pane', config: null, itemSettings: {} },
        { id: 'view-b', name: 'View B', viewType: 'split-pane', config: null, itemSettings: {} },
      ],
      items,
      'view-a',
    )
    mockViewUpdate.mockClear()

    useViewStore.getState().deleteItem('item-2')

    expect(mockViewUpdate).toHaveBeenCalledTimes(2)
    const ids = mockViewUpdate.mock.calls.map((c: any[]) => c[0].id).sort()
    expect(ids).toEqual(['view-a', 'view-b'])

    for (const call of mockViewUpdate.mock.calls) {
      const layout = call[0].config.layout
      expect(collectLeafIds(layout)).toEqual(['item-1'])
    }
  })

  it('persisted data survives clear → load round-trip', () => {
    const initialItems = [makePodItem('item-1')]
    useViewStore.getState().load(
      'pod-1',
      [
        { id: 'view-a', name: 'View A', viewType: 'split-pane', config: null, itemSettings: {} },
        { id: 'view-b', name: 'View B', viewType: 'split-pane', config: null, itemSettings: {} },
      ],
      initialItems,
      'view-a',
    )

    const items2 = [makePodItem('item-1'), makePodItem('item-2')]
    useViewStore.getState().updatePodItems(items2)
    useViewStore.getState().splitPane('horizontal', 'item-2')

    const items3 = [makePodItem('item-1'), makePodItem('item-2'), makePodItem('item-3')]
    useViewStore.getState().updatePodItems(items3)
    useViewStore.getState().splitPane('horizontal', 'item-3')

    useViewStore.getState().deleteItem('item-2')

    expect(leafIds(0).sort()).toEqual(['item-1', 'item-3'])
    expect(leafIds(1).sort()).toEqual(['item-1', 'item-3'])

    const lastPersistedByView = new Map<string, any>()
    for (const call of mockViewUpdate.mock.calls) {
      lastPersistedByView.set(call[0].id, call[0])
    }

    useViewStore.getState().clear()
    expect(getActivePod()?.views).toBeUndefined()

    const dbViews = Array.from(lastPersistedByView.values()).map((pv) => ({
      id: pv.id,
      name: pv.name,
      viewType: 'split-pane',
      config: pv.config,
      itemSettings: pv.itemSettings,
    }))
    const remainingItems = [makePodItem('item-1'), makePodItem('item-3')]
    useViewStore.getState().load('pod-1', dbViews, remainingItems, 'view-a')

    const viewAAfter = getActivePod()?.views.find((v) => v.id === 'view-a')!
    expect(collectLeafIds(viewAAfter.layout!).sort()).toEqual(['item-1', 'item-3'])

    const viewBAfter = getActivePod()?.views.find((v) => v.id === 'view-b')!
    expect(collectLeafIds(viewBAfter.layout!).sort()).toEqual(['item-1', 'item-3'])
  })
})
