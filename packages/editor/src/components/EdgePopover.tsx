/**
 * The small dialog that asks what a freshly drawn dependency means, and edits an
 * existing one: which field of the target reads the source, and which state of
 * the source it waits for. Enter confirms, Escape leaves, focus goes back to
 * wherever it came from.
 */
import { useViewport } from '@xyflow/react'
import { useEffect, useRef, useState } from 'react'
import {
  DEPENDENCY_FIELDS,
  DEPENDENCY_STATES,
  type DependencyField,
  type DependencyState,
  type EdgeSpec,
} from '../lib/connections'

const FIELD_TITLES: Record<DependencyField, string> = {
  unlock: 'Unlock',
  activate: 'Activate',
  complete: 'Complete',
  fail: 'Fail',
}

export function EdgePopover({
  mode,
  from,
  to,
  anchor,
  initial,
  onSubmit,
  onRemove,
  onCancel,
}: {
  mode: 'add' | 'edit'
  from: string
  to: string
  /** Where to sit, in flow coordinates. */
  anchor: { x: number; y: number }
  initial: EdgeSpec
  onSubmit: (spec: EdgeSpec) => void
  onRemove?: () => void
  onCancel: () => void
}) {
  const [field, setField] = useState<DependencyField>(initial.field)
  const [state, setState] = useState<DependencyState>(initial.state)
  const first = useRef<HTMLButtonElement>(null)
  const viewport = useViewport()

  // Focus the first control on open and hand focus back on close.
  useEffect(() => {
    const previous = document.activeElement
    first.current?.focus()
    return () => {
      if (previous instanceof HTMLElement) previous.focus()
    }
  }, [])

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      onSubmit({ field, state })
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onCancel()
    }
  }

  return (
    <div
      className="edge-popover nopan nowheel"
      // biome-ignore lint/a11y/useSemanticElements: a native dialog would own focus and the canvas
      role="dialog"
      aria-label="Dependency"
      style={{
        left: anchor.x * viewport.zoom + viewport.x,
        top: anchor.y * viewport.zoom + viewport.y,
      }}
      onKeyDown={onKeyDown}
    >
      <div className="edge-popover-title mono">
        {from} → {to}
      </div>
      <fieldset className="segmented" aria-label="Field">
        {DEPENDENCY_FIELDS.map((entry, index) => (
          <button
            key={entry}
            ref={index === 0 ? first : undefined}
            type="button"
            className={entry === field ? 'on' : ''}
            aria-pressed={entry === field}
            onClick={() => setField(entry)}
          >
            {FIELD_TITLES[entry]}
          </button>
        ))}
      </fieldset>
      <label className="edge-popover-state">
        <span>when {from} is</span>
        <select
          className="picker-select"
          value={state}
          onChange={(event) => setState(event.target.value as DependencyState)}
        >
          {DEPENDENCY_STATES.map((entry) => (
            <option key={entry} value={entry}>
              {entry}
            </option>
          ))}
        </select>
      </label>
      <div className="edge-popover-actions">
        <button type="button" className="primary" onClick={() => onSubmit({ field, state })}>
          {mode === 'add' ? 'Add' : 'Apply'}
        </button>
        {mode === 'edit' && onRemove !== undefined ? (
          <button type="button" className="danger" onClick={onRemove}>
            Remove
          </button>
        ) : null}
        <button type="button" className="ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
