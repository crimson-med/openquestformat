import { describe, expect, it } from 'vitest'
import {
  type Box,
  bowOf,
  centerOf,
  edgeAnchors,
  offsetAlongSide,
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

describe('bowOf', () => {
  it('leaves a lone edge on the straight line', () => {
    expect(bowOf([{ from: 'a', to: 'b' }])).toEqual([0])
  })

  it('opens a reply and its line into a pair', () => {
    const bows = bowOf([
      { from: 'offer', to: 'curiosity' },
      { from: 'curiosity', to: 'offer' },
    ])
    expect(bows[0]).not.toBe(0)
    expect(bows[1]).not.toBe(0)
    // Same sign, because the second edge runs the other way: the pair opens.
    expect(Math.sign(bows[0])).toBe(Math.sign(bows[1]))
  })

  it('spreads three edges between the same pair evenly', () => {
    const bows = bowOf([
      { from: 'a', to: 'b' },
      { from: 'a', to: 'b' },
      { from: 'a', to: 'b' },
    ])
    expect(bows).toEqual([-1, 0, 1])
  })

  it('keeps unrelated edges at zero', () => {
    const bows = bowOf([
      { from: 'a', to: 'b' },
      { from: 'b', to: 'a' },
      { from: 'c', to: 'd' },
    ])
    expect(bows[2]).toBe(0)
  })
})
