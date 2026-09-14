import type { Condition } from '@oqf/core'
import { describe, expect, it } from 'vitest'
import { parseExpression } from '../ink/expression.js'
import { fromYarn } from './import.js'

function constructs(source: string): string[] {
  return fromYarn(source).warnings.map((warning) => warning.construct)
}

function node(title: string, body: string[], headers: string[] = []): string {
  return [`title: ${title}`, ...headers, '---', ...body, '===', ''].join('\n')
}

describe('fromYarn, the mapping table read back', () => {
  const source = [
    '// oqf-speakers: harbormaster|Harbormaster Ines, otter',
    '',
    'title: ines_intro_greet',
    'tags: speaker=harbormaster oqf_conversation=ines_intro oqf_start',
    'oqf_actor: harbormaster',
    'oqf_title: Ines asks for help',
    'oqf_conversation_ext: x-game.mood=tense',
    'oqf_ext: x-game.camera=close',
    '---',
    'harbormaster: The ledger is gone.',
    '<<set $flag__met_ines to true>>',
    '<<oqf_emit "quest.offered" "id=ledger,tier=2">>',
    '<<once>>',
    '-> I will find it. <<if $count__trade >= 3>>',
    '    <<oqf_ext "x-game.sfx=nod">>',
    '    <<set $flag__agreed to "yes">>',
    '    <<jump ines_intro_help>>',
    '<<endonce>>',
    '-> Tell me about the lighthouse. #oqf_disabled',
    '    <<jump ines_intro_lighthouse>>',
    '-> Not now.',
    '    <<stop>>',
    '===',
    '',
    'title: ines_intro_lighthouse',
    'tags: lore oqf_conversation=ines_intro',
    '---',
    'It has been dark for years.',
    '<<jump ines_intro_greet>>',
    '===',
    '',
    'title: ines_intro_help',
    'tags: oqf_conversation=ines_intro',
    '---',
    'Thank you.',
    '<<stop>>',
    '===',
    '',
  ].join('\n')

  const { document, warnings } = fromYarn(source)

  it('reads the file with no warnings', () => {
    expect(warnings).toEqual([])
  })

  it('reads the speakers directive', () => {
    expect(document.speakers).toEqual([
      { id: 'harbormaster', name: 'Harbormaster Ines' },
      { id: 'otter' },
    ])
  })

  it('groups the nodes into one conversation with actor, title, ext and start', () => {
    const conversation = document.conversations[0]
    expect(conversation.id).toBe('ines_intro')
    expect(conversation.actor).toBe('harbormaster')
    expect(conversation.title).toBe('Ines asks for help')
    expect(conversation.ext).toEqual({ 'x-game.mood': 'tense' })
    expect(conversation.start).toBe('greet')
    expect(conversation.nodes.map((item) => item.id)).toEqual(['greet', 'lighthouse', 'help'])
  })

  it('reads speaker, text, lore, ext, set, emit and jump', () => {
    const [greet, lighthouse, help] = document.conversations[0].nodes
    expect(greet).toMatchObject({
      speaker: 'harbormaster',
      text: 'The ledger is gone.',
      ext: { 'x-game.camera': 'close' },
      set: [{ flag: 'met_ines' }],
      emit: [{ event: 'quest.offered', payload: { id: 'ledger', tier: 2 } }],
    })
    expect(lighthouse).toMatchObject({ lore: true, next: 'greet' })
    expect(help.next).toBeUndefined()
  })

  it('reads options with a guard, a once block and the disabled hashtag', () => {
    const choices = document.conversations[0].nodes[0].choices ?? []
    expect(choices[0]).toEqual({
      text: 'I will find it.',
      once: true,
      condition: { '>=': [{ var: 'count.trade' }, 3] },
      ext: { 'x-game.sfx': 'nod' },
      set: [{ flag: 'agreed', value: 'yes' }],
      next: 'help',
    })
    expect(choices[1]).toEqual({
      text: 'Tell me about the lighthouse.',
      show: 'disabled',
      next: 'lighthouse',
    })
    expect(choices[2]).toEqual({ text: 'Not now.' })
  })
})

describe('fromYarn, plain hand written nodes', () => {
  it('groups untagged nodes into one conversation named after the first', () => {
    const source = [
      node('start', ['Ines: Welcome to the pier.', '<<jump shop>>']),
      node('shop', ['Ines: Anything you need.']),
    ].join('\n')
    const { document, warnings } = fromYarn(source)
    expect(warnings).toEqual([])
    expect(document.conversations).toHaveLength(1)
    expect(document.conversations[0]).toMatchObject({ id: 'start', start: 'start' })
    expect(document.conversations[0].nodes[0]).toEqual({
      id: 'start',
      text: 'Welcome to the pier.',
      speaker: 'Ines',
      next: 'shop',
    })
  })

  it('chains extra lines into implicit nodes', () => {
    const { document } = fromYarn(node('n', ['One.', 'Two.', 'Three.', '<<stop>>']))
    expect(document.conversations[0].nodes.map((item) => [item.id, item.text, item.next])).toEqual([
      ['n', 'One.', 'n__1'],
      ['n__1', 'Two.', 'n__2'],
      ['n__2', 'Three.', undefined],
    ])
  })

  it('chains lines inside an option body', () => {
    const { document } = fromYarn(
      node('n', ['Pick.', '-> Left', '    Ines: You go left.', '    <<jump n>>', '-> Right']),
    )
    const nodes = document.conversations[0].nodes
    expect(nodes[0].choices).toEqual([{ text: 'Left', next: 'n__1' }, { text: 'Right' }])
    expect(nodes[1]).toEqual({ id: 'n__1', text: 'You go left.', speaker: 'Ines', next: 'n' })
  })

  it('derives the speakers dictionary when the file declares none', () => {
    const { document } = fromYarn(node('n', ['Ines: Hello.']))
    expect(document.speakers).toEqual([{ id: 'Ines' }])
  })

  it('reads the oqf_node and oqf_conversation headers when a title cannot hold them', () => {
    const source = node(
      'oqf_node_1',
      ['Hi.', '<<stop>>'],
      ['oqf_conversation: quest-one', 'oqf_node: a#b'],
    )
    const { document, warnings } = fromYarn(source)
    expect(warnings).toEqual([])
    expect(document.conversations[0]).toMatchObject({ id: 'quest-one', start: 'a#b' })
  })
})

describe('fromYarn warnings, one per construct', () => {
  it('warns on an unknown header and on a shadow node', () => {
    expect(constructs(node('n', ['Hi.'], ['position: 10,20']))).toContain('header')
    expect(constructs(node('n', ['Hi.'], ['shadow: other']))).toContain('shadow')
  })

  it('warns on content that sits outside a node', () => {
    expect(constructs(`a stray line\n${node('n', ['Hi.'])}`)).toContain('stray-content')
  })

  it('warns on an unknown tag and on a line hashtag', () => {
    expect(constructs(node('n', ['Hi.'], ['tags: colour=blue']))).toContain('tag')
    expect(constructs(node('n', ['Hi. #line:a1b2c3']))).toContain('line-tag')
  })

  it('warns on interpolation and on markup', () => {
    expect(constructs(node('n', ['You have {$count__fish} fish.']))).toContain('interpolation')
    expect(constructs(node('n', ['A [b]bold[/b] claim.']))).toContain('markup')
  })

  it('warns on an option nested inside an option body', () => {
    expect(constructs(node('n', ['Hi.', '-> One', '    -> Two']))).toContain('nested-option')
  })

  it('warns when a set writes something that is not a flag variable', () => {
    const { document, warnings } = fromYarn(node('n', ['Hi.', '<<set $score to 5>>']))
    expect(warnings[0].construct).toBe('variable')
    expect(document.conversations[0].nodes[0].set).toEqual([{ flag: 'score', value: 5 }])
  })

  it('warns on a guard it cannot read and on a function inside one', () => {
    expect(constructs(node('n', ['Hi.', '-> go <<if $a ===>>']))).toContain('condition')
    expect(constructs(node('n', ['Hi.', '-> go <<if visited("x")>>']))).toContain('function')
  })

  it('warns on an unknown command, on detour and on declare', () => {
    expect(constructs(node('n', ['Hi.', '<<wait 2>>']))).toContain('command')
    expect(constructs(node('n', ['Hi.', '<<detour other>>']))).toContain('command')
    expect(constructs(node('n', ['Hi.', '<<declare $x = 1>>']))).toContain('declare')
  })

  it('warns on a body level conditional block', () => {
    const source = node('n', ['Hi.', '<<if $flag__a>>', 'Yes.', '<<else>>', 'No.', '<<endif>>'])
    expect(constructs(source)).toEqual(expect.arrayContaining(['if-block']))
  })

  it('warns on a jump that points nowhere and one that leaves the conversation', () => {
    expect(constructs(node('n', ['Hi.', '<<jump nowhere>>']))).toContain('jump')
    const source = [
      node('a_n', ['Hi.', '<<jump b_m>>'], ['tags: oqf_conversation=a']),
      node('b_m', ['Yo.', '<<stop>>'], ['tags: oqf_conversation=b']),
    ].join('\n')
    expect(constructs(source)).toContain('cross-node-jump')
  })

  it('names the line for every warning', () => {
    const { warnings } = fromYarn(node('n', ['Hi.', '<<wait 2>>']))
    expect(warnings[0]).toEqual({
      line: 4,
      construct: 'command',
      message: expect.stringContaining('wait'),
    })
  })
})

describe('fromYarn throws only on unbalanced structure', () => {
  it('throws when a header block has no separator', () => {
    expect(() => fromYarn('title: n\ntags: a\n')).toThrow(/unbalanced/)
  })

  it('throws when a node is never closed', () => {
    expect(() => fromYarn('title: n\n---\nHi.\n')).toThrow(/unbalanced/)
  })

  it('throws when a once block has no endonce', () => {
    expect(() => fromYarn(node('n', ['Hi.', '<<once>>', '-> Go']))).toThrow(/unbalanced/)
  })

  it('does not throw on any unknown construct', () => {
    expect(() =>
      fromYarn(node('n', ['{$x} [b]hi[/b] #line:a', '<<wait 1>>', '<<magic>>'], ['colour: red'])),
    ).not.toThrow()
  })
})

describe('a hand written yarn file in the wild style', () => {
  const source = [
    '// Harbour intro, drafted in Yarn Spinner',
    '',
    'title: Harbour_Arrival',
    'tags: mood_tense',
    'position: 320,180',
    'colorID: 2',
    '---',
    'Ines: You have {$count__trade} trades on the books. #line:0f12ab',
    'Ines: The [b]ledger[/b] is gone.',
    '<<declare $tries = 0>>',
    '-> "Where is the ledger?"',
    '    <<set $flag__asked_ledger to true>>',
    '    <<jump Harbour_Ledger>>',
    '-> "I have to go." <<if visited("Harbour_Ledger")>>',
    '    <<stop>>',
    '===',
    '',
    'title: Harbour_Ledger',
    '---',
    'Ines: Gone since Tuesday.',
    '<<wait 1>>',
    '<<jump Harbour_Arrival>>',
    '===',
    '',
  ].join('\n')

  const { document, warnings } = fromYarn(source)

  it('collects at least three warnings and never throws', () => {
    expect(warnings.length).toBeGreaterThanOrEqual(3)
    expect(warnings.map((warning) => warning.construct).sort()).toEqual([
      'command',
      'declare',
      'function',
      'header',
      'header',
      'interpolation',
      'line-tag',
      'markup',
      'markup',
      'tag',
    ])
  })

  it('still produces a usable conversation', () => {
    const conversation = document.conversations[0]
    expect(conversation.id).toBe('Harbour_Arrival')
    expect(conversation.start).toBe('Harbour_Arrival')
    expect(conversation.nodes[0]).toMatchObject({
      id: 'Harbour_Arrival',
      speaker: 'Ines',
      next: 'Harbour_Arrival__1',
    })
    const choices = conversation.nodes[1].choices ?? []
    expect(choices.map((choice) => choice.text)).toEqual([
      '"Where is the ledger?"',
      '"I have to go."',
    ])
    expect(choices[0].set).toEqual([{ flag: 'asked_ledger' }])
    expect(choices[0].next).toBe('Harbour_Ledger')
    expect(choices[1].condition).toBeUndefined()
  })
})

describe('reading a yarn expression', () => {
  it('reads every operator back out', () => {
    const cases: [string, Condition][] = [
      ['$flag__met', { var: 'flag.met' }],
      ['$flag__met == true', { '==': [{ var: 'flag.met' }, true] }],
      ['$step__trade != "done"', { '!=': [{ var: 'step.trade' }, 'done'] }],
      ['$count__fish < 5', { '<': [{ var: 'count.fish' }, 5] }],
      ['$count__fish <= 5', { '<=': [{ var: 'count.fish' }, 5] }],
      ['$count__fish > 5', { '>': [{ var: 'count.fish' }, 5] }],
      ['$count__fish >= 5', { '>=': [{ var: 'count.fish' }, 5] }],
      ['not $flag__banned', { '!': [{ var: 'flag.banned' }] }],
      ['$flag__a and $flag__b', { and: [{ var: 'flag.a' }, { var: 'flag.b' }] }],
      ['$flag__a or $flag__b', { or: [{ var: 'flag.a' }, { var: 'flag.b' }] }],
      [
        '$var__season in ["spring", "summer"]',
        { in: [{ var: 'var.season' }, ['spring', 'summer']] },
      ],
      [
        '($flag__a or $flag__b) and not $flag__c',
        { and: [{ or: [{ var: 'flag.a' }, { var: 'flag.b' }] }, { '!': [{ var: 'flag.c' }] }] },
      ],
    ]
    for (const [text, expected] of cases) {
      expect(parseExpression(text, 'yarn')).toEqual(expected)
    }
  })

  it('accepts the c style boolean operators a human might type', () => {
    expect(parseExpression('$flag__a && !$flag__b', 'yarn')).toEqual({
      and: [{ var: 'flag.a' }, { '!': [{ var: 'flag.b' }] }],
    })
  })
})
