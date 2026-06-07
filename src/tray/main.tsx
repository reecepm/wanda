import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createQueryClient } from '@/shared/query-client'
import { TooltipProvider } from '@/ui/tooltip'
import { TrayApp } from './tray-app'

import '../index.css'

const queryClient = createQueryClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delay={250}>
        <TrayApp />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
)
