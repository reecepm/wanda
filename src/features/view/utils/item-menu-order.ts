export const ITEM_MENU_ORDER_SETTING_KEY = 'view.itemMenu.order'
export const AGENT_MENU_CONFIG_SETTING_KEY = 'view.itemMenu.agentOptions'

export const DEFAULT_ITEM_MENU_ORDER = ['agent', 'terminal', 'command', 'browser', 'markdown'] as const

export type ItemMenuItemId = (typeof DEFAULT_ITEM_MENU_ORDER)[number]

export const ITEM_MENU_LABELS: Record<ItemMenuItemId, string> = {
  agent: 'Agent',
  terminal: 'Terminal',
  command: 'Command',
  browser: 'Browser',
  markdown: 'Markdown File...',
}

const KNOWN_ITEM_MENU_IDS = new Set<string>(DEFAULT_ITEM_MENU_ORDER)

export function parseItemMenuOrder(value: string | null | undefined): ItemMenuItemId[] {
  if (!value) return DEFAULT_ITEM_MENU_ORDER.slice()
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return DEFAULT_ITEM_MENU_ORDER.slice()
    const seen = new Set<ItemMenuItemId>()
    const ordered: ItemMenuItemId[] = []
    for (const id of parsed) {
      if (typeof id !== 'string' || !KNOWN_ITEM_MENU_IDS.has(id)) continue
      const itemId = id as ItemMenuItemId
      if (seen.has(itemId)) continue
      seen.add(itemId)
      ordered.push(itemId)
    }
    return ordered
  } catch {
    return DEFAULT_ITEM_MENU_ORDER.slice()
  }
}

export function serializeItemMenuOrder(order: readonly ItemMenuItemId[]): string {
  return JSON.stringify(order)
}

export function completeItemMenuOrder(order: readonly ItemMenuItemId[]): ItemMenuItemId[] {
  const seen = new Set<ItemMenuItemId>()
  const result: ItemMenuItemId[] = []
  for (const id of order) {
    if (seen.has(id)) continue
    seen.add(id)
    result.push(id)
  }
  for (const id of DEFAULT_ITEM_MENU_ORDER) {
    if (!seen.has(id)) result.push(id)
  }
  return result
}

export function orderItemMenuEntries<T extends { id: string }>(
  entries: readonly T[],
  configuredOrder: readonly ItemMenuItemId[],
): T[] {
  const orderIndex = new Map<string, number>(configuredOrder.map((id, index) => [id, index]))
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const aOrder = orderIndex.get(a.entry.id)
      const bOrder = orderIndex.get(b.entry.id)
      if (aOrder != null && bOrder != null) return aOrder - bOrder
      if (aOrder != null) return -1
      if (bOrder != null) return 1
      return a.index - b.index
    })
    .map(({ entry }) => entry)
}

export interface AgentMenuConfig {
  order: string[]
  hidden: string[]
}

export function parseAgentMenuConfig(value: string | null | undefined): AgentMenuConfig {
  if (!value) return { order: [], hidden: [] }
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object') return { order: [], hidden: [] }
    const record = parsed as Record<string, unknown>
    return {
      order: parseStringList(record.order),
      hidden: parseStringList(record.hidden),
    }
  } catch {
    return { order: [], hidden: [] }
  }
}

export function serializeAgentMenuConfig(config: AgentMenuConfig): string {
  return JSON.stringify({
    order: dedupeStrings(config.order),
    hidden: dedupeStrings(config.hidden),
  })
}

export function completeAgentMenuOrder<T extends { id: string }>(
  entries: readonly T[],
  configuredOrder: readonly string[],
): T[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  const seen = new Set<string>()
  const result: T[] = []
  for (const id of configuredOrder) {
    const entry = byId.get(id)
    if (!entry || seen.has(id)) continue
    seen.add(id)
    result.push(entry)
  }
  for (const entry of entries) {
    if (seen.has(entry.id)) continue
    seen.add(entry.id)
    result.push(entry)
  }
  return result
}

export function applyAgentMenuConfig<T extends { id: string }>(entries: readonly T[], config: AgentMenuConfig): T[] {
  const hidden = new Set(config.hidden)
  return completeAgentMenuOrder(entries, config.order).filter((entry) => !hidden.has(entry.id))
}

function parseStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return dedupeStrings(value.filter((entry): entry is string => typeof entry === 'string'))
}

function dedupeStrings(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    if (seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }
  return result
}
