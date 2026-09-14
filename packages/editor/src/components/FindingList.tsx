import { useDispatch } from '../store/context'
/**
 * The findings list. Clicking one selects whatever it is about, so a warning
 * is one click from the field that caused it.
 */
import type { EditorFinding } from '../store/findings'
import type { Selection } from '../store/types'

function selectionFor(finding: EditorFinding): Selection | undefined {
  if (finding.quest !== undefined && finding.step !== undefined) {
    return { kind: 'step', quest: finding.quest, step: finding.step }
  }
  if (finding.quest !== undefined) return { kind: 'quest', quest: finding.quest }
  if (finding.conversation !== undefined && finding.node !== undefined) {
    return { kind: 'node', conversation: finding.conversation, node: finding.node }
  }
  if (finding.conversation !== undefined) {
    return { kind: 'conversation', conversation: finding.conversation }
  }
  return undefined
}

export function FindingList({
  findings,
  compact,
}: {
  findings: EditorFinding[]
  compact?: boolean
}) {
  const dispatch = useDispatch()
  if (findings.length === 0) {
    return <p className="note">Nothing to report. The pack validates.</p>
  }
  return (
    <ul className={compact === true ? 'findings compact' : 'findings'}>
      {findings.map((finding, index) => {
        const target = selectionFor(finding)
        const where = [finding.quest ?? finding.conversation, finding.step ?? finding.node]
          .filter((part) => part !== undefined)
          .join(' / ')
        return (
          <li key={`${finding.code}-${index}`} className={finding.level}>
            <button
              type="button"
              className="finding"
              disabled={target === undefined}
              onClick={() => {
                if (target !== undefined) dispatch({ type: 'select', selection: target })
              }}
            >
              <span className={`level ${finding.level}`}>{finding.level}</span>
              <span className="finding-body">
                <span className="finding-message">{finding.message}</span>
                <span className="finding-meta">
                  <code>{finding.code}</code>
                  {where === '' ? null : <span>{where}</span>}
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
