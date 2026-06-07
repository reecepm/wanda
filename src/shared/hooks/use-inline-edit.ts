import { useEffect, useRef, useState } from 'react'

/**
 * Shared hook for inline-edit (rename) behavior.
 *
 * Manages `isEditing` / `editValue` / `inputRef` state and auto-focuses +
 * selects the input when editing starts.
 *
 * @param onCommit Called with the trimmed value when the user confirms the edit
 *                 (Enter or blur). Only called when the trimmed value is non-empty.
 */
export function useInlineEdit(onCommit: (value: string) => void) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  function startEditing(currentValue: string) {
    setEditValue(currentValue)
    setIsEditing(true)
  }

  function commitRename() {
    if (editValue.trim()) {
      onCommit(editValue.trim())
    }
    setIsEditing(false)
  }

  function cancelEditing() {
    setIsEditing(false)
  }

  return { isEditing, editValue, setEditValue, inputRef, startEditing, commitRename, cancelEditing }
}
