import type { ReactNode } from 'react'
import { cn } from '@/shared/utils'
import { TopBarActions } from './topbar'

function ContentTopBarRoot({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <TopBarActions>
      <div data-wanda-content-top-bar="" className={cn('flex items-center gap-2 flex-1 min-w-0', className)}>
        {children}
      </div>
    </TopBarActions>
  )
}

function ContentTopBarLeft({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('no-drag flex items-center gap-2 min-w-0', className)}>{children}</div>
}

function ContentTopBarRight({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('no-drag flex items-center gap-1 ml-auto', className)}>{children}</div>
}

export const ContentTopBar = Object.assign(ContentTopBarRoot, {
  Left: ContentTopBarLeft,
  Right: ContentTopBarRight,
})
