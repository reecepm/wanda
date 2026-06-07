// -----------------------------------------------------------------------------
// Default tool renderers. Each one is a thin wrapper around `<ToolRow>` so
// consumers get a consistent single-line layout for every tool kind. Override
// any of these by calling `registerToolRenderer` after `installDefaultToolRenderers()`.
// -----------------------------------------------------------------------------

import type { FileLocation } from '@wanda/agent-protocol'
import type { ReactNode } from 'react'
import { cn } from '../cn'
import { CodeInk } from '../ui/CodeInk'
import { IconBrain, IconDiff, IconFile, IconGlobe, IconSearch, IconTerminal } from '../ui/icons'
import { ToolRow, type ToolRowStatus } from '../ui/ToolRow'
import { registerToolRenderer, type ToolRendererProps } from './registry'

function Locations({ locations }: { locations?: ReadonlyArray<FileLocation> }) {
  if (!locations || locations.length === 0) return null
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px] text-muted-foreground">
      {locations.map((loc, i) => (
        <li key={`${loc.path}:${loc.line ?? 0}:${i}`}>
          {loc.path}
          {loc.line !== undefined && `:${loc.line}`}
        </li>
      ))}
    </ul>
  )
}

function ResultBlock({ summary, error }: { summary?: string; error?: string }) {
  if (!summary && !error) return null
  return (
    <div className="flex flex-col gap-2">
      {summary && (
        <pre
          className={cn(
            'max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 px-2.5 py-2 font-mono text-[11.5px] leading-[1.55] text-foreground',
          )}
        >
          {summary}
        </pre>
      )}
      {error && (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border-[0.5px] border-destructive/30 bg-destructive/[0.05] px-2.5 py-2 font-mono text-[11.5px] text-destructive">
          {error}
        </pre>
      )}
    </div>
  )
}

function shellCommand(detail: { command: string; argv?: readonly string[] }): string {
  if (!detail.argv || detail.argv.length === 0) return detail.command
  return `${detail.command} ${detail.argv.join(' ')}`
}

function renderBody(children?: ReactNode): ReactNode | undefined {
  if (!children) return undefined
  return <div className="flex flex-col gap-2">{children}</div>
}

function ShellRenderer({ part }: ToolRendererProps) {
  const detail = part.detail?.kind === 'shell' ? part.detail : null
  const command = detail ? shellCommand(detail) : undefined
  const body = renderBody(
    <>
      {command && <CodeInk prompt="$">{command}</CodeInk>}
      <ResultBlock summary={part.result?.summary} error={part.result?.error} />
      {part.locations && <Locations locations={part.locations} />}
    </>,
  )
  return (
    <ToolRow
      icon={<IconTerminal />}
      title={part.title ?? 'Shell'}
      subtitle={command}
      status={part.status as ToolRowStatus}
      body={body}
    />
  )
}

function DiffRenderer({ part }: ToolRendererProps) {
  const detail = part.detail?.kind === 'diff' ? part.detail : null
  const diff = detail?.unifiedDiff
  const body = renderBody(
    <>
      {diff ? (
        <DiffBlock unified={diff} />
      ) : detail?.attachmentId ? (
        <p className="text-[11px] text-muted-foreground">
          Diff stored out-of-band · <code className="font-mono">{detail.attachmentId}</code>
        </p>
      ) : null}
      <ResultBlock error={part.result?.error} />
      {part.locations && <Locations locations={part.locations} />}
    </>,
  )
  return (
    <ToolRow
      icon={<IconDiff />}
      title={part.title ?? 'Edit'}
      subtitle={detail?.path}
      status={part.status as ToolRowStatus}
      body={body}
    />
  )
}

function DiffBlock({ unified }: { unified: string }) {
  return (
    <pre className="max-h-72 overflow-auto rounded-md bg-muted/30 font-mono text-[11.5px] leading-[1.55]">
      {unified.split('\n').map((line, i) => {
        const kind: 'add' | 'del' | 'hunk' | 'ctx' =
          line.startsWith('+') && !line.startsWith('+++')
            ? 'add'
            : line.startsWith('-') && !line.startsWith('---')
              ? 'del'
              : line.startsWith('@@')
                ? 'hunk'
                : 'ctx'
        return (
          <div
            key={i}
            className={cn(
              'px-3 py-0.5 whitespace-pre',
              kind === 'add' && 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
              kind === 'del' && 'bg-destructive/10 text-destructive',
              kind === 'hunk' && 'text-sky-600 dark:text-sky-400',
              kind === 'ctx' && 'text-foreground/80',
            )}
          >
            {line || ' '}
          </div>
        )
      })}
    </pre>
  )
}

function ReadRenderer({ part }: ToolRendererProps) {
  const detail = part.detail?.kind === 'read' ? part.detail : null
  const range = detail?.range ? `:${detail.range.startLine}-${detail.range.endLine}` : ''
  const path = detail?.path
  const body = part.result?.summary
    ? renderBody(<ResultBlock summary={part.result.summary} error={part.result.error} />)
    : undefined
  return (
    <ToolRow
      icon={<IconFile />}
      title={part.title ?? 'Read'}
      subtitle={path ? `${path}${range}` : undefined}
      status={part.status as ToolRowStatus}
      body={body}
    />
  )
}

function SearchRenderer({ part }: ToolRendererProps) {
  const detail = part.detail?.kind === 'search' ? part.detail : null
  const q = detail ? `${detail.isRegex ? '/' : '"'}${detail.query}${detail.isRegex ? '/' : '"'}` : undefined
  const body = renderBody(
    <>
      {detail?.scope && <p className="font-mono text-[11px] text-muted-foreground">scope: {detail.scope}</p>}
      <ResultBlock summary={part.result?.summary} error={part.result?.error} />
      {part.locations && <Locations locations={part.locations} />}
    </>,
  )
  return (
    <ToolRow
      icon={<IconSearch />}
      title={part.title ?? 'Search'}
      subtitle={q}
      status={part.status as ToolRowStatus}
      body={body}
    />
  )
}

function FetchRenderer({ part }: ToolRendererProps) {
  const detail = part.detail?.kind === 'fetch' ? part.detail : null
  const body = renderBody(<ResultBlock summary={part.result?.summary} error={part.result?.error} />)
  return (
    <ToolRow
      icon={<IconGlobe />}
      title={part.title ?? detail?.method ?? 'Fetch'}
      subtitle={detail?.url}
      status={part.status as ToolRowStatus}
      body={part.result?.summary || part.result?.error ? body : undefined}
    />
  )
}

function TerminalRenderer({ part }: ToolRendererProps) {
  const detail = part.detail?.kind === 'terminal' ? part.detail : null
  const body = renderBody(
    <>
      {detail?.terminalId && (
        <p className="font-mono text-[11px] text-muted-foreground">terminal: {detail.terminalId}</p>
      )}
      <ResultBlock summary={part.result?.summary} error={part.result?.error} />
    </>,
  )
  return (
    <ToolRow
      icon={<IconTerminal />}
      title={part.title ?? 'Terminal'}
      subtitle={detail?.label}
      status={part.status as ToolRowStatus}
      body={body}
    />
  )
}

function ThinkRenderer({ part }: ToolRendererProps) {
  const detail = part.detail?.kind === 'think' ? part.detail : null
  const body = part.result?.summary ? renderBody(<ResultBlock summary={part.result.summary} />) : undefined
  return (
    <ToolRow
      icon={<IconBrain />}
      title={part.title ?? 'Think'}
      subtitle={detail?.topic}
      status={part.status as ToolRowStatus}
      body={body}
    />
  )
}

function FallbackRenderer({ part }: ToolRendererProps) {
  const name = part.detail?.kind === 'other' ? part.detail.toolName : (part.title ?? part.type)
  const body = renderBody(<ResultBlock summary={part.result?.summary} error={part.result?.error} />)
  return (
    <ToolRow
      title={name}
      status={part.status as ToolRowStatus}
      body={part.result?.summary || part.result?.error ? body : undefined}
    />
  )
}

/** Register the baseline renderers. Safe to call more than once; last wins. */
export function installDefaultToolRenderers(): void {
  registerToolRenderer('tool-execute', ShellRenderer)
  registerToolRenderer('tool-edit', DiffRenderer)
  registerToolRenderer('tool-read', ReadRenderer)
  registerToolRenderer('tool-search', SearchRenderer)
  registerToolRenderer('tool-fetch', FetchRenderer)
  registerToolRenderer('tool-terminal', TerminalRenderer)
  registerToolRenderer('tool-think', ThinkRenderer)
  registerToolRenderer('tool-delete', FallbackRenderer)
  registerToolRenderer('tool-move', FallbackRenderer)
  registerToolRenderer('tool-other', FallbackRenderer)
}
