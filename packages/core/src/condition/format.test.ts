import { describe, expect, it } from 'vitest'
import type { Condition, Objective } from '../model.js'
import {
  formatCompletion,
  formatCondition,
  formatObjective,
  parseCompletion,
  parseCondition,
  parseObjective,
} from './index.js'

/** Hand written corpus for the round trip property. */
const ROUND_TRIP = [
  'flag.met_harbormaster',
  'count.catch_rare >= 5',
  'step.steal or step.trade',
  'outcome.old_lighthouse.restored and not flag.banned_from_harbor',
  'var.season in ["spring", "summer"]',
  'flag.a and flag.b and flag.c',
  'flag.a or flag.b or flag.c',
  'flag.a and (flag.b or flag.c)',
  '(flag.a or flag.b) and flag.c',
  'flag.a and (flag.b and flag.c)',
  'flag.a or (flag.b or flag.c)',
  'not flag.a',
  'not not flag.a',
  'not (flag.a and flag.b)',
  'not count.x == 1',
  'count.x == 3',
  'count.x != 3',
  'count.x < 3',
  'count.x <= 3',
  'count.x > 3',
  'count.x >= 3',
  'count.x == -2.5',
  'quest.harbor == "open"',
  'step.harbor#deliver',
  'step.x == "failed"',
  'flag.a == false',
  'var.mood == "calm"',
  'var.name == "a \\"quoted\\" name"',
  'var.path == "a\\\\b"',
  'var.x in [1, 2, 3]',
  'var.x in [true, false]',
  'var.x in []',
  '(count.x > 1) == true',
  '(flag.a and flag.b) == true',
  '(not true) == true',
  'flag.a and not flag.b or flag.c',
  'flag.x == flag.y',
  'true',
  'false',
  '42',
  '"hello"',
  '[1, 2]',
]

describe('formatCondition, round trip', () => {
  it.each(ROUND_TRIP)('parse(format(parse(%j))) is stable', (source) => {
    const tree = parseCondition(source)
    const text = formatCondition(tree)
    expect(parseCondition(text)).toEqual(tree)
    expect(formatCondition(parseCondition(text))).toBe(text)
  })

  it('is idempotent on its own output', () => {
    for (const source of ROUND_TRIP) {
      const once = formatCondition(parseCondition(source))
      expect(formatCondition(parseCondition(once))).toBe(once)
    }
  })
})

describe('formatCondition, canonical spelling', () => {
  it('reverses the bare path sugar', () => {
    expect(formatCondition({ '==': [{ var: 'flag.x' }, true] })).toBe('flag.x')
    expect(formatCondition({ '==': [{ var: 'step.x' }, 'done'] })).toBe('step.x')
    expect(formatCondition({ '==': [{ var: 'outcome.q.n' }, true] })).toBe('outcome.q.n')
    expect(formatCondition({ '==': [{ var: 'count.x' }, true] })).toBe('count.x')
  })

  it('keeps the comparison when the sugar would not read back', () => {
    expect(formatCondition({ '==': [{ var: 'step.x' }, true] })).toBe('step.x == true')
    expect(formatCondition({ '==': [{ var: 'flag.x' }, 'done'] })).toBe('flag.x == "done"')
    expect(formatCondition({ '==': [{ var: 'flag.x' }, false] })).toBe('flag.x == false')
    expect(formatCondition({ '==': [true, { var: 'flag.x' }] })).toBe('true == flag.x')
  })

  it('lowercases keywords and collapses whitespace', () => {
    expect(formatCondition(parseCondition('NOT   flag.a    AND\tflag.b'))).toBe(
      'not flag.a and flag.b',
    )
  })

  it('drops redundant parentheses', () => {
    expect(formatCondition(parseCondition('((flag.a))'))).toBe('flag.a')
    expect(formatCondition(parseCondition('(flag.a and flag.b) or flag.c'))).toBe(
      'flag.a and flag.b or flag.c',
    )
    expect(formatCondition(parseCondition('not (flag.a)'))).toBe('not flag.a')
    expect(formatCondition(parseCondition('(count.x >= 5)'))).toBe('count.x >= 5')
  })

  it('keeps the parentheses of a group that is itself boolean position', () => {
    // A parenthesised group is an expression, so a bare path inside it is sugared.
    // `(count.x) >= 5` therefore compares the boolean `count.x == true` against 5.
    expect(formatCondition(parseCondition('(count.x) >= 5'))).toBe('(count.x) >= 5')
  })

  it('keeps the parentheses precedence needs', () => {
    expect(formatCondition(parseCondition('flag.a and (flag.b or flag.c)'))).toBe(
      'flag.a and (flag.b or flag.c)',
    )
    expect(formatCondition(parseCondition('not (flag.a or flag.b)'))).toBe('not (flag.a or flag.b)')
    expect(formatCondition(parseCondition('not (flag.a and flag.b)'))).toBe(
      'not (flag.a and flag.b)',
    )
    expect(formatCondition({ or: [{ or: ['a', 'b'] }, 'c'] })).toBe('("a" or "b") or "c"')
    expect(formatCondition({ and: [{ and: ['a', 'b'] }, 'c'] })).toBe('("a" and "b") and "c"')
  })

  it('parenthesises a boolean operand of a comparison', () => {
    expect(formatCondition({ '==': [{ and: [true, false] }, true] })).toBe(
      '(true and false) == true',
    )
    expect(formatCondition({ '==': [{ '!': [true] }, true] })).toBe('(not true) == true')
    expect(formatCondition({ '==': [{ '<': [1, 2] }, true] })).toBe('(1 < 2) == true')
  })

  it('quotes and escapes strings', () => {
    expect(formatCondition({ '==': [{ var: 'var.n' }, 'a "q" b'] })).toBe('var.n == "a \\"q\\" b"')
    expect(formatCondition({ '==': [{ var: 'var.n' }, 'a\\b'] })).toBe('var.n == "a\\\\b"')
  })

  it('prints lists with one space after each comma', () => {
    expect(formatCondition({ in: [{ var: 'var.x' }, [1, 'a', true]] })).toBe(
      'var.x in [1, "a", true]',
    )
  })

  it('prints a bare variable on a best effort basis', () => {
    expect(formatCondition({ var: 'flag.x' })).toBe('flag.x')
  })

  it('accepts a non array argument list', () => {
    expect(formatCondition({ '!': true } as unknown as Condition)).toBe('not true')
  })

  it('throws on an operator outside the whitelist', () => {
    expect(() => formatCondition({ pow: [2, 3] } as unknown as Condition)).toThrow(
      /cannot format unknown condition operator "pow"/,
    )
  })
})

const OBJECTIVES: Array<[string, Objective]> = [
  ['kill goblin', { kind: 'kill', actor: 'goblin' }],
  ['kill goblin 3', { kind: 'kill', actor: 'goblin', count: 3 }],
  ['collect fish.rare', { kind: 'collect', item: 'fish.rare' }],
  ['collect fish.rare 5', { kind: 'collect', item: 'fish.rare', count: 5 }],
  ['reach pier.end', { kind: 'reach', location: 'pier.end' }],
  ['talk harbormaster', { kind: 'talk', actor: 'harbormaster' }],
  ['talk harbormaster ines_intro', { kind: 'talk', actor: 'harbormaster', dialogue: 'ines_intro' }],
  ['interact door.pier', { kind: 'interact', object: 'door.pier' }],
  ['event guard.caught', { kind: 'event', event: 'guard.caught' }],
  ['event guard.caught 2', { kind: 'event', event: 'guard.caught', count: 2 }],
  ['custom puzzle', { kind: 'custom', custom: 'puzzle', args: [] }],
  ['custom puzzle tiles 3', { kind: 'custom', custom: 'puzzle', args: ['tiles', '3'] }],
]

describe('formatObjective', () => {
  it.each(OBJECTIVES)('round trips %s', (text, objective) => {
    expect(formatObjective(objective)).toBe(text)
    expect(parseObjective(text)).toStrictEqual(objective)
  })

  it('throws on an unknown kind', () => {
    expect(() => formatObjective({ kind: 'fly' } as unknown as Objective)).toThrow(
      /cannot format unknown objective/,
    )
  })
})

describe('formatCompletion', () => {
  it('prints an objective alone', () => {
    expect(formatCompletion({ objective: { kind: 'talk', actor: 'ines' } })).toBe('talk ines')
  })

  it('prints an objective and a condition', () => {
    expect(
      formatCompletion({
        objective: { kind: 'collect', item: 'fish.rare', count: 5 },
        condition: { '==': [{ var: 'flag.otter_agreed' }, true] },
      }),
    ).toBe('collect fish.rare 5 and flag.otter_agreed')
  })

  it('prints a condition alone', () => {
    expect(formatCompletion({ condition: { '==': [{ var: 'flag.x' }, true] } })).toBe('flag.x')
  })

  it('prints a falsy condition rather than dropping it', () => {
    expect(formatCompletion({ condition: false })).toBe('false')
  })

  it('prints nothing when there is nothing', () => {
    expect(formatCompletion({})).toBe('')
  })

  it.each([
    'collect fish.rare 5',
    'collect fish.rare 5 and flag.otter_agreed',
    'talk harbormaster',
    'talk harbormaster ines_intro and not flag.rushed',
    'custom puzzle tiles and flag.x',
    'flag.met_harbormaster',
    'step.a or step.b',
  ])('round trips the complete cell %j', (source) => {
    const parts = parseCompletion(source)
    expect(formatCompletion(parts)).toBe(source)
    expect(parseCompletion(formatCompletion(parts))).toEqual(parts)
  })
})
