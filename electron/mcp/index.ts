import { readFileSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import { createRuntime } from './runtime.js'
import { createMcpServer } from './server.js'

// Resolve port — env var takes priority, then port file from either dot-dir.
// Remember which dot-dir supplied the port so the auth token is read from the
// same server instance.
let port = process.env.WANDA_PORT
let portDir: string | undefined
if (!port) {
  for (const dir of ['.wanda', '.wanda-dev']) {
    try {
      port = readFileSync(join(os.homedir(), dir, 'mcp-port'), 'utf-8').trim()
      if (port) {
        portDir = dir
        break
      }
    } catch {
      // port file not found
    }
  }
}

if (!port) {
  process.stderr.write(
    'WANDA_PORT not set and mcp-port not found in ~/.wanda or ~/.wanda-dev. Is the Wanda app running?\n',
  )
  process.exit(1)
}

// Resolve the RPC auth token. The Wanda server gates every /rpc call behind a
// Bearer session token — without it, data-plane calls (wanda.pods.*, etc.)
// come back Unauthorized while local-only tools (search/docs) still work. Env
// var wins; otherwise read the mcp-token file written alongside mcp-port.
let token = process.env.WANDA_TOKEN
if (!token) {
  for (const dir of portDir ? [portDir] : ['.wanda', '.wanda-dev']) {
    try {
      token = readFileSync(join(os.homedir(), dir, 'mcp-token'), 'utf-8').trim()
      if (token) break
    } catch {
      // token file not found
    }
  }
}
if (!token) {
  process.stderr.write(
    'WANDA_TOKEN not set and mcp-token not found; authenticated RPC calls (wanda.pods.*, etc.) will be rejected.\n',
  )
}

const link = new RPCLink({
  url: `http://127.0.0.1:${port}`,
  ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
})
const orpc = createORPCClient(link)

const runtime = createRuntime(orpc)
const server = createMcpServer(runtime)
const transport = new StdioServerTransport()
await server.connect(transport)
