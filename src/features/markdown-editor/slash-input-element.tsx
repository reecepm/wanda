import { BlockquotePlugin, H1Plugin, H2Plugin, H3Plugin, HorizontalRulePlugin } from '@platejs/basic-nodes/react'
import { CodeBlockPlugin, CodeLinePlugin } from '@platejs/code-block/react'
import { toggleList } from '@platejs/list'
import { TablePlugin } from '@platejs/table/react'
import { PlateElement, type PlateElementProps, useEditorRef } from 'platejs/react'
import {
  RiCodeBoxLine,
  RiDoubleQuotesL,
  RiH1,
  RiH2,
  RiH3,
  RiListOrdered2,
  RiListUnordered,
  RiSeparator,
  RiTableLine,
} from '@/lib/icons'
import {
  InlineCombobox,
  InlineComboboxContent,
  InlineComboboxEmpty,
  InlineComboboxInput,
  InlineComboboxItem,
} from './inline-combobox'

interface SlashItem {
  icon: React.ReactNode
  keywords: string[]
  label: string
  onSelect: (editor: ReturnType<typeof useEditorRef>) => void
  value: string
}

const SLASH_ITEMS: SlashItem[] = [
  {
    icon: <RiH1 className="size-4 text-zinc-400" />,
    keywords: ['heading', 'h1', 'title'],
    label: 'Heading 1',
    value: 'h1',
    onSelect: (editor) => {
      editor.tf.setNodes({ type: H1Plugin.key }, { match: (n) => editor.api.isBlock(n) })
    },
  },
  {
    icon: <RiH2 className="size-4 text-zinc-400" />,
    keywords: ['heading', 'h2', 'subtitle'],
    label: 'Heading 2',
    value: 'h2',
    onSelect: (editor) => {
      editor.tf.setNodes({ type: H2Plugin.key }, { match: (n) => editor.api.isBlock(n) })
    },
  },
  {
    icon: <RiH3 className="size-4 text-zinc-400" />,
    keywords: ['heading', 'h3'],
    label: 'Heading 3',
    value: 'h3',
    onSelect: (editor) => {
      editor.tf.setNodes({ type: H3Plugin.key }, { match: (n) => editor.api.isBlock(n) })
    },
  },
  {
    icon: <RiListUnordered className="size-4 text-zinc-400" />,
    keywords: ['list', 'bullet', 'ul', 'unordered'],
    label: 'Bulleted List',
    value: 'ul',
    onSelect: (editor) => {
      toggleList(editor, { listStyleType: 'disc' })
    },
  },
  {
    icon: <RiListOrdered2 className="size-4 text-zinc-400" />,
    keywords: ['list', 'number', 'ol', 'ordered'],
    label: 'Numbered List',
    value: 'ol',
    onSelect: (editor) => {
      toggleList(editor, { listStyleType: 'decimal' })
    },
  },
  {
    icon: <RiCodeBoxLine className="size-4 text-zinc-400" />,
    keywords: ['code', 'codeblock', 'fenced', 'snippet'],
    label: 'Code Block',
    value: 'code_block',
    onSelect: (editor) => {
      editor.tf.insertNodes({
        type: CodeBlockPlugin.key,
        children: [{ type: CodeLinePlugin.key, children: [{ text: '' }] }],
      })
    },
  },
  {
    icon: <RiDoubleQuotesL className="size-4 text-zinc-400" />,
    keywords: ['quote', 'blockquote', 'cite'],
    label: 'Blockquote',
    value: 'blockquote',
    onSelect: (editor) => {
      editor.tf.setNodes({ type: BlockquotePlugin.key }, { match: (n) => editor.api.isBlock(n) })
    },
  },
  {
    icon: <RiTableLine className="size-4 text-zinc-400" />,
    keywords: ['table', 'grid'],
    label: 'Table',
    value: 'table',
    onSelect: (editor) => {
      editor.tf.insertNodes({
        type: TablePlugin.key,
        children: [
          {
            type: 'tr',
            children: [
              { type: 'th', children: [{ type: 'p', children: [{ text: '' }] }] },
              { type: 'th', children: [{ type: 'p', children: [{ text: '' }] }] },
            ],
          },
          {
            type: 'tr',
            children: [
              { type: 'td', children: [{ type: 'p', children: [{ text: '' }] }] },
              { type: 'td', children: [{ type: 'p', children: [{ text: '' }] }] },
            ],
          },
        ],
      })
    },
  },
  {
    icon: <RiSeparator className="size-4 text-zinc-400" />,
    keywords: ['hr', 'divider', 'separator', 'line'],
    label: 'Horizontal Rule',
    value: 'hr',
    onSelect: (editor) => {
      editor.tf.insertNodes({ type: HorizontalRulePlugin.key, children: [{ text: '' }] })
    },
  },
]

export function SlashInputElement(props: PlateElementProps) {
  const editor = useEditorRef()

  return (
    <PlateElement {...props} as="span">
      <InlineCombobox element={props.element} trigger="/" showTrigger={false}>
        <InlineComboboxInput />
        <InlineComboboxContent>
          <InlineComboboxEmpty>No matching commands</InlineComboboxEmpty>
          {SLASH_ITEMS.map((item) => (
            <InlineComboboxItem
              key={item.value}
              value={item.value}
              label={item.label}
              keywords={item.keywords}
              onClick={() => item.onSelect(editor)}
            >
              {item.icon}
              <span>{item.label}</span>
            </InlineComboboxItem>
          ))}
        </InlineComboboxContent>
      </InlineCombobox>
    </PlateElement>
  )
}
