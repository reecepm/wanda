import { ListEditor } from './list-editor'

export interface MountEntry {
  source: string
  target: string
  readonly?: boolean
}

interface MountEditorProps {
  value: MountEntry[]
  onChange: (value: MountEntry[]) => void
}

export function MountEditor({ value, onChange }: MountEditorProps) {
  return (
    <ListEditor
      items={value}
      onChange={onChange}
      createEmpty={(): MountEntry => ({ source: '', target: '' })}
      addLabel="Add mount"
      renderRow={(mount, _index, onChange) => (
        <>
          <input
            type="text"
            value={mount.source}
            onChange={(e) => onChange({ ...mount, source: e.target.value })}
            placeholder="host path"
            className="flex-1 h-6 rounded-md border border-zinc-700 bg-zinc-800 px-1.5 text-[11px] text-zinc-200 font-mono outline-none focus:border-zinc-500"
          />
          <input
            type="text"
            value={mount.target}
            onChange={(e) => onChange({ ...mount, target: e.target.value })}
            placeholder="container path"
            className="flex-1 h-6 rounded-md border border-zinc-700 bg-zinc-800 px-1.5 text-[11px] text-zinc-200 font-mono outline-none focus:border-zinc-500"
          />
          <label className="flex items-center gap-1 text-[10px] text-zinc-500 cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={mount.readonly ?? false}
              onChange={(e) => onChange({ ...mount, readonly: e.target.checked })}
              className="rounded-md border-zinc-600"
            />
            ro
          </label>
        </>
      )}
    />
  )
}
