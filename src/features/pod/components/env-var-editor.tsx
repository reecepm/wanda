import { useMemo } from 'react'
import { ListEditor } from './list-editor'

interface EnvVarEntry {
  key: string
  value: string
}

interface EnvVarEditorProps {
  value: Record<string, string>
  onChange: (value: Record<string, string>) => void
}

export function EnvVarEditor({ value, onChange }: EnvVarEditorProps) {
  const entries: EnvVarEntry[] = useMemo(() => Object.entries(value).map(([key, value]) => ({ key, value })), [value])

  function handleChange(items: EnvVarEntry[]) {
    const record: Record<string, string> = {}
    for (const entry of items) {
      record[entry.key] = entry.value
    }
    onChange(record)
  }

  return (
    <ListEditor
      items={entries}
      onChange={handleChange}
      createEmpty={() => ({ key: '', value: '' })}
      addLabel="Add variable"
      renderRow={(entry, _index, onChange) => (
        <>
          <input
            type="text"
            value={entry.key}
            onChange={(e) => onChange({ ...entry, key: e.target.value })}
            placeholder="KEY"
            className="flex-1 h-6 rounded-md border border-zinc-700 bg-zinc-800 px-1.5 text-[11px] text-zinc-200 font-mono outline-none focus:border-zinc-500"
          />
          <input
            type="text"
            value={entry.value}
            onChange={(e) => onChange({ ...entry, value: e.target.value })}
            placeholder="value"
            className="flex-1 h-6 rounded-md border border-zinc-700 bg-zinc-800 px-1.5 text-[11px] text-zinc-200 font-mono outline-none focus:border-zinc-500"
          />
        </>
      )}
    />
  )
}
