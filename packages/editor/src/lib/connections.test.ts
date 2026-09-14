import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { type Quest, type Step, formatCondition, parseCompact, parseCondition } from '@oqf/core'
import { describe, expect, it } from 'vitest'
import { linkSteps, unlinkSteps } from './connections'

function fixture(name: string): Quest {
  const text = readFileSync(
    fileURLToPath(new URL(`../../../examples/quests/${name}`, import.meta.url)),
    'utf8',
  )
  return parseCompact(text).quests[0]
}

function stepOf(quest: Quest, id: string): Step {
  const step = quest.steps.find((entry) => entry.id === id)
  if (step === undefined) throw new Error(`no step ${id}`)
  return step
}

const ledger = fixture('harbormasters-ledger.oqf')
const parallel = fixture('templates/parallel.oqf')
const loop = fixture('templates/loop.oqf')

function fresh(id = 'fresh'): Step {
  return { id, title: 'Fresh', rewards: [], actors: [] }
}

describe('linkSteps', () => {
  it('gives a fresh step the bare unlock', () => {
    const linked = linkSteps(fresh(), 'talk_ines')
    expect(linked.unlock).toEqual({ '==': [{ var: 'step.talk_ines' }, 'done'] })
    expect(linked.unlock).toEqual(parseCondition('step.talk_ines'))
  })

  it('drops the start flag once the step has an unlock', () => {
    const linked = linkSteps({ ...fresh(), start: true }, 'talk_ines')
    expect('start' in linked).toBe(false)
    expect(formatCondition(linked.unlock as never)).toBe('step.talk_ines')
  })

  it('wraps a bare unlock in an and', () => {
    const linked = linkSteps(stepOf(ledger, 'find_otter'), 'ask_gulls')
    expect(formatCondition(linked.unlock as never)).toBe('step.talk_ines and step.ask_gulls')
  })

  it('wraps an or unlock in an and', () => {
    const linked = linkSteps(stepOf(ledger, 'have_ledger'), 'find_otter')
    expect(formatCondition(linked.unlock as never)).toBe(
      '(step.trade or step.steal) and step.find_otter',
    )
  })

  it('appends to an existing and', () => {
    const linked = linkSteps(stepOf(parallel, 'open_festival'), 'bake_pies')
    expect(formatCondition(linked.unlock as never)).toBe(
      'step.gather_lanterns and step.hang_bunting and step.hire_band and step.bake_pies',
    )
  })

  it('returns the step unchanged when the dependency already exists', () => {
    const step = stepOf(ledger, 'have_ledger')
    expect(linkSteps(step, 'trade')).toBe(step)
    const counted = stepOf(parallel, 'lanterns_halfway')
    expect(linkSteps(counted, 'gather_lanterns')).toBe(counted)
  })

  it('does not touch the other fields', () => {
    const step = stepOf(ledger, 'trade')
    const linked = linkSteps(step, 'ask_gulls')
    expect(linked.objective).toBe(step.objective)
    expect(linked.complete).toBe(step.complete)
    expect(linked.rewards).toBe(step.rewards)
  })
})

describe('unlinkSteps', () => {
  it('leaves the other branch of an or', () => {
    const unlinked = unlinkSteps(stepOf(ledger, 'have_ledger'), 'trade')
    expect(formatCondition(unlinked.unlock as never)).toBe('step.steal')
  })

  it('removes one link of an and chain', () => {
    const unlinked = unlinkSteps(stepOf(parallel, 'open_festival'), 'hang_bunting')
    expect(formatCondition(unlinked.unlock as never)).toBe(
      'step.gather_lanterns and step.hire_band',
    )
  })

  it('collapses an and to its last child', () => {
    const unlinked = unlinkSteps(stepOf(loop, 'cast_line'), 'mend_line')
    expect(formatCondition(unlinked.unlock as never)).toBe('step.meet_angler')
  })

  it('removes a counter read', () => {
    const unlinked = unlinkSteps(stepOf(parallel, 'lanterns_halfway'), 'gather_lanterns')
    expect('unlock' in unlinked).toBe(false)
  })

  it('removes a comparison that is not a done check', () => {
    const unlinked = unlinkSteps(stepOf(ledger, 'caught'), 'steal')
    expect('unlock' in unlinked).toBe(false)
    expect(unlinked.outcome).toEqual(stepOf(ledger, 'caught').outcome)
  })

  it('removes the read from complete and keeps the objective', () => {
    const step: Step = {
      ...fresh(),
      objective: { kind: 'collect', item: 'ledger' },
      complete: parseCondition('step.talk_ines and flag.ready'),
      fail: parseCondition('not step.talk_ines'),
    }
    const unlinked = unlinkSteps(step, 'talk_ines')
    expect(unlinked.objective).toEqual({ kind: 'collect', item: 'ledger' })
    expect(formatCondition(unlinked.complete as never)).toBe('flag.ready')
    expect('fail' in unlinked).toBe(false)
  })

  it('returns an equal step when nothing reads the id', () => {
    const step = stepOf(ledger, 'have_ledger')
    expect(unlinkSteps(step, 'talk_ines')).toEqual(step)
  })

  it('round trips with linkSteps', () => {
    const step = stepOf(ledger, 'find_otter')
    expect(unlinkSteps(linkSteps(step, 'ask_gulls'), 'ask_gulls')).toEqual(step)
  })
})
