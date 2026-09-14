/**
 * One step on the canvas: what it is called, what it listens for, and the
 * handful of flags worth seeing without opening the inspector.
 */
import { Handle, type Node, type NodeProps, Position } from '@xyflow/react'
import '../styles/playtest.css'

export interface StepNodeData extends Record<string, unknown> {
  stepId: string
  title: string
  objective?: string
  badges: string[]
  ending: boolean
  failed: boolean
  optional: boolean
  start: boolean
  repeat: boolean
  level?: 'error' | 'warning'
  picked: boolean
  direction: 'TB' | 'LR'
  /** Where the step stands in the running playtest, when one exists. */
  runState?: 'locked' | 'available' | 'active' | 'done' | 'failed' | 'skipped'
}

export type StepFlowNode = Node<StepNodeData, 'step'>

type Role = 'failed' | 'ending' | 'start' | 'repeat' | 'optional' | 'step'

const ROLE_GLYPHS: Record<Role, string> = {
  failed: '✕',
  ending: '⚑',
  start: '▶',
  repeat: '↻',
  optional: '◌',
  step: '•',
}

/** The one role that colors the card. Endings win over everything else. */
function roleOf(data: StepNodeData): Role {
  if (data.failed) return 'failed'
  if (data.ending) return 'ending'
  if (data.start) return 'start'
  if (data.repeat) return 'repeat'
  if (data.optional) return 'optional'
  return 'step'
}

export function StepNode({ data }: NodeProps<StepFlowNode>) {
  const role = roleOf(data)
  const classes = ['node', 'step-node', role]
  if (data.picked) classes.push('picked')
  if (data.level !== undefined) classes.push(data.level)
  if (data.runState !== undefined) classes.push(`run-${data.runState}`)
  const badges = data.badges.filter((badge) => badge !== role)
  const across = data.direction === 'LR'

  return (
    <div className={classes.join(' ')}>
      <Handle type="target" position={across ? Position.Left : Position.Top} />
      <div className="node-role">
        <span aria-hidden="true">{ROLE_GLYPHS[role]}</span>
        {role}
        {data.runState === undefined ? null : <span className="node-run">{data.runState}</span>}
      </div>
      <div className="node-title">{data.title}</div>
      <div className="node-id mono">{data.stepId}</div>
      {data.objective === undefined ? null : (
        <div className="node-objective mono">{data.objective}</div>
      )}
      {badges.length === 0 ? null : (
        <div className="node-badges">
          {badges.map((badge) => (
            <span key={badge} className="badge">
              {badge}
            </span>
          ))}
        </div>
      )}
      <Handle type="source" position={across ? Position.Right : Position.Bottom} />
    </div>
  )
}
