/**
 * One step on the canvas: what it is called, what it listens for, and the
 * handful of flags worth seeing without opening the inspector.
 */
import { Handle, type Node, type NodeProps, Position } from '@xyflow/react'

export interface StepNodeData extends Record<string, unknown> {
  stepId: string
  title: string
  objective?: string
  badges: string[]
  ending: boolean
  failed: boolean
  optional: boolean
  level?: 'error' | 'warning'
  picked: boolean
}

export type StepFlowNode = Node<StepNodeData, 'step'>

export function StepNode({ data }: NodeProps<StepFlowNode>) {
  const classes = ['node', 'step-node']
  if (data.ending) classes.push('ending')
  if (data.failed) classes.push('failed')
  if (data.optional) classes.push('optional')
  if (data.picked) classes.push('picked')
  if (data.level !== undefined) classes.push(data.level)

  return (
    <div className={classes.join(' ')}>
      <Handle type="target" position={Position.Top} />
      <div className="node-title">{data.title}</div>
      <div className="node-id mono">{data.stepId}</div>
      {data.objective === undefined ? null : (
        <div className="node-objective mono">{data.objective}</div>
      )}
      {data.badges.length === 0 ? null : (
        <div className="node-badges">
          {data.badges.map((badge) => (
            <span key={badge} className={`badge ${badge.replace(/[^a-z]/g, '')}`}>
              {badge}
            </span>
          ))}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
