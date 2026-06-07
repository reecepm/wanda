import { useEffect, useRef, useState } from 'react'

export function InlineRenameInput({
  name,
  onSubmit,
  onCancel,
}: {
  name: string
  onSubmit: (name: string) => void
  onCancel: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [editValue, setEditValue] = useState(name)

  useEffect(() => {
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }, [])

  function commit() {
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== name) onSubmit(trimmed)
    else onCancel()
  }

  return (
    <input
      ref={inputRef}
      type="text"
      value={editValue}
      onChange={(e) => setEditValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          onCancel()
        }
      }}
      onBlur={commit}
      onClick={(e) => e.stopPropagation()}
      className="flex-1 min-w-0 bg-zinc-700 border border-zinc-600 rounded-md px-1.5 py-0.5 text-[12px] text-zinc-200 outline-none focus:border-zinc-500"
    />
  )
}
