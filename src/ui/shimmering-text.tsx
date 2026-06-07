export function ShimmeringText({ text, className }: { text: string; className?: string }) {
  return (
    <span
      className={`inline-block bg-[length:200%_100%] bg-clip-text text-transparent animate-[shimmer_2.5s_ease-in-out_infinite] ${className ?? ''}`}
      style={{
        backgroundImage:
          'linear-gradient(90deg, rgb(161 161 170) 0%, rgb(244 244 245) 40%, rgb(244 244 245) 60%, rgb(161 161 170) 100%)',
      }}
    >
      {text}
    </span>
  )
}
