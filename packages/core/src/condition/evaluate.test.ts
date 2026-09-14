import { describe, expect, it } from 'vitest'
import type { Condition } from '../model.js'
import { checkCondition, conditionVariables, evaluateCondition, parseCondition } from './index.js'

function resolver(values: Record<string, unknown>): (path: string) => unknown {
  return (path) => values[path]
}

describe('evaluateCondition', () => {
  it('evaluates the sugared forms', () => {
    const resolve = resolver({
      'flag.met': true,
      'step.steal': 'done',
      'step.trade': 'failed',
      'count.fish': 5,
    })
    expect(evaluateCondition(parseCondition('flag.met'), resolve)).toBe(true)
    expect(evaluateCondition(parseCondition('step.steal'), resolve)).toBe(true)
    expect(evaluateCondition(parseCondition('step.trade'), resolve)).toBe(false)
    expect(evaluateCondition(parseCondition('count.fish >= 5'), resolve)).toBe(true)
  })

  it('reads an unknown variable as null', () => {
    const resolve = resolver({})
    expect(evaluateCondition(parseCondition('flag.missing'), resolve)).toBe(false)
    expect(evaluateCondition({ '!': [{ var: 'flag.missing' }] }, resolve)).toBe(true)
    expect(evaluateCondition({ '==': [{ var: 'flag.a' }, { var: 'flag.b' }] }, resolve)).toBe(true)
  })

  it('compares with strict equality', () => {
    const resolve = resolver({ 'var.n': 1 })
    expect(evaluateCondition({ '==': [{ var: 'var.n' }, 1] }, resolve)).toBe(true)
    expect(evaluateCondition({ '==': [{ var: 'var.n' }, '1'] }, resolve)).toBe(false)
    expect(evaluateCondition({ '!=': [{ var: 'var.n' }, '1'] }, resolve)).toBe(true)
    expect(evaluateCondition({ '==': [true, 1] }, resolve)).toBe(false)
  })

  it('orders numbers and strings only', () => {
    const resolve = resolver({})
    expect(evaluateCondition({ '<': [1, 2] }, resolve)).toBe(true)
    expect(evaluateCondition({ '<=': [2, 2] }, resolve)).toBe(true)
    expect(evaluateCondition({ '<=': [3, 2] }, resolve)).toBe(false)
    expect(evaluateCondition({ '>': [3, 2] }, resolve)).toBe(true)
    expect(evaluateCondition({ '>': [2, 2] }, resolve)).toBe(false)
    expect(evaluateCondition({ '>=': [2, 3] }, resolve)).toBe(false)
    expect(evaluateCondition({ '>=': [3, 3] }, resolve)).toBe(true)
    expect(evaluateCondition({ '<': ['a', 'b'] }, resolve)).toBe(true)
    expect(evaluateCondition({ '>': ['b', 'a'] }, resolve)).toBe(true)
    expect(evaluateCondition({ '<': [1, '2'] }, resolve)).toBe(false)
    expect(evaluateCondition({ '>': ['1', 2] }, resolve)).toBe(false)
    expect(evaluateCondition({ '<': [true, false] }, resolve)).toBe(false)
  })

  it('tests membership against a list only', () => {
    const resolve = resolver({ 'var.season': 'spring' })
    expect(evaluateCondition(parseCondition('var.season in ["spring", "summer"]'), resolve)).toBe(
      true,
    )
    expect(evaluateCondition(parseCondition('var.season in ["autumn"]'), resolve)).toBe(false)
    expect(evaluateCondition({ in: ['a', 'abc'] }, resolve)).toBe(false)
    expect(evaluateCondition({ in: [1, ['1']] }, resolve)).toBe(false)
  })

  it('short circuits and', () => {
    const read: string[] = []
    const resolve = (path: string): unknown => {
      read.push(path)
      return path !== 'flag.a'
    }
    expect(evaluateCondition(parseCondition('flag.a and flag.b'), resolve)).toBe(false)
    expect(read).toEqual(['flag.a'])
  })

  it('short circuits or', () => {
    const read: string[] = []
    const resolve = (path: string): unknown => {
      read.push(path)
      return true
    }
    expect(evaluateCondition(parseCondition('flag.a or flag.b'), resolve)).toBe(true)
    expect(read).toEqual(['flag.a'])
  })

  it('evaluates empty and, or', () => {
    const resolve = resolver({})
    expect(evaluateCondition({ and: [] }, resolve)).toBe(true)
    expect(evaluateCondition({ or: [] }, resolve)).toBe(false)
  })

  it('negates', () => {
    const resolve = resolver({})
    expect(evaluateCondition({ '!': [false] }, resolve)).toBe(true)
    expect(evaluateCondition({ '!': [true] }, resolve)).toBe(false)
    expect(evaluateCondition({ '!': false } as unknown as Condition, resolve)).toBe(true)
  })

  it('evaluates bare literals', () => {
    const resolve = resolver({})
    expect(evaluateCondition(true, resolve)).toBe(true)
    expect(evaluateCondition(false, resolve)).toBe(false)
    expect(evaluateCondition(0, resolve)).toBe(false)
    expect(evaluateCondition('x', resolve)).toBe(true)
    expect(evaluateCondition([], resolve)).toBe(false)
    expect(evaluateCondition([1], resolve)).toBe(true)
  })

  it('throws on an operator outside the whitelist', () => {
    const resolve = resolver({})
    expect(() => evaluateCondition({ pow: [2, 3] } as unknown as Condition, resolve)).toThrow(
      /unknown condition operator "pow"/,
    )
  })

  it('throws on an object that is not a single operator', () => {
    const resolve = resolver({})
    expect(() => evaluateCondition({ and: [], or: [] } as unknown as Condition, resolve)).toThrow(
      /exactly one operator, found 2/,
    )
    expect(() => evaluateCondition({} as unknown as Condition, resolve)).toThrow(
      /exactly one operator, found 0/,
    )
  })

  it('evaluates a nested expression', () => {
    const resolve = resolver({
      'outcome.old_lighthouse.restored': true,
      'flag.banned_from_harbor': false,
    })
    const tree = parseCondition('outcome.old_lighthouse.restored and not flag.banned_from_harbor')
    expect(evaluateCondition(tree, resolve)).toBe(true)
  })
})

describe('conditionVariables', () => {
  it('lists paths in source order without duplicates', () => {
    const tree = parseCondition('flag.a and (count.b > 1 or flag.a) and var.c in ["x"]')
    expect(conditionVariables(tree)).toEqual(['flag.a', 'count.b', 'var.c'])
  })

  it('returns nothing for a literal', () => {
    expect(conditionVariables(true)).toEqual([])
    expect(conditionVariables([1, 2])).toEqual([])
  })

  it('walks lists and non array arguments', () => {
    expect(conditionVariables({ '!': { var: 'flag.x' } } as unknown as Condition)).toEqual([
      'flag.x',
    ])
    expect(
      conditionVariables({ in: [{ var: 'var.a' }, [{ var: 'var.b' }]] } as unknown as Condition),
    ).toEqual(['var.a', 'var.b'])
  })

  it('ignores a var whose argument is not a string', () => {
    expect(conditionVariables({ var: 5 } as unknown as Condition)).toEqual([])
  })
})

describe('checkCondition', () => {
  it('accepts a valid tree', () => {
    expect(checkCondition(parseCondition('flag.a and count.b >= 2'))).toEqual([])
    expect(checkCondition(parseCondition('var.x in [1, "a", true]'))).toEqual([])
    expect(checkCondition(parseCondition('not step.x'))).toEqual([])
    expect(checkCondition(true)).toEqual([])
    expect(checkCondition('a')).toEqual([])
    expect(checkCondition(2)).toEqual([])
  })

  it('reports offset -1 because trees carry no source positions', () => {
    const errors = checkCondition({ nope: [1] })
    expect(errors).toHaveLength(1)
    expect(errors[0].offset).toBe(-1)
  })

  it('reports an unknown operator', () => {
    expect(checkCondition({ pow: [2, 3] })[0].message).toMatch(/unknown operator "pow"/)
  })

  it('reports an object with more than one key', () => {
    expect(checkCondition({ and: [], or: [] })[0].message).toMatch(/more than one key: and, or/)
  })

  it('reports an object with no operator', () => {
    expect(checkCondition({})[0].message).toMatch(/has no operator/)
  })

  it('reports a bad var argument', () => {
    expect(checkCondition({ var: 5 })[0].message).toMatch(/"var" expects a string path/)
    expect(checkCondition({ var: 'flag.a:b' })[0].message).toMatch(/invalid variable path/)
    expect(checkCondition({ var: 'bogus.a' })[0].message).toMatch(
      /unknown variable namespace "bogus"/,
    )
  })

  it('reports wrong arity', () => {
    expect(checkCondition({ and: [true] })[0].message).toMatch(/at least two conditions/)
    expect(checkCondition({ or: 'x' })[0].message).toMatch(/at least two conditions/)
    expect(checkCondition({ '!': [true, false] })[0].message).toMatch(/exactly one condition/)
    expect(checkCondition({ '!': true })[0].message).toMatch(/exactly one condition/)
    expect(checkCondition({ '==': [1] })[0].message).toMatch(/exactly two operands/)
    expect(checkCondition({ in: 3 })[0].message).toMatch(/exactly two operands/)
  })

  it('reports nested non scalar lists', () => {
    expect(checkCondition([1, [2]])[0].message).toMatch(/a list may only contain/)
    expect(checkCondition([{ var: 'flag.x' }])[0].message).toMatch(/a list may only contain/)
    expect(checkCondition([1, 'a', true])).toEqual([])
  })

  it('reports values that are not conditions', () => {
    expect(checkCondition(null)[0].message).toMatch(/null is not a valid condition value/)
    expect(checkCondition(undefined)[0].message).toMatch(/undefined is not a valid condition value/)
  })

  it('collects every error in a tree', () => {
    const errors = checkCondition({
      and: [{ var: 'bogus.a' }, { pow: [1, 2] }, { '==': [{ var: 5 }, [null]] }],
    })
    expect(errors.map((error) => error.message)).toEqual([
      'unknown variable namespace "bogus"',
      'unknown operator "pow"',
      '"var" expects a string path',
      'a list may only contain numbers, strings and booleans',
    ])
  })
})
