/** Top to bottom or left to right. Picking one lays the graph out again. */
import type { Direction } from '../lib/direction'

export function DirectionToggle({
  direction,
  onChange,
}: {
  direction: Direction
  onChange: (direction: Direction) => void
}) {
  return (
    <fieldset className="segmented" aria-label="Layout direction">
      <button
        type="button"
        className={direction === 'TB' ? 'on' : ''}
        title="Lay the graph out top to bottom"
        onClick={() => onChange('TB')}
      >
        ↓ Top to bottom
      </button>
      <button
        type="button"
        className={direction === 'LR' ? 'on' : ''}
        title="Lay the graph out left to right"
        onClick={() => onChange('LR')}
      >
        → Left to right
      </button>
    </fieldset>
  )
}
