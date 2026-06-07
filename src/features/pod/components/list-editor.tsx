import { useRef, useState } from 'react'
import { RiAddLine, RiCloseLine } from '@/lib/icons'

interface ListEditorProps<T> {
  items: T[]
  onChange: (items: T[]) => void
  createEmpty: () => T
  renderRow: (item: T, index: number, onChange: (updated: T) => void) => React.ReactNode
  addLabel?: string
}

export function ListEditor<T>({ items, onChange, createEmpty, renderRow, addLabel = 'Add' }: ListEditorProps<T>) {
  const nextId = useRef(items.length)
  const [keys, setKeys] = useState<number[]>(() => items.map((_, index) => index))

  function handleItemChange(index: number, updated: T) {
    onChange(items.map((item, i) => (i === index ? updated : item)))
  }

  function handleRemove(index: number) {
    setKeys((prev) => prev.filter((_, i) => i !== index))
    onChange(items.filter((_, i) => i !== index))
  }

  function handleAdd() {
    const key = nextId.current
    nextId.current += 1
    setKeys((prev) => [...prev, key])
    onChange([...items, createEmpty()])
  }

  return (
    <div className="flex flex-col gap-1">
      {items.map((item, i) => (
        <div key={keys[i] ?? i} className="flex gap-1 items-center">
          {renderRow(item, i, (updated) => handleItemChange(i, updated))}
          <button
            type="button"
            onClick={() => handleRemove(i)}
            className="p-0.5 rounded-md hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300"
          >
            <RiCloseLine className="h-3 w-3" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={handleAdd}
        className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors mt-0.5"
      >
        <RiAddLine className="h-3 w-3" />
        {addLabel}
      </button>
    </div>
  )
}
