import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type PodItem, useViewStore } from './view-store'

const mockWorkspaceViewCreate = vi.fn().mockImplementation(async (input: Record<string, unknown>) => ({
  id: `wv-${Date.now()}`,
  name: input.name,
  viewType: input.viewType ?? 'columns',
  config: input.config,
  itemSettings: input.itemSettings ?? {},
  workspaceId: input.workspaceId,
  sortOrder: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
}))
const mockWorkspaceViewUpdate = vi.fn().mockResolvedValue(undefined)
const mockWorkspaceViewDelete = vi.fn().mockResolvedValue(undefined)
const mockWorkspaceViewSetActiveView = vi.fn().mockResolvedValue(undefined)
const mockPodItemUpdate = vi.fn().mockResolvedValue(undefined)

vi.mock('@/shared/orpc', () => ({
  orpc: {
    view: { update: vi.fn().mockResolvedValue(undefined), create: vi.fn(), delete: vi.fn() },
    pod: { setActiveView: vi.fn().mockResolvedValue(undefined) },
    podItem: { update: (...args: unknown[]) => mockPodItemUpdate(...args) },
    workspaceView: {
      create: (...args: unknown[]) => mockWorkspaceViewCreate(...args),
      update: (...args: unknown[]) => mockWorkspaceViewUpdate(...args),
      delete: (...args: unknown[]) => mockWorkspaceViewDelete(...args),
      setActiveView: (...args: unknown[]) => mockWorkspaceViewSetActiveView(...args),
    },
  },
  // Workspace persistence routes through `orpcUtils.workspaceView.*.call`.
  orpcUtils: {
    workspaceView: {
      create: { call: (...args: unknown[]) => mockWorkspaceViewCreate(...args) },
      update: { call: (...args: unknown[]) => mockWorkspaceViewUpdate(...args) },
      delete: { call: (...args: unknown[]) => mockWorkspaceViewDelete(...args) },
      setActiveView: { call: (...args: unknown[]) => mockWorkspaceViewSetActiveView(...args) },
    },
  },
  // Pod persistence routes through `orpcForPod(id).view.*`.
  orpcForPod: () => ({
    view: { update: vi.fn().mockResolvedValue(undefined), create: vi.fn(), delete: vi.fn() },
    pod: { setActiveView: vi.fn().mockResolvedValue(undefined) },
  }),
}))

function makePodItem(id: string, podId: string, label?: string): PodItem {
  return {
    id,
    podId,
    contentType: 'terminal',
    label: label ?? `Terminal ${id}`,
    labelSource: 'default',
    config: { podTerminalId: `pty-${id}` },
    sortOrder: 0,
  }
}

function getActiveEntity() {
  const s = useViewStore.getState()
  return s.activeEntityId ? s.entities[s.activeEntityId] : undefined
}

function getActiveView() {
  const entity = getActiveEntity()
  if (!entity) return undefined
  return entity.views.find((v) => v.id === entity.activeViewId) ?? entity.views[0]
}

function setupWorkspaceWithColumns() {
  const items = [makePodItem('item-1', 'pod-a'), makePodItem('item-2', 'pod-a'), makePodItem('item-3', 'pod-b')]
  useViewStore.getState().load(
    'workspace-1',
    [
      {
        id: 'wv-1',
        name: 'Default',
        viewType: 'columns',
        config: {
          type: 'columns',
          rows: [{ items: items.map((i) => ({ itemId: i.id, width: 520 })) }],
        },
        itemSettings: {},
      },
    ],
    items,
    'wv-1',
    'workspace',
  )
}

describe('workspace-scoped view store', () => {
  beforeEach(() => {
    useViewStore.getState().clear()
    mockWorkspaceViewCreate.mockClear()
    mockWorkspaceViewUpdate.mockClear()
    mockWorkspaceViewDelete.mockClear()
    mockWorkspaceViewSetActiveView.mockClear()
  })

  it('load with workspace scope sets scope correctly', () => {
    setupWorkspaceWithColumns()
    const entity = getActiveEntity()
    expect(entity?.scope).toBe('workspace')
  })

  it('load with default scope is pod', () => {
    useViewStore
      .getState()
      .load(
        'pod-1',
        [{ id: 'v1', name: 'V1', viewType: 'split-pane', config: null, itemSettings: {} }],
        [makePodItem('item-1', 'pod-1')],
        'v1',
      )
    expect(getActiveEntity()?.scope).toBe('pod')
  })

  it('reconcile adds new items to columns view', () => {
    setupWorkspaceWithColumns()

    const view = getActiveView()
    expect(view?.viewType).toBe('columns')
    const itemIds = view?.columnsRows?.flatMap((r) => r.items.map((i) => i.itemId)).sort()
    expect(itemIds).toEqual(['item-1', 'item-2', 'item-3'])

    const newItems = [
      makePodItem('item-1', 'pod-a'),
      makePodItem('item-2', 'pod-a'),
      makePodItem('item-3', 'pod-b'),
      makePodItem('item-4', 'pod-b'),
    ]
    useViewStore.getState().reconcile(newItems)

    const updatedView = getActiveView()
    const updatedIds = updatedView?.columnsRows?.flatMap((r) => r.items.map((i) => i.itemId)).sort()
    expect(updatedIds).toContain('item-4')
  })

  it('reconcile removes deleted items from columns view', () => {
    setupWorkspaceWithColumns()

    const remaining = [makePodItem('item-1', 'pod-a'), makePodItem('item-3', 'pod-b')]
    useViewStore.getState().reconcile(remaining)

    const view = getActiveView()
    const itemIds = view?.columnsRows?.flatMap((r) => r.items.map((i) => i.itemId)).sort()
    expect(itemIds).toEqual(['item-1', 'item-3'])
  })

  // Regression: reconcile fires on every TanStack Query refetch, which
  // yields fresh array references with identical content. If it writes
  // unconditionally, store subscribers re-render every refetch and the
  // effects driving reconcile loop into React error #185 (max update
  // depth). A no-op reconcile must not persist, and must preserve the
  // existing entity/view references.
  it('reconcile with identical items is a no-op (no persist, stable refs)', () => {
    setupWorkspaceWithColumns()
    mockWorkspaceViewUpdate.mockClear()

    const before = getActiveEntity()
    const beforeViews = before?.views
    const beforeItems = before?.podItems

    // Same items, fresh array + object references (as a refetch produces).
    useViewStore
      .getState()
      .reconcile([makePodItem('item-1', 'pod-a'), makePodItem('item-2', 'pod-a'), makePodItem('item-3', 'pod-b')])

    const after = getActiveEntity()
    expect(after?.views).toBe(beforeViews)
    expect(after?.podItems).toBe(beforeItems)
    expect(mockWorkspaceViewUpdate).not.toHaveBeenCalled()
  })

  it('addView at workspace scope uses workspace persistence', async () => {
    setupWorkspaceWithColumns()

    await useViewStore.getState().addView('workspace-1', 'Canvas View', 'canvas')

    expect(mockWorkspaceViewCreate).toHaveBeenCalledTimes(1)
    const createCall = mockWorkspaceViewCreate.mock.calls[0]![0]
    expect(createCall.workspaceId).toBe('workspace-1')

    expect(mockWorkspaceViewSetActiveView).toHaveBeenCalledTimes(1)
    expect(mockWorkspaceViewSetActiveView.mock.calls[0]![0].workspaceId).toBe('workspace-1')
  })

  it('addView canvas has nodes for all items', async () => {
    setupWorkspaceWithColumns()

    await useViewStore.getState().addView('workspace-1', 'Canvas', 'canvas')

    const entity = getActiveEntity()
    const canvasView = entity?.views.find((v) => v.viewType === 'canvas')
    expect(canvasView?.canvasNodes).toHaveLength(3)
    const nodeItemIds = canvasView?.canvasNodes?.map((n) => n.itemId).sort()
    expect(nodeItemIds).toEqual(['item-1', 'item-2', 'item-3'])
  })

  it('addView columns has items for all pod items', async () => {
    setupWorkspaceWithColumns()

    await useViewStore.getState().addView('workspace-1', 'Columns 2', 'columns')

    const entity = getActiveEntity()
    const colView = entity?.views.find((v) => v.name === 'Columns 2')
    const allItemIds = colView?.columnsRows?.flatMap((r) => r.items.map((i) => i.itemId)).sort()
    expect(allItemIds).toEqual(['item-1', 'item-2', 'item-3'])
  })

  it('removeView at workspace scope uses workspace persistence', async () => {
    setupWorkspaceWithColumns()

    await useViewStore.getState().addView('workspace-1', 'Extra', 'columns')
    mockWorkspaceViewDelete.mockClear()
    mockWorkspaceViewSetActiveView.mockClear()

    const entity = getActiveEntity()
    const extraView = entity?.views.find((v) => v.name === 'Extra')
    if (extraView) {
      await useViewStore.getState().removeView(extraView.id, 'workspace-1')
    }

    expect(mockWorkspaceViewDelete).toHaveBeenCalledTimes(1)
  })

  it('switchView at workspace scope uses workspace persistence', () => {
    const items = [makePodItem('item-1', 'pod-a')]
    useViewStore.getState().load(
      'workspace-1',
      [
        {
          id: 'wv-1',
          name: 'V1',
          viewType: 'columns',
          config: { type: 'columns', rows: [{ items: [{ itemId: 'item-1', width: 520 }] }] },
          itemSettings: {},
        },
        {
          id: 'wv-2',
          name: 'V2',
          viewType: 'columns',
          config: { type: 'columns', rows: [{ items: [{ itemId: 'item-1', width: 520 }] }] },
          itemSettings: {},
        },
      ],
      items,
      'wv-1',
      'workspace',
    )

    useViewStore.getState().switchView('wv-2', 'workspace-1')

    expect(mockWorkspaceViewSetActiveView).toHaveBeenCalledTimes(1)
    expect(mockWorkspaceViewSetActiveView.mock.calls[0]![0].workspaceId).toBe('workspace-1')
    expect(mockWorkspaceViewSetActiveView.mock.calls[0]![0].viewId).toBe('wv-2')
  })

  it('podItems retain podId through load and reconcile', () => {
    setupWorkspaceWithColumns()

    const entity = getActiveEntity()
    const item1 = entity?.podItems.find((pi) => pi.id === 'item-1')
    expect(item1?.podId).toBe('pod-a')

    const item3 = entity?.podItems.find((pi) => pi.id === 'item-3')
    expect(item3?.podId).toBe('pod-b')

    // Reconcile with same items — podIds should persist
    useViewStore
      .getState()
      .reconcile([makePodItem('item-1', 'pod-a'), makePodItem('item-2', 'pod-a'), makePodItem('item-3', 'pod-b')])

    const updated = getActiveEntity()
    expect(updated?.podItems.find((pi) => pi.id === 'item-1')?.podId).toBe('pod-a')
    expect(updated?.podItems.find((pi) => pi.id === 'item-3')?.podId).toBe('pod-b')
  })
})
