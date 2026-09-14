import type { OqfDocument, Payload, Quest, Step } from '@oqf/core'
import { emptyDictionaries, parseCondition, parseObjective } from '@oqf/core'
import { describe, expect, it } from 'vitest'
import type { OqfEvent } from './events.js'
import {
  REFERENCE_QUEST,
  chainDocument,
  customDocument,
  loopDocument,
  questWithExtraStep,
  questWithoutGulls,
  referenceDocument,
  repeatDocument,
  repeatStepDocument,
} from './fixtures.js'
import { MAX_PASSES, QuestRuntime } from './runtime.js'
import type { QuestState } from './state.js'

const LEDGER = REFERENCE_QUEST

/** `quest.harbormasters_ledger.step.<id>.<state>`, spelled out for readable expectations. */
function ev(stepId: string, state: string): string {
  return `quest.${LEDGER}.step.${stepId}.${state}`
}

interface Options {
  night?: boolean
  documents?: OqfDocument[]
  eventMap?: Record<string, string>
}

function harness(options: Options = {}) {
  const seen: OqfEvent[] = []
  const runtime = new QuestRuntime({
    documents: options.documents ?? [referenceDocument()],
    resolveVar: (path) => (path === 'var.time.isNight' ? options.night === true : undefined),
    eventMap: options.eventMap,
  })
  runtime.on((event) => seen.push(event))
  return {
    runtime,
    seen,
    names: () => seen.map((event) => event.name),
    payloads: (name: string) => seen.filter((event) => event.name === name).map((e) => e.payload),
    reset: () => {
      seen.length = 0
    },
  }
}

type Harness = ReturnType<typeof harness>

function inline(quests: Quest[]): OqfDocument {
  return { dictionaries: emptyDictionaries(), quests }
}

function only(id: string, step: Partial<Step> & { id: string }): Quest {
  return {
    id,
    version: 1,
    title: id,
    tags: [],
    steps: [{ title: step.id, rewards: [], actors: [], ...step }],
    rewards: [],
  }
}

/** Two quests that both own a step called `errand`, to pin path resolution. */
function twinDocument(): OqfDocument {
  return inline([
    only('first', { id: 'errand', start: true, objective: parseObjective('event tick 5') }),
    only('second', { id: 'errand', start: true, complete: parseCondition('count.errand >= 2') }),
  ])
}

/** A step that only ends on one node of one conversation. */
function nodeBoundDocument(): OqfDocument {
  return inline([
    only('deal', {
      id: 'handshake',
      start: true,
      objective: parseObjective('talk otter otter_trade#handover'),
    }),
  ])
}

function takeQuest(harness: Harness): void {
  harness.runtime.offer(LEDGER)
  harness.runtime.accept(LEDGER)
}

/** Talk to Ines, walk to the den. Leaves `trade` and `steal` both active. */
function reachTheDen(harness: Harness): void {
  takeQuest(harness)
  harness.runtime.emit('dialogue.ended', { actor: 'harbormaster', node: 'ines_intro' })
  harness.runtime.emit('location.entered', { location: 'otter_den' })
}

function tradeForLedger(harness: Harness): void {
  harness.runtime.emit('item.collected', { item: 'fish.rare', amount: 5 })
  harness.runtime.emit('flag.set', { flag: 'otter_traded', value: true })
}

describe('taking a quest', () => {
  it('walks unseen to offered to open and starts the first step', () => {
    const h = harness()
    expect(h.runtime.getState(LEDGER).status).toBe('unseen')
    h.runtime.offer(LEDGER)
    expect(h.names()).toEqual([`quest.${LEDGER}.offered`])
    expect(h.runtime.getState(LEDGER).status).toBe('offered')
    h.reset()
    h.runtime.accept(LEDGER)
    expect(h.runtime.getState(LEDGER).status).toBe('open')
    expect(h.names()).toEqual([ev('talk_ines', 'available'), ev('talk_ines', 'active')])
    expect(h.seen[0].payload).toEqual({ from: 'locked' })
  })

  it('offers on accept for games with no accept step', () => {
    const h = harness()
    h.runtime.accept(LEDGER)
    expect(h.names()).toEqual([
      `quest.${LEDGER}.offered`,
      ev('talk_ines', 'available'),
      ev('talk_ines', 'active'),
    ])
    expect(h.runtime.getState(LEDGER).status).toBe('open')
  })

  it('leaves an already offered quest alone and rejects unknown ids', () => {
    const h = harness()
    h.runtime.offer(LEDGER)
    h.reset()
    h.runtime.offer(LEDGER)
    expect(h.names()).toEqual([])
    expect(() => h.runtime.offer('nope')).toThrow(/unknown quest/)
    expect(() => h.runtime.getState('nope')).toThrow(/unknown quest/)
  })
})

describe('the trade route', () => {
  it('reaches the returned outcome and grants its rewards', () => {
    const h = harness()
    takeQuest(h)
    h.reset()

    h.runtime.emit('dialogue.ended', { actor: 'harbormaster', node: 'ines_intro' })
    expect(h.names()).toEqual([
      ev('talk_ines', 'done'),
      ev('ask_gulls', 'available'),
      ev('find_otter', 'available'),
      ev('ask_gulls', 'active'),
      ev('find_otter', 'active'),
    ])
    h.reset()

    h.runtime.emit('location.entered', { location: 'otter_den' })
    expect(h.names()).toEqual([
      ev('find_otter', 'done'),
      ev('trade', 'available'),
      ev('steal', 'available'),
      ev('trade', 'active'),
      ev('steal', 'active'),
    ])
    h.reset()

    h.runtime.emit('item.collected', { item: 'fish.rare', amount: 3 })
    h.runtime.emit('item.collected', { item: 'fish.rare' })
    h.runtime.emit('item.collected', { item: 'fish.rare' })
    expect(h.runtime.getState(LEDGER).steps.trade.count).toBe(5)
    expect(h.names()).toEqual([])

    h.runtime.emit('flag.set', { flag: 'otter_traded', value: true })
    expect(h.names()).toEqual([
      ev('trade', 'done'),
      'reward.granted',
      ev('have_ledger', 'available'),
      ev('have_ledger', 'active'),
      ev('have_ledger', 'done'),
      ev('return_ledger', 'available'),
      ev('sell_ledger', 'available'),
      ev('return_ledger', 'active'),
      ev('sell_ledger', 'active'),
    ])
    expect(h.payloads('reward.granted')).toEqual([
      {
        quest: LEDGER,
        step: 'trade',
        reward: 'trade_xp',
        kind: 'xp',
        ref: 'xp',
        amount: 50,
      },
    ])
    h.reset()

    h.runtime.emit('dialogue.ended', { actor: 'harbormaster', node: 'ines_return' })
    expect(h.names()).toEqual([
      ev('return_ledger', 'done'),
      ev('ask_gulls', 'skipped'),
      ev('steal', 'skipped'),
      ev('sell_ledger', 'skipped'),
      ev('caught', 'skipped'),
      'reward.granted',
      'reward.granted',
      'reward.granted',
      'cozycoast.ledger.restored',
      `quest.${LEDGER}.outcome`,
    ])
    expect(h.payloads(`quest.${LEDGER}.outcome`)).toEqual([{ name: 'returned', failed: false }])
    expect(h.payloads('cozycoast.ledger.restored')).toEqual([{ feature: 'catch_log' }])
    expect(h.payloads('reward.granted').map((payload) => payload.reward)).toEqual([
      'returned_rep',
      'returned_lure',
      'returned_event',
    ])

    const state = h.runtime.getState(LEDGER)
    expect(state.status).toBe('closed')
    expect(state.outcome).toBe('returned')
    expect(state.rewards).toEqual(['trade_xp', 'returned_rep', 'returned_lure', 'returned_event'])
    expect(state.steps.caught.state).toBe('skipped')
    expect(state.steps.steal.state).toBe('skipped')
  })

  it('reaches the sold outcome and sets the vendor flag', () => {
    const h = harness()
    reachTheDen(h)
    tradeForLedger(h)
    h.reset()

    h.runtime.emit('dialogue.ended', { actor: 'smuggler', node: 'smuggler_deal' })
    expect(h.names()).toEqual([
      ev('sell_ledger', 'done'),
      ev('ask_gulls', 'skipped'),
      ev('steal', 'skipped'),
      ev('return_ledger', 'skipped'),
      ev('caught', 'skipped'),
      'reward.granted',
      'reward.granted',
      'reward.granted',
      'flag.set',
      `quest.${LEDGER}.outcome`,
    ])
    expect(h.payloads('flag.set')).toEqual([
      { flag: 'smuggler_vendor_open', value: true, quest: LEDGER },
    ])

    const state = h.runtime.getState(LEDGER)
    expect(state.outcome).toBe('sold')
    expect(state.flags).toEqual({ smuggler_vendor_open: true })
    expect(state.rewards).toEqual(['trade_xp', 'sold_coins', 'sold_rep', 'sold_vendor'])
    expect(h.runtime.resolve('flag.smuggler_vendor_open')).toBe(true)
  })
})

describe('the steal route', () => {
  it('needs the night variable before the chest counts', () => {
    const h = harness({ night: false })
    reachTheDen(h)
    h.reset()
    h.runtime.emit('object.interacted', { object: 'ledger_chest' })
    expect(h.names()).toEqual([])
    expect(h.runtime.getState(LEDGER).steps.steal).toMatchObject({ state: 'active', count: 1 })
  })

  it('reaches the returned outcome without any step reward', () => {
    const h = harness({ night: true })
    reachTheDen(h)
    h.reset()

    h.runtime.emit('object.interacted', { object: 'ledger_chest' })
    expect(h.names()).toEqual([
      ev('steal', 'done'),
      ev('have_ledger', 'available'),
      ev('have_ledger', 'active'),
      ev('have_ledger', 'done'),
      ev('return_ledger', 'available'),
      ev('sell_ledger', 'available'),
      ev('return_ledger', 'active'),
      ev('sell_ledger', 'active'),
    ])
    h.reset()

    h.runtime.emit('dialogue.ended', { actor: 'harbormaster', node: 'ines_return' })
    const state = h.runtime.getState(LEDGER)
    expect(state.outcome).toBe('returned')
    expect(state.rewards).toEqual(['returned_rep', 'returned_lure', 'returned_event'])
    expect(state.steps.trade.state).toBe('skipped')
  })

  it('fails on the guard and reaches the confiscated outcome', () => {
    const h = harness({ night: true })
    reachTheDen(h)
    h.reset()

    h.runtime.emit('guard.caught')
    expect(h.names()).toEqual([
      ev('steal', 'failed'),
      ev('caught', 'available'),
      ev('caught', 'active'),
      ev('caught', 'failed'),
      ev('ask_gulls', 'skipped'),
      ev('trade', 'skipped'),
      ev('have_ledger', 'skipped'),
      ev('return_ledger', 'skipped'),
      ev('sell_ledger', 'skipped'),
      'reward.granted',
      `quest.${LEDGER}.outcome`,
    ])
    expect(h.payloads(`quest.${LEDGER}.outcome`)).toEqual([{ name: 'confiscated', failed: true }])
    expect(h.payloads('reward.granted')[0]).toEqual({
      quest: LEDGER,
      step: 'caught',
      reward: 'confiscated_rep',
      kind: 'reputation',
      ref: 'harbor',
      amount: -5,
    })

    const state = h.runtime.getState(LEDGER)
    expect(state.status).toBe('closed')
    expect(state.outcome).toBe('confiscated')
    expect(state.steps.steal).toMatchObject({ state: 'failed', failCount: 1 })
    expect(state.steps.caught.state).toBe('failed')
    expect(h.runtime.resolve(`outcome.${LEDGER}.confiscated`)).toBe(true)
  })

  it('checks fail before complete when both land in the same tick', () => {
    const h = harness({ night: true })
    reachTheDen(h)
    h.reset()
    h.runtime.emit('guard.caught')
    h.reset()
    h.runtime.emit('object.interacted', { object: 'ledger_chest' })
    expect(h.names()).toEqual([])
    expect(h.runtime.getState(LEDGER).steps.steal.state).toBe('failed')
  })
})

describe('the optional hint', () => {
  it('grants its coins once however often the dialogue ends', () => {
    const h = harness()
    takeQuest(h)
    h.runtime.emit('dialogue.ended', { actor: 'harbormaster', node: 'ines_intro' })
    h.reset()

    h.runtime.emit('dialogue.ended', { actor: 'gull_feeder', node: 'gulls_hint' })
    h.runtime.emit('dialogue.ended', { actor: 'gull_feeder', node: 'gulls_hint' })
    expect(h.names()).toEqual([ev('ask_gulls', 'done'), 'reward.granted'])
    expect(h.runtime.getState(LEDGER).rewards).toEqual(['gulls_coins'])
  })

  it('ignores a dialogue with the wrong node', () => {
    const h = harness()
    takeQuest(h)
    h.runtime.emit('dialogue.ended', { actor: 'harbormaster', node: 'ines_intro' })
    h.reset()
    h.runtime.emit('dialogue.ended', { actor: 'gull_feeder', node: 'gulls_smalltalk' })
    expect(h.names()).toEqual([])
    expect(h.runtime.getState(LEDGER).steps.ask_gulls.count).toBe(0)
  })

  it('is crossed out and unpaid when the player never asks', () => {
    const h = harness()
    reachTheDen(h)
    tradeForLedger(h)
    h.runtime.emit('dialogue.ended', { actor: 'harbormaster', node: 'ines_return' })
    const state = h.runtime.getState(LEDGER)
    expect(state.steps.ask_gulls.state).toBe('skipped')
    expect(state.rewards).not.toContain('gulls_coins')
  })
})

describe('save and load', () => {
  function midQuestSave(): QuestState[] {
    const h = harness()
    reachTheDen(h)
    h.runtime.emit('item.collected', { item: 'fish.rare', amount: 3 })
    return h.runtime.save()
  }

  it('round trips mid quest and carries on', () => {
    const saved = midQuestSave()
    expect(saved).toHaveLength(1)
    expect(saved[0].steps.trade).toMatchObject({ state: 'active', count: 3 })

    const h = harness()
    h.runtime.load(saved)
    expect(h.names()).toEqual([])
    expect(h.runtime.getState(LEDGER)).toEqual(saved[0])

    h.runtime.emit('item.collected', { item: 'fish.rare', amount: 2 })
    h.runtime.emit('flag.set', { flag: 'otter_traded', value: true })
    expect(h.names()).toContain(ev('trade', 'done'))
    h.reset()
    h.runtime.emit('dialogue.ended', { actor: 'harbormaster', node: 'ines_return' })
    expect(h.runtime.getState(LEDGER).outcome).toBe('returned')
  })

  it('hands out copies, not the live document', () => {
    const h = harness()
    takeQuest(h)
    const saved = h.runtime.save()
    saved[0].steps.talk_ines.state = 'done'
    expect(h.runtime.getState(LEDGER).steps.talk_ines.state).toBe('active')
  })

  it('parks steps the quest no longer declares', () => {
    const h = harness({ documents: [questWithoutGulls()] })
    h.runtime.load(midQuestSave())
    const state = h.runtime.getState(LEDGER)
    expect(state.questVersion).toBe(2)
    expect(state.steps.ask_gulls).toBeUndefined()
    expect(state.ext['x-oqf.orphaned']).toEqual({ ask_gulls: 'active' })
  })

  it('starts steps the quest gained locked and evaluates their unlock', () => {
    const h = harness({ documents: [questWithExtraStep()] })
    h.runtime.load(midQuestSave())
    const state = h.runtime.getState(LEDGER)
    expect(state.questVersion).toBe(2)
    expect(state.steps.log_catch).toEqual({ state: 'locked', count: 0, failCount: 0 })

    h.reset()
    h.runtime.emit('item.collected', { item: 'fish.rare', amount: 2 })
    h.runtime.emit('flag.set', { flag: 'otter_traded', value: true })
    expect(h.names()).toContain(ev('log_catch', 'available'))
  })

  it('ignores documents for quests it does not hold and refuses newer schemas', () => {
    const h = harness()
    const stranger = midQuestSave()[0]
    stranger.quest = 'somebody_elses_quest'
    h.runtime.load([stranger])
    expect(h.runtime.save()).toHaveLength(1)
    expect(h.runtime.getState(LEDGER).status).toBe('unseen')

    const future = midQuestSave()[0]
    future.stateVersion = 99
    expect(() => h.runtime.load([future])).toThrow(/version 99/)
  })
})

describe('event mapping', () => {
  it('renames incoming engine events before anything reads them', () => {
    const h = harness({ eventMap: { 'fish.caught': 'item.collected' } })
    reachTheDen(h)
    h.reset()
    h.runtime.emit('fish.caught', { item: 'fish.rare', amount: 5 })
    expect(h.runtime.getState(LEDGER).steps.trade.count).toBe(5)
    h.runtime.emit('flag.set', { flag: 'otter_traded', value: true })
    expect(h.names()).toContain(ev('trade', 'done'))
  })

  it('leaves unmapped names alone', () => {
    const h = harness({ night: true, eventMap: { 'fish.caught': 'item.collected' } })
    reachTheDen(h)
    h.reset()
    h.runtime.emit('guard.caught')
    expect(h.names()).toContain(ev('steal', 'failed'))
  })
})

describe('delivery', () => {
  it('queues what a handler emits until the current input is drained', () => {
    const h = harness()
    takeQuest(h)
    const order: string[] = []
    h.runtime.on((event) => {
      order.push(event.name)
      if (event.name === ev('find_otter', 'active')) {
        h.runtime.emit('location.entered', { location: 'otter_den' })
      }
    })
    h.runtime.emit('dialogue.ended', { actor: 'harbormaster', node: 'ines_intro' })
    expect(order).toEqual([
      ev('talk_ines', 'done'),
      ev('ask_gulls', 'available'),
      ev('find_otter', 'available'),
      ev('ask_gulls', 'active'),
      ev('find_otter', 'active'),
      ev('find_otter', 'done'),
      ev('trade', 'available'),
      ev('steal', 'available'),
      ev('trade', 'active'),
      ev('steal', 'active'),
    ])
  })

  it('stops delivering once a handler unsubscribes', () => {
    const h = harness()
    const seen: string[] = []
    const off = h.runtime.on((event) => seen.push(event.name))
    h.runtime.offer(LEDGER)
    off()
    h.runtime.accept(LEDGER)
    expect(seen).toEqual([`quest.${LEDGER}.offered`])
  })
})

describe('the fixed point', () => {
  it('throws once two steps have toggled each other past the cap', () => {
    const h = harness({ documents: [loopDocument()] })
    expect(() => h.runtime.accept('loop')).toThrow(/did not settle after 1000 passes/)
    expect(MAX_PASSES).toBe(1000)
  })
})

describe('repeat', () => {
  it('archives the old document when a repeat quest is retaken', () => {
    const h = harness({ documents: [repeatDocument()] })
    h.runtime.accept('daily_catch')
    h.runtime.emit('item.collected', { item: 'fish.rare' })
    expect(h.names()).toEqual([
      'quest.daily_catch.offered',
      'quest.daily_catch.step.catch.available',
      'quest.daily_catch.step.catch.active',
      'quest.daily_catch.step.catch.done',
      'reward.granted',
      'quest.daily_catch.outcome',
    ])
    expect(h.runtime.history).toHaveLength(1)
    expect(h.runtime.history[0].outcome).toBe('done')
    expect(h.runtime.history[0].status).toBe('closed')

    const fresh = h.runtime.getState('daily_catch')
    expect(fresh.status).toBe('unseen')
    expect(fresh.outcome).toBeNull()
    expect(fresh.rewards).toEqual([])
    expect(fresh.log).toEqual([])
    h.reset()

    h.runtime.accept('daily_catch')
    h.runtime.emit('item.collected', { item: 'fish.rare' })
    expect(h.names()).toContain('quest.daily_catch.outcome')
    expect(h.runtime.history).toHaveLength(2)
    expect(h.runtime.getState('daily_catch').log).toEqual([])
  })

  it('clears a repeat step reward when the step is re-entered', () => {
    const h = harness({ documents: [repeatStepDocument()] })
    h.runtime.accept('patrol')
    h.runtime.emit('flag.set', { flag: 'bell', value: true })
    h.runtime.emit('watch.tick')
    expect(h.runtime.getState('patrol').rewards).toEqual(['tick_pay'])
    h.reset()

    h.runtime.emit('flag.set', { flag: 'bell', value: false })
    expect(h.names()).toEqual(['quest.patrol.step.watch.locked'])
    const relocked = h.runtime.getState('patrol')
    expect(relocked.steps.watch).toMatchObject({ state: 'locked', count: 0 })
    expect(relocked.rewards).toEqual([])
    h.reset()

    h.runtime.emit('flag.set', { flag: 'bell', value: true })
    h.runtime.emit('watch.tick')
    expect(h.names()).toEqual([
      'quest.patrol.step.watch.available',
      'quest.patrol.step.watch.active',
      'quest.patrol.step.watch.done',
      'reward.granted',
    ])
    expect(h.runtime.getState('patrol').rewards).toEqual(['tick_pay'])
  })
})

describe('two quests', () => {
  it('offers the second one when the first reaches its outcome', () => {
    const h = harness({ documents: [chainDocument()] })
    h.runtime.accept('a')
    h.reset()
    expect(h.runtime.getState('b').status).toBe('unseen')

    h.runtime.emit('a.finished')
    expect(h.names()).toEqual(['quest.a.step.finish.done', 'quest.a.outcome', 'quest.b.offered'])
    expect(h.runtime.getState('b').status).toBe('offered')
    expect(h.runtime.resolve('outcome.a.done')).toBe(true)
    expect(h.runtime.resolve('quest.a')).toBe('closed')

    h.reset()
    h.runtime.accept('b')
    expect(h.names()).toEqual(['quest.b.step.go.available', 'quest.b.step.go.active'])
  })
})

describe('custom objectives', () => {
  it('never completes until the engine says so', () => {
    const h = harness({ documents: [customDocument()] })
    h.runtime.accept('custom_quest')
    h.reset()

    h.runtime.emit('ritual.performed')
    h.runtime.emit('quest.custom_quest.step.ritual.custom', { done: false })
    expect(h.names()).toEqual([])

    h.runtime.emit('quest.custom_quest.step.ritual.custom', { done: true })
    expect(h.names()).toEqual(['quest.custom_quest.step.ritual.done'])
  })
})

describe('resolve', () => {
  it('serves every namespace the runtime owns', () => {
    const h = harness({ night: true })
    reachTheDen(h)
    const runtime = h.runtime

    expect(runtime.resolve(`step.${LEDGER}#talk_ines`)).toBe('done')
    expect(runtime.resolve(`step.${LEDGER}#trade`)).toBe('active')
    expect(runtime.resolve(`step.${LEDGER}#nothing`)).toBeUndefined()
    expect(runtime.resolve(`quest.${LEDGER}`)).toBe('open')
    expect(runtime.resolve('quest.nothing')).toBeUndefined()
    expect(runtime.resolve('flag.otter_traded')).toBe(false)
    expect(runtime.resolve('var.time.isNight')).toBe(true)
    expect(runtime.resolve('var.time.season')).toBeUndefined()
    expect(runtime.resolve(`outcome.${LEDGER}.returned`)).toBe(false)
    expect(runtime.resolve('nonsense.path')).toBeUndefined()

    runtime.emit('flag.set', { flag: 'otter_traded', value: true })
    expect(runtime.resolve('flag.otter_traded')).toBe(true)
  })

  it('serves counters and bare step paths outside an evaluation', () => {
    const h = harness()
    reachTheDen(h)
    h.runtime.emit('item.collected', { item: 'fish.rare', amount: 3 })
    expect(h.runtime.resolve('count.trade')).toBe(3)
    expect(h.runtime.resolve('step.trade')).toBe('active')
    expect(h.runtime.resolve('count.nothing')).toBeUndefined()
  })

  it('accepts the qualified form of both step paths', () => {
    const h = harness()
    reachTheDen(h)
    h.runtime.emit('item.collected', { item: 'fish.rare', amount: 3 })
    expect(h.runtime.resolve(`count.${LEDGER}#trade`)).toBe(3)
    expect(h.runtime.resolve(`step.${LEDGER}#trade`)).toBe('active')
    expect(h.runtime.resolve('count.nobody#trade')).toBeUndefined()
    expect(h.runtime.resolve(`count.${LEDGER}#nothing`)).toBeUndefined()
  })

  it('searches quests the player has seen, in load order', () => {
    const h = harness({ documents: [twinDocument()] })
    h.runtime.accept('second')
    expect(h.runtime.getState('first').status).toBe('unseen')
    expect(h.runtime.resolve('step.errand')).toBe('active')
    expect(h.runtime.resolve('step.first#errand')).toBe('locked')

    h.runtime.offer('first')
    expect(h.runtime.resolve('step.errand')).toBe('locked')
  })

  it('reads the quest under evaluation before the search', () => {
    const h = harness({ documents: [twinDocument()] })
    h.runtime.accept('first')
    h.runtime.accept('second')
    h.runtime.emit('tick')
    h.runtime.emit('tick')

    expect(h.runtime.resolve('count.first#errand')).toBe(2)
    expect(h.runtime.resolve('count.second#errand')).toBe(0)
    expect(h.runtime.resolve('count.errand')).toBe(2)
    expect(h.runtime.getState('second').steps.errand.state).toBe('active')
  })

  it('counts an item.collected payload without an amount as one', () => {
    const h = harness()
    reachTheDen(h)
    const payload: Payload = { item: 'fish.rare' }
    h.runtime.emit({ name: 'item.collected', payload })
    h.runtime.emit('item.collected', { item: 'other.fish', amount: 9 })
    expect(h.runtime.getState(LEDGER).steps.trade.count).toBe(1)
  })
})

describe('talk objectives', () => {
  it('matches a bare dialogue binding on the conversation alone', () => {
    const h = harness()
    takeQuest(h)
    h.runtime.emit('dialogue.ended', { actor: 'harbormaster', node: 'ines_intro' })
    h.reset()
    h.runtime.emit('dialogue.ended', {
      actor: 'gull_feeder',
      node: 'gulls_hint',
      at: 'the_gulls_know',
    })
    expect(h.names()).toEqual([ev('ask_gulls', 'done'), 'reward.granted'])
  })

  it('matches a conversation#node binding on both halves', () => {
    const h = harness({ documents: [nodeBoundDocument()] })
    h.runtime.accept('deal')
    h.reset()

    h.runtime.emit('dialogue.ended', { actor: 'otter', node: 'otter_trade', at: 'walk_away' })
    h.runtime.emit('dialogue.ended', { actor: 'otter', node: 'otter_trade' })
    h.runtime.emit('dialogue.ended', { actor: 'otter', node: 'gulls_hint', at: 'handover' })
    h.runtime.emit('dialogue.ended', { actor: 'smuggler', node: 'otter_trade', at: 'handover' })
    expect(h.names()).toEqual([])
    expect(h.runtime.getState('deal').steps.handshake.count).toBe(0)

    h.runtime.emit('dialogue.ended', { actor: 'otter', node: 'otter_trade', at: 'handover' })
    expect(h.names()).toEqual(['quest.deal.step.handshake.done'])
  })
})

describe('the transition log', () => {
  it('records every move with a monotonic clock', () => {
    const h = harness()
    takeQuest(h)
    h.runtime.emit('dialogue.ended', { actor: 'harbormaster', node: 'ines_intro' })
    const log = h.runtime.getState(LEDGER).log
    expect(log.slice(0, 3)).toEqual([
      { step: 'talk_ines', from: 'locked', to: 'available', at: 0 },
      { step: 'talk_ines', from: 'available', to: 'active', at: 1 },
      { step: 'talk_ines', from: 'active', to: 'done', at: 2 },
    ])
    expect(h.runtime.getState(LEDGER).steps.talk_ines.enteredAt).toBe(2)
  })

  it('uses the clock the game supplies', () => {
    const stamps = [100, 200, 300]
    const runtime = new QuestRuntime({
      documents: [customDocument()],
      clock: () => stamps.shift() ?? 999,
    })
    runtime.accept('custom_quest')
    expect(runtime.getState('custom_quest').log).toEqual([
      { step: 'ritual', from: 'locked', to: 'available', at: 100 },
      { step: 'ritual', from: 'available', to: 'active', at: 200 },
    ])
  })
})

describe('construction', () => {
  it('refuses two quests with the same id', () => {
    expect(
      () => new QuestRuntime({ documents: [referenceDocument(), referenceDocument()] }),
    ).toThrow(/duplicate quest id/)
  })

  it('holds every quest from every document', () => {
    const runtime = new QuestRuntime({ documents: [referenceDocument(), chainDocument()] })
    expect(runtime.save().map((state) => state.quest)).toEqual([LEDGER, 'a', 'b'])
  })
})
