interface LineDeltaProps {
  additions: number
  deletions: number
  className?: string
}

export function LineDelta({ additions, deletions, className }: LineDeltaProps) {
  if (additions === 0 && deletions === 0) return null
  return (
    <span className={`font-mono tabular-nums ${className ?? 'text-[10px]'}`}>
      <span className="text-emerald-400">+{additions}</span>
      <span className="text-zinc-600 mx-0.5">/</span>
      <span className="text-red-400">-{deletions}</span>
    </span>
  )
}
