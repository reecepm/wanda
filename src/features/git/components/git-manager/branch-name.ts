// A user types a human-readable display name (with spaces); we derive the
// branch-safe slug from it: lowercase, non-alphanumeric runs collapse to a
// single hyphen, leading/trailing hyphens trimmed.
export function toBranchName(displayName: string): string {
  return displayName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, '-')
    .replace(/(^-|-$)/g, '')
}
