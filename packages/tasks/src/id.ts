let counter = 0

export function generateId(): string {
  const ts = Date.now().toString(36)
  const c = (counter++).toString(36)
  const r = Math.random().toString(36).slice(2, 8)
  return `${ts}${c}${r}`
}
