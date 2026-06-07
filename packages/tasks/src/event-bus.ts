import type { EventStorage } from './interfaces.ts'
import type { TaskEvent, TaskEventType } from './types.ts'

type EventHandler = (event: TaskEvent) => void

export class EventBus {
  private listeners = new Map<string, Set<EventHandler>>()
  private storage: EventStorage
  private instanceId: string
  private position: number

  constructor(storage: EventStorage, instanceId: string, initialPosition: number) {
    this.storage = storage
    this.instanceId = instanceId
    this.position = initialPosition
  }

  static async create(storage: EventStorage, instanceId: string): Promise<EventBus> {
    const lastPos = await storage.lastPosition()
    return new EventBus(storage, instanceId, lastPos)
  }

  async emit(
    type: TaskEventType,
    entityId: string,
    data: Record<string, unknown>,
    agentId?: string | null,
  ): Promise<TaskEvent> {
    this.position++
    const event: TaskEvent = {
      id: generateEventId(),
      position: this.position,
      type,
      entityId,
      agentId: agentId ?? null,
      data,
      timestamp: Date.now(),
      instanceId: this.instanceId,
    }
    await this.storage.append(event)
    this.notify(event)
    return event
  }

  on(type: TaskEventType | '*', handler: EventHandler): void {
    let set = this.listeners.get(type)
    if (!set) {
      set = new Set()
      this.listeners.set(type, set)
    }
    set.add(handler)
  }

  off(type: TaskEventType | '*', handler: EventHandler): void {
    this.listeners.get(type)?.delete(handler)
  }

  private notify(event: TaskEvent): void {
    this.listeners.get(event.type)?.forEach((h) => h(event))
    this.listeners.get('*')?.forEach((h) => h(event))
  }
}

let counter = 0
function generateEventId(): string {
  const ts = Date.now().toString(36)
  const c = (counter++).toString(36)
  const r = Math.random().toString(36).slice(2, 6)
  return `${ts}-${c}-${r}`
}
