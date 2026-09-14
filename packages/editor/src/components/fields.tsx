/**
 * Form primitives for the inspector.
 *
 * Text lands in the store as you type. Conditions are parsed on every keystroke
 * so the message shows at once, but they land in the store on blur or Enter,
 * because half a condition should never reach the document.
 */
import {
  type Condition,
  type Objective,
  formatCompletion,
  formatCondition,
  parseCompletion,
  parseCondition,
} from '@oqf/core'
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { Suggestion } from '../lib/suggest'
import '../styles/suggest.css'

/** Offers completions for the token ending at `caret`. See lib/suggest.ts. */
export type SuggestFn = (text: string, caret: number) => Suggestion[]

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

/**
 * Text that parses to a value: shown as its canonical spelling, parsed on every
 * keystroke for the inline message, committed on blur or Enter. With `suggest`
 * a listbox of completions opens under the input while there is something to
 * offer.
 */
function ParsedField<T>({
  label,
  hint,
  canonical,
  placeholder,
  parse,
  empty,
  onCommit,
  suggest,
}: {
  label: string
  hint?: string
  canonical: string
  placeholder: string
  parse: (trimmed: string) => T
  /** What an empty field commits. */
  empty: T
  onCommit: (value: T) => void
  suggest?: SuggestFn
}) {
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState(canonical)
  const [error, setError] = useState<string | undefined>(undefined)
  const [caret, setCaret] = useState(canonical.length)
  const [focused, setFocused] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [highlight, setHighlight] = useState(0)
  /** Where the caret goes once an accepted suggestion has rendered. */
  const [pendingCaret, setPendingCaret] = useState<number | undefined>(undefined)

  useEffect(() => {
    setText(canonical)
    setError(undefined)
    setDismissed(false)
  }, [canonical])

  useLayoutEffect(() => {
    if (pendingCaret === undefined) return
    inputRef.current?.setSelectionRange(pendingCaret, pendingCaret)
    setPendingCaret(undefined)
  }, [pendingCaret])

  const check = (next: string): string | undefined => {
    const trimmed = next.trim()
    if (trimmed === '') return undefined
    try {
      parse(trimmed)
      return undefined
    } catch (failure) {
      return errorMessage(failure)
    }
  }

  const update = (next: string, at: number) => {
    setText(next)
    setCaret(at)
    setError(check(next))
    setDismissed(false)
    setHighlight(0)
  }

  const commit = () => {
    const trimmed = text.trim()
    if (trimmed === '') {
      setError(undefined)
      onCommit(empty)
      return
    }
    try {
      onCommit(parse(trimmed))
      setError(undefined)
    } catch (failure) {
      setError(errorMessage(failure))
    }
  }

  const suggestions = focused && !dismissed && suggest !== undefined ? suggest(text, caret) : []
  const open = suggestions.length > 0
  const active = Math.min(highlight, Math.max(0, suggestions.length - 1))

  const accept = (entry: Suggestion) => {
    const next = text.slice(0, entry.range.start) + entry.insert + text.slice(entry.range.end)
    const at = entry.range.start + entry.insert.length
    setPendingCaret(at)
    update(next, at)
  }

  return (
    <Field label={label} hint={hint} error={error}>
      <div className="suggest-wrap">
        <input
          ref={inputRef}
          className="input mono"
          value={text}
          spellCheck={false}
          autoComplete="off"
          placeholder={placeholder}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open ? `${listId}-${active}` : undefined}
          onChange={(event) =>
            update(event.target.value, event.target.selectionStart ?? event.target.value.length)
          }
          onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? text.length)}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false)
            commit()
          }}
          onKeyDown={(event) => {
            if (open) {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setHighlight((active + 1) % suggestions.length)
                return
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setHighlight((active - 1 + suggestions.length) % suggestions.length)
                return
              }
              if (event.key === 'Enter' || event.key === 'Tab') {
                event.preventDefault()
                accept(suggestions[active])
                return
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                setDismissed(true)
                return
              }
            }
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
        />
        {open ? (
          // biome-ignore lint/a11y/useSemanticElements: a select cannot follow a typed combobox
          <div className="suggest-list" role="listbox" id={listId} tabIndex={-1}>
            {suggestions.map((entry, index) => (
              <SuggestOption
                key={`${entry.detail}:${entry.insert}`}
                id={`${listId}-${index}`}
                entry={entry}
                selected={index === active}
                onAccept={accept}
              />
            ))}
          </div>
        ) : null}
      </div>
    </Field>
  )
}

function SuggestOption({
  id,
  entry,
  selected,
  onAccept,
}: {
  id: string
  entry: Suggestion
  selected: boolean
  onAccept: (entry: Suggestion) => void
}) {
  return (
    <div
      id={id}
      className="suggest-option"
      // biome-ignore lint/a11y/useSemanticElements: an option of the typed combobox above
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      onMouseDown={(event) => {
        // Keep focus on the input so blur does not commit before the pick lands.
        event.preventDefault()
        onAccept(entry)
      }}
    >
      <span className="suggest-label">{entry.label}</span>
      <span className="suggest-detail">{entry.detail}</span>
    </div>
  )
}

/** A condition, edited as infix text. */
export function ConditionField({
  label,
  value,
  onChange,
  hint,
  suggest,
}: {
  label: string
  value: Condition | undefined
  onChange: (value: Condition | undefined) => void
  hint?: string
  suggest?: SuggestFn
}) {
  return (
    <ParsedField<Condition | undefined>
      label={label}
      hint={hint}
      canonical={value === undefined ? '' : formatCondition(value)}
      placeholder="flag.met_ines and count.fish >= 5"
      parse={parseCondition}
      empty={undefined}
      onCommit={onChange}
      suggest={suggest}
    />
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
  suggest,
}: {
  label: string
  objective: Objective | undefined
  condition: Condition | undefined
  onChange: (parts: { objective?: Objective; condition?: Condition }) => void
  hint?: string
  suggest?: SuggestFn
}) {
  return (
    <ParsedField<{ objective?: Objective; condition?: Condition }>
      label={label}
      hint={hint}
      canonical={formatCompletion({ objective, condition })}
      placeholder="collect fish.rare 5 and flag.otter_agreed"
      parse={parseCompletion}
      empty={{}}
      onCommit={onChange}
      suggest={suggest}
    />
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
