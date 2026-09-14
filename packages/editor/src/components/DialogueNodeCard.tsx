/**
 * One dialogue node on the canvas: the line as written, plus its choices so a
 * branch reads without opening anything.
 */
import { Handle, type Node, type NodeProps, Position } from '@xyflow/react'

export interface DialogueNodeData extends Record<string, unknown> {
  nodeId: string
  speaker?: string
  text: string
  choices: string[]
  lore: boolean
  start: boolean
  ends: boolean
  level?: 'error' | 'warning'
  picked: boolean
  direction: 'TB' | 'LR'
}

export type DialogueFlowNode = Node<DialogueNodeData, 'dialogue'>

export function DialogueNodeCard({ data }: NodeProps<DialogueFlowNode>) {
  const classes = ['node', 'dialogue-node']
  if (data.lore) classes.push('lore')
  if (data.start) classes.push('start')
  if (data.ends) classes.push('ends')
  if (data.picked) classes.push('picked')
  if (data.level !== undefined) classes.push(data.level)
  const across = data.direction === 'LR'

  return (
    <div className={classes.join(' ')}>
      <Handle type="target" position={across ? Position.Left : Position.Top} />
      <div className="node-head">
        <span className="node-id mono">{data.nodeId}</span>
        {data.speaker === undefined ? null : <span className="node-speaker">{data.speaker}</span>}
      </div>
      <div className="node-text">{data.text === '' ? 'empty line' : data.text}</div>
      {data.choices.length === 0 ? null : (
        <ul className="node-choices">
          {data.choices.map((choice, index) => (
            <li key={`${data.nodeId}-${index}`}>{choice}</li>
          ))}
        </ul>
      )}
      <Handle type="source" position={across ? Position.Right : Position.Bottom} />
    </div>
  )
}
