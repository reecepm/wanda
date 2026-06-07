import { MockupFrame, MockupLines } from './mockup-frame'

/**
 * "Columns" view type: vertical rows, each subdivided into flexible columns.
 * Every cell carries a few skeleton lines so it reads as a mini pane.
 */
export function ColumnsMockup({ className, active }: { className?: string; active?: boolean }) {
  const rows: { width: number; widths: string[] }[][] = [
    [
      { width: 60, widths: ['70%', '45%'] },
      { width: 40, widths: ['60%', '35%'] },
    ],
    [
      { width: 33, widths: ['60%'] },
      { width: 33, widths: ['70%'] },
      { width: 34, widths: ['50%'] },
    ],
    [
      { width: 50, widths: ['65%', '40%'] },
      { width: 50, widths: ['55%', '45%'] },
    ],
  ]
  return (
    <MockupFrame className={className} active={active}>
      <div className="flex h-full flex-col gap-0.5">
        {rows.map((cols, rIdx) => (
          <div key={rIdx} className="flex flex-1 gap-0.5">
            {cols.map((col, cIdx) => (
              <div
                key={cIdx}
                style={{ width: `${col.width}%` }}
                className={`rounded-sm border ${
                  active && rIdx === 0 && cIdx === 0
                    ? 'border-amber-500/50 bg-amber-500/10'
                    : 'border-zinc-800 bg-zinc-900/70'
                }`}
              >
                <MockupLines widths={col.widths} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </MockupFrame>
  )
}
