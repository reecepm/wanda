export interface FilePatchInfo {
  patch: string
  oldPath: string
  newPath: string
  isNew: boolean
  isDeleted: boolean
}

export function splitAndParsePatch(fullPatch: string): FilePatchInfo[] {
  const files: FilePatchInfo[] = []
  let current = ''
  for (const line of fullPatch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      if (current) files.push(parsePatchInfo(current))
      current = `${line}\n`
    } else {
      current += `${line}\n`
    }
  }
  if (current.trim()) files.push(parsePatchInfo(current))
  return files
}

function parsePatchInfo(patch: string): FilePatchInfo {
  const m = patch.match(/^diff --git a\/(.+?) b\/(.+?)$/m)
  return {
    patch,
    oldPath: m?.[1] ?? '',
    newPath: m?.[2] ?? '',
    isNew: /^new file mode/m.test(patch),
    isDeleted: /^deleted file mode/m.test(patch),
  }
}
