import type { Preview } from '@storybook/react-vite'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import '../src/index.css'

// One QueryClient per Storybook session — matches what main.tsx provides
// at runtime so components that call hooks like `useGitStatus` work in
// stories even though the oRPC backend isn't reachable.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
  },
})

const preview: Preview = {
  parameters: {
    backgrounds: { disable: true },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      test: 'todo',
    },
  },
  decorators: [
    (Story) => {
      React.useEffect(() => {
        document.documentElement.classList.add('dark')
        return () => document.documentElement.classList.remove('dark')
      }, [])
      return (
        <QueryClientProvider client={queryClient}>
          <div className="bg-zinc-950 text-zinc-50 p-4 min-h-screen">
            <Story />
          </div>
        </QueryClientProvider>
      )
    },
  ],
}

export default preview
