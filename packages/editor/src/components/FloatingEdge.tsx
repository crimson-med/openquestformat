/**
 * An edge that attaches to whichever side of each card faces the other one.
 *
 * React Flow's default edge is pinned to a fixed handle, so a line that runs
 * backwards has to wrap around the card to reach it. A conversation loops back
 * to an earlier line all the time (every lore branch returns to its hub), so
 * the dialogue graph anchors its edges instead of its handles. The geometry is
 * in `lib/floating.ts`; this only reads live node boxes and draws.
 */
import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  Position,
  getBezierPath,
  useInternalNode,
} from '@xyflow/react'
import { type Box, type Side, edgeAnchors, offsetAlongSide, selfLoopPath } from '../lib/floating'

const POSITIONS: Record<Side, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
}

/** The live box of a node, or undefined while React Flow is still measuring it. */
function boxOf(node: ReturnType<typeof useInternalNode>): Box | undefined {
  if (node === undefined) return undefined
  const { x, y } = node.internals.positionAbsolute
  const width = node.measured.width
  const height = node.measured.height
  if (width === undefined || height === undefined) return undefined
  return { x, y, width, height }
}

/** How far apart two edges between the same pair of nodes are pulled. */
const BOW = 13

export function FloatingEdge({ id, source, target, label, markerEnd, style, data }: EdgeProps) {
  const sourceNode = useInternalNode(source)
  const targetNode = useInternalNode(target)
  const sourceBox = boxOf(sourceNode)
  const targetBox = boxOf(targetNode)
  if (sourceBox === undefined || targetBox === undefined) return null

  if (source === target) {
    const loop = selfLoopPath(sourceBox)
    return <BaseEdge id={id} path={loop} markerEnd={markerEnd} style={style} />
  }

  const anchors = edgeAnchors(sourceBox, targetBox)
  const bow = typeof data?.bow === 'number' ? data.bow * BOW : 0
  const from = offsetAlongSide(anchors.source, anchors.sourceSide, bow)
  const to = offsetAlongSide(anchors.target, anchors.targetSide, -bow)
  const [path, labelX, labelY] = getBezierPath({
    sourceX: from.x,
    sourceY: from.y,
    sourcePosition: POSITIONS[anchors.sourceSide],
    targetX: to.x,
    targetY: to.y,
    targetPosition: POSITIONS[anchors.targetSide],
    curvature: 0.3,
  })

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      {label === undefined || label === '' ? null : (
        <EdgeLabelRenderer>
          <div
            className="edge-chip nodrag nopan"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
