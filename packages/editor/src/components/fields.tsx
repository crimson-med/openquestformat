/**
 * Form primitives for the inspector.
 *
 * Text lands in the store as you type. Conditions land on blur, because half a
 * condition is a parse error and nobody wants to see one per keystroke.
 */
import {
  type Condition,
  type Objective,
  formatCompletion,
  formatCondition,
  parseCompletion,
  parseCondition,
} from '@oqf/core'
import { type ReactNode, useEffect, useId, useState } from 'react'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string
  hint?: string
  error?: string
  children: ReactNode
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is the caller's child
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint !== undefined && error === undefined ? (
        <span className="field-hint">{hint}</span>
      ) : null}
      {error !== undefined ? <span className="field-error">{error}</span> : null}
    </label>
  )
}

export function Section({
  title,
  action,
  children,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="section">
      <header className="section-head">
        <h3>{title}</h3>
        {action}
      </header>
      {children}
    </section>
  )
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  multiline,
  mono,
}: {
  label: string
  value: string | undefined
  onChange: (value: string | undefined) => void
  placeholder?: string
  hint?: string
  multiline?: boolean
  mono?: boolean
}) {
  const text = value ?? ''
  const emit = (next: string) => onChange(next === '' ? undefined : next)
  return (
    <Field label={label} hint={hint}>
      {multiline === true ? (
        <textarea
          className={mono === true ? 'input mono' : 'input'}
          value={text}
          rows={3}
          placeholder={placeholder}
          onChange={(event) => emit(event.target.value)}
        />
      ) : (
        <input
          className={mono === true ? 'input mono' : 'input'}
          value={text}
          placeholder={placeholder}
          onChange={(event) => emit(event.target.value)}
        />
      )}
    </Field>
  )
}

/** A text field that must not be empty, used for ids and titles. */
export function RequiredField({
  label,
  value,
  onChange,
  hint,
  mono,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  hint?: string
  mono?: boolean
}) {
  return (
    <Field label={label} hint={hint} error={value.trim() === '' ? 'Required' : undefined}>
      <input
        className={mono === true ? 'input mono' : 'input'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  )
}

export function NumberField({
  label,
  value,
  onChange,
  hint,
  min,
  placeholder,
}: {
  label: string
  value: number | undefined
  onChange: (value: number | undefined) => void
  hint?: string
  min?: number
  placeholder?: string
}) {
  return (
    <Field label={label} hint={hint}>
      <input
        className="input"
        type="number"
        min={min}
        placeholder={placeholder}
        value={value === undefined ? '' : String(value)}
        onChange={(event) => {
          const raw = event.target.value
          if (raw === '') {
            onChange(undefined)
            return
          }
          const parsed = Number(raw)
          if (!Number.isNaN(parsed)) onChange(parsed)
        }}
      />
    </Field>
  )
}

export function CheckField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string
  value: boolean | undefined
  onChange: (value: boolean | undefined) => void
  hint?: string
}) {
  const id = useId()
  return (
    <div className="field check">
      <input
        id={id}
        type="checkbox"
        checked={value === true}
        onChange={(event) => onChange(event.target.checked ? true : undefined)}
      />
      <label htmlFor={id}>
        {label}
        {hint !== undefined ? <span className="field-hint"> {hint}</span> : null}
      </label>
    </div>
  )
}

export function SelectField({
  label,
  value,
  options,
  onChange,
  empty,
  hint,
}: {
  label: string
  value: string | undefined
  options: Array<{ value: string; label: string }>
  onChange: (value: string | undefined) => void
  empty?: string
  hint?: string
}) {
  return (
    <Field label={label} hint={hint}>
      <select
        className="input"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value === '' ? undefined : event.target.value)}
      >
        {empty !== undefined ? <option value="">{empty}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  )
}

/** A condition, edited as infix text and parsed on blur. */
export function ConditionField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string
  value: Condition | undefined
  onChange: (value: Condition | undefined) => void
  hint?: string
}) {
  const canonical = value === undefined ? '' : formatCondition(value)
  const [text, setText] = useState(canonical)
  const [error, setError] = useState<string | undefined>(undefined)
  useEffect(() => {
    setText(canonical)
    setError(undefined)
  }, [canonical])

  const commit = () => {
    const trimmed = text.trim()
    if (trimmed === '') {
      setError(undefined)
      onChange(undefined)
      return
    }
    try {
      onChange(parseCondition(trimmed))
      setError(undefined)
    } catch (failure) {
      setError(errorMessage(failure))
    }
  }

  return (
    <Field label={label} hint={hint} error={error}>
      <input
        className="input mono"
        value={text}
        spellCheck={false}
        placeholder="flag.met_ines and count.fish >= 5"
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
      />
    </Field>
  )
}

/**
 * An objective and its condition as one cell, the way the file writes it:
 * `collect fish.rare 5 and flag.otter_agreed`.
 */
export function CompletionField({
  label,
  objective,
  condition,
  onChange,
  hint,
}: {
  label: string
  objective: Objective | undefined
  condition: Condition | undefined
  onChange: (parts: { objective?: Objective; condition?: Condition }) => void
  hint?: string
}) {
  const canonical = formatCompletion({ objective, condition })
  const [text, setText] = useState(canonical)
  const [error, setError] = useState<string | undefined>(undefined)
  useEffect(() => {
    setText(canonical)
    setError(undefined)
  }, [canonical])

  const commit = () => {
    const trimmed = text.trim()
    if (trimmed === '') {
      setError(undefined)
      onChange({})
      return
    }
    try {
      onChange(parseCompletion(trimmed))
      setError(undefined)
    } catch (failure) {
      setError(errorMessage(failure))
    }
  }

  return (
    <Field label={label} hint={hint} error={error}>
      <input
        className="input mono"
        value={text}
        spellCheck={false}
        placeholder="collect fish.rare 5 and flag.otter_agreed"
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
      />
    </Field>
  )
}

/** A set of ids picked from a catalog, rendered as toggles. */
export function PickerField({
  label,
  selected,
  options,
  onChange,
  hint,
  emptyNote,
}: {
  label: string
  selected: string[]
  options: Array<{ value: string; label: string }>
  onChange: (values: string[]) => void
  hint?: string
  emptyNote?: string
}) {
  return (
    <Field label={label} hint={hint}>
      {options.length === 0 ? (
        <p className="note">{emptyNote ?? 'Nothing to pick yet.'}</p>
      ) : (
        <div className="picker">
          {options.map((option) => {
            const on = selected.includes(option.value)
            return (
              <button
                key={option.value}
                type="button"
                className={on ? 'chip on' : 'chip'}
                onClick={() =>
                  onChange(
                    on
                      ? selected.filter((value) => value !== option.value)
                      : [...selected, option.value],
                  )
                }
              >
                {option.label}
              </button>
            )
          })}
        </div>
      )}
    </Field>
  )
}
