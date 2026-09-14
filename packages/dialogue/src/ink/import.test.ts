import type { Condition } from '@oqf/core'
import { describe, expect, it } from 'vitest'
import { parseExpression } from './expression.js'
import { fromInk } from './import.js'
import { decodeExt, decodePayload, fromIdentifier } from './naming.js'

function constructs(source: string): string[] {
  return fromInk(source).warnings.map((warning) => warning.construct)
}

describe('fromInk, the mapping table read back', () => {
  const source = [
    '# oqf_speakers: harbormaster%7CHarbormaster Ines, otter',
    'EXTERNAL oqf_emit(event, payload)',
    'VAR flag__met_ines = false',
    '',
    '=== ines_intro ===',
    '# actor: harbormaster',
    '# title: Ines asks for help',
    '-> ines_intro.greet',
    '',
    '= greet',
    '# speaker: harbormaster',
    '# ext: x-game.mood=dark',
    '~ flag__met_ines = true',
    '~ oqf_emit("quest.offered", "id=ledger,tier=2")',
    'The ledger is gone.',
    '* {count__trade >= 3} I will find it.',
    '    ~ flag__agreed = "yes"',
    '    -> ines_intro.help',
    '+ Ask about the lighthouse. # disabled',
    '    -> ines_intro.lighthouse',
    '+ Not now.',
    '    -> END',
    '',
    '= lighthouse',
    '# lore',
    'It has been dark for years.',
    '-> ines_intro.greet',
    '',
    '= help',
    'Thank you.',
    '-> END',
    '',
  ].join('\n')

  const { document, warnings } = fromInk(source)

  it('reads the file with no warnings', () => {
    expect(warnings).toEqual([])
  })

  it('reads the speakers dictionary', () => {
    expect(document.speakers).toEqual([
      { id: 'harbormaster', name: 'Harbormaster Ines' },
      { id: 'otter' },
    ])
  })

  it('reads the knot as a conversation with its actor, title and start', () => {
    const conversation = document.conversations[0]
    expect(conversation.id).toBe('ines_intro')
    expect(conversation.actor).toBe('harbormaster')
    expect(conversation.title).toBe('Ines asks for help')
    expect(conversation.start).toBe('greet')
  })

  it('reads stitches as nodes with speaker, lore, ext, set, emit and next', () => {
    const [greet, lighthouse, help] = document.conversations[0].nodes
    expect(greet).toMatchObject({
      id: 'greet',
      speaker: 'harbormaster',
      text: 'The ledger is gone.',
      ext: { 'x-game.mood': 'dark' },
      set: [{ flag: 'met_ines' }],
      emit: [{ event: 'quest.offered', payload: { id: 'ledger', tier: 2 } }],
    })
    expect(lighthouse).toMatchObject({ lore: true, next: 'greet' })
    expect(help.next).toBeUndefined()
  })

  it('reads * as once, + as sticky, the guard and the disabled tag', () => {
    const choices = document.conversations[0].nodes[0].choices ?? []
    expect(choices[0]).toEqual({
      text: 'I will find it.',
      once: true,
      condition: { '>=': [{ var: 'count.trade' }, 3] },
      set: [{ flag: 'agreed', value: 'yes' }],
      next: 'help',
    })
    expect(choices[1]).toEqual({
      text: 'Ask about the lighthouse.',
      show: 'disabled',
      next: 'lighthouse',
    })
    expect(choices[2]).toEqual({ text: 'Not now.' })
  })
})

describe('fromInk, hand written forms', () => {
  it('uses the text before the bracket as the choice text', () => {
    const { document } = fromInk(
      ['=== c ===', '= n', 'Hello.', '+ Yes[, of course] I will help.', '    -> END', ''].join(
        '\n',
      ),
    )
    expect((document.conversations[0].nodes[0].choices ?? [])[0].text).toBe('Yes')
  })

  it('falls back to the bracket contents when nothing precedes them', () => {
    const { document } = fromInk(
      ['=== c ===', '= n', 'Hello.', '+ [Just the label]', '    -> END', ''].join('\n'),
    )
    expect((document.conversations[0].nodes[0].choices ?? [])[0].text).toBe('Just the label')
  })

  it('treats a gather as an implicit node the choices join at', () => {
    const { document, warnings } = fromInk(
      [
        '=== c ===',
        '= n',
        'Which way?',
        '+ Left',
        '+ Right',
        '- Either way, the pier is closed.',
        '-> END',
        '',
      ].join('\n'),
    )
    expect(warnings).toEqual([])
    const nodes = document.conversations[0].nodes
    expect(nodes).toHaveLength(2)
    expect(nodes[1]).toEqual({ id: 'n__1', text: 'Either way, the pier is closed.' })
    expect(nodes[0].choices).toEqual([
      { text: 'Left', next: 'n__1' },
      { text: 'Right', next: 'n__1' },
    ])
  })

  it('chains extra lines in a stitch and in a choice body into implicit nodes', () => {
    const { document } = fromInk(
      ['=== c ===', '= n', 'One.', 'Two.', '+ Go', '    Three.', '    -> END', ''].join('\n'),
    )
    const nodes = document.conversations[0].nodes
    expect(nodes.map((node) => [node.id, node.text, node.next])).toEqual([
      ['n', 'One.', 'n__1'],
      ['n__1', 'Two.', undefined],
      ['n__2', 'Three.', undefined],
    ])
    expect((nodes[1].choices ?? [])[0]).toEqual({ text: 'Go', next: 'n__2' })
  })

  it('reads a trailing divert on a line and a trailing tag on a line', () => {
    const { document, warnings } = fromInk(
      ['=== c ===', '= n', 'Hello there. # speaker: ines', '= m', 'Bye -> END', ''].join('\n'),
    )
    expect(warnings).toEqual([])
    expect(document.conversations[0].nodes[0].speaker).toBe('ines')
    expect(document.conversations[0].nodes[1]).toEqual({ id: 'm', text: 'Bye' })
  })

  it('skips comments and reads a knot body with no stitches', () => {
    const { document, warnings } = fromInk(
      ['// a note', '=== c ===', '/* block', 'comment */', 'Just one line.', '-> END', ''].join(
        '\n',
      ),
    )
    expect(warnings).toEqual([])
    expect(document.conversations[0]).toMatchObject({ id: 'c', start: 'start__1' })
    expect(document.conversations[0].nodes[0].text).toBe('Just one line.')
  })

  it('derives the speakers dictionary when the file declares none', () => {
    const { document } = fromInk(
      ['=== c ===', '# actor: ines', '= n', '# speaker: otter', 'Hi.', '-> END', ''].join('\n'),
    )
    expect(document.speakers).toEqual([{ id: 'ines' }, { id: 'otter' }])
  })
})

describe('fromInk warnings, one per construct', () => {
  it('warns on a TODO line', () => {
    expect(constructs('TODO: write this\n=== c ===\n= n\nHi.\n-> END\n')).toContain('todo')
  })

  it('warns on inline logic and on a sequence', () => {
    expect(constructs('=== c ===\n= n\nYou have {count__fish} fish.\n-> END\n')).toContain(
      'inline-logic',
    )
    expect(constructs('=== c ===\n= n\nHello{ again|once more}.\n-> END\n')).toContain('sequence')
  })

  it('warns on glue', () => {
    expect(constructs('=== c ===\n= n\nHello <> there.\n-> END\n')).toContain('glue')
  })

  it('warns on a tunnel call and a tunnel return', () => {
    expect(constructs('=== c ===\n= n\nHi.\n-> other ->\n')).toContain('tunnel')
    expect(constructs('=== c ===\n= n\nHi.\n->->\n')).toContain('tunnel')
  })

  it('warns on a thread', () => {
    expect(constructs('=== c ===\n= n\nHi.\n<- side\n-> END\n')).toContain('thread')
  })

  it('warns on an external that is not oqf_emit', () => {
    expect(constructs('EXTERNAL rand(a, b)\n=== c ===\n= n\nHi.\n-> END\n')).toContain('external')
  })

  it('warns on CONST, LIST and INCLUDE', () => {
    const source = [
      'CONST LIMIT = 3',
      'LIST Colours = red, blue',
      'INCLUDE extra.ink',
      '=== c ===',
      '= n',
      'Hi.',
      '-> END',
      '',
    ].join('\n')
    expect(constructs(source)).toEqual(expect.arrayContaining(['const', 'list', 'include']))
  })

  it('warns on an ink function and on a call that is not oqf_emit', () => {
    expect(constructs('=== function add(a, b) ===\n~ return a + b\n')).toContain('function')
    expect(constructs('=== c ===\n= n\n~ shuffle()\nHi.\n-> END\n')).toContain('function')
  })

  it('warns on ~ temp, ~ return and a statement that is neither', () => {
    const source = [
      '=== c ===',
      '= n',
      '~ temp x = 1',
      '~ return 2',
      '~ x++',
      'Hi.',
      '-> END',
      '',
    ].join('\n')
    expect(constructs(source)).toEqual(expect.arrayContaining(['temp', 'return', 'logic']))
  })

  it('warns when an assignment is not a flag variable', () => {
    const { document, warnings } = fromInk('=== c ===\n= n\n~ score = 5\nHi.\n-> END\n')
    expect(warnings[0].construct).toBe('variable')
    expect(document.conversations[0].nodes[0].set).toEqual([{ flag: 'score', value: 5 }])
  })

  it('warns on a guard it cannot read and on a function inside one', () => {
    expect(constructs('=== c ===\n= n\nHi.\n+ {flag__a ===} go\n    -> END\n')).toContain(
      'condition',
    )
    expect(constructs('=== c ===\n= n\nHi.\n+ {visited(other)} go\n    -> END\n')).toContain(
      'function',
    )
  })

  it('warns on an unknown tag and on a choice label', () => {
    expect(constructs('=== c ===\n= n\n# CLASS: whisper\nHi.\n-> END\n')).toContain('tag')
    expect(constructs('=== c ===\n= n\nHi.\n+ (again) go\n    -> END\n')).toContain('choice-label')
  })

  it('warns on a nested choice and a nested gather', () => {
    const source = [
      '=== c ===',
      '= n',
      'Hi.',
      '+ Outer',
      '    ** Inner',
      '        -> END',
      '    - - deep join',
      '',
    ].join('\n')
    expect(constructs(source)).toEqual(expect.arrayContaining(['nested-choice', 'nested-gather']))
  })

  it('warns on a divert that points nowhere and one that leaves the knot', () => {
    expect(constructs('=== c ===\n= n\nHi.\n-> nowhere\n')).toContain('divert')
    const source = [
      '=== c ===',
      '= n',
      'Hi.',
      '-> d.m',
      '',
      '=== d ===',
      '= m',
      'Yo.',
      '-> END',
      '',
    ].join('\n')
    expect(constructs(source)).toContain('cross-knot-divert')
  })

  it('warns on content before the first knot and on an empty knot', () => {
    expect(constructs('A stray line.\n=== c ===\n= n\nHi.\n-> END\n')).toContain('stray-content')
    expect(constructs('=== empty ===\n')).toContain('empty-knot')
  })

  it('warns on a multi line logic block', () => {
    const source = ['=== c ===', '= n', 'Hi.', '{ flag__a:', '    yes', '}', '-> END', ''].join(
      '\n',
    )
    expect(constructs(source)).toContain('conditional-block')
  })

  it('warns on a divert that sits after choices', () => {
    const source = ['=== c ===', '= n', 'Hi.', '+ Go', '    -> END', '- ', '-> END', ''].join('\n')
    expect(fromInk(source).warnings.map((w) => w.construct)).not.toContain('crash')
  })

  it('names the line for every warning', () => {
    const { warnings } = fromInk('=== c ===\n= n\nHi.\n~ temp x = 1\n-> END\n')
    expect(warnings[0]).toEqual({
      line: 4,
      construct: 'temp',
      message: expect.stringContaining('temp'),
    })
  })
})

describe('fromInk throws only on unbalanced structure', () => {
  it('throws on an unterminated block comment', () => {
    expect(() => fromInk('=== c ===\n/* never closed\n= n\nHi.\n')).toThrow(/unbalanced/)
  })

  it('throws on an inline logic block that is never closed', () => {
    expect(() => fromInk('=== c ===\n= n\n{ flag__a:\n    yes\n')).toThrow(/unbalanced/)
  })

  it('does not throw on any unknown construct', () => {
    expect(() => fromInk('<- thread\n~ temp x\nLIST a = b\n->->\n{a|b}\n')).not.toThrow()
  })
})

describe('a hand written ink file in the wild style', () => {
  const source = [
    '// Harbour intro, drafted in Inky',
    'INCLUDE globals.ink',
    'LIST Weather = calm, storm',
    '',
    '=== harbour ===',
    '= arrival',
    'Ines looks up from the empty shelf. # speaker: ines',
    'You have {count__trade} trades on the books.',
    '* [Ask about the ledger] "Where is the ledger?"',
    '    ~ flag__asked_ledger = true',
    '    She shrugs. <> "Gone since Tuesday."',
    '    -> harbour.ledger',
    '* (stubborn) {visited(ledger)} "I already asked."',
    '    -> harbour.ledger',
    '+ [Leave]',
    '    -> END',
    '',
    '= ledger',
    '~ temp tries = 0',
    'TODO: write the follow up',
    'She points at the harbourmaster office. # CLASS: quiet',
    '-> harbour.arrival',
    '',
  ].join('\n')

  const { document, warnings } = fromInk(source)

  it('collects at least three warnings and never throws', () => {
    expect(warnings.length).toBeGreaterThanOrEqual(3)
    expect(warnings.map((warning) => warning.construct).sort()).toEqual([
      'choice-label',
      'function',
      'glue',
      'include',
      'inline-logic',
      'list',
      'tag',
      'temp',
      'todo',
    ])
  })

  it('still produces a usable conversation', () => {
    const conversation = document.conversations[0]
    expect(conversation.id).toBe('harbour')
    expect(conversation.start).toBe('arrival')
    expect(conversation.nodes[0]).toMatchObject({
      id: 'arrival',
      speaker: 'ines',
      text: 'Ines looks up from the empty shelf.',
      next: 'arrival__1',
    })
    const choices = conversation.nodes[1].choices ?? []
    expect(choices.map((choice) => choice.text)).toEqual([
      'Ask about the ledger',
      '"I already asked."',
      'Leave',
    ])
    expect(choices[0].set).toEqual([{ flag: 'asked_ledger' }])
    expect(choices[1].condition).toBeUndefined()
  })
})

describe('reading back the shared codecs', () => {
  it('reads an identifier back into a path', () => {
    expect(fromIdentifier('flag__met_ines')).toBe('flag.met_ines')
    expect(fromIdentifier('step__harbor_s_deliver')).toBe('step.harbor#deliver')
    expect(fromIdentifier('var__season_h_of_h_year')).toBe('var.season-of-year')
    expect(fromIdentifier('flag__a_e__b')).toBe('flag.a__b')
    expect(fromIdentifier('flag__a_e_h_b')).toBe('flag.a_h_b')
    expect(fromIdentifier('flag__a_hb')).toBe('flag.a_hb')
  })

  it('reads a payload with escaped separators', () => {
    expect(decodePayload('a\\,b=c\\=d,plain=x')).toEqual({ 'a,b': 'c=d', plain: 'x' })
    expect(decodePayload('count=3,ok=true,name=Ines')).toEqual({
      count: 3,
      ok: true,
      name: 'Ines',
    })
    expect(decodePayload('')).toEqual({})
    expect(decodePayload('bare')).toEqual({ bare: true })
  })

  it('reads an ext bag with a nested record', () => {
    expect(decodeExt('x-game.mood=dark;x-game.camera={pan=1,tilt=2}')).toEqual({
      'x-game.mood': 'dark',
      'x-game.camera': { pan: 1, tilt: 2 },
    })
  })

  it('reads every operator back out of an ink expression', () => {
    const cases: [string, Condition][] = [
      ['flag__met', { var: 'flag.met' }],
      ['flag__met == true', { '==': [{ var: 'flag.met' }, true] }],
      ['step__trade != "done"', { '!=': [{ var: 'step.trade' }, 'done'] }],
      ['count__fish < 5', { '<': [{ var: 'count.fish' }, 5] }],
      ['count__fish <= 5', { '<=': [{ var: 'count.fish' }, 5] }],
      ['count__fish > 5', { '>': [{ var: 'count.fish' }, 5] }],
      ['count__fish >= 5', { '>=': [{ var: 'count.fish' }, 5] }],
      ['not flag__banned', { '!': [{ var: 'flag.banned' }] }],
      ['flag__a and flag__b', { and: [{ var: 'flag.a' }, { var: 'flag.b' }] }],
      ['flag__a or flag__b', { or: [{ var: 'flag.a' }, { var: 'flag.b' }] }],
      ['["spring", "summer"] ? var__season', { in: [{ var: 'var.season' }, ['spring', 'summer']] }],
      [
        '(flag__a or flag__b) and not flag__c',
        { and: [{ or: [{ var: 'flag.a' }, { var: 'flag.b' }] }, { '!': [{ var: 'flag.c' }] }] },
      ],
    ]
    for (const [text, expected] of cases) {
      expect(parseExpression(text, 'ink')).toEqual(expected)
    }
  })

  it('accepts the c style boolean operators a human might type', () => {
    expect(parseExpression('flag__a && !flag__b', 'ink')).toEqual({
      and: [{ var: 'flag.a' }, { '!': [{ var: 'flag.b' }] }],
    })
    expect(parseExpression('flag__a || flag__b', 'ink')).toEqual({
      or: [{ var: 'flag.a' }, { var: 'flag.b' }],
    })
  })
})
