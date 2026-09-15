/**
 * The bar above a graph: add, auto layout and the direction on the left, the
 * quest or conversation picker beside them, the role legend on the right.
 */
import type { ReactNode } from 'react'
import type { Direction } from '../lib/direction'
import type { LegendEntry } from '../lib/help'
import { DirectionToggle } from './DirectionToggle'

export function CanvasHead({
  addLabel,
  onAdd,
  onLayout,
  direction,
  onDirection,
  picker,
  legend,
}: {
  addLabel: string
  onAdd: () => void
  /** Lays the graph out again in the current direction. */
  onLayout: () => void
  direction: Direction
  /** Picks a direction and lays the graph out that way. */
  onDirection: (direction: Direction) => void
  picker: ReactNode
  legend: readonly LegendEntry[]
}) {
  return (
    <header className="canvas-head">
      <div className="canvas-actions">
        <button type="button" title={`${addLabel} (N)`} onClick={onAdd}>
          {addLabel}
        </button>
        <button type="button" title="Lay the graph out again" onClick={onLayout}>
          Auto layout
        </button>
        <DirectionToggle direction={direction} onChange={onDirection} />
      </div>
      {picker}
      <ul className="canvas-legend" aria-label="Legend">
        {legend.map((entry) => (
          <li key={entry.id} title={entry.text}>
            <span className={`legend-dot ${entry.color}`} aria-hidden="true" />
            {entry.label}
          </li>
        ))}
      </ul>
    </header>
  )
}
