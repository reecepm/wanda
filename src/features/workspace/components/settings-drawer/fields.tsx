import type { ReactNode } from 'react'
import { RiFolderOpenLine } from '@/lib/icons'
import { Button } from '@/ui/button'

const inputClass =
  'h-7 rounded-md border border-zinc-700 bg-zinc-800 px-2 text-xs text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-zinc-500'
const monoInputClass = `${inputClass} font-mono`
const textareaClass =
  'rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-zinc-500 font-mono resize-none'

export function SectionHeading({ children }: { children: ReactNode }) {
  return <h4 className="text-xs font-medium text-zinc-400 mb-3">{children}</h4>
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return <label className="text-xs text-zinc-400">{children}</label>
}

export function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return <p className="text-[10px] text-red-400">{message}</p>
}

export function FieldHint({ children }: { children: ReactNode }) {
  return <p className="text-[10px] text-zinc-600">{children}</p>
}

interface FieldProps {
  label: ReactNode
  error?: string
  hint?: ReactNode
  children: ReactNode
}

export function Field({ label, error, hint, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <FieldLabel>{label}</FieldLabel>
      {children}
      <FieldError message={error} />
      {hint && <FieldHint>{hint}</FieldHint>}
    </div>
  )
}

interface TextFieldProps {
  label: ReactNode
  value: string
  onChange: (value: string) => void
  placeholder?: string
  error?: string
  hint?: ReactNode
  mono?: boolean
  onBlur?: () => void
}

export function TextField({ label, value, onChange, placeholder, error, hint, mono, onBlur }: TextFieldProps) {
  return (
    <Field label={label} error={error} hint={hint}>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        className={mono ? monoInputClass : inputClass}
      />
    </Field>
  )
}

interface BrowseFieldProps {
  label: ReactNode
  value: string
  onChange: (value: string) => void
  onBrowse: () => void
  placeholder?: string
  error?: string
  target?: string | null
  onBlur?: () => void
}

export function BrowseField({
  label,
  value,
  onChange,
  onBrowse,
  placeholder,
  error,
  target,
  onBlur,
}: BrowseFieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <FieldLabel>{label}</FieldLabel>
      <div className="flex gap-1">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          placeholder={placeholder}
          className={`flex-1 ${monoInputClass}`}
        />
        <Button type="button" variant="outline" size="icon-sm" onClick={onBrowse}>
          <RiFolderOpenLine className="h-3.5 w-3.5" />
        </Button>
      </div>
      <FieldError message={error} />
      {target && <p className="text-[10px] text-zinc-500 font-mono truncate">&rarr; {target}</p>}
    </div>
  )
}

interface TextAreaFieldProps {
  label: ReactNode
  value: string
  onChange: (value: string) => void
  placeholder?: string
  rows?: number
  hint?: ReactNode
}

export function TextAreaField({ label, value, onChange, placeholder, rows = 2, hint }: TextAreaFieldProps) {
  return (
    <Field label={label} hint={hint}>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className={textareaClass}
      />
    </Field>
  )
}
