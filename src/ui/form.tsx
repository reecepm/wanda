import { Field, FieldDescription, FieldError, FieldLabel } from '@/ui/field'

export type { FieldApi, FormApi } from '@tanstack/react-form'
export { useForm } from '@tanstack/react-form'

/** Check if a form field should display validation errors. */
export function isFieldInvalid(field: { state: { meta: { isTouched: boolean; isValid: boolean } } }): boolean {
  return field.state.meta.isTouched && !field.state.meta.isValid
}

/** Normalize TanStack Form validation errors to FieldError format. */
export function normalizeErrors(errors: ReadonlyArray<unknown>): Array<{ message?: string }> {
  if (!errors?.length) return []
  return errors.map((e) => {
    if (typeof e === 'string') return { message: e }
    if (e && typeof e === 'object' && 'message' in e) return e as { message?: string }
    return { message: String(e) }
  })
}

/**
 * Wraps a form field with consistent layout: label, description, and error display.
 * Use inside a `form.Field` render prop.
 *
 * @example
 * ```tsx
 * <form.Field
 *   name="title"
 *   children={(field) => (
 *     <FormField field={field} label="Title" description="A short title">
 *       <Input
 *         id={field.name}
 *         value={field.state.value}
 *         onBlur={field.handleBlur}
 *         onChange={(e) => field.handleChange(e.target.value)}
 *         aria-invalid={isFieldInvalid(field)}
 *       />
 *     </FormField>
 *   )}
 * />
 * ```
 */
interface FormFieldProps {
  field: {
    name: string
    state: {
      meta: {
        isTouched: boolean
        isValid: boolean
        errors: ReadonlyArray<unknown>
      }
    }
  }
  label?: React.ReactNode
  description?: React.ReactNode
  orientation?: 'vertical' | 'horizontal' | 'responsive'
  children: React.ReactNode
}

export function FormField({ field, label, description, orientation, children }: FormFieldProps) {
  const invalid = isFieldInvalid(field)
  return (
    <Field data-invalid={invalid} orientation={orientation}>
      {label && <FieldLabel htmlFor={field.name}>{label}</FieldLabel>}
      {children}
      {description && <FieldDescription>{description}</FieldDescription>}
      {invalid && <FieldError errors={normalizeErrors(field.state.meta.errors)} />}
    </Field>
  )
}
