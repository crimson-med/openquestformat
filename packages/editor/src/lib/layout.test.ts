import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseCompact, toCompact } from '@oqf/core'
import { parseOqd } from '@oqf/dialogue'
import { describe, expect, it } from 'vitest'
import { sampleDialogues, sampleQuests } from '../store/fixtures'
import {
  conversationPositions,
  dialogueEdges,
  layoutConversation,
  layoutGraph,
  layoutQuest,
  questPositions,
} from './layout'
import { clearPosition, formatPosition, readPosition, writePosition } from './position'

function fixture(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../../examples/quests/${name}`, import.meta.url)),
    'utf8',
  )
}

describe('positions on the extension bag', () => {
  it('writes a flat map and reads it back', () => {
    const ext = writePosition(undefined, { x: 12.6, y: -4.2 })
    expect(ext['x-editor.pos']).toEqual({ x: 13, y: -4 })
    expect(readPosition(ext)).toEqual({ x: 13, y: -4 })
    expect(formatPosition({ x: 13, y: -4 })).toBe('x=13;y=-4')
  })

  it('reads the text spelling a hand-written file may carry', () => {
    expect(readPosition({ 'x-editor.pos': 'x=120;y=40' })).toEqual({ x: 120, y: 40 })
  })

  it('keeps other extension keys', () => {
    const ext = writePosition({ 'x-cozycoast.marker': 'pier' }, { x: 1, y: 2 })
    expect(ext['x-cozycoast.marker']).toBe('pier')
    expect(clearPosition(ext)).toEqual({ 'x-cozycoast.marker': 'pier' })
    expect(clearPosition({ 'x-editor.pos': { x: 1, y: 2 } })).toBeUndefined()
  })

  it('ignores a bag with no position or a broken one', () => {
    expect(readPosition(undefined)).toBeUndefined()
    expect(readPosition({ 'x-editor.pos': { x: 1 } })).toBeUndefined()
    expect(readPosition({ 'x-editor.pos': 'nonsense' })).toBeUndefined()
  })

  it('survives a round trip through the compact format', () => {
    const document = parseCompact(fixture('harbormasters-ledger.oqf'))
    const quest = document.quests[0]
    quest.steps[0].ext = writePosition(quest.steps[0].ext, { x: 320, y: 180 })
    // The serializer writes the flat map as x=320;y=180.
    const reparsed = parseCompact(toCompact(document))
    expect(readPosition(reparsed.quests[0].steps[0].ext)).toEqual({ x: 320, y: 180 })
  })
})

describe('dagre layout', () => {
  it('places every node it is given', () => {
    const positions = layoutGraph(
      ['a', 'b', 'c'],
      [
        ['a', 'b'],
        ['b', 'c'],
      ],
    )
    expect(Object.keys(positions).sort()).toEqual(['a', 'b', 'c'])
    expect(positions.a.y).toBeLessThan(positions.b.y)
    expect(positions.b.y).toBeLessThan(positions.c.y)
  })

  it('ignores edges that name a node it does not have', () => {
    const positions = layoutGraph(['a'], [['a', 'ghost']])
    expect(Object.keys(positions)).toEqual(['a'])
  })

  it('lays a quest out down the dependency graph', () => {
    const positions = layoutQuest(sampleQuests().quests[0])
    expect(positions.talk_ines.y).toBeLessThan(positions.find_it.y)
  })

  it('prefers the positions the file already carries', () => {
    const quest = sampleQuests().quests[0]
    quest.steps[0].ext = writePosition(quest.steps[0].ext, { x: 900, y: 900 })
    const positions = questPositions(quest)
    expect(positions.talk_ines).toEqual({ x: 900, y: 900 })
    expect(positions.find_it).toBeDefined()
  })

  it('uses only the stored positions once every step has one', () => {
    const quest = sampleQuests().quests[0]
    quest.steps = quest.steps.map((step, index) => ({
      ...step,
      ext: writePosition(step.ext, { x: index, y: index }),
    }))
    expect(questPositions(quest)).toEqual({
      talk_ines: { x: 0, y: 0 },
      find_it: { x: 1, y: 1 },
    })
  })
})

describe('dialogue graph', () => {
  it('follows next and every choice with a target', () => {
    const conversation = sampleDialogues().conversations[0]
    const edges = dialogueEdges(conversation)
    expect(edges).toEqual([
      { from: 'greet', to: 'thanks', label: 'I will find it.', kind: 'choice', choice: 0 },
    ])
  })

  it('drops edges to nodes that are not there', () => {
    const conversation = sampleDialogues().conversations[0]
    conversation.nodes[1].next = 'nowhere'
    expect(dialogueEdges(conversation)).toHaveLength(1)
  })

  it('lays the reference conversation out', () => {
    const document = parseOqd(fixture('harbormasters-ledger.oqd'))
    const conversation = document.conversations[0]
    const positions = layoutConversation(conversation)
    expect(Object.keys(positions)).toHaveLength(conversation.nodes.length)
    expect(conversationPositions(conversation)).toEqual(positions)
  })
})
