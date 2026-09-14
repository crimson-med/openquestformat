import { describe, expect, it } from 'vitest'
import { fullDialogue, minimalDialogue } from './fixtures.js'
import { DialogueJsonError, fromDialogueJsonValue, parseDialogueJson } from './parse.js'
import { toDialogueJson, toDialogueJsonValue } from './serialize.js'

function value(partial: Record<string, unknown> = {}): Record<string, unknown> {
  return { oqd: 1, conversations: [], ...partial }
}

function caught(input: unknown): DialogueJsonError {
  try {
    fromDialogueJsonValue(input)
  } catch (error) {
    if (error instanceof DialogueJsonError) return error
    throw error
  }
  throw new Error('expected fromDialogueJsonValue to throw')
}

describe('the document frame', () => {
  it('reads an empty document', () => {
    expect(fromDialogueJsonValue(value())).toEqual({ speakers: [], conversations: [] })
  })

  it('rejects a missing or wrong version', () => {
    expect(caught({ conversations: [] }).path).toBe('oqd')
    expect(caught({ oqd: 2, conversations: [] }).path).toBe('oqd')
  })

  it('rejects an unknown top level key', () => {
    expect(caught(value({ quests: [] })).path).toBe('quests')
  })

  it('rejects a missing conversations list', () => {
    expect(caught({ oqd: 1 }).path).toBe('conversations')
  })
})

describe('speakers', () => {
  it('reads objects and bare id strings', () => {
    const doc = fromDialogueJsonValue(value({ speakers: [{ id: 'a', name: 'A' }, 'b'] }))
    expect(doc.speakers).toEqual([{ id: 'a', name: 'A' }, { id: 'b' }])
  })

  it('locates a bad speaker by index', () => {
    expect(caught(value({ speakers: [{ name: 'A' }] })).path).toBe('speakers[0].id')
  })
})

describe('conversations and nodes', () => {
  it('reads the full shape back into the model', () => {
    const doc = fullDialogue()
    expect(fromDialogueJsonValue(toDialogueJsonValue(doc))).toEqual(doc)
  })

  it('requires an id, a start and nodes', () => {
    expect(caught(value({ conversations: [{ start: 'g', nodes: [] }] })).path).toBe(
      'conversations[0].id',
    )
    expect(caught(value({ conversations: [{ id: 'a', nodes: [] }] })).path).toBe(
      'conversations[0].start',
    )
    expect(caught(value({ conversations: [{ id: 'a', start: 'g' }] })).path).toBe(
      'conversations[0].nodes',
    )
  })

  it('requires an id and a text on a node', () => {
    expect(
      caught(value({ conversations: [{ id: 'a', start: 'g', nodes: [{ id: 'g' }] }] })).path,
    ).toBe('conversations[0].nodes[0].text')
  })

  it('rejects an unknown key on a node and a choice', () => {
    expect(
      caught(
        value({
          conversations: [{ id: 'a', start: 'g', nodes: [{ id: 'g', text: 'x', oops: 1 }] }],
        }),
      ).path,
    ).toBe('conversations[0].nodes[0].oops')
    expect(
      caught(
        value({
          conversations: [
            {
              id: 'a',
              start: 'g',
              nodes: [{ id: 'g', text: 'x', choices: [{ text: 'y', oops: 1 }] }],
            },
          ],
        }),
      ).path,
    ).toBe('conversations[0].nodes[0].choices[0].oops')
  })
})

describe('normalization on read', () => {
  function node(extra: Record<string, unknown>): Record<string, unknown> {
    return value({
      conversations: [{ id: 'a', start: 'g', nodes: [{ id: 'g', text: 'x', ...extra }] }],
    })
  }

  it('reads empty lists as absent', () => {
    const doc = fromDialogueJsonValue(node({ choices: [], set: [], emit: [] }))
    expect(doc.conversations[0].nodes[0]).toEqual({ id: 'g', text: 'x' })
  })

  it('reads false booleans as absent', () => {
    const doc = fromDialogueJsonValue(node({ lore: false, choices: [{ text: 'y', once: false }] }))
    expect(doc.conversations[0].nodes[0]).toEqual({ id: 'g', text: 'x', choices: [{ text: 'y' }] })
  })

  it('reads show hidden as absent, since it is the default', () => {
    const doc = fromDialogueJsonValue(node({ choices: [{ text: 'y', show: 'hidden' }] }))
    expect(doc.conversations[0].nodes[0].choices).toEqual([{ text: 'y' }])
  })

  it('reads an empty extension bag and an empty payload as absent', () => {
    const doc = fromDialogueJsonValue(node({ ext: {}, emit: [{ event: 'e', payload: {} }] }))
    expect(doc.conversations[0].nodes[0]).toEqual({ id: 'g', text: 'x', emit: [{ event: 'e' }] })
  })

  it('rejects a show that is neither hidden nor disabled', () => {
    expect(caught(node({ choices: [{ text: 'y', show: 'greyed' }] })).path).toBe(
      'conversations[0].nodes[0].choices[0].show',
    )
  })
})

describe('conditions', () => {
  function condition(input: unknown): Record<string, unknown> {
    return value({
      conversations: [
        {
          id: 'a',
          start: 'g',
          nodes: [{ id: 'g', text: 'x', choices: [{ text: 'y', condition: input }] }],
        },
      ],
    })
  }

  it('reads an operator tree', () => {
    const doc = fromDialogueJsonValue(condition({ and: [{ var: 'flag.a' }, true] }))
    expect(doc.conversations[0].nodes[0].choices?.[0].condition).toEqual({
      and: [{ var: 'flag.a' }, true],
    })
  })

  it('rejects an unknown operator', () => {
    expect(caught(condition({ nope: [1, 2] })).path).toBe(
      'conversations[0].nodes[0].choices[0].condition',
    )
  })

  it('rejects the wrong arity', () => {
    expect(caught(condition({ '==': [1] })).path).toBe(
      'conversations[0].nodes[0].choices[0].condition.==',
    )
  })

  it('rejects a var path that is not a string', () => {
    expect(caught(condition({ var: 3 })).path).toBe(
      'conversations[0].nodes[0].choices[0].condition.var',
    )
  })
})

describe('flags, emits and extensions', () => {
  function node(extra: Record<string, unknown>): Record<string, unknown> {
    return value({
      conversations: [{ id: 'a', start: 'g', nodes: [{ id: 'g', text: 'x', ...extra }] }],
    })
  }

  it('requires a flag name', () => {
    expect(caught(node({ set: [{ value: 1 }] })).path).toBe('conversations[0].nodes[0].set[0].flag')
  })

  it('rejects a flag value that is not a scalar', () => {
    expect(caught(node({ set: [{ flag: 'a', value: { b: 1 } }] })).path).toBe(
      'conversations[0].nodes[0].set[0].value',
    )
  })

  it('requires an event name', () => {
    expect(caught(node({ emit: [{ payload: {} }] })).path).toBe(
      'conversations[0].nodes[0].emit[0].event',
    )
  })

  it('rejects an extension key that is not x-<namespace>.<key>', () => {
    expect(caught(node({ ext: { nope: 1 } })).path).toBe('conversations[0].nodes[0].ext.nope')
  })

  it('keeps a flat map extension value as written', () => {
    const doc = fromDialogueJsonValue(node({ ext: { 'x-editor.pos': { x: 1, y: 2 } } }))
    expect(doc.conversations[0].nodes[0].ext).toEqual({ 'x-editor.pos': { x: 1, y: 2 } })
  })
})

describe('parseDialogueJson', () => {
  it('round trips the minimal and the full document', () => {
    for (const doc of [minimalDialogue(), fullDialogue()]) {
      expect(parseDialogueJson(toDialogueJson(doc))).toEqual(doc)
    }
  })

  it('reports invalid JSON with an empty path', () => {
    try {
      parseDialogueJson('{')
      throw new Error('expected parseDialogueJson to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(DialogueJsonError)
      expect((error as DialogueJsonError).path).toBe('')
    }
  })
})
