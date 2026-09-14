import { describe, expect, it } from 'vitest'
import { fullDialogue, minimalDialogue } from './fixtures.js'
import { toDialogueJson, toDialogueJsonValue } from './serialize.js'

describe('toDialogueJsonValue', () => {
  it('writes the version, the speakers and the conversations', () => {
    expect(toDialogueJsonValue(minimalDialogue())).toEqual({
      oqd: 1,
      speakers: [],
      conversations: [{ id: 'hello', start: 'only', nodes: [{ id: 'only', text: 'Hello.' }] }],
    })
  })

  it('writes keys in the declaration order of model.ts', () => {
    const value = toDialogueJsonValue(fullDialogue()) as Record<string, unknown>
    expect(Object.keys(value)).toEqual(['oqd', 'speakers', 'conversations'])
    const conversation = (value.conversations as Record<string, unknown>[])[0]
    expect(Object.keys(conversation)).toEqual(['id', 'actor', 'title', 'start', 'nodes', 'ext'])
    const nodes = conversation.nodes as Record<string, unknown>[]
    expect(Object.keys(nodes[0])).toEqual(['id', 'text', 'choices', 'ext'])
    expect(Object.keys(nodes[1])).toEqual(['id', 'speaker', 'text', 'next', 'lore'])
    expect(Object.keys(nodes[2])).toEqual(['id', 'text', 'set', 'emit'])
    const choices = nodes[0].choices as Record<string, unknown>[]
    expect(Object.keys(choices[0])).toEqual([
      'text',
      'next',
      'condition',
      'show',
      'set',
      'emit',
      'once',
      'ext',
    ])
    const sets = choices[0].set as Record<string, unknown>[]
    expect(Object.keys(sets[0])).toEqual(['flag'])
    expect(Object.keys(sets[1])).toEqual(['flag', 'value'])
    const emits = choices[0].emit as Record<string, unknown>[]
    expect(Object.keys(emits[0])).toEqual(['event', 'payload'])
  })

  it('omits false booleans, empty lists and empty extension bags', () => {
    const value = toDialogueJsonValue({
      speakers: [],
      conversations: [
        {
          id: 'talk',
          start: 'g',
          nodes: [{ id: 'g', text: 'x', choices: [], set: [], emit: [], lore: false, ext: {} }],
          ext: {},
        },
      ],
    }) as Record<string, unknown>
    const conversation = (value.conversations as Record<string, unknown>[])[0]
    expect(conversation).toEqual({ id: 'talk', start: 'g', nodes: [{ id: 'g', text: 'x' }] })
  })

  it('writes show only when it is disabled', () => {
    const value = toDialogueJsonValue({
      speakers: [],
      conversations: [
        {
          id: 'talk',
          start: 'g',
          nodes: [{ id: 'g', text: 'x', choices: [{ text: 'a', show: 'hidden' }] }],
        },
      ],
    }) as Record<string, unknown>
    const nodes = (value.conversations as Record<string, unknown>[])[0].nodes as Record<
      string,
      unknown
    >[]
    expect(nodes[0].choices).toEqual([{ text: 'a' }])
  })

  it('copies condition trees instead of sharing them', () => {
    const doc = fullDialogue()
    const value = toDialogueJsonValue(doc) as Record<string, unknown>
    const nodes = (value.conversations as Record<string, unknown>[])[0].nodes as Record<
      string,
      unknown
    >[]
    const choices = nodes[0].choices as Record<string, unknown>[]
    expect(choices[0].condition).not.toBe(doc.conversations[0].nodes[0].choices?.[0].condition)
    expect(choices[0].condition).toEqual({ '>=': [{ var: 'count.trade' }, 5] })
  })
})

describe('toDialogueJson', () => {
  it('pretty prints with two spaces and a trailing newline by default', () => {
    const text = toDialogueJson(minimalDialogue())
    expect(text.endsWith('}\n')).toBe(true)
    expect(text.split('\n')[1]).toBe('  "oqd": 1,')
  })

  it('writes one line when pretty is false', () => {
    const text = toDialogueJson(minimalDialogue(), { pretty: false })
    expect(text).toBe(JSON.stringify(toDialogueJsonValue(minimalDialogue())))
  })
})
