import { describe, expect, it } from 'vitest'
import type { DialogueDocument } from '../model.js'
import { toYarn } from './export.js'
import { fromYarn } from './import.js'

function roundTrip(doc: DialogueDocument): DialogueDocument {
  const result = fromYarn(toYarn(doc))
  expect(result.warnings).toEqual([])
  return result.document
}

const documents: [string, DialogueDocument][] = [
  [
    'a single line conversation',
    {
      speakers: [{ id: 'ines' }],
      conversations: [{ id: 'c', actor: 'ines', start: 'n', nodes: [{ id: 'n', text: 'Hello.' }] }],
    },
  ],
  [
    'every row of the mapping table at once',
    {
      speakers: [
        { id: 'harbormaster', name: 'Harbormaster Ines' },
        { id: 'otter', name: 'The otter' },
        { id: 'unused' },
      ],
      conversations: [
        {
          id: 'ines_intro',
          actor: 'harbormaster',
          title: 'Ines asks for help',
          start: 'greet',
          ext: { 'x-game.mood': 'tense' },
          nodes: [
            {
              id: 'greet',
              speaker: 'harbormaster',
              text: 'The ledger is gone. Will you help me find it?',
              set: [
                { flag: 'met_ines' },
                { flag: 'mood', value: 'tense' },
                { flag: 'tries', value: 0 },
              ],
              emit: [
                { event: 'quest.offered', payload: { id: 'ledger', tier: 2, urgent: true } },
                { event: 'ui.ping' },
              ],
              ext: { 'x-game.camera': { pan: 1, tilt: -2 } },
              choices: [
                {
                  text: 'I will find it.',
                  next: 'help',
                  once: true,
                  condition: { '>=': [{ var: 'count.trade' }, 3] },
                  set: [{ flag: 'agreed', value: 'yes' }],
                  emit: [{ event: 'quest.accepted', payload: { by: 'player' } }],
                  ext: { 'x-game.sfx': 'nod' },
                },
                {
                  text: 'Tell me about the old lighthouse.',
                  next: 'lighthouse',
                  show: 'disabled',
                  condition: { '!': [{ var: 'flag.banned' }] },
                },
                { text: 'Not now.' },
              ],
            },
            {
              id: 'lighthouse',
              speaker: 'otter',
              text: 'It has been dark since the storm.',
              lore: true,
              next: 'greet',
            },
            { id: 'help', text: 'Thank you. Ask around the pier first.' },
          ],
        },
        {
          id: 'otter_smalltalk',
          start: 'hi',
          nodes: [{ id: 'hi', speaker: 'otter', text: '@otter.smalltalk.hi' }],
        },
      ],
    },
  ],
  [
    'every condition operator',
    {
      speakers: [],
      conversations: [
        {
          id: 'c',
          start: 'n',
          nodes: [
            {
              id: 'n',
              text: 'Pick one.',
              choices: [
                { text: 'bare', condition: { var: 'flag.a' } },
                { text: 'eq', condition: { '==': [{ var: 'flag.a' }, true] } },
                { text: 'ne', condition: { '!=': [{ var: 'step.trade' }, 'done'] } },
                { text: 'lt', condition: { '<': [{ var: 'count.fish' }, 5] } },
                { text: 'le', condition: { '<=': [{ var: 'count.fish' }, 5] } },
                { text: 'gt', condition: { '>': [{ var: 'count.fish' }, 5] } },
                { text: 'ge', condition: { '>=': [{ var: 'count.fish' }, 5] } },
                { text: 'not', condition: { '!': [{ var: 'flag.banned' }] } },
                { text: 'and', condition: { and: [{ var: 'flag.a' }, { var: 'flag.b' }] } },
                { text: 'or', condition: { or: [{ var: 'flag.a' }, { var: 'flag.b' }] } },
                { text: 'in', condition: { in: [{ var: 'var.season' }, ['spring', 'summer']] } },
                {
                  text: 'nested',
                  condition: {
                    and: [
                      { or: [{ var: 'outcome.lighthouse.restored' }, { var: 'flag.b' }] },
                      { '!': [{ '==': [{ var: 'quest.ledger' }, 'closed'] }] },
                    ],
                  },
                },
                { text: 'numbers', condition: { in: [{ var: 'count.fish' }, [1, 2, 3]] } },
              ],
            },
          ],
        },
      ],
    },
  ],
  [
    'text that would otherwise be yarn syntax',
    {
      speakers: [],
      conversations: [
        {
          id: 'c',
          start: 'a',
          title: 'A title: with a colon and a #hash',
          nodes: [
            { id: 'a', text: 'Wait: what?', next: 'b' },
            { id: 'b', text: 'Tags #here are not tags, {$x} is not a value.', next: 'c' },
            { id: 'c', text: 'Markup [b]here[/b] and a <<command>> stay as written.', next: 'd' },
            { id: 'd', text: 'A // comment stays too.', next: 'e' },
            { id: 'e', text: '  padded on both sides  ', next: 'f' },
            { id: 'f', text: 'two\nlines and a backslash \\ here', next: 'g' },
            { id: 'g', text: '-> starts like an option', speaker: 'ines', next: 'h' },
            { id: 'h', text: '', next: 'i' },
            {
              id: 'i',
              text: 'Odd choices:',
              choices: [{ text: 'A: answer' }, { text: '' }, { text: 'ends with a space ' }],
            },
          ],
        },
      ],
    },
  ],
  [
    'payloads and ext with escaped separators',
    {
      speakers: [],
      conversations: [
        {
          id: 'c',
          start: 'n',
          nodes: [
            {
              id: 'n',
              text: 'Sending.',
              emit: [
                { event: 'odd.event', payload: { 'a,b': 'c=d', 'x=y': 'p,q', back: 'a\\b' } },
                { event: 'padded', payload: { pad: ' spaced ' } },
              ],
              ext: {
                'x-game.weird': 'semi;colon=equals,comma',
                'x-game.nested': { 'a;b': 'c,d', n: -3.5 },
              },
            },
          ],
        },
      ],
    },
  ],
  [
    'flag and variable names that need identifier escaping',
    {
      speakers: [],
      conversations: [
        {
          id: 'c',
          start: 'n',
          nodes: [
            {
              id: 'n',
              text: 'Odd names.',
              set: [{ flag: 'a.b' }, { flag: 'a__b' }, { flag: 'a_h_b' }, { flag: 'kebab-case' }],
              choices: [
                { text: 'step in another quest', condition: { var: 'step.harbor#deliver' } },
                { text: 'a kebab var', condition: { var: 'var.season-of-year' } },
              ],
            },
          ],
        },
      ],
    },
  ],
  [
    'ids and speakers a yarn title cannot hold',
    {
      speakers: [{ id: 'harbour master' }],
      conversations: [
        {
          id: 'quest-one',
          actor: 'harbour master',
          start: 'a#b',
          nodes: [
            { id: 'a#b', speaker: 'harbour master', text: 'Hello.', next: 'plain' },
            { id: 'plain', text: 'Bye.' },
          ],
        },
      ],
    },
  ],
  [
    'a conversation whose only node loops back to itself',
    {
      speakers: [],
      conversations: [{ id: 'c', start: 'n', nodes: [{ id: 'n', text: 'Again?', next: 'n' }] }],
    },
  ],
]

describe('fromYarn(toYarn(doc))', () => {
  for (const [name, doc] of documents) {
    it(`reproduces ${name} with zero warnings`, () => {
      expect(roundTrip(doc)).toEqual(doc)
    })
  }

  it('is stable across a second pass', () => {
    for (const [, doc] of documents) {
      const once = toYarn(doc)
      expect(toYarn(fromYarn(once).document)).toBe(once)
    }
  })

  it('keeps an empty document empty', () => {
    const empty: DialogueDocument = { speakers: [], conversations: [] }
    expect(roundTrip(empty)).toEqual(empty)
  })
})
