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

/** Every measured node box, keyed by id. Unmeasured nodes are left out. */
function readBoxes(state: ReactFlowState): Record<string, Box> {
  const boxes: Record<string, Box> = {}
  for (const [id, node] of state.nodeLookup) {
    const { width, height } = node.measured
    if (width === undefined || height === undefined) continue
    const { x, y } = node.internals.positionAbsolute
    boxes[id] = { x, y, width, height }
  }
  return boxes
}

/**
 * A string that changes whenever a box moves or resizes. React Flow compares
 * selector results by value, so a string keeps the subscription quiet until
 * something actually moved, where returning the boxes themselves would rerender
 * every edge on every store tick.
 */
function boxSignature(state: ReactFlowState): string {
  let signature = ''
  for (const [id, node] of state.nodeLookup) {
    const { x, y } = node.internals.positionAbsolute
    signature += `${id}:${x},${y},${node.measured.width},${node.measured.height};`
  }
  return signature
}

function edgeEnds(state: ReactFlowState): string {
  return state.edges.map((edge) => `${edge.id}>${edge.source}>${edge.target}`).join('|')
}

export function FloatingEdge({ id, source, target, label, markerEnd, style }: EdgeProps) {
  const signature = useStore(boxSignature)
  const ends = useStore(edgeEnds)
  const store = useStore((state) => state)
  const sourceNode = useInternalNode(source)

  const routes = useMemo(
    () => {
      const list: EdgeEnds[] = store.edges.map((edge) => ({
        id: edge.id,
        from: edge.source,
        to: edge.target,
      }))
      return routeEdges(readBoxes(store), list)
    },
    // The signatures say when the geometry actually changed.
    // biome-ignore lint/correctness/useExhaustiveDependencies: store is read through the signatures
    [signature, ends],
  )

  if (source === target) {
    const box = sourceNode === undefined ? undefined : readBoxes(store)[source]
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
