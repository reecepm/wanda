// Minimal glob matcher used to detect auto-generated files in the diff
// and review viewers. Supports the subset actually used by .gitattributes
// and typical user configs:
//
//   *         — any run of characters except `/`
//   **        — any run of characters including `/`
//   ?         — a single character except `/`
//   [abc]     — character class
//   path/to/* — matches files in path/to, not nested
//
// Patterns with no slash match against the filename only (gitattributes
// semantics). Patterns with slashes match against the full path.

function globToRegExp(pattern: string): RegExp {
  let re = ''
  let i = 0
  while (i < pattern.length) {
    const ch = pattern[i]
    if (ch === undefined) break
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        // ** — match anything including slashes
        re += '.*'
        i += 2
        // Consume trailing slash in pattern like "**/foo" so it doesn't
        // require a leading slash in the input.
        if (pattern[i] === '/') i++
      } else {
        // * — match anything but slashes
        re += '[^/]*'
        i++
      }
    } else if (ch === '?') {
      re += '[^/]'
      i++
    } else if (ch === '[') {
      // character class — pass through mostly verbatim
      let j = i + 1
      while (j < pattern.length && pattern[j] !== ']') j++
      if (j < pattern.length) {
        re += pattern.slice(i, j + 1)
        i = j + 1
      } else {
        re += '\\['
        i++
      }
    } else if ('\\^$.|+(){}'.includes(ch)) {
      re += `\\${ch}`
      i++
    } else {
      re += ch
      i++
    }
  }
  return new RegExp(`^${re}$`)
}

export function matchesGlob(filePath: string, pattern: string): boolean {
  const re = globToRegExp(pattern)
  // gitattributes: patterns without a slash match the basename only
  if (!pattern.includes('/')) {
    const basename = filePath.split('/').pop() ?? filePath
    return re.test(basename)
  }
  // Strip leading ./ or / for consistency
  const normalized = filePath.replace(/^\.?\/+/, '')
  return re.test(normalized)
}

export function matchesAnyGlob(filePath: string, patterns: string[]): boolean {
  for (const p of patterns) {
    if (matchesGlob(filePath, p)) return true
  }
  return false
}
