/** The Help dialog: the views, the graph legend and the shortcuts, from lib/help. */
import {
  DIALOGUE_LEGEND,
  EDGE_LEGEND,
  HELP_VIEWS,
  type LegendEntry,
  QUEST_LEGEND,
  SHORTCUTS,
} from '../lib/help'
import { Modal } from './Modal'

function LegendRows({ entries }: { entries: readonly LegendEntry[] }) {
  return (
    <ul className="help-legend">
      {entries.map((entry) => (
        <li key={entry.id}>
          <span className={`legend-dot ${entry.color}`} aria-hidden="true" />
          <strong>
            {entry.glyph === undefined ? null : <span aria-hidden="true">{entry.glyph} </span>}
            {entry.label}
          </strong>
          <span className="muted">{entry.text}</span>
        </li>
      ))}
    </ul>
  )
}

export function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} title="Help" onClose={onClose} wide>
      <div className="modal-body help">
        <section>
          <h3>Views</h3>
          <ul className="help-list">
            {HELP_VIEWS.map((view) => (
              <li key={view.id}>
                <strong>{view.title}</strong>
                <span className="muted">{view.text}</span>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3>Graph legend</h3>
          <h4>Steps</h4>
          <LegendRows entries={QUEST_LEGEND} />
          <h4>Dependencies</h4>
          <ul className="help-legend">
            {EDGE_LEGEND.map((entry) => (
              <li key={entry.id}>
                <span
                  className={`edge-sample ${entry.style}${entry.red === true ? ' red' : ''}`}
                  aria-hidden="true"
                />
                <strong>{entry.label}</strong>
                <span className="muted">{entry.text}</span>
              </li>
            ))}
          </ul>
          <h4>Dialogue nodes</h4>
          <LegendRows entries={DIALOGUE_LEGEND} />
          <p className="note">
            Dialogue edges follow next (solid) and every choice with a target (dashed).
          </p>
        </section>

        <section>
          <h3>Shortcuts</h3>
          <ul className="help-list">
            {SHORTCUTS.map((entry) => (
              <li key={entry.keys}>
                <kbd>{entry.keys}</kbd>
                <span>{entry.text}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Modal>
  )
}
