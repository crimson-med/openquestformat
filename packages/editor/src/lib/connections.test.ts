import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { type Quest, type Step, formatCondition, parseCompact, parseCondition } from '@oqf/core'
import { describe, expect, it } from 'vitest'
import { edgeLabels, edgeSpec, linkSteps, unlinkSteps } from './connections'

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

  it('writes a state other than done as a comparison', () => {
    const linked = linkSteps(fresh(), 'steal', { state: 'failed' })
    expect(linked.unlock).toEqual(parseCondition('step.steal == "failed"'))
    expect(formatCondition(linked.unlock as never)).toBe('step.steal == "failed"')
  })

  it('keeps the bare spelling when the state is done', () => {
    const linked = linkSteps(fresh(), 'steal', { field: 'unlock', state: 'done' })
    expect(formatCondition(linked.unlock as never)).toBe('step.steal')
  })

  it('links into activate and keeps the start flag', () => {
    const linked = linkSteps({ ...fresh(), start: true }, 'talk_ines', { field: 'activate' })
    expect(linked.start).toBe(true)
    expect('unlock' in linked).toBe(false)
    expect(formatCondition(linked.activate as never)).toBe('step.talk_ines')
  })

  it('links into complete next to the objective', () => {
    const step = stepOf(ledger, 'trade')
    const linked = linkSteps(step, 'ask_gulls', { field: 'complete', state: 'active' })
    expect(linked.objective).toBe(step.objective)
    expect(formatCondition(linked.complete as never)).toBe(
      'flag.otter_agreed and step.ask_gulls == "active"',
    )
  })

  it('appends to an existing complete condition', () => {
    const step: Step = { ...fresh(), complete: parseCondition('flag.ready') }
    const linked = linkSteps(step, 'talk_ines', { field: 'complete' })
    expect(formatCondition(linked.complete as never)).toBe('flag.ready and step.talk_ines')
  })

  it('links into fail with every state', () => {
    for (const state of ['failed', 'active', 'available', 'skipped'] as const) {
      const linked = linkSteps(fresh(), 'steal', { field: 'fail', state })
      expect(formatCondition(linked.fail as never)).toBe(`step.steal == "${state}"`)
    }
  })

  it('unlinks a dependency whichever field holds it', () => {
    const linked = linkSteps(fresh(), 'steal', { field: 'fail', state: 'failed' })
    expect(unlinkSteps(linked, 'steal')).toEqual(fresh())
  })
})

describe('edgeLabels', () => {
  it('labels the state when it is not done', () => {
    const labels = edgeLabels(ledger)
    expect(labels['steal->caught']).toBe('failed')
    expect(labels['talk_ines->find_otter']).toBe('')
    expect(labels['trade->have_ledger']).toBe('')
    expect(labels['steal->have_ledger']).toBe('')
  })

  it('labels a counter read with its comparison', () => {
    const labels = edgeLabels(parallel)
    expect(labels['gather_lanterns->lanterns_halfway']).toBe('count >= 2')
    expect(labels['meet_organizer->gather_lanterns']).toBe('')
  })

  it('labels a negative state check', () => {
    const labels = edgeLabels(loop)
    expect(labels['meet_angler->cast_line']).toBe('')
    expect(labels['mend_line->cast_line']).toBe('not active')
    expect(labels['cast_line->mend_line']).toBe('failed')
    expect(labels['cast_line->land_eel']).toBe('')
  })

  it('labels the field when it is not unlock, with the state when both apply', () => {
    const quest: Quest = {
      ...ledger,
      steps: [
        stepOf(ledger, 'talk_ines'),
        stepOf(ledger, 'ask_gulls'),
        linkSteps(linkSteps(fresh('a'), 'talk_ines', { field: 'activate' }), 'ask_gulls', {
          field: 'fail',
          state: 'failed',
        }),
        linkSteps(fresh('b'), 'talk_ines', { field: 'complete' }),
        { ...fresh('c'), unlock: parseCondition('not step.talk_ines') },
        { ...fresh('d'), fail: parseCondition('2 <= count.talk_ines') },
      ],
    }
    const labels = edgeLabels(quest)
    expect(labels['talk_ines->a']).toBe('activate')
    expect(labels['ask_gulls->a']).toBe('fail failed')
    expect(labels['talk_ines->b']).toBe('complete')
    expect(labels['talk_ines->c']).toBe('not done')
    expect(labels['talk_ines->d']).toBe('fail count >= 2')
  })

  it('lists each distinct label once when several fields read the source', () => {
    const quest: Quest = {
      ...ledger,
      steps: [
        stepOf(ledger, 'talk_ines'),
        {
          ...fresh('a'),
          unlock: parseCondition('step.talk_ines'),
          fail: parseCondition('step.talk_ines == "failed"'),
        },
      ],
    }
    expect(edgeLabels(quest)['talk_ines->a']).toBe('fail failed')
  })

  it('has one entry per edge of the graph', () => {
    expect(Object.keys(edgeLabels(ledger))).toHaveLength(9)
  })
})

describe('edgeSpec', () => {
  it('reads the field and state of a plain check', () => {
    expect(edgeSpec(ledger, 'talk_ines', 'find_otter')).toEqual({ field: 'unlock', state: 'done' })
    expect(edgeSpec(ledger, 'steal', 'caught')).toEqual({ field: 'unlock', state: 'failed' })
  })

  it('reads the field of a link into fail', () => {
    const quest: Quest = {
      ...ledger,
      steps: [
        stepOf(ledger, 'steal'),
        linkSteps(fresh('a'), 'steal', { field: 'fail', state: 'skipped' }),
      ],
    }
    expect(edgeSpec(quest, 'steal', 'a')).toEqual({ field: 'fail', state: 'skipped' })
  })

  it('falls back to done for reads that are not a state check', () => {
    expect(edgeSpec(parallel, 'gather_lanterns', 'lanterns_halfway')).toEqual({
      field: 'unlock',
      state: 'done',
    })
    expect(edgeSpec(loop, 'mend_line', 'cast_line')).toEqual({ field: 'unlock', state: 'done' })
  })

  it('is undefined when there is no such edge', () => {
    expect(edgeSpec(ledger, 'find_otter', 'talk_ines')).toBeUndefined()
    expect(edgeSpec(ledger, 'talk_ines', 'ghost')).toBeUndefined()
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
