// TanStack Query keys for the paired-servers surface.
//
// Kept in a standalone module so the hooks + downstream consumers (anything
// that needs to invalidate after a side-effect) share one source of truth.

export const serversQueryKeys = {
  all: ['servers'] as const,
  list: () => ['servers', 'list'] as const,
  capabilities: (id: string) => ['servers', 'capabilities', id] as const,
} as const
