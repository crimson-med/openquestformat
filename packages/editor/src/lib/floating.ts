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

/**
 * How far each edge should be pulled off the straight line between its two
 * nodes, so that edges sharing a pair of nodes stay apart. The pair is read
 * without direction, so a line and its reply count as one group and bow the
 * same amount in opposite directions. A lone edge gets zero and stays put.
 */
export function bowOf(edges: ReadonlyArray<{ from: string; to: string }>): number[] {
  const groups = new Map<string, number[]>()
  edges.forEach((edge, index) => {
    const key = [edge.from, edge.to].sort().join('\u0000')
    const group = groups.get(key) ?? []
    group.push(index)
    groups.set(key, group)
  })
  const bows = new Array<number>(edges.length).fill(0)
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const middle = (group.length - 1) / 2
    group.forEach((index, position) => {
      // Reversed edges bow the same way, so the pair opens instead of crossing.
      const direction = edges[index].from < edges[index].to ? 1 : -1
      bows[index] = (position - middle) * direction
    })
  }
  return bows
}
