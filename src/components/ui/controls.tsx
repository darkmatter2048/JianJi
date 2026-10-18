import type { ReactNode } from 'react'
import { round } from '../../lib/format'
import {
  Field,
  Section as KitSection,
  Select as KitSelect,
  Slider as KitSlider,
  Switch as KitSwitch,
} from './kit'

/**
 * The inspector's vocabulary, built on the kit: a labelled slider, a switch row,
 * a colour well, a text box. Anything that needs a new control composes these
 * rather than reaching for a raw `<input>`.
 */

export { Badge, Button, Empty, Tip } from './kit'

/** A collapsible block: the kit's Section, owning its own open state. */
export function Section({
  title,
  children,
  defaultOpen = true,
  right,
}: {
  title: string
  children: ReactNode
  defaultOpen?: boolean
  right?: ReactNode
}) {
  return (
    <KitSection title={title} right={right} defaultOpen={defaultOpen}>
      {children}
    </KitSection>
  )
}

export function Hint({ children }: { children: ReactNode }) {
  return <p className="ui-hint">{children}</p>
}

export function SliderField({
  label,
  value,
  onChange,
  min,
  max,
  step = 0.01,
  format,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  min: number
  max: number
  step?: number
  format?: (value: number) => string
}) {
  return (
    <Field label={label}>
      <div className="ui-field__row">
        <KitSlider value={value} min={min} max={max} step={step} onChange={onChange} />
        <span className="ui-field__value">{format ? format(value) : round(value, 2)}</span>
      </div>
    </Field>
  )
}

export function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <Field row label={label}>
      <KitSwitch checked={checked} onChange={onChange} label={label} />
    </Field>
  )
}

export function ColorField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <Field label={label}>
      <div className="ui-field__row">
        <input
          className="ui-input"
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <span className="ui-field__value" style={{ minWidth: 62 }}>
          {value.toUpperCase()}
        </span>
      </div>
    </Field>
  )
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  textarea,
  rows = 3,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  textarea?: boolean
  rows?: number
}) {
  return (
    <Field label={label}>
      {textarea ? (
        <textarea
          className="ui-textarea"
          rows={rows}
          value={value}
          placeholder={placeholder}
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          className="ui-input"
          value={value}
          placeholder={placeholder}
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  )
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
}) {
  return (
    <Field label={label}>
      <KitSelect value={value} options={options} onChange={onChange} ariaLabel={label} />
    </Field>
  )
}

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 0.01,
  suffix,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  suffix?: string
}) {
  return (
    <Field label={label}>
      <div className="ui-field__row">
        <input
          className="ui-input"
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        {suffix ? <span className="ui-field__value">{suffix}</span> : null}
      </div>
    </Field>
  )
}
