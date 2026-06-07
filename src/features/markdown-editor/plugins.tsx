import { AutoformatPlugin, type AutoformatRule } from '@platejs/autoformat'
import {
  BlockquotePlugin,
  BoldPlugin,
  CodePlugin,
  H1Plugin,
  H2Plugin,
  H3Plugin,
  H4Plugin,
  H5Plugin,
  H6Plugin,
  HorizontalRulePlugin,
  ItalicPlugin,
  StrikethroughPlugin,
  UnderlinePlugin,
} from '@platejs/basic-nodes/react'
import { CodeBlockPlugin, CodeLinePlugin } from '@platejs/code-block/react'
import { LinkPlugin } from '@platejs/link/react'
import { toggleList } from '@platejs/list'
import { ListPlugin } from '@platejs/list/react'
import { MarkdownPlugin } from '@platejs/markdown'
import { SlashInputPlugin, SlashPlugin } from '@platejs/slash-command/react'
import { TableCellHeaderPlugin, TableCellPlugin, TablePlugin, TableRowPlugin } from '@platejs/table/react'
import { PlateElement, type PlateElementProps, PlateLeaf, type PlateLeafProps } from 'platejs/react'
import { SlashInputElement } from './slash-input-element'

// --- Element components (block-level) ---

function ParagraphElement(props: PlateElementProps) {
  return (
    <PlateElement {...props} as="p" className="my-2 leading-relaxed">
      {props.children}
    </PlateElement>
  )
}

function H1Element(props: PlateElementProps) {
  return (
    <PlateElement {...props} as="h1" className="mt-6 mb-3 text-3xl font-bold tracking-tight text-zinc-100">
      {props.children}
    </PlateElement>
  )
}

function H2Element(props: PlateElementProps) {
  return (
    <PlateElement {...props} as="h2" className="mt-5 mb-2 text-2xl font-semibold tracking-tight text-zinc-100">
      {props.children}
    </PlateElement>
  )
}

function H3Element(props: PlateElementProps) {
  return (
    <PlateElement {...props} as="h3" className="mt-4 mb-2 text-xl font-semibold text-zinc-100">
      {props.children}
    </PlateElement>
  )
}

function H4Element(props: PlateElementProps) {
  return (
    <PlateElement {...props} as="h4" className="mt-4 mb-2 text-lg font-semibold text-zinc-100">
      {props.children}
    </PlateElement>
  )
}

function H5Element(props: PlateElementProps) {
  return (
    <PlateElement {...props} as="h5" className="mt-3 mb-1 text-base font-semibold text-zinc-100">
      {props.children}
    </PlateElement>
  )
}

function H6Element(props: PlateElementProps) {
  return (
    <PlateElement {...props} as="h6" className="mt-3 mb-1 text-sm font-semibold text-zinc-100">
      {props.children}
    </PlateElement>
  )
}

function BlockquoteElement(props: PlateElementProps) {
  return (
    <PlateElement {...props} as="blockquote" className="my-3 border-l-2 border-zinc-600 pl-4 italic text-zinc-400">
      {props.children}
    </PlateElement>
  )
}

function HorizontalRuleElement(props: PlateElementProps) {
  return (
    <PlateElement {...props} className="my-4">
      <div contentEditable={false}>
        <hr className="border-zinc-700" />
      </div>
      {props.children}
    </PlateElement>
  )
}

function ListElement(props: PlateElementProps) {
  const styleType = (props.element as { listStyleType?: string }).listStyleType
  const indent = (props.element as { indent?: number }).indent ?? 0
  const isOrdered = styleType === 'decimal' || styleType?.startsWith('lower') || styleType?.startsWith('upper')
  const marker = isOrdered ? 'decimal' : 'disc'
  return (
    <PlateElement
      {...props}
      as="div"
      className="my-1 leading-relaxed"
      style={{
        marginLeft: `${indent * 1.25}rem`,
        listStyleType: marker,
        display: 'list-item',
        listStylePosition: 'inside',
      }}
    >
      {props.children}
    </PlateElement>
  )
}

function CodeBlockElement(props: PlateElementProps) {
  const lang = (props.element as { lang?: string }).lang
  return (
    <PlateElement
      {...props}
      as="pre"
      className="group/code-block relative my-3 overflow-x-auto rounded-md bg-zinc-900 border border-zinc-800 p-3 text-xs font-mono text-zinc-200"
    >
      {lang && (
        <span className="absolute top-1.5 right-2 text-[10px] text-zinc-500 select-none opacity-60">{lang}</span>
      )}
      <code>{props.children}</code>
    </PlateElement>
  )
}

function CodeLineElement(props: PlateElementProps) {
  return (
    <PlateElement {...props} as="div" className="font-mono">
      {props.children}
    </PlateElement>
  )
}

function LinkElement(props: PlateElementProps) {
  const href = (props.element as { url?: string }).url
  return (
    <PlateElement
      {...props}
      as="a"
      className="text-blue-400 underline decoration-blue-400/40 underline-offset-2 hover:text-blue-300"
      attributes={{ ...props.attributes, href: href ?? '#' } as PlateElementProps['attributes']}
    >
      {props.children}
    </PlateElement>
  )
}

function TableElement(props: PlateElementProps) {
  return (
    <PlateElement {...props} as="table" className="my-3 w-full border-collapse text-sm">
      <tbody>{props.children}</tbody>
    </PlateElement>
  )
}

function TableRowElement(props: PlateElementProps) {
  return (
    <PlateElement {...props} as="tr" className="border-b border-zinc-800">
      {props.children}
    </PlateElement>
  )
}

function TableCellElement(props: PlateElementProps) {
  return (
    <PlateElement {...props} as="td" className="border border-zinc-800 px-3 py-1.5 align-top">
      {props.children}
    </PlateElement>
  )
}

function TableHeaderCellElement(props: PlateElementProps) {
  return (
    <PlateElement
      {...props}
      as="th"
      className="border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-left font-semibold"
    >
      {props.children}
    </PlateElement>
  )
}

// --- Leaf components (inline marks) ---

function BoldLeaf(props: PlateLeafProps) {
  return (
    <PlateLeaf {...props} as="strong" className="font-semibold text-zinc-100">
      {props.children}
    </PlateLeaf>
  )
}

function ItalicLeaf(props: PlateLeafProps) {
  return (
    <PlateLeaf {...props} as="em" className="italic">
      {props.children}
    </PlateLeaf>
  )
}

function UnderlineLeaf(props: PlateLeafProps) {
  return (
    <PlateLeaf {...props} as="u" className="underline underline-offset-2">
      {props.children}
    </PlateLeaf>
  )
}

function StrikethroughLeaf(props: PlateLeafProps) {
  return (
    <PlateLeaf {...props} as="s" className="line-through text-zinc-500">
      {props.children}
    </PlateLeaf>
  )
}

function CodeLeaf(props: PlateLeafProps) {
  return (
    <PlateLeaf {...props} as="code" className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-[0.85em] text-zinc-200">
      {props.children}
    </PlateLeaf>
  )
}

// --- Autoformat rules ---

const autoformatBlocks: AutoformatRule[] = [
  { match: '# ', mode: 'block', type: H1Plugin.key },
  { match: '## ', mode: 'block', type: H2Plugin.key },
  { match: '### ', mode: 'block', type: H3Plugin.key },
  { match: '#### ', mode: 'block', type: H4Plugin.key },
  { match: '##### ', mode: 'block', type: H5Plugin.key },
  { match: '###### ', mode: 'block', type: H6Plugin.key },
  { match: '> ', mode: 'block', type: BlockquotePlugin.key },
  {
    match: ['* ', '- '],
    mode: 'block',
    type: ListPlugin.key,
    format: (editor) => {
      toggleList(editor, { listStyleType: 'disc' })
    },
  },
  {
    match: ['1. ', '1) '],
    mode: 'block',
    type: ListPlugin.key,
    format: (editor) => {
      toggleList(editor, { listStyleType: 'decimal' })
    },
  },
  {
    match: '---',
    mode: 'block',
    type: HorizontalRulePlugin.key,
    format: (editor) => {
      editor.tf.insertNodes({ type: HorizontalRulePlugin.key, children: [{ text: '' }] })
    },
  },
  {
    match: '```',
    mode: 'block',
    type: CodeBlockPlugin.key,
    format: (editor) => {
      editor.tf.insertNodes({
        type: CodeBlockPlugin.key,
        children: [{ type: CodeLinePlugin.key, children: [{ text: '' }] }],
      })
    },
  },
]

const autoformatMarks: AutoformatRule[] = [
  { match: '**', mode: 'mark', type: BoldPlugin.key },
  { match: '__', mode: 'mark', type: BoldPlugin.key },
  { match: '*', mode: 'mark', type: ItalicPlugin.key },
  { match: '_', mode: 'mark', type: ItalicPlugin.key },
  { match: '~~', mode: 'mark', type: StrikethroughPlugin.key },
  { match: '`', mode: 'mark', type: CodePlugin.key },
]

const autoformatRules: AutoformatRule[] = [...autoformatBlocks, ...autoformatMarks]

/**
 * Full plugin list for the markdown editor. Order matters for plate — MarkdownPlugin
 * should come last so it sees the final schema when deriving rules.
 */
export const markdownPlugins = [
  H1Plugin,
  H2Plugin,
  H3Plugin,
  H4Plugin,
  H5Plugin,
  H6Plugin,
  BlockquotePlugin,
  HorizontalRulePlugin,
  ListPlugin,
  CodeBlockPlugin,
  CodeLinePlugin,
  LinkPlugin,
  TablePlugin,
  TableRowPlugin,
  TableCellPlugin,
  TableCellHeaderPlugin,
  BoldPlugin,
  ItalicPlugin,
  UnderlinePlugin,
  StrikethroughPlugin,
  CodePlugin,
  AutoformatPlugin.configure({
    options: {
      enableUndoOnDelete: true,
      rules: autoformatRules,
    },
  }),
  SlashPlugin.configure({
    options: {
      trigger: '/',
      triggerPreviousCharPattern: /^\s?$/,
      triggerQuery: (editor) => !editor.api.some({ match: { type: CodeBlockPlugin.key } }),
    },
  }),
  SlashInputPlugin.withComponent(SlashInputElement),
  MarkdownPlugin,
]

/**
 * Component registration keyed by plugin key. Plate uses these to render nodes.
 */
export const markdownComponents = {
  p: ParagraphElement,
  [H1Plugin.key]: H1Element,
  [H2Plugin.key]: H2Element,
  [H3Plugin.key]: H3Element,
  [H4Plugin.key]: H4Element,
  [H5Plugin.key]: H5Element,
  [H6Plugin.key]: H6Element,
  [BlockquotePlugin.key]: BlockquoteElement,
  [HorizontalRulePlugin.key]: HorizontalRuleElement,
  [ListPlugin.key]: ListElement,
  [CodeBlockPlugin.key]: CodeBlockElement,
  [CodeLinePlugin.key]: CodeLineElement,
  [LinkPlugin.key]: LinkElement,
  [TablePlugin.key]: TableElement,
  [TableRowPlugin.key]: TableRowElement,
  [TableCellPlugin.key]: TableCellElement,
  [TableCellHeaderPlugin.key]: TableHeaderCellElement,
  [BoldPlugin.key]: BoldLeaf,
  [ItalicPlugin.key]: ItalicLeaf,
  [UnderlinePlugin.key]: UnderlineLeaf,
  [StrikethroughPlugin.key]: StrikethroughLeaf,
  [CodePlugin.key]: CodeLeaf,
}
