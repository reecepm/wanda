import { log as evlog, initLogger } from 'evlog'

initLogger({
  env: { service: 'wanda' },
  sampling: {
    rates: {
      debug: process.env.WANDA_DEBUG ? 100 : 0,
      info: 100,
      warn: 100,
      error: 100,
    },
  },
})

function formatArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (a instanceof Error) return a.message
      if (typeof a === 'object' && a !== null) return JSON.stringify(a)
      return String(a)
    })
    .join(' ')
}

function tagged(tag: string) {
  return {
    info: (...args: unknown[]) => evlog.info(tag, formatArgs(args)),
    warn: (...args: unknown[]) => evlog.warn(tag, formatArgs(args)),
    error: (...args: unknown[]) => evlog.error(tag, formatArgs(args)),
    debug: (...args: unknown[]) => evlog.debug(tag, formatArgs(args)),
  }
}

export const log = {
  pod: tagged('pod'),
  docker: tagged('docker'),
  slice: tagged('slice'),
  build: tagged('build'),
  environment: tagged('environment'),
  agent: tagged('agent'),
  scheduler: tagged('scheduler'),
  gc: tagged('gc'),
  mcp: tagged('mcp'),
  pty: tagged('pty'),
  target: tagged('target'),
  daemon: tagged('daemon'),
  db: tagged('db'),
  main: tagged('main'),
  router: tagged('router'),
  repo: tagged('repo'),
}
