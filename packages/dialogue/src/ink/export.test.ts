import type { Condition } from '@oqf/core'
import { Compiler } from 'inkjs/full'
import { describe, expect, it } from 'vitest'
import type { DialogueDocument } from '../model.js'
import { escapeInkText, inkVariables, toInk } from './export.js'
import { renderExpression } from './expression.js'
import { encodePayload, toIdentifier } from './naming.js'

function lines(source: string): string[] {
  return source.split('\n')
}

const sample: DialogueDocument = {
  speakers: [{ id: 'harbormaster', name: 'Harbormaster Ines' }, { id: 'otter' }],
  conversations: [
    {
      id: 'ines_intro',
      actor: 'harbormaster',
      title: 'Ines asks for help',
      start: 'greet',
      nodes: [
        {
          id: 'greet',
          speaker: 'harbormaster',
          text: 'The ledger is gone.',
          set: [{ flag: 'met_ines' }, { flag: 'mood', value: 'tense' }],
          emit: [{ event: 'quest.offered', payload: { id: 'ledger', tier: 2, urgent: true } }],
          choices: [
            {
              text: 'I will find it.',
              next: 'help',
              once: true,
              condition: { '>=': [{ var: 'count.trade' }, 3] },
              set: [{ flag: 'agreed', value: 'yes' }],
              emit: [{ event: 'quest.accepted' }],
            },
            { text: 'Tell me about the lighthouse.', next: 'lighthouse', show: 'disabled' },
            { text: 'Not now.' },
          ],
        },
        { id: 'lighthouse', text: 'It has been dark for years.', lore: true, next: 'greet' },
        { id: 'help', text: 'Thank you.' },
      ],
    },
  ],
}

describe('toInk, the mapping table', () => {
  const source = toInk(sample)

  it('opens with the oqf_emit external and the speakers dictionary', () => {
    expect(source).toContain('EXTERNAL oqf_emit(event, payload)')
    expect(source).toContain('# oqf_speakers: harbormaster%7CHarbormaster Ines, otter')
  })

  it('declares a VAR for every variable the document writes or reads', () => {
    expect(lines(source)).toEqual(
      expect.arrayContaining([
        'VAR count__trade = 0',
        'VAR flag__agreed = false',
        'VAR flag__met_ines = false',
        'VAR flag__mood = false',
      ]),
    )
  })

  it('writes a conversation as a knot with its actor, title and start divert', () => {
    expect(source).toContain('=== ines_intro ===')
    expect(source).toContain('# actor: harbormaster')
    expect(source).toContain('# title: Ines asks for help')
    expect(source).toContain('-> ines_intro.greet')
  })

  it('writes a node as a stitch with the speaker tag and the line', () => {
    expect(lines(source)).toEqual(
      expect.arrayContaining([
        '= greet',
        '# node: greet',
        '# speaker: harbormaster',
        'The ledger is gone.',
      ]),
    )
  })

  it('writes lore as a tag and next as a divert', () => {
    expect(source).toContain(
      '= lighthouse\n# node: lighthouse\n# lore\nIt has been dark for years.\n-> ines_intro.greet',
    )
  })

  it('ends a node with no next and no choices with -> END', () => {
    expect(source).toContain('= help\n# node: help\nThank you.\n-> END')
  })

  it('writes once choices as * and sticky choices as +', () => {
    expect(source).toContain('* {count__trade >= 3} [I will find it.]')
    expect(source).toContain('+ [Tell me about the lighthouse.] # disabled')
    expect(source).toContain('+ [Not now.]')
  })

  it('writes set as an assignment and emit as an oqf_emit call', () => {
    expect(source).toContain('~ flag__met_ines = true')
    expect(source).toContain('~ flag__mood = "tense"')
    expect(source).toContain('~ oqf_emit("quest.offered", "id=ledger,tier=2,urgent=true")')
    expect(source).toContain('    ~ flag__agreed = "yes"')
    expect(source).toContain('    ~ oqf_emit("quest.accepted", "")')
  })

  it('indents the choice body and closes every choice with a divert', () => {
    expect(source).toContain('    -> ines_intro.help')
    expect(source).toContain('    -> ines_intro.lighthouse')
    expect(source).toContain('+ [Not now.]\n    -> END')
  })

  it('writes ext bags as tags', () => {
    const withExt = toInk({
      speakers: [],
      conversations: [
        {
          id: 'c',
          start: 'n',
          ext: { 'x-game.mood': 'dark' },
          nodes: [
            {
              id: 'n',
              text: 'hi',
              ext: { 'x-game.camera': { pan: 1, tilt: 2 } },
              choices: [{ text: 'ok', ext: { 'x-game.sfx': 'click' } }],
            },
          ],
        },
      ],
    })
    expect(withExt).toContain('# ext: x-game.mood=dark')
    expect(withExt).toContain('# ext: x-game.camera=%7Bpan=1,tilt=2%7D')
    expect(withExt).toContain('    # ext: x-game.sfx=click')
  })

  it('ends with a trailing newline', () => {
    expect(source.endsWith('\n')).toBe(true)
  })
})

describe('identifier translation', () => {
  it('writes a dot as a double underscore', () => {
    expect(toIdentifier('flag.met_ines')).toBe('flag__met_ines')
    expect(toIdentifier('count.trade')).toBe('count__trade')
    expect(toIdentifier('outcome.old_lighthouse.restored')).toBe(
      'outcome__old_lighthouse__restored',
    )
  })

  it('escapes the characters ink identifiers reject', () => {
    expect(toIdentifier('step.harbor#deliver')).toBe('step__harbor_s_deliver')
    expect(toIdentifier('var.season-of-year')).toBe('var__season_h_of_h_year')
  })

  it('escapes a literal underscore that would read back as an escape', () => {
    expect(toIdentifier('flag.a__b')).toBe('flag__a_e__b')
    expect(toIdentifier('flag.a_h_b')).toBe('flag__a_e_h_b')
    expect(toIdentifier('flag.a_hb')).toBe('flag__a_hb')
  })
})

describe('condition rendering', () => {
  const cases: [string, Condition, string][] = [
    ['var', { var: 'flag.met' }, 'flag__met'],
    ['==', { '==': [{ var: 'flag.met' }, true] }, 'flag__met == true'],
    ['!=', { '!=': [{ var: 'step.trade' }, 'done'] }, 'step__trade != "done"'],
    ['<', { '<': [{ var: 'count.fish' }, 5] }, 'count__fish < 5'],
    ['<=', { '<=': [{ var: 'count.fish' }, 5] }, 'count__fish <= 5'],
    ['>', { '>': [{ var: 'count.fish' }, 5] }, 'count__fish > 5'],
    ['>=', { '>=': [{ var: 'count.fish' }, 5] }, 'count__fish >= 5'],
    ['not', { '!': [{ var: 'flag.banned' }] }, 'not flag__banned'],
    ['and', { and: [{ var: 'flag.a' }, { var: 'flag.b' }] }, 'flag__a and flag__b'],
    ['or', { or: [{ var: 'flag.a' }, { var: 'flag.b' }] }, 'flag__a or flag__b'],
    [
      'in',
      { in: [{ var: 'var.season' }, ['spring', 'summer']] },
      '["spring", "summer"] ? var__season',
    ],
    [
      'precedence',
      {
        and: [{ or: [{ var: 'flag.a' }, { var: 'flag.b' }] }, { '!': [{ var: 'flag.c' }] }],
      },
      '(flag__a or flag__b) and not flag__c',
    ],
  ]

  for (const [name, condition, expected] of cases) {
    it(`renders ${name}`, () => {
      expect(renderExpression(condition, 'ink')).toBe(expected)
    })
  }
})

describe('payload encoding', () => {
  it('types numbers, booleans and strings', () => {
    expect(encodePayload({ id: 'ledger', count: 3, urgent: true })).toBe(
      'id=ledger,count=3,urgent=true',
    )
  })

  it('escapes the separators inside a key or a value', () => {
    expect(encodePayload({ 'a,b': 'c=d', plain: 'x,y=z' })).toBe('a\\,b=c\\=d,plain=x\\,y\\=z')
  })

  it('escapes a backslash and an edge space', () => {
    expect(encodePayload({ path: 'a\\b', pad: ' x ' })).toBe('path=a\\\\b,pad=\\ x\\ ')
  })
})

describe('text escaping', () => {
  it('escapes the characters that would start another construct', () => {
    expect(escapeInkText('a # b { c } d', false)).toBe('a \\# b \\{ c \\} d')
    expect(escapeInkText('go -> home', false)).toBe('go -\\> home')
    expect(escapeInkText('* not a choice', false)).toBe('\\* not a choice')
    expect(escapeInkText('glue <> here', false)).toBe('glue <\\> here')
  })

  it('escapes brackets only in choice text', () => {
    expect(escapeInkText('a [b] c', false)).toBe('a [b] c')
    expect(escapeInkText('a [b] c', true)).toBe('a \\[b\\] c')
  })

  it('protects leading and trailing whitespace', () => {
    expect(escapeInkText('  padded  ', false)).toBe('\\  padded \\ ')
  })
})

describe('inkVariables', () => {
  it('lists written flags and read variables once, sorted', () => {
    expect(inkVariables(sample)).toEqual([
      'count.trade',
      'flag.agreed',
      'flag.met_ines',
      'flag.mood',
    ])
  })
})

describe('the exported ink is ink inkjs accepts', () => {
  function compile(doc: DialogueDocument): string[] {
    const errors: string[] = []
    const options = { errorHandler: (message: string) => errors.push(message.split('\n')[0]) }
    try {
      new Compiler(toInk(doc), options as never).Compile()
    } catch {
      // the error handler already collected what went wrong
    }
    return errors
  }

  it('compiles the whole mapping table', () => {
    expect(compile(sample)).toEqual([])
  })

  it('compiles text, tags and payloads that carry ink syntax', () => {
    expect(
      compile({
        speakers: [{ id: 'ines', name: 'Harbormaster Ines' }],
        conversations: [
          {
            id: 'c',
            actor: 'ines',
            title: 'A # title { with } syntax',
            start: 'a',
            ext: { 'x-game.mood': 'dark' },
            nodes: [
              {
                id: 'a',
                speaker: 'ines',
                text: '* Not a choice. Tags # here. {logic} no.',
                next: 'b',
              },
              {
                id: 'b',
                text: 'A divert -> arrow, glue <> text, // comment, /* block */.',
                next: 'd',
              },
              {
                id: 'd',
                text: '  padded  ',
                set: [{ flag: 'a.b' }],
                emit: [{ event: 'e', payload: { 'a,b': 'c=d' } }],
                next: 'e',
              },
              {
                id: 'e',
                text: 'Pick:',
                ext: { 'x-game.camera': { pan: 1 } },
                choices: [
                  {
                    text: 'A [bracketed] answer',
                    once: true,
                    condition: { '>=': [{ var: 'count.trade' }, 3] },
                  },
                  {
                    text: 'quiet',
                    show: 'disabled',
                    condition: { and: [{ var: 'flag.a' }, { '!': [{ var: 'flag.b' }] }] },
                  },
                ],
              },
            ],
          },
        ],
      }),
    ).toEqual([])
  })

  it('renames a stitch that would shadow its knot or break ink naming', () => {
    const source = toInk({
      speakers: [],
      conversations: [
        {
          id: 'quest-one',
          start: 'c',
          nodes: [
            { id: 'c', text: 'Hi.', next: 'quest-one' },
            { id: 'quest-one', text: 'Bye.' },
          ],
        },
      ],
    })
    expect(source).toContain('=== oqf_conversation_1 ===')
    expect(source).toContain('# conversation: quest-one')
    expect(source).toContain('= oqf_node_1_1')
    expect(source).toContain('# node: quest-one')
  })
})
