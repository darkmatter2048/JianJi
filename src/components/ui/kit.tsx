import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as SelectPrimitive from '@radix-ui/react-select'
import * as SliderPrimitive from '@radix-ui/react-slider'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { Check, ChevronDown, ChevronRight, X } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { forwardRef, useState } from 'react'

/**
 * The kit: Radix does the behaviour (focus traps, roving tabs, keyboard on a
 * slider, aria wiring) and `kit.css` does the look. Everything the editor shows
 * is built from these, so the whole app moves together when the tokens change.
 */

/* --------------------------------------------------------------- buttons -- */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'ghost' | 'outline' | 'danger'
  size?: 'md' | 'sm'
  /** Renders the "on" state for ghost tools (网格开着, 摄像机视角…). */
  active?: boolean
  round?: boolean
  icon?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', size = 'md', active, round, icon, className = '', children, ...rest },
  ref,
) {
  const classes = [
    'ui-btn',
    `ui-btn--${variant}`,
    size === 'sm' ? 'ui-btn--sm' : '',
    round ? 'ui-btn--round' : '',
    active ? 'ui-btn--on' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <button type="button" ref={ref} className={classes} {...rest}>
      {icon}
      {children}
    </button>
  )
})

/** A square button that only holds a glyph — the toolbars are made of these. */
export const IconButton = forwardRef<
  HTMLButtonElement,
  Omit<ButtonProps, 'icon' | 'children'> & { label: string; children: ReactNode }
>(function IconButton({ label, children, size = 'md', ...rest }, ref) {
  return (
    <Button
      ref={ref}
      aria-label={label}
      size={size}
      className={`ui-btn--icon ${rest.className ?? ''}`}
      {...rest}
    >
      {children}
    </Button>
  )
})

/* -------------------------------------------------------------- tooltips -- */

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={320} skipDelayDuration={120}>
      {children}
    </TooltipPrimitive.Provider>
  )
}

/**
 * Wrap anything in a tooltip. Used on every icon-only control, so the meaning of
 * a glyph is never a guess.
 */
export function Tip({
  label,
  side = 'top',
  children,
}: {
  label: ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  children: ReactNode
}) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content className="ui-tip" side={side} sideOffset={6}>
          {label}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}

/* ------------------------------------------------------------------ tabs -- */

export const Tabs = TabsPrimitive.Root

export function TabList({ children }: { children: ReactNode }) {
  return <TabsPrimitive.List className="ui-tabs__list">{children}</TabsPrimitive.List>
}

export function Tab({ value, children }: { value: string; children: ReactNode }) {
  return (
    <TabsPrimitive.Trigger className="ui-tabs__trigger" value={value}>
      {children}
    </TabsPrimitive.Trigger>
  )
}

export function TabPanel({ value, children }: { value: string; children: ReactNode }) {
  return (
    <TabsPrimitive.Content className="ui-tabs__panel" value={value}>
      {children}
    </TabsPrimitive.Content>
  )
}

/* ---------------------------------------------------------------- dialog -- */

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close
export const DialogTitle = DialogPrimitive.Title

export function DialogContent({
  title,
  children,
  width,
  onClose,
}: {
  title: ReactNode
  children: ReactNode
  width?: number
  onClose?: () => void
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="ui-overlay" />
      <DialogPrimitive.Content
        className="ui-dialog"
        style={width ? { width: `min(${width}px, calc(100vw - 40px))` } : undefined}
      >
        <div className="ui-dialog__head">
          <DialogPrimitive.Title className="ui-dialog__title">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Close asChild>
            <IconButton label="关闭" variant="ghost" size="sm" onClick={onClose}>
              <X size={14} />
            </IconButton>
          </DialogPrimitive.Close>
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

/* ---------------------------------------------------------------- slider -- */

export function Slider({
  value,
  min,
  max,
  step = 0.01,
  onChange,
  ariaLabel,
}: {
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
  ariaLabel?: string
}) {
  return (
    <SliderPrimitive.Root
      className="ui-slider"
      value={[value]}
      min={min}
      max={max}
      step={step}
      onValueChange={(next) => onChange(next[0])}
    >
      <SliderPrimitive.Track className="ui-slider__track">
        <SliderPrimitive.Range className="ui-slider__range" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="ui-slider__thumb" aria-label={ariaLabel} />
    </SliderPrimitive.Root>
  )
}

/* ---------------------------------------------------------------- switch -- */

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
}) {
  return (
    <SwitchPrimitive.Root
      className="ui-switch"
      checked={checked}
      onCheckedChange={onChange}
      aria-label={label}
    >
      <SwitchPrimitive.Thumb className="ui-switch__thumb" />
    </SwitchPrimitive.Root>
  )
}

/* ---------------------------------------------------------------- select -- */

export function Select<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  width,
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
  ariaLabel?: string
  width?: number | string
}) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={(next) => onChange(next as T)}>
      <SelectPrimitive.Trigger
        className="ui-select__trigger"
        aria-label={ariaLabel}
        style={width ? { width } : undefined}
      >
        <SelectPrimitive.Value />
        <ChevronDown size={13} style={{ color: 'var(--text-2)', flex: 'none' }} />
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content className="ui-select__content" position="popper" sideOffset={4}>
          <SelectPrimitive.Viewport>
            {options.map((option) => (
              <SelectPrimitive.Item
                className="ui-select__item"
                key={option.value}
                value={option.value}
              >
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator>
                  <Check size={12} />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}

/* ------------------------------------------------------------ structure -- */

export function Field({
  label,
  hint,
  row,
  children,
}: {
  label?: ReactNode
  hint?: ReactNode
  row?: boolean
  children: ReactNode
}) {
  return (
    <div className={`ui-field${row ? ' ui-field--row' : ''}`}>
      {label ? <div className="ui-field__label">{label}</div> : null}
      {children}
      {hint ? <div className="ui-hint">{hint}</div> : null}
    </div>
  )
}

/** A collapsible block of the inspector: a title that folds its body away. */
export function Section({
  title,
  right,
  defaultOpen = true,
  onToggle,
  children,
}: {
  title: ReactNode
  right?: ReactNode
  defaultOpen?: boolean
  onToggle?: () => void
  children: ReactNode
}) {
  // Folds itself unless the caller drives it (`onToggle`).
  const [open, setOpen] = useState(defaultOpen)
  const isOpen = onToggle ? defaultOpen : open
  return (
    <div className="ui-section" data-open={isOpen}>
      <button
        type="button"
        className="ui-section__head"
        onClick={() => (onToggle ? onToggle() : setOpen((value) => !value))}
      >
        <ChevronRight className="ui-section__chevron" size={13} />
        <span>{title}</span>
        <span style={{ marginLeft: 'auto' }}>{right}</span>
      </button>
      {isOpen ? <div className="ui-section__body">{children}</div> : null}
    </div>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  wide,
}: {
  value: T
  options: Array<{ value: T; label: ReactNode }>
  onChange: (value: T) => void
  wide?: boolean
}) {
  return (
    <div className={`ui-seg${wide ? ' ui-seg--wide' : ''}`}>
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          className="ui-seg__item"
          data-on={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function Badge({ children, accent }: { children: ReactNode; accent?: boolean }) {
  return <span className={`ui-badge${accent ? ' ui-badge--accent' : ''}`}>{children}</span>
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="ui-empty">{children}</div>
}

export function Divider() {
  return <div className="ui-divider" />
}
