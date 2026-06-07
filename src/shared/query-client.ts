import { QueryClient } from '@tanstack/react-query'

// Shared QueryClient factory.
//
// Both renderer entries (the main window and the tray) build their client
// here so query behavior stays identical across windows. The defaults are
// tuned for a DESKTOP app talking to a LOCAL server:
//
//   * refetchOnWindowFocus: off — focus thrash is meaningless against a
//     local socket, and live data is already kept fresh by WS push
//     invalidation (`onOrpcInvalidate` / `onPodStatusChange`) plus the
//     explicit `refetchInterval` pollers individual queries opt into.
//   * staleTime: a small baseline so back-to-back mounts don't double-fetch.
//     Queries that need fresher (or longer-lived) data set their own
//     `staleTime`, which overrides this default.
//   * retry: one attempt — a failed call to the local server rarely recovers
//     with extra exponential-backoff tries. Queries override where needed.

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  })
}
