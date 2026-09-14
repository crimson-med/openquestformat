import { describe, expect, it } from 'vitest'
import { done, inState, quest, referenceDocument, step } from './fixtures.js'
import {
  findCycles,
  isStartStep,
  pathNamespace,
  pathRest,
  reachableSteps,
  readsGameVariables,
  satisfiable,
  stepConditions,
  stepDependencies,
  stepGraph,
} from './graph.js'

describe('stepConditions', () => {
  it('returns the fields the step fills, in evaluation order', () => {
    const fields = stepConditions(
      step('a', { complete: true, unlock: done('b'), fail: { var: 'flag.x' } }),
    ).map((entry) => entry.field)
    expect(fields).toEqual(['unlock', 'complete', 'fail'])
  })
})

describe('variable paths', () => {
  it('splits a path into a namespace and the rest', () => {
    expect(pathNamespace('outcome.old_lighthouse.restored')).toBe('outcome')
    expect(pathRest('outcome.old_lighthouse.restored')).toBe('old_lighthouse.restored')
    expect(pathNamespace('flag')).toBe('flag')
    expect(pathRest('flag')).toBe('')
  })
})

describe('stepDependencies', () => {
  it('collects step and counter reads from every condition field', () => {
    const found = stepDependencies(
      step('c', {
        unlock: done('a'),
        activate: { var: 'flag.ready' },
        complete: { '>=': [{ var: 'count.b' }, 3] },
        fail: inState('d', 'failed'),
      }),
    )
    expect(found).toEqual(['a', 'b', 'd'])
  })

  it('reports a step only once however often it is read', () => {
    expect(
      stepDependencies(step('c', { unlock: done('a'), fail: inState('a', 'failed') })),
    ).toEqual(['a'])
  })

  it('leaves out a step watching its own counter', () => {
    expect(stepDependencies(step('a', { complete: { '>=': [{ var: 'count.a' }, 5] } }))).toEqual([])
  })

  it('keeps a step reading its own state', () => {
    expect(stepDependencies(step('a', { unlock: done('a') }))).toEqual(['a'])
  })

  it('leaves out references to steps in other quests', () => {
    expect(stepDependencies(step('c', { unlock: done('other#a') }))).toEqual([])
  })
})

describe('stepGraph', () => {
  it('lists every step as a node and every dependency as an edge into the dependent', () => {
    const graph = stepGraph(
      quest('q', [
        step('a', { start: true }),
        step('b', { unlock: done('a') }),
        step('c', { unlock: { or: [done('a'), done('b')] } }),
      ]),
    )
    expect(graph.nodes).toEqual(['a', 'b', 'c'])
    expect(graph.edges).toEqual([
      ['a', 'b'],
      ['a', 'c'],
      ['b', 'c'],
    ])
  })

  it('drops references to steps the quest does not have', () => {
    const graph = stepGraph(quest('q', [step('a', { unlock: done('ghost') })]))
    expect(graph.edges).toEqual([])
  })

  it('keeps a step that depends on itself as a self edge', () => {
    const graph = stepGraph(quest('q', [step('a', { unlock: done('a') })]))
    expect(graph.edges).toEqual([['a', 'a']])
  })

  it('draws the reference quest', () => {
    const graph = stepGraph(referenceDocument().quests[0])
    expect(graph.nodes).toHaveLength(9)
    expect(graph.edges).toContainEqual(['trade', 'have_ledger'])
    expect(graph.edges).toContainEqual(['steal', 'have_ledger'])
    expect(graph.edges).toContainEqual(['steal', 'caught'])
    expect(graph.edges.filter(([, to]) => to === 'talk_ines')).toEqual([])
  })
})

describe('findCycles', () => {
  it('finds nothing in a chain', () => {
    expect(findCycles(stepGraph(referenceDocument().quests[0]))).toEqual([])
  })

  it('finds a two step cycle', () => {
    const cycles = findCycles(
      stepGraph(quest('q', [step('a', { unlock: done('b') }), step('b', { unlock: done('a') })])),
    )
    expect(cycles).toHaveLength(1)
    expect([...cycles[0]].sort()).toEqual(['a', 'b'])
  })

  it('finds a self loop', () => {
    expect(findCycles(stepGraph(quest('q', [step('a', { unlock: done('a') })])))).toEqual([['a']])
  })
})

describe('satisfiable', () => {
  const context = { inQuest: new Set(['a']), reachable: new Set(['a']) }

  it('finds an assignment for a reachable step read', () => {
    expect(satisfiable(done('a'), context)).toBe(true)
  })

  it('proves a contradiction has none', () => {
    expect(satisfiable({ and: [done('a'), inState('a', 'failed')] }, context)).toBe(false)
  })

  it('pins a step that is not reachable yet to locked', () => {
    expect(satisfiable(done('a'), { inQuest: new Set(['a']), reachable: new Set() })).toBe(false)
  })

  it('leaves game variables free unless they are ignored', () => {
    expect(satisfiable({ var: 'var.night' }, context)).toBe(true)
    expect(satisfiable({ var: 'var.night' }, { ...context, ignoreVars: true })).toBe(false)
  })
})

describe('reachableSteps', () => {
  it('starts from steps marked start and from steps with no unlock', () => {
    expect(isStartStep(step('a', { start: true, unlock: done('b') }))).toBe(true)
    expect(isStartStep(step('a'))).toBe(true)
    expect(isStartStep(step('a', { unlock: done('b') }))).toBe(false)
  })

  it('walks a chain to the end', () => {
    const found = reachableSteps(
      quest('q', [
        step('a', { start: true }),
        step('b', { unlock: done('a') }),
        step('c', { unlock: done('b') }),
      ]),
    )
    expect([...found].sort()).toEqual(['a', 'b', 'c'])
  })

  it('leaves out a step whose unlock can never hold', () => {
    const found = reachableSteps(
      quest('q', [
        step('a', { start: true }),
        step('never', { unlock: { and: [done('a'), inState('a', 'failed')] } }),
      ]),
    )
    expect([...found]).toEqual(['a'])
  })

  it('sees which steps read a game variable', () => {
    expect(readsGameVariables(step('a', { complete: { var: 'var.night' } }))).toBe(true)
    expect(readsGameVariables(step('a', { fail: { var: 'var.night' } }))).toBe(false)
    expect(readsGameVariables(step('a', { unlock: done('b') }))).toBe(false)
  })

  it('drops a step that only a game variable can complete when vars are ignored', () => {
    const target = quest('q', [
      step('a', { start: true }),
      step('risky', { unlock: done('a'), complete: { var: 'var.night' } }),
      step('end', { unlock: done('risky') }),
    ])
    expect([...reachableSteps(target)].sort()).toEqual(['a', 'end', 'risky'])
    expect([...reachableSteps(target, { ignoreVars: true })]).toEqual(['a'])
  })

  it('proves both endings of the reference quest without a game variable', () => {
    const proven = reachableSteps(referenceDocument().quests[0], { ignoreVars: true })
    expect(proven.has('return_ledger')).toBe(true)
    expect(proven.has('sell_ledger')).toBe(true)
    expect(proven.has('steal')).toBe(false)
  })
})
