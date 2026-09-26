import { describe, expect, it } from 'vitest'
import {
  type Box,
  EDGE_GAP,
  centerOf,
  edgeAnchors,
  offsetAlongSide,
  routeEdges,
  selfLoopPath,
  sideFacing,
  sidePoint,
} from './floating'

const box = (x: number, y: number, width = 100, height = 60): Box => ({ x, y, width, height })

describe('sideFacing', () => {
  it('picks the side the other node sits on', () => {
    const middle = box(0, 0)
    expect(sideFacing(middle, { x: 500, y: 30 })).toBe('right')
    expect(sideFacing(middle, { x: -500, y: 30 })).toBe('left')
    expect(sideFacing(middle, { x: 50, y: -500 })).toBe('top')
    expect(sideFacing(middle, { x: 50, y: 500 })).toBe('bottom')
  })

  it('weighs the gap against the box size, so a wide card prefers its short sides', () => {
    const wide = box(0, 0, 400, 40)
    // Level with the card and only a little above it: still a side, not the top.
    expect(sideFacing(wide, { x: 600, y: 0 })).toBe('right')
    // Straight above by more than the card is wide: the top.
    expect(sideFacing(wide, { x: 200, y: -600 })).toBe('top')
  })
})

describe('sidePoint', () => {
  it('sits on the middle of the named side', () => {
    const b = box(10, 20, 100, 60)
    expect(sidePoint(b, 'left')).toEqual({ x: 10, y: 50 })
    expect(sidePoint(b, 'right')).toEqual({ x: 110, y: 50 })
    expect(sidePoint(b, 'top')).toEqual({ x: 60, y: 20 })
    expect(sidePoint(b, 'bottom')).toEqual({ x: 60, y: 80 })
    expect(centerOf(b)).toEqual({ x: 60, y: 50 })
  })
})

describe('edgeAnchors', () => {
  it('runs right to left when the target is to the right', () => {
    const anchors = edgeAnchors(box(0, 0), box(400, 0))
    expect(anchors.sourceSide).toBe('right')
    expect(anchors.targetSide).toBe('left')
    expect(anchors.source).toEqual({ x: 100, y: 30 })
    expect(anchors.target).toEqual({ x: 400, y: 30 })
  })

  it('runs left to right for a back edge, the short way round', () => {
    const anchors = edgeAnchors(box(400, 0), box(0, 0))
    expect(anchors.sourceSide).toBe('left')
    expect(anchors.targetSide).toBe('right')
  })

  it('runs top to bottom when the target is below', () => {
    const anchors = edgeAnchors(box(0, 0), box(0, 400))
    expect(anchors.sourceSide).toBe('bottom')
    expect(anchors.targetSide).toBe('top')
  })

  it('never leaves and arrives on the same side', () => {
    // Stacked with a small offset: both ends would otherwise want the right side.
    const anchors = edgeAnchors(box(0, 0), box(20, 30))
    expect(anchors.sourceSide).not.toBe(anchors.targetSide)
  })
})

describe('offsetAlongSide', () => {
  it('slides along the side, so a pair of edges does not overlap', () => {
    expect(offsetAlongSide({ x: 10, y: 20 }, 'right', 12)).toEqual({ x: 10, y: 32 })
    expect(offsetAlongSide({ x: 10, y: 20 }, 'left', -12)).toEqual({ x: 10, y: 8 })
    expect(offsetAlongSide({ x: 10, y: 20 }, 'top', 12)).toEqual({ x: 22, y: 20 })
    expect(offsetAlongSide({ x: 10, y: 20 }, 'bottom', -12)).toEqual({ x: -2, y: 20 })
  })

  it('leaves a lone edge exactly where it was', () => {
    expect(offsetAlongSide({ x: 10, y: 20 }, 'top', 0)).toEqual({ x: 10, y: 20 })
  })
})

describe('selfLoopPath', () => {
  it('draws a curve that leaves and returns to the same box', () => {
    const path = selfLoopPath(box(0, 0))
    expect(path.startsWith('M 100,20')).toBe(true)
    expect(path).toContain('C')
  })
})

describe('routeEdges', () => {
  const boxes = {
    offer: { x: 0, y: 0, width: 200, height: 160 },
    a: { x: 500, y: -200, width: 200, height: 100 },
    b: { x: 500, y: 0, width: 200, height: 100 },
    c: { x: 500, y: 200, width: 200, height: 100 },
  }

  it('fans the edges that leave one side apart', () => {
    const routes = routeEdges(boxes, [
      { id: '1', from: 'offer', to: 'a' },
      { id: '2', from: 'offer', to: 'b' },
      { id: '3', from: 'offer', to: 'c' },
    ])
    const ys = ['1', '2', '3'].map((id) => routes[id].source.y)
    expect(new Set(ys).size).toBe(3)
    // Ordered by where the far end sits, and evenly spaced.
    expect(ys[0]).toBeLessThan(ys[1])
    expect(ys[1]).toBeLessThan(ys[2])
    expect(ys[1] - ys[0]).toBeCloseTo(ys[2] - ys[1])
  })

  it('separates a line from its reply', () => {
    const routes = routeEdges(boxes, [
      { id: 'there', from: 'offer', to: 'b' },
      { id: 'back', from: 'b', to: 'offer' },
    ])
    expect(routes.there.source.y).not.toBe(routes.back.target.y)
    expect(Math.abs(routes.there.source.y - routes.back.target.y)).toBe(EDGE_GAP)
  })

  it('leaves a lone edge on the middle of the side', () => {
    const routes = routeEdges(boxes, [{ id: 'only', from: 'offer', to: 'b' }])
    expect(routes.only.source).toEqual({ x: 200, y: 80 })
  })

  it('tightens the gap rather than overflowing a short side', () => {
    const narrow = { ...boxes, offer: { x: 0, y: 0, width: 200, height: 40 } }
    const routes = routeEdges(narrow, [
      { id: '1', from: 'offer', to: 'a' },
      { id: '2', from: 'offer', to: 'b' },
      { id: '3', from: 'offer', to: 'c' },
    ])
    const ys = ['1', '2', '3'].map((id) => routes[id].source.y)
    for (const y of ys) {
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThanOrEqual(40)
    }
  })

  it('skips a self loop and an edge whose node is missing', () => {
    const routes = routeEdges(boxes, [
      { id: 'loop', from: 'offer', to: 'offer' },
      { id: 'gone', from: 'offer', to: 'nowhere' },
      { id: 'real', from: 'offer', to: 'b' },
    ])
    expect(routes.loop).toBeUndefined()
    expect(routes.gone).toBeUndefined()
    expect(routes.real).toBeDefined()
  })
})
