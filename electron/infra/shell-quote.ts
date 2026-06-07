/**
 * Single-quote a value for safe interpolation into a `/bin/sh` command string.
 *
 * Values made entirely of shell-safe characters are returned verbatim for
 * readability; anything else (spaces, `$`, backticks, `;`, `|`, `&`, globs, …)
 * is wrapped in single quotes with embedded quotes escaped via the
 * `'"'"'` idiom, so no client- or data-derived value can break out of its
 * argument.
 */
export function shellQuote(s: string): string {
  if (/^[A-Za-z0-9_\-./:+@=,%]+$/.test(s)) return s
  return `'${s.replace(/'/g, `'"'"'`)}'`
}
