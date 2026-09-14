import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { type OqfDocument, parseCompact } from '@oqf/core'
import { describe, expect, it } from 'vitest'
import {
  type EventSuggestion,
  PlaytestSession,
  type TranscriptEntry,
  formatPayload,
  parsePayload,
  suggestEvents,
} from './playtest'

function template(name: string): OqfDocument {
  return parseCompact(
    readFileSync(
      fileURLToPath(new URL(`../../../examples/quests/templates/${name}`, import.meta.url)),
      'utf8',
    ),
  )
}

const branching = template('branching.oqf')
const engineHooks = template('engine-hooks.oqf')
const repeatable = template('repeatable.oqf')

function states(session: PlaytestSession): Record<string, string> {
  return Object.fromEntries(session.snapshot().steps.map((step) => [step.id, step.state]))
}

function transitions(session: PlaytestSession): string[] {
  return session.transcript
    .filter((entry): entry is TranscriptEntry & { kind: 'step' } => entry.kind === 'step')
    .map((entry) => `${entry.step}:${entry.from}>${entry.to}`)
}

function suggestion(list: EventSuggestion[], step: string, fail = false): EventSuggestion[] {
  return list.filter((entry) => entry.step === step && entry.fail === fail)
}

describe('PlaytestSession on the branching template', () => {
  it('reports the crate and reaches the reported outcome', () => {
    const session = new PlaytestSession(branching, 'washed_crate')
    expect(session.snapshot().status).toBe('unseen')

    session.start()
    expect(session.snapshot().status).toBe('open')
    expect(session.transcript[0]).toEqual({ kind: 'offered', quest: 'washed_crate' })
    expect(states(session).find_crate).toBe('active')
    expect(states(session).choose_report).toBe('locked')

    session.emit('object.interacted', { object: 'washed_crate' })
    expect(states(session).find_crate).toBe('done')
    expect(states(session).choose_report).toBe('active')
    expect(states(session).choose_keep).toBe('active')

    session.emit('dialogue.ended', { actor: 'keeper', node: 'crate_found', at: 'report' })
    expect(states(session).choose_report).toBe('done')
    expect(states(session).deliver_report).toBe('active')

    session.emit('location.entered', { location: 'harbor_office' })
    const snapshot = session.snapshot()
    expect(snapshot.status).toBe('closed')
    expect(snapshot.outcome).toBe('reported')
    expect(snapshot.passes).toBe(0)
    expect(snapshot.error).toBeUndefined()
    expect(states(session)).toEqual({
      find_crate: 'done',
      choose_report: 'done',
      choose_keep: 'skipped',
      deliver_report: 'done',
      pry_open: 'skipped',
      caught: 'skipped',
      sell_contents: 'skipped',
      refuse_deal: 'skipped',
      return_owner: 'skipped',
    })
    expect(snapshot.rewards).toEqual([
      {
        quest: 'washed_crate',
        step: 'deliver_report',
        reward: 'reported_rep',
        kind: 'reputation',
        ref: 'harbor',
        amount: 10,
      },
    ])
    expect(transitions(session)).toEqual([
      'find_crate:locked>available',
      'find_crate:available>active',
      'find_crate:active>done',
      'choose_report:locked>available',
      'choose_keep:locked>available',
      'choose_report:available>active',
      'choose_keep:available>active',
      'choose_report:active>done',
      'deliver_report:locked>available',
      'deliver_report:available>active',
      'deliver_report:active>done',
      'choose_keep:active>skipped',
      'pry_open:locked>skipped',
      'caught:locked>skipped',
      'sell_contents:locked>skipped',
      'refuse_deal:locked>skipped',
      'return_owner:locked>skipped',
    ])
    expect(session.transcript.at(-1)).toEqual({
      kind: 'outcome',
      quest: 'washed_crate',
      name: 'reported',
      failed: false,
    })
    expect(session.transcript.filter((entry) => entry.kind === 'input')).toHaveLength(3)
  })

  it('keeps the crate, sells the contents and gets paid', () => {
    const session = new PlaytestSession(branching, 'washed_crate')
    session.start()
    session.emit('object.interacted', { object: 'washed_crate' })
    session.emit('dialogue.ended', { actor: 'keeper', node: 'crate_found', at: 'keep' })
    expect(states(session).pry_open).toBe('active')
    session.emit('object.interacted', { object: 'crate_lock' })
    expect(states(session).sell_contents).toBe('active')
    expect(states(session).refuse_deal).toBe('active')
    session.emit('dialogue.ended', { actor: 'smuggler', node: 'contraband_offer', at: 'sell' })

    const snapshot = session.snapshot()
    expect(snapshot.status).toBe('closed')
    expect(snapshot.outcome).toBe('sold')
    expect(snapshot.rewards.map((grant) => [grant.reward, grant.amount])).toEqual([
      ['sold_coins', 150],
      ['sold_rep', -10],
    ])
    expect(states(session).refuse_deal).toBe('skipped')
    expect(states(session).return_owner).toBe('skipped')
  })

  it('is caught by the guard through the fail objective', () => {
    const session = new PlaytestSession(branching, 'washed_crate')
    session.start()
    session.emit('object.interacted', { object: 'washed_crate' })
    session.emit('dialogue.ended', { actor: 'keeper', node: 'crate_found', at: 'keep' })
    session.emit('guard.spotted')

    const snapshot = session.snapshot()
    expect(snapshot.outcome).toBe('confiscated')
    expect(states(session).pry_open).toBe('failed')
    expect(states(session).caught).toBe('failed')
    expect(snapshot.steps.find((step) => step.id === 'pry_open')?.failCount).toBe(1)
    expect(session.transcript.at(-1)).toEqual({
      kind: 'outcome',
      quest: 'washed_crate',
      name: 'confiscated',
      failed: true,
    })
  })

  it('the suggestions can drive the quest to an outcome', () => {
    const session = new PlaytestSession(branching, 'washed_crate')
    const suggestions = suggestEvents(branching.quests[0])
    session.start()
    for (const step of ['find_crate', 'choose_keep', 'pry_open', 'refuse_deal', 'return_owner']) {
      const [pick] = suggestion(suggestions, step)
      session.emit(pick.name, pick.payload)
    }
    expect(session.snapshot().outcome).toBe('returned')
    expect(session.snapshot().rewards.map((grant) => grant.reward)).toEqual([
      'returned_rep',
      'returned_compass',
    ])
  })

  it('reset clears the runtime but keeps flags the author set', () => {
    const session = new PlaytestSession(branching, 'washed_crate')
    session.setFlag('lantern_lit')
    session.start()
    session.emit('object.interacted', { object: 'washed_crate' })
    expect(states(session).find_crate).toBe('done')
    session.reset()
    expect(session.transcript).toEqual([])
    expect(session.snapshot().status).toBe('unseen')
    expect(session.snapshot().flags).toEqual({ lantern_lit: true })
    expect(session.engine.resolve('flag.lantern_lit')).toBe(true)
  })

  it('records a runtime error instead of throwing', () => {
    const session = new PlaytestSession(branching, 'washed_crate')
    expect(() => new PlaytestSession(branching, 'missing')).toThrow('unknown quest')
    session.start()
    expect(session.snapshot().error).toBeUndefined()
  })
})

describe('suggestEvents', () => {
  it('labels every objective and fail objective of the branching template', () => {
    const list = suggestEvents(branching.quests[0])
    expect(suggestion(list, 'find_crate')).toEqual([
      {
        quest: 'washed_crate',
        step: 'find_crate',
        stepTitle: 'Inspect the crate on the beach',
        fail: false,
        label: 'Interact with washed_crate',
        name: 'object.interacted',
        payload: { object: 'washed_crate' },
      },
    ])
    expect(suggestion(list, 'choose_report')[0]).toMatchObject({
      name: 'dialogue.ended',
      payload: { actor: 'keeper', node: 'crate_found', at: 'report' },
    })
    expect(suggestion(list, 'return_owner')[0]).toMatchObject({
      label: 'Talk to captain',
      name: 'dialogue.ended',
      payload: { actor: 'captain' },
    })
    expect(suggestion(list, 'deliver_report')[0]).toMatchObject({
      name: 'location.entered',
      payload: { location: 'harbor_office' },
    })
    expect(suggestion(list, 'pry_open', true)).toEqual([
      {
        quest: 'washed_crate',
        step: 'pry_open',
        stepTitle: 'Pry the crate open before the guard passes',
        fail: true,
        label: 'guard.spotted',
        name: 'guard.spotted',
        payload: {},
      },
    ])
    expect(suggestion(list, 'caught')).toEqual([])
  })

  it('offers the custom objective event on the engine hooks template', () => {
    const list = suggestEvents(engineHooks.quests[0])
    expect(suggestion(list, 'perform_rite')).toEqual([
      {
        quest: 'moon_rite',
        step: 'perform_rite',
        stepTitle: 'Perform the moon rite',
        fail: false,
        label: 'Complete cozycoast.ritual',
        name: 'quest.moon_rite.step.perform_rite.custom',
        payload: { done: true },
      },
    ])
    expect(suggestion(list, 'banish_spirit')).toEqual([
      {
        quest: 'moon_rite',
        step: 'banish_spirit',
        stepTitle: 'Banish the spirit three times',
        fail: false,
        label: 'spirit.banished',
        name: 'spirit.banished',
        payload: {},
      },
    ])
  })

  it('offers one and all for a counted collect on the repeatable template', () => {
    const list = suggestEvents(repeatable.quests[0])
    expect(suggestion(list, 'catch_fish').map((entry) => [entry.label, entry.payload])).toEqual([
      ['Collect 1 fish.common', { item: 'fish.common', amount: 1 }],
      ['Collect all 3 fish.common', { item: 'fish.common', amount: 3 }],
    ])
    expect(suggestion(list, 'take_order')[0]).toMatchObject({
      label: 'Talk to cook',
      payload: { actor: 'cook' },
    })
  })

  it('offers a kill event', () => {
    const quest = { ...branching.quests[0] }
    quest.steps = [
      { ...quest.steps[0], id: 'hunt', objective: { kind: 'kill', actor: 'gull', count: 2 } },
    ]
    expect(suggestEvents(quest)).toEqual([
      expect.objectContaining({
        step: 'hunt',
        label: 'Kill gull',
        name: 'actor.killed',
        payload: { actor: 'gull' },
      }),
    ])
  })
})

describe('PlaytestSession on the engine hooks template', () => {
  it('feeds game variables to the runtime and completes the custom objective', () => {
    const session = new PlaytestSession(engineHooks, 'moon_rite')
    session.start()
    session.emit('location.entered', { location: 'shrine' })
    expect(states(session).find_shrine).toBe('done')
    expect(states(session).perform_rite).toBe('active')
    expect(states(session).moon_blessing).toBe('locked')

    session.setVar('moon.isFull', true)
    expect(states(session).moon_blessing).toBe('done')
    expect(session.snapshot().vars).toEqual({ 'moon.isFull': true })

    session.emit('quest.moon_rite.step.perform_rite.custom', { done: true })
    expect(states(session).perform_rite).toBe('done')
    expect(session.snapshot().flags).toEqual({ rite_performed: true })
    expect(session.transcript).toContainEqual({ kind: 'flag', flag: 'rite_performed', value: true })

    for (let index = 0; index < 3; index += 1) session.emit('spirit.banished')
    const snapshot = session.snapshot()
    expect(snapshot.outcome).toBe('calmed')
    expect(snapshot.rewards.map((grant) => grant.reward)).toEqual([
      'moon_fishing',
      'rite_flag',
      'calmed_event',
      'codex_entry',
    ])
    expect(session.transcript).toContainEqual({
      kind: 'event',
      name: 'cozycoast.spirit.calmed',
      payload: { source: 'shrine', weight: 2 },
    })
  })

  it('offers the quest on its own once the unlock variable is set', () => {
    const session = new PlaytestSession(engineHooks, 'moon_rite')
    session.setVar('season', 'autumn')
    expect(session.snapshot().status).toBe('offered')
    expect(session.transcript).toContainEqual({ kind: 'offered', quest: 'moon_rite' })
  })
})

describe('PlaytestSession on the repeatable template', () => {
  it('retakes the quest after an outcome and counts the passes', () => {
    const session = new PlaytestSession(repeatable, 'daily_catch')
    session.start()
    session.emit('dialogue.ended', { actor: 'cook' })
    session.emit('item.collected', { item: 'fish.common', amount: 3 })
    session.emit('dialogue.ended', { actor: 'cook' })

    let snapshot = session.snapshot()
    expect(snapshot.outcome).toBeNull()
    expect(snapshot.status).toBe('unseen')
    expect(snapshot.passes).toBe(1)
    expect(session.engine.history[0].outcome).toBe('delivered')
    expect(snapshot.rewards.map((grant) => grant.reward)).toEqual([
      'bait',
      'daily_coins',
      'daily_rep',
    ])
    expect(states(session)).toEqual({
      take_order: 'locked',
      catch_fish: 'locked',
      deliver: 'locked',
    })

    session.setFlag('notice_board_open')
    expect(session.snapshot().status).toBe('offered')
    session.accept()
    expect(session.snapshot().status).toBe('open')
    session.emit('dialogue.ended', { actor: 'cook' })
    session.emit('item.collected', { item: 'fish.common', amount: 1 })
    session.emit('item.collected', { item: 'fish.common', amount: 2 })
    session.emit('dialogue.ended', { actor: 'cook' })

    snapshot = session.snapshot()
    expect(snapshot.passes).toBe(2)
    expect(session.engine.history).toHaveLength(2)
    expect(snapshot.rewards.filter((grant) => grant.reward === 'daily_coins')).toHaveLength(2)
    expect(session.transcript.filter((entry) => entry.kind === 'outcome')).toHaveLength(2)
  })
})

describe('parsePayload', () => {
  it('types numbers and booleans and keeps the rest as strings', () => {
    expect(parsePayload('item=fish.rare; amount=3;flag=true;off=false;name=Otter')).toEqual({
      item: 'fish.rare',
      amount: 3,
      flag: true,
      off: false,
      name: 'Otter',
    })
  })

  it('skips empty pairs and treats a bare key as true', () => {
    expect(parsePayload('')).toEqual({})
    expect(parsePayload(';;done;;')).toEqual({ done: true })
    expect(parsePayload('=3')).toEqual({})
  })

  it('formats a payload the way the transcript prints it', () => {
    expect(formatPayload({ item: 'fish', amount: 2 })).toBe('item=fish amount=2')
    expect(formatPayload({})).toBe('')
  })
})
