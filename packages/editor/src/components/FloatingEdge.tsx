/**
 * An edge that attaches to whichever side of each card faces the other one.
 *
 * React Flow pins an edge to a fixed handle, so a line that runs backwards has
 * to wrap around the card to reach it, and every edge of a card leaves from the
 * same pixel. A conversation does both all the time: lore branches return to
 * their hub, and a hub has several choices. The routing is in `lib/floating.ts`
 * and runs over the whole graph at once, so edges sharing a side fan out along
 * it. This reads live node boxes and draws.
 */
import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  Position,
  type ReactFlowState,
  getBezierPath,
  useInternalNode,
  useStore,
} from '@xyflow/react'
import { useMemo } from 'react'
import { type Box, type EdgeEnds, type Side, routeEdges, selfLoopPath } from '../lib/floating'

const POSITIONS: Record<Side, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
}

/**
 * Every measured node box, keyed by id, as a string. React Flow compares
 * selector results by value, so a string keeps the subscription quiet until
 * something actually moved, where returning the boxes themselves would rerender
 * every edge on every store tick. Unmeasured nodes are left out.
 */
function boxSignature(state: ReactFlowState): string {
  const boxes: Record<string, Box> = {}
  for (const [id, node] of state.nodeLookup) {
    const { width, height } = node.measured
    if (width === undefined || height === undefined) continue
    const { x, y } = node.internals.positionAbsolute
    boxes[id] = { x, y, width, height }
  }
  return JSON.stringify(boxes)
}

/** Every edge's id and ends, as a string, for the same reason. */
function edgeEnds(state: ReactFlowState): string {
  const list: EdgeEnds[] = state.edges.map((edge) => ({
    id: edge.id,
    from: edge.source,
    to: edge.target,
  }))
  return JSON.stringify(list)
}

export function FloatingEdge({ id, source, target, label, markerEnd, style }: EdgeProps) {
  const signature = useStore(boxSignature)
  const ends = useStore(edgeEnds)
  const sourceNode = useInternalNode(source)

  // The signatures carry the geometry, so they are the whole dependency list.
  const boxes = useMemo(() => JSON.parse(signature) as Record<string, Box>, [signature])
  const routes = useMemo(() => routeEdges(boxes, JSON.parse(ends) as EdgeEnds[]), [boxes, ends])

  if (source === target) {
    const box = sourceNode === undefined ? undefined : boxes[source]
    if (box === undefined) return null
    return <BaseEdge id={id} path={selfLoopPath(box)} markerEnd={markerEnd} style={style} />
  }

  const anchors = routes[id]
  if (anchors === undefined) return null

  const [path, labelX, labelY] = getBezierPath({
    sourceX: anchors.source.x,
    sourceY: anchors.source.y,
    sourcePosition: POSITIONS[anchors.sourceSide],
    targetX: anchors.target.x,
    targetY: anchors.target.y,
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
