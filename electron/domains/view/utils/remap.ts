import type { SplitNode } from '../../../../src/features/view/utils/split-tree'
import type { ViewConfig } from '../types'

function remapId(map: Map<string, string>, id: string | undefined): string | undefined {
  if (!id) return id
  return map.get(id) ?? id
}

function remapSplitNode(node: SplitNode, map: Map<string, string>): SplitNode {
  if (node.type === 'leaf') {
    return { type: 'leaf', itemId: map.get(node.itemId) ?? node.itemId }
  }
  return {
    type: 'branch',
    direction: node.direction,
    children: [remapSplitNode(node.children[0], map), remapSplitNode(node.children[1], map)],
    sizes: node.sizes,
  }
}

/**
 * Returns a new ViewConfig with every podItem id remapped via the given map.
 * Unknown ids are left as-is so that out-of-band references survive a partial copy.
 */
export function remapViewConfigItemIds(
  config: ViewConfig | null | undefined,
  map: Map<string, string>,
): ViewConfig | null | undefined {
  if (!config) return config
  switch (config.type) {
    case 'tabs':
      return { ...config, focusedItemId: remapId(map, config.focusedItemId) }
    case 'split-pane': {
      const paneTabs = config.paneTabs
        ? Object.fromEntries(
            Object.entries(config.paneTabs).map(([paneId, group]) => [
              paneId,
              {
                tabIds: group.tabIds.map((id) => map.get(id) ?? id),
                activeTabId: group.activeTabId ? (map.get(group.activeTabId) ?? group.activeTabId) : null,
              },
            ]),
          )
        : undefined
      return {
        ...config,
        layout: remapSplitNode(config.layout, map),
        paneTabs,
        focusedItemId: remapId(map, config.focusedItemId),
      }
    }
    case 'grid':
      return {
        ...config,
        widgets: config.widgets.map((w) => ({ ...w, itemId: map.get(w.itemId) ?? w.itemId })),
        focusedItemId: remapId(map, config.focusedItemId),
      }
    case 'carousel':
      return {
        ...config,
        items: config.items.map((i) => ({ ...i, itemId: map.get(i.itemId) ?? i.itemId })),
        focusedItemId: remapId(map, config.focusedItemId),
      }
    case 'columns':
      return {
        ...config,
        rows: config.rows.map((r) => ({
          items: r.items.map((i) => ({ ...i, itemId: map.get(i.itemId) ?? i.itemId })),
        })),
        focusedItemId: remapId(map, config.focusedItemId),
      }
    case 'canvas':
      return {
        ...config,
        nodes: config.nodes.map((n) => ({ ...n, itemId: map.get(n.itemId) ?? n.itemId })),
        focusedItemId: remapId(map, config.focusedItemId),
      }
  }
}
