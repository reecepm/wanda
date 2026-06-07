import path from 'node:path'
import type { ShellExecFn } from '../domains/git/controller'
import type { TargetManager } from '../targets/target-manager'

/** Dynamic import to avoid requiring Electron in test environments */
export async function selectDirectory(): Promise<string | null> {
  const { dialog } = await import('electron')
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
  })
  const [filePath] = result.filePaths
  if (result.canceled || !filePath) return null
  return filePath
}

/**
 * Open a file picker rooted at `cwd` and return a path **relative** to `cwd`.
 * Returns `null` if the user cancels or picks a file outside `cwd`.
 */
export async function selectMarkdownFile(cwd: string): Promise<string | null> {
  const { dialog } = await import('electron')
  const result = await dialog.showOpenDialog({
    defaultPath: cwd,
    properties: ['openFile'],
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown', 'mdx', 'mdown', 'mkd'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  })
  const [absPath] = result.filePaths
  if (result.canceled || !absPath) return null
  const rel = path.relative(path.resolve(cwd), path.resolve(absPath))
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null
  return rel
}

/** Resolve a shellExec function for a pod. Always routes to the local target. */
export function resolveShellExec(_pod: { cwd: string }, targetManager: TargetManager | undefined): ShellExecFn | null {
  if (!targetManager) return null
  const target = targetManager.getLocalTarget()
  if (target.status !== 'connected') return null
  return (opts) => target.shellExec(opts)
}
