import os from 'node:os'
import type { AppRouterDeps } from '../index'

export function systemRoutes({ orpc, selectDirectory }: AppRouterDeps) {
  return {
    getHomeDir: orpc.handler(() => os.homedir()),

    selectDirectory: orpc.handler(selectDirectory),

    stats: orpc.handler(() => {
      const mem = process.memoryUsage()
      const uptime = process.uptime()
      return {
        memoryMB: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
        rssMB: Math.round(mem.rss / 1024 / 1024),
        uptimeSeconds: Math.round(uptime),
        platform: process.platform,
        nodeVersion: process.version,
        cpuCount: os.cpus().length,
        freeMemoryMB: Math.round(os.freemem() / 1024 / 1024),
        totalMemoryMB: Math.round(os.totalmem() / 1024 / 1024),
      }
    }),
  }
}
