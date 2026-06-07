// -----------------------------------------------------------------------------
// Markdown — thin wrapper around react-markdown with styles tuned for
// agent prose. Keeps the same feel as a plain paragraph; tables, checklists
// and fenced code get dedicated styling via the `.agent-prose` class.
// -----------------------------------------------------------------------------

import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '../cn'

const components: Components = {
  // Strip the default <p> wrapper margin; the wrapper handles rhythm.
  p: ({ children }) => <p>{children}</p>,
  code: ({ className, children, ...rest }) => {
    const isBlock = /language-/.test(className ?? '')
    if (isBlock) {
      return (
        <code className={cn('block font-mono text-[12px] leading-[1.55]', className)} {...rest}>
          {children}
        </code>
      )
    }
    return (
      <code className="rounded-sm bg-foreground/[0.08] px-[0.3em] py-[0.1em] font-mono text-[0.88em]" {...rest}>
        {children}
      </code>
    )
  },
  a: ({ children, ...rest }) => (
    <a
      className="text-foreground underline decoration-foreground/30 underline-offset-[3px] hover:decoration-foreground/70"
      target="_blank"
      rel="noreferrer"
      {...rest}
    >
      {children}
    </a>
  ),
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn('agent-prose', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  )
}
