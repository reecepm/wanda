import {
  BoldPlugin,
  CodePlugin,
  H1Plugin,
  H2Plugin,
  H3Plugin,
  ItalicPlugin,
  StrikethroughPlugin,
} from '@platejs/basic-nodes/react'
import { flip, offset, shift, useFloatingToolbar, useFloatingToolbarState } from '@platejs/floating'
import { useEditorRef, useEditorSelector } from 'platejs/react'
import { RiBold, RiCodeSSlashLine, RiH1, RiH2, RiH3, RiItalic, RiStrikethrough } from '@/lib/icons'
import { cn } from '@/shared/utils'

export function FloatingToolbar({ editorId }: { editorId: string }) {
  const editor = useEditorRef()
  const focusedEditorId = useEditorSelector((e) => e.id, [])

  const state = useFloatingToolbarState({
    editorId,
    focusedEditorId,
    floatingOptions: {
      middleware: [offset(8), flip(), shift({ padding: 8 })],
      placement: 'top',
    },
  })

  const { hidden, props, ref } = useFloatingToolbar(state)

  if (hidden) return null

  return (
    <div
      ref={ref}
      className={cn(
        'z-50 flex items-center gap-0.5 rounded-lg border border-zinc-700 bg-zinc-900 px-1 py-0.5 shadow-xl',
        'animate-in fade-in-0 zoom-in-95',
      )}
      {...props}
    >
      <MarkButton editor={editor} type={BoldPlugin.key} icon={<RiBold className="size-3.5" />} />
      <MarkButton editor={editor} type={ItalicPlugin.key} icon={<RiItalic className="size-3.5" />} />
      <MarkButton editor={editor} type={StrikethroughPlugin.key} icon={<RiStrikethrough className="size-3.5" />} />
      <MarkButton editor={editor} type={CodePlugin.key} icon={<RiCodeSSlashLine className="size-3.5" />} />
      <div className="mx-0.5 h-4 w-px bg-zinc-700" />
      <BlockButton editor={editor} type={H1Plugin.key} icon={<RiH1 className="size-3.5" />} />
      <BlockButton editor={editor} type={H2Plugin.key} icon={<RiH2 className="size-3.5" />} />
      <BlockButton editor={editor} type={H3Plugin.key} icon={<RiH3 className="size-3.5" />} />
    </div>
  )
}

function MarkButton({
  editor,
  icon,
  type,
}: {
  editor: ReturnType<typeof useEditorRef>
  icon: React.ReactNode
  type: string
}) {
  const isActive = editor.api.hasMark(type)
  return (
    <button
      type="button"
      className={cn(
        'flex items-center justify-center rounded p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200',
        isActive && 'bg-zinc-800 text-zinc-100',
      )}
      onMouseDown={(e) => {
        e.preventDefault()
        editor.tf.toggleMark(type)
      }}
    >
      {icon}
    </button>
  )
}

function BlockButton({
  editor,
  icon,
  type,
}: {
  editor: ReturnType<typeof useEditorRef>
  icon: React.ReactNode
  type: string
}) {
  const isActive = editor.api.some({ match: { type } })
  return (
    <button
      type="button"
      className={cn(
        'flex items-center justify-center rounded p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200',
        isActive && 'bg-zinc-800 text-zinc-100',
      )}
      onMouseDown={(e) => {
        e.preventDefault()
        if (isActive) {
          editor.tf.setNodes({ type: 'p' }, { match: (n) => editor.api.isBlock(n) })
        } else {
          editor.tf.setNodes({ type }, { match: (n) => editor.api.isBlock(n) })
        }
      }}
    >
      {icon}
    </button>
  )
}
