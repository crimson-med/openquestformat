import { describe, expect, it } from 'vitest'
import { ConditionSyntaxError, parseCompletion, parseCondition, parseObjective } from './index.js'

function expectSyntaxError(run: () => unknown, message: RegExp, offset: number): void {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(ConditionSyntaxError)
    const syntax = error as ConditionSyntaxError
    expect(syntax.message).toMatch(message)
    expect(syntax.offset).toBe(offset)
    return
  }
  throw new Error('expected a ConditionSyntaxError')
}

const flagA = { '==': [{ var: 'flag.a' }, true] }
const flagB = { '==': [{ var: 'flag.b' }, true] }
const flagC = { '==': [{ var: 'flag.c' }, true] }

describe('parseCondition, examples from docs/02-conditions.md', () => {
  it('parses a bare flag', () => {
    expect(parseCondition('flag.met_harbormaster')).toEqual({
      '==': [{ var: 'flag.met_harbormaster' }, true],
    })
  })

  it('parses a counter comparison', () => {
    expect(parseCondition('count.catch_rare >= 5')).toEqual({
      '>=': [{ var: 'count.catch_rare' }, 5],
    })
  })

  it('parses an or of two step states', () => {
    expect(parseCondition('step.steal == "done" or step.trade == "done"')).toEqual({
      or: [{ '==': [{ var: 'step.steal' }, 'done'] }, { '==': [{ var: 'step.trade' }, 'done'] }],
    })
  })

  it('parses an outcome with a negated flag', () => {
    expect(
      parseCondition('outcome.old_lighthouse.restored and not flag.banned_from_harbor'),
    ).toEqual({
      and: [
        { '==': [{ var: 'outcome.old_lighthouse.restored' }, true] },
        { '!': [{ '==': [{ var: 'flag.banned_from_harbor' }, true] }] },
      ],
    })
  })

  it('parses membership in a list literal', () => {
    expect(parseCondition('var.season in ["spring", "summer"]')).toEqual({
      in: [{ var: 'var.season' }, ['spring', 'summer']],
    })
  })
})

describe('parseCondition, bare path sugar', () => {
  it('reads a flag against true', () => {
    expect(parseCondition('flag.x')).toEqual({ '==': [{ var: 'flag.x' }, true] })
  })

  it('reads a step against done', () => {
    expect(parseCondition('step.x')).toEqual({ '==': [{ var: 'step.x' }, 'done'] })
  })

  it('reads a cross quest step against done', () => {
    expect(parseCondition('step.harbor#deliver')).toEqual({
      '==': [{ var: 'step.harbor#deliver' }, 'done'],
    })
  })

  it('reads an outcome against true', () => {
    expect(parseCondition('outcome.q.name')).toEqual({ '==': [{ var: 'outcome.q.name' }, true] })
  })

  it('reads every other namespace against true', () => {
    expect(parseCondition('count.x')).toEqual({ '==': [{ var: 'count.x' }, true] })
    expect(parseCondition('quest.x')).toEqual({ '==': [{ var: 'quest.x' }, true] })
    expect(parseCondition('var.x')).toEqual({ '==': [{ var: 'var.x' }, true] })
  })

  it('does not sugar a path in operand position', () => {
    expect(parseCondition('flag.x == flag.y')).toEqual({
      '==': [{ var: 'flag.x' }, { var: 'flag.y' }],
    })
  })
})

describe('parseCondition, precedence', () => {
  it('binds and tighter than or', () => {
    expect(parseCondition('flag.a and flag.b or flag.c')).toEqual({
      or: [{ and: [flagA, flagB] }, flagC],
    })
    expect(parseCondition('flag.a or flag.b and flag.c')).toEqual({
      or: [flagA, { and: [flagB, flagC] }],
    })
  })

  it('flattens a run of the same operator', () => {
    expect(parseCondition('flag.a and flag.b and flag.c')).toEqual({
      and: [flagA, flagB, flagC],
    })
    expect(parseCondition('flag.a or flag.b or flag.c')).toEqual({ or: [flagA, flagB, flagC] })
  })

  it('binds not to the following comparison only', () => {
    expect(parseCondition('not count.x == 1')).toEqual({
      '!': [{ '==': [{ var: 'count.x' }, 1] }],
    })
    expect(parseCondition('not flag.a and flag.b')).toEqual({
      and: [{ '!': [flagA] }, flagB],
    })
  })

  it('stacks not', () => {
    expect(parseCondition('not not flag.a')).toEqual({ '!': [{ '!': [flagA] }] })
  })

  it('honours parentheses', () => {
    expect(parseCondition('not (flag.a or flag.b)')).toEqual({ '!': [{ or: [flagA, flagB] }] })
    expect(parseCondition('(flag.a or flag.b) and flag.c')).toEqual({
      and: [{ or: [flagA, flagB] }, flagC],
    })
    expect(parseCondition('((flag.a))')).toEqual(flagA)
  })

  it('accepts a boolean expression as a comparison operand', () => {
    expect(parseCondition('(flag.a and flag.b) == true')).toEqual({
      '==': [{ and: [flagA, flagB] }, true],
    })
    expect(parseCondition('(not true) == true')).toEqual({ '==': [{ '!': [true] }, true] })
  })
})

describe('parseCondition, literals', () => {
  it('parses every comparison operator', () => {
    for (const operator of ['==', '!=', '<', '<=', '>', '>=']) {
      expect(parseCondition(`count.x ${operator} 1`)).toEqual({
        [operator]: [{ var: 'count.x' }, 1],
      })
    }
  })

  it('parses signed and fractional numbers', () => {
    expect(parseCondition('count.x == -2.5')).toEqual({ '==': [{ var: 'count.x' }, -2.5] })
    expect(parseCondition('count.x == +3')).toEqual({ '==': [{ var: 'count.x' }, 3] })
    expect(parseCondition('count.x == 0.25')).toEqual({ '==': [{ var: 'count.x' }, 0.25] })
  })

  it('parses string escapes', () => {
    expect(parseCondition('var.n == "a \\"quoted\\" name"')).toEqual({
      '==': [{ var: 'var.n' }, 'a "quoted" name'],
    })
    expect(parseCondition('var.n == "back\\\\slash"')).toEqual({
      '==': [{ var: 'var.n' }, 'back\\slash'],
    })
  })

  it('parses lists of literals', () => {
    expect(parseCondition('var.x in [1, 2.5, "a", true, false]')).toEqual({
      in: [{ var: 'var.x' }, [1, 2.5, 'a', true, false]],
    })
  })

  it('parses an empty list', () => {
    expect(parseCondition('var.x in []')).toEqual({ in: [{ var: 'var.x' }, []] })
  })

  it('parses bare literals', () => {
    expect(parseCondition('true')).toBe(true)
    expect(parseCondition('false')).toBe(false)
    expect(parseCondition('42')).toBe(42)
    expect(parseCondition('"hello"')).toBe('hello')
    expect(parseCondition('[1, 2]')).toEqual([1, 2])
  })

  it('reads keywords and booleans case insensitively', () => {
    expect(parseCondition('NOT flag.a AND flag.b OR flag.c')).toEqual({
      or: [{ and: [{ '!': [flagA] }, flagB] }, flagC],
    })
    expect(parseCondition('var.x IN [TRUE, False]')).toEqual({
      in: [{ var: 'var.x' }, [true, false]],
    })
  })

  it('ignores surrounding whitespace', () => {
    expect(parseCondition('\t flag.a \n and\tflag.b  ')).toEqual({ and: [flagA, flagB] })
  })
})

describe('parseCondition, errors', () => {
  it('reports an empty source', () => {
    expectSyntaxError(() => parseCondition(''), /expected a value, got end of input/, 0)
  })

  it('reports a missing right operand', () => {
    expectSyntaxError(() => parseCondition('flag.a and'), /expected a value/, 10)
    expectSyntaxError(() => parseCondition('count.x == '), /expected a value/, 11)
    expectSyntaxError(() => parseCondition('not'), /expected a value/, 3)
  })

  it('reports an unknown namespace', () => {
    expectSyntaxError(() => parseCondition('bogus.a'), /unknown variable namespace "bogus"/, 0)
    expectSyntaxError(() => parseCondition('flag.a and nope.b'), /unknown variable namespace/, 11)
  })

  it('reports an invalid path', () => {
    expectSyntaxError(() => parseCondition('flag.a:b'), /invalid variable path "flag.a:b"/, 0)
  })

  it('reports a reserved word in value position', () => {
    expectSyntaxError(() => parseCondition('and'), /unexpected keyword "and"/, 0)
    expectSyntaxError(() => parseCondition('count.x == in'), /unexpected keyword "in"/, 11)
  })

  it('reports unbalanced parentheses', () => {
    expectSyntaxError(() => parseCondition('(flag.a'), /expected "\)", got end of input/, 7)
    expectSyntaxError(() => parseCondition('flag.a)'), /unexpected "\)"/, 6)
  })

  it('reports bad strings', () => {
    expectSyntaxError(() => parseCondition('"abc'), /unterminated string/, 0)
    expectSyntaxError(() => parseCondition('"abc\\'), /unterminated string/, 0)
    expectSyntaxError(() => parseCondition('flag.a == "a\\q"'), /unknown escape/, 12)
  })

  it('reports bad numbers', () => {
    expectSyntaxError(
      () => parseCondition('count.x == 1.'),
      /expected a digit after the decimal point/,
      13,
    )
    expectSyntaxError(() => parseCondition('count.x == -'), /expected a digit/, 12)
  })

  it('reports unexpected characters', () => {
    expectSyntaxError(() => parseCondition('count.x == $5'), /unexpected character "\$"/, 11)
    expectSyntaxError(() => parseCondition('flag.a = 1'), /unexpected character "="/, 7)
    expectSyntaxError(() => parseCondition('flag.a ! 1'), /unexpected character "!"/, 7)
  })

  it('reports bad lists', () => {
    expectSyntaxError(() => parseCondition('var.x in [flag.y]'), /a list may only contain/, 10)
    expectSyntaxError(() => parseCondition('var.x in [[1]]'), /a list may only contain/, 10)
    expectSyntaxError(() => parseCondition('var.x in [1 2]'), /expected "," or "\]"/, 12)
    expectSyntaxError(() => parseCondition('var.x in [1,'), /a list may only contain/, 12)
  })

  it('reports trailing input', () => {
    expectSyntaxError(() => parseCondition('flag.a flag.b'), /unexpected "flag.b"/, 7)
  })
})

describe('parseObjective', () => {
  it('parses kill with and without a count', () => {
    expect(parseObjective('kill goblin')).toStrictEqual({ kind: 'kill', actor: 'goblin' })
    expect(parseObjective('kill goblin 3')).toStrictEqual({
      kind: 'kill',
      actor: 'goblin',
      count: 3,
    })
  })

  it('parses collect with and without a count', () => {
    expect(parseObjective('collect fish.rare')).toStrictEqual({
      kind: 'collect',
      item: 'fish.rare',
    })
    expect(parseObjective('collect fish.rare 5')).toStrictEqual({
      kind: 'collect',
      item: 'fish.rare',
      count: 5,
    })
  })

  it('parses reach', () => {
    expect(parseObjective('reach pier.end')).toStrictEqual({ kind: 'reach', location: 'pier.end' })
  })

  it('parses talk with and without a dialogue reference', () => {
    expect(parseObjective('talk harbormaster')).toStrictEqual({
      kind: 'talk',
      actor: 'harbormaster',
    })
    expect(parseObjective('talk harbormaster ines_intro')).toStrictEqual({
      kind: 'talk',
      actor: 'harbormaster',
      dialogue: 'ines_intro',
    })
  })

  it('parses interact', () => {
    expect(parseObjective('interact door.pier')).toStrictEqual({
      kind: 'interact',
      object: 'door.pier',
    })
  })

  it('parses event with and without a count', () => {
    expect(parseObjective('event guard.caught')).toStrictEqual({
      kind: 'event',
      event: 'guard.caught',
    })
    expect(parseObjective('event guard.caught 2')).toStrictEqual({
      kind: 'event',
      event: 'guard.caught',
      count: 2,
    })
  })

  it('parses custom with any number of arguments', () => {
    expect(parseObjective('custom puzzle')).toStrictEqual({
      kind: 'custom',
      custom: 'puzzle',
      args: [],
    })
    expect(parseObjective('custom puzzle tiles 3 left')).toStrictEqual({
      kind: 'custom',
      custom: 'puzzle',
      args: ['tiles', '3', 'left'],
    })
  })

  it('accepts colons in references', () => {
    expect(parseObjective('collect mod:item')).toStrictEqual({
      kind: 'collect',
      item: 'mod:item',
    })
  })

  it('reads the kind case insensitively', () => {
    expect(parseObjective('KILL goblin 2')).toStrictEqual({
      kind: 'kill',
      actor: 'goblin',
      count: 2,
    })
  })

  it('reports errors', () => {
    expectSyntaxError(() => parseObjective(''), /expected an objective kind/, 0)
    expectSyntaxError(() => parseObjective('fly bird'), /unknown objective kind "fly"/, 0)
    expectSyntaxError(() => parseObjective('kill'), /expected an actor reference/, 4)
    expectSyntaxError(() => parseObjective('kill 5'), /invalid an actor reference "5"/, 5)
    expectSyntaxError(() => parseObjective('kill goblin 0'), /count must be a positive integer/, 12)
    expectSyntaxError(() => parseObjective('kill goblin extra'), /unexpected "extra"/, 12)
    expectSyntaxError(() => parseObjective('reach'), /expected a location reference/, 5)
    expectSyntaxError(() => parseObjective('talk'), /expected an actor reference/, 4)
    expectSyntaxError(() => parseObjective('interact'), /expected an object reference/, 8)
    expectSyntaxError(() => parseObjective('event'), /expected an event name/, 5)
    expectSyntaxError(() => parseObjective('custom'), /expected a custom kind/, 6)
    expectSyntaxError(() => parseObjective('custom k a and flag.x'), /unexpected "and"/, 11)
    expectSyntaxError(() => parseObjective('talk npc "x"'), /unexpected "\\"x\\""/, 9)
  })
})

describe('parseCompletion', () => {
  it('parses an objective alone', () => {
    expect(parseCompletion('collect fish.rare 5')).toStrictEqual({
      objective: { kind: 'collect', item: 'fish.rare', count: 5 },
    })
    expect(parseCompletion('talk harbormaster')).toStrictEqual({
      objective: { kind: 'talk', actor: 'harbormaster' },
    })
  })

  it('parses an objective followed by a condition', () => {
    expect(parseCompletion('collect fish.rare 5 and flag.otter_agreed')).toEqual({
      objective: { kind: 'collect', item: 'fish.rare', count: 5 },
      condition: { '==': [{ var: 'flag.otter_agreed' }, true] },
    })
  })

  it('stops custom arguments at and', () => {
    expect(parseCompletion('custom puzzle tiles and flag.x')).toEqual({
      objective: { kind: 'custom', custom: 'puzzle', args: ['tiles'] },
      condition: { '==': [{ var: 'flag.x' }, true] },
    })
  })

  it('parses a bare condition', () => {
    expect(parseCompletion('flag.x')).toStrictEqual({
      condition: { '==': [{ var: 'flag.x' }, true] },
    })
    expect(parseCompletion('step.a == "done" and count.b > 1')).toEqual({
      condition: {
        and: [{ '==': [{ var: 'step.a' }, 'done'] }, { '>': [{ var: 'count.b' }, 1] }],
      },
    })
  })

  it('reads the objective kind case insensitively', () => {
    expect(parseCompletion('Collect fish.rare 2')).toStrictEqual({
      objective: { kind: 'collect', item: 'fish.rare', count: 2 },
    })
  })

  it('reports errors', () => {
    expectSyntaxError(() => parseCompletion(''), /expected an objective or a condition/, 0)
    expectSyntaxError(() => parseCompletion('   '), /expected an objective or a condition/, 0)
    expectSyntaxError(
      () => parseCompletion('collect fish.rare 5 flag.x'),
      /expected "and", got "flag.x"/,
      20,
    )
    expectSyntaxError(
      () => parseCompletion('collect fish.rare 5 and flag.x flag.y'),
      /unexpected "flag.y"/,
      31,
    )
  })
})
