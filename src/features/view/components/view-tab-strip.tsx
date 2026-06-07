import { useState } from 'react'
import { useViewScope } from '@/features/view/scope/view-scope-context'
import { useActiveViewId, useViewStore, useViews } from '@/features/view/store/view-store'
import {
  RiAddLine,
  RiArtboard2Line,
  RiCloseLine,
  RiEditLine,
  RiFileCopyLine,
  RiGalleryView2,
  RiGridLine,
  RiLayoutColumnLine,
  RiLayoutMasonryLine,
  RiStackLine,
} from '@/lib/icons'
import { useInlineEdit } from '@/shared/hooks/use-inline-edit'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/ui/context-menu'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu'

export function ViewTabStrip({ podId }: { podId: string }) {
  const views = useViews()
  const activeViewId = useActiveViewId()
  const switchView = useViewStore((s) => s.switchView)
  const addView = useViewStore((s) => s.addView)
  const removeView = useViewStore((s) => s.removeView)
  const renameView = useViewStore((s) => s.renameView)
  const duplicateView = useViewStore((s) => s.duplicateView)

  const [editingId, setEditingId] = useState<string | null>(null)
  const {
    editValue,
    setEditValue,
    inputRef,
    startEditing: startEdit,
    commitRename: commitEdit,
    cancelEditing: cancelEdit,
  } = useInlineEdit((value) => {
    if (editingId) renameView(editingId, value)
  })
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const { config: scopeConfig } = useViewScope()

  function startEditing(viewId: string, name: string) {
    setEditingId(viewId)
    startEdit(name)
  }

  function commitRename() {
    commitEdit()
    setEditingId(null)
  }

  if (views.length === 0) return null

  return (
    <div role="tablist" aria-label="Views" className="flex items-center gap-0.5">
      {views.map((view) => {
        const isActive = view.id === activeViewId
        const isEditing = editingId === view.id

        return (
          <ContextMenu key={view.id}>
            <ContextMenuTrigger
              render={
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  tabIndex={isActive ? 0 : -1}
                  className={`
                    relative px-2 py-1 text-[11px] rounded-md transition-colors
                    ${isActive ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'}
                  `}
                  onClick={() => !isEditing && switchView(view.id, podId)}
                  onDoubleClick={() => startEditing(view.id, view.name)}
                />
              }
            >
              {isEditing ? (
                <input
                  ref={inputRef}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename()
                    if (e.key === 'Escape') {
                      cancelEdit()
                      setEditingId(null)
                    }
                    e.stopPropagation()
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="bg-transparent border-none outline-none text-[11px] text-zinc-200 w-[60px] py-0 text-center"
                />
              ) : (
                view.name
              )}
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem
                onClick={() => {
                  startEditing(view.id, view.name)
                }}
              >
                <RiEditLine />
                Rename
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => {
                  duplicateView(view.id, podId)
                }}
              >
                <RiFileCopyLine />
                Duplicate
              </ContextMenuItem>
              {views.length > 1 && (
                <ContextMenuItem
                  variant="destructive"
                  onClick={() => {
                    removeView(view.id, podId)
                  }}
                >
                  <RiCloseLine />
                  Delete
                </ContextMenuItem>
              )}
            </ContextMenuContent>
          </ContextMenu>
        )
      })}

      <DropdownMenu open={addMenuOpen} onOpenChange={setAddMenuOpen}>
        <DropdownMenuTrigger
          className="p-1 rounded-md text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800 transition-colors outline-none"
          title="New view"
        >
          <RiAddLine className="h-3.5 w-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={6} className="w-52">
          {[
            {
              type: 'split-pane' as const,
              icon: RiLayoutColumnLine,
              label: 'Split View',
              desc: 'Resizable horizontal/vertical panes',
            },
            { type: 'grid' as const, icon: RiGridLine, label: 'Grid View', desc: 'Even grid of all terminals' },
            {
              type: 'carousel' as const,
              icon: RiGalleryView2,
              label: 'Carousel View',
              desc: 'One terminal at a time, swipe to switch',
            },
            {
              type: 'columns' as const,
              icon: RiLayoutMasonryLine,
              label: 'Columns View',
              desc: 'Side-by-side scrollable columns',
            },
            {
              type: 'tabs' as const,
              icon: RiStackLine,
              label: 'Tabs View',
              desc: 'Tabbed interface, one visible at a time',
            },
            {
              type: 'canvas' as const,
              icon: RiArtboard2Line,
              label: 'Canvas View',
              desc: 'Free-form drag and resize on a canvas',
            },
          ]
            .filter((item) => scopeConfig.allowedViewTypes.includes(item.type))
            .map((item) => (
              <DropdownMenuItem
                key={item.type}
                className="flex flex-col items-start gap-0"
                onClick={() => {
                  addView(podId, `View ${views.length + 1}`, item.type)
                  setAddMenuOpen(false)
                }}
              >
                <span className="flex items-center gap-1.5">
                  <item.icon className="h-3.5 w-3.5 shrink-0" />
                  {item.label}
                </span>
                <span className="text-[10px] text-zinc-500 ml-5">{item.desc}</span>
              </DropdownMenuItem>
            ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
