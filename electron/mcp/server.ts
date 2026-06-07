import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { DOCS } from './docs.js'
import type { WandaRuntime } from './runtime.js'
import { NAMESPACE_DOCS } from './runtime.js'
import { executeSandboxed } from './sandbox.js'

const TOOL_DESCRIPTION = `Execute JavaScript with the \`wanda\` API. All methods are async.

Namespaces: workspaces, workspaceSettings, pods, podItems, views,
profiles, environments, dependencies, slices, targets, plans, agents, git, docker,
notifications, tasks, settings, app.

Discovery:
  wanda.help()              → list all namespaces with summaries
  wanda.<ns>.help()         → list all methods with signatures

Quick examples:
  const ws = await wanda.workspaces.list()
  const pod = await wanda.pods.get("pod-id")
  await wanda.tasks.list({})

The last expression value is returned. Use console.log() for intermediate output.`

function extractExampleArgs(sig: string): string {
  const match = sig.match(/\(([^)]*)\)/)
  const inner = match?.[1]?.trim()
  if (!inner) return ''
  if (inner.startsWith('{')) {
    const fields = inner
      .replace(/[{}]/g, '')
      .split(',')
      .map((f) => f.trim().replace(/\?$/, ''))
    return `{ ${fields.map((f) => `${f}: "..."`).join(', ')} }`
  }
  return inner
    .split(',')
    .map((p) => `"${p.trim()}"`)
    .join(', ')
}

export function createMcpServer(runtime: WandaRuntime) {
  const server = new McpServer({ name: 'wanda', version: '0.1.0' })

  server.tool('execute', TOOL_DESCRIPTION, { code: z.string() }, async ({ code }) => {
    const { result, logs } = await executeSandboxed(code, runtime)

    const parts: string[] = []
    if (logs.length > 0) {
      parts.push(logs.join('\n'))
    }
    if (result !== undefined) {
      parts.push(JSON.stringify(result))
    }

    return {
      content: [{ type: 'text' as const, text: parts.join('\n\n') || '(no output)' }],
    }
  })

  server.tool(
    'search',
    'Search Wanda API methods by keyword. Returns matching methods with signatures, descriptions, and example execute() calls.',
    { query: z.string() },
    async ({ query }) => {
      const terms = query.toLowerCase().split(/\s+/)
      const results: Array<{ namespace: string; method: string; description: string; example: string }> = []

      for (const [ns, docs] of Object.entries(NAMESPACE_DOCS)) {
        const nsMatch = terms.some((t) => ns.toLowerCase().includes(t) || docs.description.toLowerCase().includes(t))
        for (const [sig, desc] of Object.entries(docs.methods)) {
          const haystack = `${ns} ${sig} ${desc}`.toLowerCase()
          if (nsMatch || terms.every((t) => haystack.includes(t))) {
            const methodName = sig.replace(/\(.*/, '')
            results.push({
              namespace: ns,
              method: sig,
              description: desc,
              example: `await wanda.${ns}.${methodName}(${extractExampleArgs(sig)})`,
            })
          }
        }
      }

      return {
        content: [
          {
            type: 'text' as const,
            text:
              results.length > 0
                ? JSON.stringify(results.slice(0, 15))
                : 'No methods found. Try broader terms or call wanda.help() for all namespaces.',
          },
        ],
      }
    },
  )

  server.tool(
    'docs-search',
    'Search Wanda documentation for concepts, guides, and recipes. Use when you need to understand how things work or how to accomplish multi-step tasks.',
    { query: z.string() },
    async ({ query }) => {
      const terms = query.toLowerCase().split(/\s+/)
      const scored = DOCS.map((doc) => {
        const haystack = `${doc.title} ${doc.keywords.join(' ')}`.toLowerCase()
        const score = terms.filter((t) => haystack.includes(t)).length
        return { doc, score }
      })
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)

      if (scored.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'No docs found. Try: pods, environments, targets, slices, profiles, git, dependencies.',
            },
          ],
        }
      }

      const text = scored.map(({ doc }) => `## ${doc.title}\n${doc.content}`).join('\n\n---\n\n')
      return { content: [{ type: 'text' as const, text }] }
    },
  )

  return server
}
