import type { Condition } from '@oqf/core'
import { describe, expect, it } from 'vitest'
import { renderExpression } from '../ink/expression.js'
import type { DialogueDocument } from '../model.js'
import { escapeYarnText, toYarn, yarnTitle } from './export.js'

const sample: DialogueDocument = {
  speakers: [{ id: 'harbormaster', name: 'Harbormaster Ines' }, { id: 'otter' }],
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
          text: 'The ledger is gone.',
          set: [{ flag: 'met_ines' }, { flag: 'mood', value: 'tense' }],
          emit: [{ event: 'quest.offered', payload: { id: 'ledger', tier: 2 } }],
          ext: { 'x-game.camera': 'close' },
          choices: [
            {
              text: 'I will find it.',
              next: 'help',
              once: true,
              condition: { '>=': [{ var: 'count.trade' }, 3] },
              set: [{ flag: 'agreed', value: 'yes' }],
              emit: [{ event: 'quest.accepted' }],
              ext: { 'x-game.sfx': 'nod' },
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

describe('toYarn, the mapping table', () => {
  const source = toYarn(sample)

  it('declares the speakers dictionary in a directive comment', () => {
    expect(source).toContain('// oqf-speakers: harbormaster|Harbormaster Ines, otter')
  })

  it('writes a node with a title, the conversation tag and the start tag', () => {
    expect(source).toContain('title: ines_intro_greet')
    expect(source).toContain('tags: speaker=harbormaster oqf_conversation=ines_intro oqf_start')
    expect(source).toContain('title: ines_intro_lighthouse\ntags: lore oqf_conversation=ines_intro')
  })

  it('writes the conversation actor, title and ext on the start node', () => {
    expect(source).toContain('oqf_actor: harbormaster')
    expect(source).toContain('oqf_title: Ines asks for help')
    expect(source).toContain('oqf_conversation_ext: x-game.mood=tense')
    expect(source).toContain('oqf_ext: x-game.camera=close')
  })

  it('separates the header block with --- and closes the node with ===', () => {
    expect(source).toContain('---\nharbormaster: The ledger is gone.')
    expect(source.trimEnd().endsWith('===')).toBe(true)
  })

  it('writes the speaker as a line prefix', () => {
    expect(source).toContain('harbormaster: The ledger is gone.')
    expect(source).toContain('It has been dark for years.')
  })

  it('writes set and emit as commands', () => {
    expect(source).toContain('<<set $flag__met_ines to true>>')
    expect(source).toContain('<<set $flag__mood to "tense">>')
    expect(source).toContain('<<oqf_emit "quest.offered" "id=ledger,tier=2">>')
    expect(source).toContain('    <<oqf_emit "quest.accepted" "">>')
  })

  it('writes choices as options with an if guard and an indented jump', () => {
    expect(source).toContain('-> I will find it. <<if $count__trade >= 3>>')
    expect(source).toContain('    <<jump ines_intro_help>>')
    expect(source).toContain('-> Tell me about the lighthouse. #oqf_disabled')
    expect(source).toContain('-> Not now.\n    <<stop>>')
  })

  it('wraps a once choice in a once block', () => {
    expect(source).toContain('<<once>>\n-> I will find it.')
    expect(source).toContain('    <<jump ines_intro_help>>\n<<endonce>>')
  })

  it('writes next as a jump and an end as a stop', () => {
    expect(source).toContain('<<jump ines_intro_greet>>')
    expect(source).toContain('Thank you.\n<<stop>>')
  })

  it('writes a choice ext bag as a command', () => {
    expect(source).toContain('    <<oqf_ext "x-game.sfx=nod">>')
  })

  it('ends with a trailing newline', () => {
    expect(source.endsWith('\n')).toBe(true)
  })
})

describe('titles', () => {
  it('joins the conversation and the node id', () => {
    expect(yarnTitle('ines_intro', 'greet', 1)).toBe('ines_intro_greet')
  })

  it('falls back to a generated title when an id cannot live in one', () => {
    expect(yarnTitle('ines intro', 'greet', 4)).toBe('oqf_node_4')
    expect(yarnTitle('c', 'a#b', 7)).toBe('oqf_node_7')
  })

  it('adds the headers that carry the real ids', () => {
    const source = toYarn({
      speakers: [],
      conversations: [
        { id: 'quest-one', start: 'a#b', nodes: [{ id: 'a#b', text: 'Hi.', speaker: 'a b' }] },
      ],
    })
    expect(source).toContain('oqf_conversation: quest-one')
    expect(source).toContain('oqf_node: a#b')
    expect(source).toContain('oqf_speaker: a b')
  })
})

describe('yarn condition rendering', () => {
  const cases: [string, Condition, string][] = [
    ['var', { var: 'flag.met' }, '$flag__met'],
    ['==', { '==': [{ var: 'flag.met' }, true] }, '$flag__met == true'],
    ['!=', { '!=': [{ var: 'step.trade' }, 'done'] }, '$step__trade != "done"'],
    ['<', { '<': [{ var: 'count.fish' }, 5] }, '$count__fish < 5'],
    ['<=', { '<=': [{ var: 'count.fish' }, 5] }, '$count__fish <= 5'],
    ['>', { '>': [{ var: 'count.fish' }, 5] }, '$count__fish > 5'],
    ['>=', { '>=': [{ var: 'count.fish' }, 5] }, '$count__fish >= 5'],
    ['not', { '!': [{ var: 'flag.banned' }] }, 'not $flag__banned'],
    ['and', { and: [{ var: 'flag.a' }, { var: 'flag.b' }] }, '$flag__a and $flag__b'],
    ['or', { or: [{ var: 'flag.a' }, { var: 'flag.b' }] }, '$flag__a or $flag__b'],
    [
      'in',
      { in: [{ var: 'var.season' }, ['spring', 'summer']] },
      '$var__season in ["spring", "summer"]',
    ],
    [
      'precedence',
      { and: [{ or: [{ var: 'flag.a' }, { var: 'flag.b' }] }, { '!': [{ var: 'flag.c' }] }] },
      '($flag__a or $flag__b) and not $flag__c',
    ],
  ]

  for (const [name, condition, expected] of cases) {
    it(`renders ${name} with a dollar sigil`, () => {
      expect(renderExpression(condition, 'yarn')).toBe(expected)
    })
  }
})

describe('yarn text escaping', () => {
  it('escapes the characters that would start another construct', () => {
    expect(escapeYarnText('a #tag {interp} [markup]', false)).toBe(
      'a \\#tag \\{interp\\} \\[markup\\]',
    )
    expect(escapeYarnText('a <<command>>', false)).toBe('a \\<\\<command>>')
    expect(escapeYarnText('-> not an option', false)).toBe('\\-> not an option')
  })

  it('escapes the first colon when the line carries no speaker', () => {
    expect(escapeYarnText('Wait: what?', false)).toBe('Wait\\: what?')
    expect(escapeYarnText('Wait: what?', true)).toBe('Wait: what?')
  })

  it('protects leading and trailing whitespace', () => {
    expect(escapeYarnText('  padded  ', true)).toBe('\\  padded \\ ')
  })
})
