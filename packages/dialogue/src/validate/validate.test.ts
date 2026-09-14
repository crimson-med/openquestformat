import { readFileSync } from 'node:fs'
import { type OqfDocument, parseCompact } from '@oqf/core'
import { describe, expect, it } from 'vitest'
import { parseOqd } from '../compact/parse.js'
import type { Conversation, DialogueDocument } from '../model.js'
import { validateDialogue } from './validate.js'

function read(name: string): string {
  return readFileSync(new URL(`../../../examples/quests/${name}`, import.meta.url), 'utf8')
}

function doc(...conversations: Conversation[]): DialogueDocument {
  return { speakers: [], conversations }
}

function codes(result: ReturnType<typeof validateDialogue>): string[] {
  return result.findings.map((finding) => finding.code)
}

function only(docs: DialogueDocument[], code: string) {
  return validateDialogue(docs).findings.filter((finding) => finding.code === code)
}

describe('the reference fixture', () => {
  const dialogue = parseOqd(read('harbormasters-ledger.oqd'))
  const quests: OqfDocument = parseCompact(read('harbormasters-ledger.oqf'))

  it('is clean on its own', () => {
    const result = validateDialogue([dialogue])
    expect(result.findings).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('is clean against the quest that binds it, even in strict mode', () => {
    const result = validateDialogue([dialogue], { strict: true, quests: [quests] })
    expect(result.findings).toEqual([])
    expect(result.ok).toBe(true)
  })
})

describe('errors', () => {
  it('reports a duplicate conversation id', () => {
    const result = validateDialogue([
      doc(
        { id: 'a', start: 'g', nodes: [{ id: 'g', text: 'x' }] },
        { id: 'a', start: 'g', nodes: [{ id: 'g', text: 'x' }] },
      ),
    ])
    expect(codes(result)).toEqual(['duplicate-conversation-id'])
    expect(result.ok).toBe(false)
    expect(result.findings[0].path).toBe('conversations[1]')
  })

  it('reports a duplicate node id', () => {
    const result = validateDialogue([
      doc({
        id: 'a',
        start: 'g',
        nodes: [
          { id: 'g', text: 'x' },
          { id: 'g', text: 'y' },
        ],
      }),
    ])
    expect(codes(result)).toContain('duplicate-node-id')
    expect(result.ok).toBe(false)
  })

  it('reports an unknown start node and stops there', () => {
    const result = validateDialogue([doc({ id: 'a', start: 'nope', nodes: [] })])
    expect(codes(result)).toEqual(['unknown-start'])
    expect(result.findings[0].path).toBe('conversations[0].start')
  })

  it('reports an unknown next on a node and on a choice', () => {
    const result = validateDialogue([
      doc({
        id: 'a',
        start: 'g',
        nodes: [
          { id: 'g', text: 'x', choices: [{ text: 'y', next: 'gone' }] },
          { id: 'h', text: 'x', next: 'missing' },
        ],
      }),
    ])
    const found = result.findings.filter((finding) => finding.code === 'unknown-next')
    expect(found).toHaveLength(2)
    expect(found.map((finding) => finding.path)).toEqual([
      'conversations[0].nodes[0].choices[0].next',
      'conversations[0].nodes[1].next',
    ])
  })

  it('reports an invalid choice condition', () => {
    const result = only(
      [
        doc({
          id: 'a',
          start: 'g',
          nodes: [
            {
              id: 'g',
              text: 'x',
              choices: [{ text: 'y', condition: { var: 'nope.thing' } }],
            },
          ],
        }),
      ],
      'condition-invalid',
    )
    expect(result).toHaveLength(1)
    expect(result[0].message).toContain('unknown variable namespace')
    expect(result[0].path).toBe('conversations[0].nodes[0].choices[0].condition')
  })

  it('reports an invalid extension key on a conversation, a node and a choice', () => {
    const result = only(
      [
        doc({
          id: 'a',
          start: 'g',
          nodes: [{ id: 'g', text: 'x', choices: [{ text: 'y', ext: { c: 1 } }], ext: { b: 1 } }],
          ext: { a: 1 },
        }),
      ],
      'ext-key-invalid',
    )
    expect(result.map((finding) => finding.path)).toEqual([
      'conversations[0].ext',
      'conversations[0].nodes[0].ext',
      'conversations[0].nodes[0].choices[0].ext',
    ])
  })
})

describe('lore nodes', () => {
  it('accepts a lore branch that loops back into a conversation with no effects', () => {
    const result = validateDialogue([
      doc({
        id: 'a',
        start: 'g',
        nodes: [
          { id: 'g', text: 'x', choices: [{ text: 'y', next: 'lore' }, { text: 'z' }] },
          { id: 'lore', text: 'x', next: 'g', lore: true },
        ],
      }),
    ])
    expect(result.findings).toEqual([])
  })

  it('reports a set on the lore node itself', () => {
    const result = only(
      [
        doc({
          id: 'a',
          start: 'g',
          nodes: [{ id: 'g', text: 'x', set: [{ flag: 'a' }], lore: true }],
        }),
      ],
      'lore-node-effect',
    )
    expect(result).toHaveLength(1)
  })

  it('reports an emit deeper in the subtree', () => {
    const result = only(
      [
        doc({
          id: 'a',
          start: 'g',
          nodes: [
            { id: 'g', text: 'x', next: 'mid', lore: true },
            { id: 'mid', text: 'x', next: 'deep' },
            { id: 'deep', text: 'x', emit: [{ event: 'boom' }] },
          ],
        }),
      ],
      'lore-node-effect',
    )
    expect(result).toHaveLength(1)
    expect(result[0].message).toContain('"deep"')
  })

  it('reports a set on a choice in the subtree', () => {
    const result = only(
      [
        doc({
          id: 'a',
          start: 'g',
          nodes: [
            { id: 'g', text: 'x', next: 'mid', lore: true },
            { id: 'mid', text: 'x', choices: [{ text: 'y', set: [{ flag: 'a' }] }] },
          ],
        }),
      ],
      'lore-node-effect',
    )
    expect(result).toHaveLength(1)
  })

  it('walks a cycle without hanging', () => {
    const result = only(
      [
        doc({
          id: 'a',
          start: 'g',
          nodes: [
            { id: 'g', text: 'x', next: 'h', lore: true },
            { id: 'h', text: 'x', next: 'g' },
          ],
        }),
      ],
      'lore-node-effect',
    )
    expect(result).toEqual([])
  })
})

describe('warnings', () => {
  it('reports a node nothing reaches', () => {
    const result = only(
      [
        doc({
          id: 'a',
          start: 'g',
          nodes: [
            { id: 'g', text: 'x' },
            { id: 'orphan', text: 'x' },
          ],
        }),
      ],
      'unreachable-node',
    )
    expect(result).toHaveLength(1)
    expect(result[0].level).toBe('warning')
    expect(result[0].path).toBe('conversations[0].nodes[1]')
  })

  it('reports a node with choices and next both set', () => {
    const result = only(
      [
        doc({
          id: 'a',
          start: 'g',
          nodes: [
            { id: 'g', text: 'x', next: 'h', choices: [{ text: 'y' }] },
            { id: 'h', text: 'x' },
          ],
        }),
      ],
      'next-ignored',
    )
    expect(result).toHaveLength(1)
    expect(result[0].level).toBe('warning')
  })

  it('reports a conversation where every path cycles', () => {
    const result = only(
      [
        doc({
          id: 'a',
          start: 'g',
          nodes: [
            { id: 'g', text: 'x', next: 'h' },
            { id: 'h', text: 'x', choices: [{ text: 'y', next: 'g' }] },
          ],
        }),
      ],
      'no-exit',
    )
    expect(result).toHaveLength(1)
    expect(result[0].level).toBe('warning')
  })

  it('stays quiet when one choice in the cycle ends the conversation', () => {
    const result = only(
      [
        doc({
          id: 'a',
          start: 'g',
          nodes: [
            { id: 'g', text: 'x', next: 'h' },
            { id: 'h', text: 'x', choices: [{ text: 'y', next: 'g' }, { text: 'z' }] },
          ],
        }),
      ],
      'no-exit',
    )
    expect(result).toEqual([])
  })
})

describe('against the quests', () => {
  const quests: OqfDocument = {
    dictionaries: { actors: [], locations: [], items: [], tags: [] },
    quests: [
      {
        id: 'q',
        version: 1,
        title: 'Q',
        tags: [],
        steps: [
          {
            id: 's1',
            title: 'One',
            rewards: [],
            actors: [],
            dialogue: { provider: 'oqf', ref: 'known' },
          },
          {
            id: 's2',
            title: 'Two',
            rewards: [],
            actors: [],
            dialogue: { provider: 'oqf', ref: 'gone' },
          },
          {
            id: 's3',
            title: 'Three',
            rewards: [],
            actors: [],
            dialogue: { provider: 'ink', ref: 'elsewhere' },
          },
        ],
        rewards: [],
      },
    ],
  }
  const dialogue = doc(
    { id: 'known', start: 'g', nodes: [{ id: 'g', text: 'x' }] },
    { id: 'spare', start: 'g', nodes: [{ id: 'g', text: 'x' }] },
  )

  it('reports a binding to a conversation that does not exist', () => {
    const result = validateDialogue([dialogue], { quests: [quests] })
    const found = result.findings.filter((finding) => finding.code === 'unknown-dialogue-ref')
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({
      level: 'warning',
      quest: 'q',
      step: 's2',
      path: 'quests[0].steps[1].dialogue.ref',
    })
  })

  it('ignores bindings that name another provider', () => {
    const result = validateDialogue([dialogue], { quests: [quests] })
    expect(result.findings.every((finding) => !finding.message.includes('elsewhere'))).toBe(true)
  })

  it('reports an unbound conversation only in strict mode', () => {
    expect(
      validateDialogue([dialogue], { quests: [quests] }).findings.map((f) => f.code),
    ).not.toContain('unbound-conversation')
    const strict = validateDialogue([dialogue], { strict: true, quests: [quests] })
    const found = strict.findings.filter((finding) => finding.code === 'unbound-conversation')
    expect(found).toHaveLength(1)
    expect(found[0].message).toContain('"spare"')
  })

  it('needs the quests to say anything about bindings', () => {
    expect(validateDialogue([dialogue], { strict: true }).findings).toEqual([])
  })
})

describe('several documents', () => {
  it('prefixes the path with the document index and shares the id space', () => {
    const result = validateDialogue([
      doc({ id: 'a', start: 'g', nodes: [{ id: 'g', text: 'x' }] }),
      doc({ id: 'a', start: 'g', nodes: [{ id: 'g', text: 'x' }] }),
    ])
    expect(result.findings[0].path).toBe('documents[1].conversations[0]')
    expect(result.findings[0].code).toBe('duplicate-conversation-id')
  })
})
