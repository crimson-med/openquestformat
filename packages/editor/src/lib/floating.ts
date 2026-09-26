/**
 * Where an edge should touch two node boxes.
 *
 * React Flow pins an edge to a fixed handle, so an edge that runs backwards has
 * to wrap around the whole card to reach the far side. These helpers pick the
 * side facing the other node instead, which is what makes a conversation that
 * loops back to an earlier line read as a short hop rather than a lasso.
 *
 * Pure geometry over plain rectangles: no React, no React Flow.
 */

/** A node box in flow coordinates, top left corner plus size. */
export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

/** The side of a box an edge leaves from or arrives at. */
export type Side = 'top' | 'right' | 'bottom' | 'left'

export interface Anchors {
  source: Point
  target: Point
  sourceSide: Side
  targetSide: Side
}

export function centerOf(box: Box): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/**
 * The side of `box` that faces `toward`, comparing the gap on each axis against
 * the box's own half size so a wide card prefers its short sides.
 */
export function sideFacing(box: Box, toward: Point): Side {
  const center = centerOf(box)
  const dx = (toward.x - center.x) / (box.width / 2 || 1)
  const dy = (toward.y - center.y) / (box.height / 2 || 1)
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left'
  return dy >= 0 ? 'bottom' : 'top'
}

/** The midpoint of one side of a box. */
export function sidePoint(box: Box, side: Side): Point {
  const center = centerOf(box)
  if (side === 'left') return { x: box.x, y: center.y }
  if (side === 'right') return { x: box.x + box.width, y: center.y }
  if (side === 'top') return { x: center.x, y: box.y }
  return { x: center.x, y: box.y + box.height }
}

/**
 * Where the edge between two boxes should start and end.
 *
 * Each end takes the side facing the other box. When both ends would use the
 * same axis and the boxes overlap on it, the edge would double back on itself,
 * so the far end is pushed to the opposite side and the path stays readable.
 */
export function edgeAnchors(source: Box, target: Box): Anchors {
  const sourceSide = sideFacing(source, centerOf(target))
  let targetSide = sideFacing(target, centerOf(source))
  if (sourceSide === targetSide) {
    targetSide = opposite(targetSide)
  }
  return {
    source: sidePoint(source, sourceSide),
    target: sidePoint(target, targetSide),
    sourceSide,
    targetSide,
  }
}

/**
 * Slide an anchor along its own side.
 *
 * Two nodes that point at each other, or two choices that lead to the same
 * line, would otherwise draw one path on top of another. Nudging each anchor
 * the other way splits them into a readable pair without moving either card.
 */
export function offsetAlongSide(point: Point, side: Side, amount: number): Point {
  if (amount === 0) return point
  if (side === 'left' || side === 'right') return { x: point.x, y: point.y + amount }
  return { x: point.x + amount, y: point.y }
}

export function opposite(side: Side): Side {
  if (side === 'left') return 'right'
  if (side === 'right') return 'left'
  if (side === 'top') return 'bottom'
  return 'top'
}

/**
 * A closed path for an edge whose source and target are the same node, drawn
 * off the top right corner so it never sits under the card's text.
 */
export function selfLoopPath(box: Box, radius = 34): string {
  const start = { x: box.x + box.width, y: box.y + box.height / 3 }
  const end = { x: box.x + box.width / 1.6, y: box.y }
  const c1 = { x: start.x + radius, y: start.y - radius }
  const c2 = { x: end.x + radius / 2, y: end.y - radius }
  return `M ${start.x},${start.y} C ${c1.x},${c1.y} ${c2.x},${c2.y} ${end.x},${end.y}`
}

/** An edge, reduced to what routing needs. */
export interface EdgeEnds {
  id: string
  from: string
  to: string
}

/** Gap between two edges that meet the same side of the same card. */
export const EDGE_GAP = 22

/**
 * Where every edge should meet every card.
 *
 * Anchoring each edge on its own puts all of a card's edges on one point, so a
 * hub with three choices and a line back sprouts four lines from the same
 * pixel. This walks the whole set instead: it picks a side per end, then fans
 * the edges that share a side out along it, ordered by where their other end
 * sits so the lines do not cross. Self loops are left out, they have their own
 * path.
 */
export function routeEdges(
  boxes: Readonly<Record<string, Box>>,
  edges: readonly EdgeEnds[],
): Record<string, Anchors> {
  const routes: Record<string, Anchors> = {}
  /** Every end that lands on one side of one card, so they can be fanned out. */
  const lanes = new Map<string, { id: string; end: 'source' | 'target'; along: number }[]>()

  for (const edge of edges) {
    const source = boxes[edge.from]
    const target = boxes[edge.to]
    if (source === undefined || target === undefined || edge.from === edge.to) continue
    const anchors = edgeAnchors(source, target)
    routes[edge.id] = anchors
    const put = (node: string, side: Side, end: 'source' | 'target', other: Box) => {
      const key = `${node}\u0000${side}`
      const lane = lanes.get(key) ?? []
      const center = centerOf(other)
      lane.push({
        id: edge.id,
        end,
        along: side === 'left' || side === 'right' ? center.y : center.x,
      })
      lanes.set(key, lane)
    }
    put(edge.from, anchors.sourceSide, 'source', target)
    put(edge.to, anchors.targetSide, 'target', source)
  }

  for (const [key, lane] of lanes) {
    if (lane.length < 2) continue
    const [node, side] = key.split('\u0000') as [string, Side]
    const box = boxes[node]
    if (box === undefined) continue
    // Order by where the far end sits, so neighbouring lines stay parallel.
    lane.sort((a, b) => a.along - b.along)
    const span = side === 'left' || side === 'right' ? box.height : box.width
    const gap = Math.min(EDGE_GAP, (span * 0.8) / (lane.length - 1))
    const middle = (lane.length - 1) / 2
    lane.forEach((entry, index) => {
      const anchors = routes[entry.id]
      if (anchors === undefined) return
      const shift = (index - middle) * gap
      if (entry.end === 'source') {
        anchors.source = offsetAlongSide(anchors.source, anchors.sourceSide, shift)
      } else {
        anchors.target = offsetAlongSide(anchors.target, anchors.targetSide, shift)
      }
    })
  }

  return routes
}
