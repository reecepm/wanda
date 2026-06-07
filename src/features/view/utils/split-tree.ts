export type SplitLeaf = {
  type: 'leaf'
  itemId: string
}

export type SplitBranch = {
  type: 'branch'
  direction: 'horizontal' | 'vertical'
  children: [SplitNode, SplitNode]
  sizes: [number, number]
}

export type SplitNode = SplitLeaf | SplitBranch

/** Collect all leaf itemIds in depth-first order. */
export function collectLeafIds(node: SplitNode): string[] {
  if (node.type === 'leaf') return [node.itemId]
  return [...collectLeafIds(node.children[0]), ...collectLeafIds(node.children[1])]
}

/** Count total leaves in the tree. */
export function countLeaves(node: SplitNode): number {
  if (node.type === 'leaf') return 1
  return countLeaves(node.children[0]) + countLeaves(node.children[1])
}

/** Find a leaf by itemId (returns the leaf or null). */
export function findLeaf(node: SplitNode, itemId: string): SplitLeaf | null {
  if (node.type === 'leaf') return node.itemId === itemId ? node : null
  return findLeaf(node.children[0], itemId) ?? findLeaf(node.children[1], itemId)
}

/**
 * Split a leaf into a branch containing the old leaf + a new leaf.
 * The new item appears as the second child (right or bottom).
 */
export function splitLeaf(
  node: SplitNode,
  targetId: string,
  direction: 'horizontal' | 'vertical',
  newItemId: string,
): SplitNode {
  if (node.type === 'leaf') {
    if (node.itemId === targetId) {
      return {
        type: 'branch',
        direction,
        children: [
          { type: 'leaf', itemId: targetId },
          { type: 'leaf', itemId: newItemId },
        ],
        sizes: [50, 50],
      }
    }
    return node
  }

  return {
    ...node,
    children: [
      splitLeaf(node.children[0], targetId, direction, newItemId),
      splitLeaf(node.children[1], targetId, direction, newItemId),
    ],
  }
}

/**
 * Remove a leaf from the tree. The sibling of the removed leaf replaces the parent branch.
 * Returns null if the tree becomes empty (removed the only leaf).
 */
export function removeLeaf(node: SplitNode, targetId: string): SplitNode | null {
  if (node.type === 'leaf') {
    return node.itemId === targetId ? null : node
  }

  const [left, right] = node.children

  if (left.type === 'leaf' && left.itemId === targetId) return right
  if (right.type === 'leaf' && right.itemId === targetId) return left

  const newLeft = removeLeaf(left, targetId)
  const newRight = removeLeaf(right, targetId)

  if (newLeft === null) return newRight
  if (newRight === null) return newLeft

  if (newLeft === left && newRight === right) return node

  return {
    ...node,
    children: [newLeft, newRight],
  }
}

/**
 * Update sizes at a specific path in the tree.
 * Path is an array of child indices (0 or 1) from root to the target branch.
 */
export function updateSizes(node: SplitNode, path: number[], sizes: [number, number]): SplitNode {
  if (node.type === 'leaf') return node

  if (path.length === 0) {
    return { ...node, sizes }
  }

  const [head, ...rest] = path
  if (head === undefined) return node
  const child = node.children[head]
  if (child === undefined) return node
  const newChildren: [SplitNode, SplitNode] = [...node.children]
  newChildren[head] = updateSizes(child, rest, sizes)
  return { ...node, children: newChildren }
}

/** Get the next leaf's itemId after currentId in tree order, wrapping around. */
export function nextLeaf(node: SplitNode, currentId: string): string | null {
  const ids = collectLeafIds(node)
  if (ids.length === 0) return null
  const idx = ids.indexOf(currentId)
  if (idx === -1) return ids[0] ?? null
  return ids[(idx + 1) % ids.length] ?? null
}

/** Get the previous leaf's itemId before currentId in tree order, wrapping around. */
export function prevLeaf(node: SplitNode, currentId: string): string | null {
  const ids = collectLeafIds(node)
  if (ids.length === 0) return null
  const idx = ids.indexOf(currentId)
  if (idx === -1) return ids[ids.length - 1] ?? null
  return ids[(idx - 1 + ids.length) % ids.length] ?? null
}

/** Get the leaf itemId at a given index (0-based) in tree order. */
export function leafAtIndex(node: SplitNode, index: number): string | null {
  const ids = collectLeafIds(node)
  return ids[index] ?? null
}

/** Swap the positions of two leaves in the tree by exchanging their itemIds. */
export function swapLeaves(node: SplitNode, idA: string, idB: string): SplitNode {
  if (node.type === 'leaf') {
    if (node.itemId === idA) return { type: 'leaf', itemId: idB }
    if (node.itemId === idB) return { type: 'leaf', itemId: idA }
    return node
  }
  return {
    ...node,
    children: [swapLeaves(node.children[0], idA, idB), swapLeaves(node.children[1], idA, idB)],
  }
}

/** Find which pane contains a given item ID. */
export function findPaneForItem(paneTabs: Record<string, { tabIds: string[] }>, itemId: string): string | null {
  for (const [paneId, group] of Object.entries(paneTabs)) {
    if (group.tabIds.includes(itemId)) return paneId
  }
  return null
}
