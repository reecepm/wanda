import {
  Combobox,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxItem,
  type ComboboxItemProps,
  ComboboxPopover,
  ComboboxProvider,
  Portal,
  useComboboxContext,
  useComboboxStore,
} from '@ariakit/react'
import { filterWords } from '@platejs/combobox'
import { type UseComboboxInputResult, useComboboxInput, useHTMLInputCursorState } from '@platejs/combobox/react'
import type { Point, TElement } from 'platejs'
import { useComposedRef, useEditorRef } from 'platejs/react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/shared/utils'

type FilterFn = (
  item: { value: string; group?: string; keywords?: string[]; label?: string },
  search: string,
) => boolean

type InlineComboboxContextValue = {
  filter: FilterFn | false
  inputProps: UseComboboxInputResult['props']
  inputRef: React.RefObject<HTMLInputElement | null>
  removeInput: UseComboboxInputResult['removeInput']
  showTrigger: boolean
  trigger: string
  setHasEmpty: (hasEmpty: boolean) => void
}

const InlineComboboxContext = createContext<InlineComboboxContextValue | null>(null)

function useInlineComboboxContext(): InlineComboboxContextValue {
  const ctx = useContext(InlineComboboxContext)
  if (!ctx) throw new Error('InlineCombobox.* must render inside <InlineCombobox>')
  return ctx
}

const defaultFilter: FilterFn = ({ group, keywords = [], label, value }, search) => {
  const uniqueTerms = new Set([value, ...keywords, group, label].filter(Boolean))
  return Array.from(uniqueTerms).some((keyword) => filterWords(keyword!, search))
}

type InlineComboboxProps = {
  children: React.ReactNode
  element: TElement
  trigger: string
  filter?: FilterFn | false
  hideWhenNoValue?: boolean
  showTrigger?: boolean
  value?: string
  setValue?: (value: string) => void
}

function InlineCombobox({
  children,
  element,
  filter = defaultFilter,
  hideWhenNoValue = false,
  setValue: setValueProp,
  showTrigger = true,
  trigger,
  value: valueProp,
}: InlineComboboxProps) {
  const editor = useEditorRef()
  const inputRef = useRef<HTMLInputElement>(null)
  const cursorState = useHTMLInputCursorState(inputRef)

  const [valueState, setValueState] = useState('')
  const hasValueProp = valueProp !== undefined
  const value = hasValueProp ? valueProp : valueState

  const setValue = useCallback(
    (newValue: string) => {
      setValueProp?.(newValue)
      if (!hasValueProp) {
        setValueState(newValue)
      }
    },
    [setValueProp, hasValueProp],
  )

  const insertPoint = useRef<Point | null>(null)

  useEffect(() => {
    const path = editor.api.findPath(element)
    if (!path) return
    const point = editor.api.before(path)
    if (!point) return
    const pointRef = editor.api.pointRef(point)
    insertPoint.current = pointRef.current
    return () => {
      pointRef.unref()
    }
  }, [editor, element])

  const { props: inputProps, removeInput } = useComboboxInput({
    cancelInputOnBlur: true,
    cursorState,
    autoFocus: true,
    ref: inputRef,
    onCancelInput: (cause) => {
      if (cause !== 'backspace') {
        editor.tf.insertText(trigger + value, {
          at: insertPoint?.current ?? undefined,
        })
      }
      if (cause === 'arrowLeft' || cause === 'arrowRight') {
        editor.tf.move({
          distance: 1,
          reverse: cause === 'arrowLeft',
        })
      }
    },
  })

  const [hasEmpty, setHasEmpty] = useState(false)

  const contextValue: InlineComboboxContextValue = useMemo(
    () => ({
      filter,
      inputProps,
      inputRef,
      removeInput,
      setHasEmpty,
      showTrigger,
      trigger,
    }),
    [trigger, showTrigger, filter, inputRef, inputProps, removeInput, setHasEmpty],
  )

  const store = useComboboxStore({
    setValue: (newValue) => setValue(newValue),
  })

  const items = store.useState('items')

  useEffect(() => {
    if (!store.getState().activeId) {
      store.setActiveId(store.first())
    }
  }, [items, store])

  return (
    <span contentEditable={false}>
      <ComboboxProvider open={(items.length > 0 || hasEmpty) && (!hideWhenNoValue || value.length > 0)} store={store}>
        <InlineComboboxContext.Provider value={contextValue}>{children}</InlineComboboxContext.Provider>
      </ComboboxProvider>
    </span>
  )
}

function InlineComboboxInput({
  className,
  ref: propRef,
  ...props
}: React.HTMLAttributes<HTMLInputElement> & {
  ref?: React.RefObject<HTMLInputElement | null>
}) {
  const { inputProps, inputRef: contextRef, showTrigger, trigger } = useInlineComboboxContext()
  const store = useComboboxContext()!
  const value = store.useState('value')
  const ref = useComposedRef(propRef, contextRef)

  return (
    <>
      {showTrigger && <span className="text-zinc-500">{trigger}</span>}
      <span className="relative min-h-[1lh]">
        <span className="invisible overflow-hidden text-nowrap" aria-hidden="true">
          {value || '\u200B'}
        </span>
        <Combobox
          ref={ref}
          className={cn('absolute top-0 left-0 size-full bg-transparent outline-none', className)}
          value={value}
          autoSelect
          {...inputProps}
          {...props}
        />
      </span>
    </>
  )
}

function InlineComboboxContent({ className, ...props }: React.ComponentProps<typeof ComboboxPopover>) {
  return (
    <Portal>
      <ComboboxPopover
        className={cn(
          'z-[9999] max-h-48 min-w-[220px] overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl py-1',
          className,
        )}
        style={{ width: 'max-content' }}
        {...props}
      />
    </Portal>
  )
}

function InlineComboboxItem({
  className,
  focusEditor = true,
  group,
  keywords,
  label,
  onClick,
  ...props
}: {
  focusEditor?: boolean
  group?: string
  keywords?: string[]
  label?: string
} & ComboboxItemProps &
  Required<Pick<ComboboxItemProps, 'value'>>) {
  const { value } = props
  const { filter, removeInput } = useInlineComboboxContext()
  const store = useComboboxContext()!
  const search = filter && store.useState('value')

  const visible = useMemo(
    () => !filter || filter({ group, keywords, label, value }, search as string),
    [filter, group, keywords, label, value, search],
  )

  if (!visible) return null

  return (
    <ComboboxItem
      className={cn(
        'relative flex items-center gap-2 w-full px-3 py-1.5 text-left text-[11px] text-zinc-300 select-none rounded-sm cursor-pointer transition-colors hover:bg-zinc-800 data-[active-item=true]:bg-zinc-800',
        className,
      )}
      onClick={(event) => {
        removeInput(focusEditor)
        onClick?.(event)
      }}
      {...props}
    />
  )
}

function InlineComboboxEmpty({ children, className }: React.HTMLAttributes<HTMLDivElement>) {
  const { setHasEmpty } = useInlineComboboxContext()
  const store = useComboboxContext()!
  const items = store.useState('items')

  useEffect(() => {
    setHasEmpty(true)
    return () => {
      setHasEmpty(false)
    }
  }, [setHasEmpty])

  if (items.length > 0) return null

  return <div className={cn('px-3 py-1.5 text-[11px] text-zinc-500', className)}>{children}</div>
}

function InlineComboboxGroup({ className, ...props }: React.ComponentProps<typeof ComboboxGroup>) {
  return (
    <ComboboxGroup
      {...props}
      className={cn('hidden not-last:border-b border-zinc-800 py-1 [&:has([role=option])]:block', className)}
    />
  )
}

function InlineComboboxGroupLabel({ className, ...props }: React.ComponentProps<typeof ComboboxGroupLabel>) {
  return (
    <ComboboxGroupLabel {...props} className={cn('mt-1 mb-1 px-3 text-[9px] font-medium text-zinc-500', className)} />
  )
}

export {
  InlineCombobox,
  InlineComboboxContent,
  InlineComboboxEmpty,
  InlineComboboxGroup,
  InlineComboboxGroupLabel,
  InlineComboboxInput,
  InlineComboboxItem,
}
