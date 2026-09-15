import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { type OqfDocument, type Step, parseCompact } from '@oqf/core'
import { type DialogueDocument, parseOqd } from '@oqf/dialogue'
import { describe, expect, it } from 'vitest'
import { startConversation } from './dialoguePlay'
import {
  type EventSuggestion,
  PlaytestSession,
  type TranscriptEntry,
  boundConversation,
  choiceText,
  formatPayload,
  groupTranscript,
  labelChoices,
  lastOutcome,
  nextEvents,
  objectiveCount,
  parsePayload,
  readsWorld,
  stepRole,
  suggestEvents,
} from './playtest'

function templateText(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../../examples/quests/templates/${name}`, import.meta.url)),
    'utf8',
  )
}

function template(name: string): OqfDocument {
  return parseCompact(templateText(name))
}

function dialogueTemplate(name: string): DialogueDocument {
  return parseOqd(templateText(name))
}

const branching = template('branching.oqf')
const branchingDialogue = dialogueTemplate('branching.oqd')
const engineHooks = template('engine-hooks.oqf')
const repeatable = template('repeatable.oqf')
const failure = template('failure.oqf')

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
      choose_keep: 'failed',
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
      'choose_keep:active>failed',
      'deliver_report:locked>available',
      'deliver_report:available>active',
      'deliver_report:active>done',
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

describe('PlaytestSession.removeFlag', () => {
  it('drops the flag from the snapshot and the runtime reads it as false', () => {
    const session = new PlaytestSession(failure, 'escort_merchant')
    session.start()
    session.emit('dialogue.ended', { actor: 'merchant' })
    expect(states(session).escort).toBe('available')
    session.setFlag('escort_accepted')
    expect(states(session).escort).toBe('active')

    session.removeFlag('escort_accepted')
    expect(session.snapshot().flags).toEqual({})
    expect(session.engine.resolve('flag.escort_accepted')).toBe(false)
    expect(states(session).escort).toBe('active')
    expect(session.transcript.at(-1)).toEqual({
      kind: 'input',
      name: 'flag.set',
      payload: { flag: 'escort_accepted', value: false },
    })
    session.reset()
    expect(session.snapshot().flags).toEqual({})
  })
})

describe('groupTranscript', () => {
  it('opens a Start card for everything before the first input', () => {
    const session = new PlaytestSession(branching, 'washed_crate')
    expect(groupTranscript(session.transcript)).toEqual([])

    session.start()
    const [start] = groupTranscript(session.transcript)
    expect(start.input).toBeNull()
    expect(start.title).toBe('Start')
    expect(start.effects).toEqual([
      { kind: 'offered', quest: 'washed_crate' },
      { kind: 'step', quest: 'washed_crate', step: 'find_crate', from: 'locked', to: 'available' },
      { kind: 'step', quest: 'washed_crate', step: 'find_crate', from: 'available', to: 'active' },
    ])
  })

  it('nests every answer under the input that caused it, in order', () => {
    const session = new PlaytestSession(branching, 'washed_crate')
    session.start()
    session.emit('object.interacted', { object: 'washed_crate' })
    session.emit('dialogue.ended', { actor: 'keeper', node: 'crate_found', at: 'report' })
    session.emit('location.entered', { location: 'harbor_office' })

    const cards = groupTranscript(session.transcript)
    expect(cards.map((card) => card.title)).toEqual([
      'Start',
      'object.interacted',
      'dialogue.ended',
      'location.entered',
    ])
    expect(cards[1].input).toEqual({
      name: 'object.interacted',
      payload: { object: 'washed_crate' },
    })
    expect(cards[1].effects.map((entry) => entry.kind)).toEqual([
      'step',
      'step',
      'step',
      'step',
      'step',
    ])
    const last = cards[3].effects
    expect(last[0]).toMatchObject({ kind: 'step', step: 'deliver_report', to: 'done' })
    expect(last.filter((entry) => entry.kind === 'reward')).toHaveLength(1)
    expect(last.at(-1)).toMatchObject({ kind: 'outcome', name: 'reported' })
    expect(cards.flatMap((card) => card.effects)).toHaveLength(
      session.transcript.filter((entry) => entry.kind !== 'input').length,
    )
  })

  it('skips the Start card when the first entry is an input', () => {
    const entries: TranscriptEntry[] = [
      { kind: 'input', name: 'guard.spotted', payload: {} },
      { kind: 'input', name: 'item.collected', payload: { item: 'fish', amount: 1 } },
    ]
    expect(groupTranscript(entries)).toEqual([
      { input: { name: 'guard.spotted', payload: {} }, title: 'guard.spotted', effects: [] },
      {
        input: { name: 'item.collected', payload: { item: 'fish', amount: 1 } },
        title: 'item.collected',
        effects: [],
      },
    ])
  })
})

describe('lastOutcome', () => {
  it('finds the newest outcome of the quest and nothing before one is reached', () => {
    const session = new PlaytestSession(repeatable, 'daily_catch')
    session.start()
    expect(lastOutcome(session.transcript, 'daily_catch')).toBeUndefined()
    session.emit('dialogue.ended', { actor: 'cook' })
    session.emit('item.collected', { item: 'fish.common', amount: 3 })
    session.emit('dialogue.ended', { actor: 'cook' })
    expect(lastOutcome(session.transcript, 'daily_catch')).toEqual({
      name: 'delivered',
      failed: false,
    })
    expect(lastOutcome(session.transcript, 'other')).toBeUndefined()
  })
})

describe('objectiveCount', () => {
  it('reads the count of a counted objective and nothing otherwise', () => {
    const steps = repeatable.quests[0].steps
    expect(objectiveCount(steps.find((step) => step.id === 'catch_fish'))).toBe(3)
    expect(objectiveCount(steps.find((step) => step.id === 'take_order'))).toBeUndefined()
    expect(objectiveCount(undefined)).toBeUndefined()
    const hooks = engineHooks.quests[0].steps
    expect(objectiveCount(hooks.find((step) => step.id === 'banish_spirit'))).toBe(3)
  })
})

describe('stepRole', () => {
  it('picks the role the graph card shows, endings first', () => {
    const quest = branching.quests[0]
    const role = (id: string) => stepRole(quest.steps.find((step) => step.id === id) as Step)
    expect(role('find_crate')).toBe('start')
    expect(role('choose_report')).toBe('step')
    expect(role('deliver_report')).toBe('ending')
    expect(role('caught')).toBe('failed')
    const plain = quest.steps.find((step) => step.id === 'choose_report') as Step
    expect(stepRole({ ...plain, repeat: true })).toBe('repeat')
    expect(stepRole({ ...plain, optional: true })).toBe('optional')
  })
})

describe('nextEvents', () => {
  const quest = branching.quests[0]
  const suggestions = suggestEvents(quest)

  it('puts everything in later before the session starts', () => {
    const split = nextEvents(quest, undefined, suggestions)
    expect(split.now).toEqual([])
    expect(split.later.map((group) => group.step)).toEqual([
      'find_crate',
      'choose_report',
      'choose_keep',
      'deliver_report',
      'pry_open',
      'sell_contents',
      'refuse_deal',
      'return_owner',
    ])
    expect(split.later.every((group) => group.state === 'locked' && !group.waiting)).toBe(true)
  })

  it('follows the active steps as the quest moves', () => {
    const session = new PlaytestSession(branching, 'washed_crate')
    session.start()
    let split = nextEvents(quest, session.snapshot(), suggestions)
    expect(split.now).toEqual([
      {
        step: 'find_crate',
        stepTitle: 'Inspect the crate on the beach',
        role: 'start',
        objective: 'interact washed_crate',
        state: 'active',
        waiting: false,
        events: suggestion(suggestions, 'find_crate'),
      },
    ])
    expect(split.later.map((group) => group.step)).not.toContain('find_crate')

    session.emit('object.interacted', { object: 'washed_crate' })
    session.emit('dialogue.ended', { actor: 'keeper', node: 'crate_found', at: 'keep' })
    split = nextEvents(quest, session.snapshot(), suggestions)
    expect(split.now.map((group) => [group.step, group.role])).toEqual([['pry_open', 'step']])
    expect(split.now[0].events.map((event) => event.fail)).toEqual([false, true])
    expect(split.later.find((group) => group.step === 'find_crate')?.state).toBe('done')
    expect(split.later.find((group) => group.step === 'choose_keep')?.state).toBe('done')
    expect(split.later.find((group) => group.step === 'choose_report')?.state).toBe('failed')
  })

  it('marks an available step as waiting on its activate condition', () => {
    const escort = failure.quests[0]
    const session = new PlaytestSession(failure, 'escort_merchant')
    session.start()
    session.emit('dialogue.ended', { actor: 'merchant' })
    const split = nextEvents(escort, session.snapshot(), suggestEvents(escort))
    expect(split.now.map((group) => [group.step, group.state, group.waiting])).toEqual([
      ['escort', 'available', true],
    ])
    expect(split.later.map((group) => group.step)).toEqual(['meet_merchant', 'close_sale'])
  })
})

describe('readsWorld', () => {
  it('reads nothing on a quest whose conditions only name steps', () => {
    expect(readsWorld(branching.quests[0])).toEqual({ flags: false, vars: false })
  })

  it('finds flags read by a step activate or unlock', () => {
    expect(readsWorld(failure.quests[0])).toEqual({ flags: true, vars: false })
  })

  it('finds variables read by the quest unlock and a step unlock', () => {
    expect(readsWorld(engineHooks.quests[0])).toEqual({ flags: false, vars: true })
  })

  it('finds a flag read by the quest unlock alone', () => {
    const quest = { ...repeatable.quests[0], steps: [] }
    expect(readsWorld(quest)).toEqual({ flags: true, vars: false })
  })
})

describe('boundConversation', () => {
  const step = (id: string) => branching.quests[0].steps.find((entry) => entry.id === id) as Step

  it('finds the conversation a step binds through the built-in provider', () => {
    expect(boundConversation(step('choose_report'), branchingDialogue)?.id).toBe('crate_found')
    expect(boundConversation(step('sell_contents'), branchingDialogue)?.id).toBe('contraband_offer')
  })

  it('finds nothing without a binding, for another provider, or a missing conversation', () => {
    expect(boundConversation(step('find_crate'), branchingDialogue)).toBeUndefined()
    expect(boundConversation(step('return_owner'), branchingDialogue)).toBeUndefined()
    const ink = { ...step('choose_report'), dialogue: { provider: 'ink', ref: 'crate_found' } }
    expect(boundConversation(ink, branchingDialogue)).toBeUndefined()
    const gone = { ...step('choose_report'), dialogue: { provider: 'oqf', ref: 'nowhere' } }
    expect(boundConversation(gone, branchingDialogue)).toBeUndefined()
  })
})

describe('choiceText and labelChoices', () => {
  it('reads the text of one choice on one node', () => {
    expect(choiceText(branchingDialogue, 'crate_found', 'look', 1)).toBe('Finders keepers.')
    expect(choiceText(branchingDialogue, 'crate_found', 'look', 5)).toBeUndefined()
    expect(choiceText(branchingDialogue, 'crate_found', 'report', 0)).toBeUndefined()
    expect(choiceText(branchingDialogue, 'nowhere', 'look', 0)).toBeUndefined()
  })

  it('labels dialogue.choice cards from the conversation started before them', () => {
    const entries: TranscriptEntry[] = [
      { kind: 'input', name: 'object.interacted', payload: { object: 'washed_crate' } },
      {
        kind: 'input',
        name: 'dialogue.started',
        payload: { actor: 'keeper', node: 'crate_found' },
      },
      { kind: 'input', name: 'dialogue.choice', payload: { node: 'look', choice: 0 } },
      { kind: 'input', name: 'dialogue.ended', payload: { node: 'crate_found', at: 'report' } },
      { kind: 'input', name: 'dialogue.choice', payload: { node: 'look', choice: 9 } },
    ]
    const cards = labelChoices(groupTranscript(entries), branchingDialogue)
    expect(cards.map((card) => card.label)).toEqual([
      undefined,
      undefined,
      'I will take it to the harbor office.',
      undefined,
      undefined,
    ])
  })

  it('leaves a choice card alone when no conversation started before it', () => {
    const entries: TranscriptEntry[] = [
      { kind: 'input', name: 'dialogue.choice', payload: { node: 'look', choice: 0 } },
    ]
    const [card] = labelChoices(groupTranscript(entries), branchingDialogue)
    expect(card.label).toBeUndefined()
  })
})

describe('a conversation played inside a quest playtest', () => {
  it('reaches the reported outcome through the keeper with no synthetic dialogue.ended', () => {
    const session = new PlaytestSession(branching, 'washed_crate')
    session.start()
    session.emit('object.interacted', { object: 'washed_crate' })
    expect(states(session).choose_report).toBe('active')

    const step = branching.quests[0].steps.find((entry) => entry.id === 'choose_report') as Step
    const conversation = boundConversation(step, branchingDialogue)
    expect(conversation?.id).toBe('crate_found')

    const play = startConversation(branchingDialogue, conversation?.id ?? '', {
      resolve: (path) => session.engine.resolve(path),
      emit: (event) => session.emit(event.name, event.payload),
    })
    expect(play.current()?.speaker).toBe('keeper')
    expect(play.current()?.choices.map((choice) => String(choice.text))).toEqual([
      'I will take it to the harbor office.',
      'Finders keepers.',
    ])

    play.choose(0)
    expect(play.current()?.node).toBe('report')
    expect(states(session).choose_report).toBe('active')
    play.advance()
    expect(play.ended).toBe(true)
    expect(states(session).choose_report).toBe('done')
    expect(states(session).deliver_report).toBe('active')

    session.emit('location.entered', { location: 'harbor_office' })
    const snapshot = session.snapshot()
    expect(snapshot.status).toBe('closed')
    expect(snapshot.outcome).toBe('reported')
    expect(snapshot.error).toBeUndefined()
    expect(states(session).choose_keep).toBe('failed')

    const inputs = session.transcript.filter(
      (entry): entry is TranscriptEntry & { kind: 'input' } => entry.kind === 'input',
    )
    expect(inputs.map((entry) => entry.name)).toEqual([
      'object.interacted',
      'dialogue.started',
      'dialogue.choice',
      'dialogue.ended',
      'location.entered',
    ])
    expect(inputs[3].payload).toEqual({ actor: 'keeper', node: 'crate_found', at: 'report' })
    expect(
      play.transcript.filter((entry) => entry.kind === 'event').map((entry) => entry.text),
    ).toEqual(['dialogue.started', 'dialogue.choice', 'dialogue.ended'])

    const cards = labelChoices(groupTranscript(session.transcript), branchingDialogue)
    expect(cards.map((card) => [card.title, card.label])).toEqual([
      ['Start', undefined],
      ['object.interacted', undefined],
      ['dialogue.started', undefined],
      ['dialogue.choice', 'I will take it to the harbor office.'],
      ['dialogue.ended', undefined],
      ['location.entered', undefined],
    ])
    expect(cards[4].effects).toEqual([
      { kind: 'step', quest: 'washed_crate', step: 'choose_report', from: 'active', to: 'done' },
      { kind: 'step', quest: 'washed_crate', step: 'choose_keep', from: 'active', to: 'failed' },
      {
        kind: 'step',
        quest: 'washed_crate',
        step: 'deliver_report',
        from: 'locked',
        to: 'available',
      },
      {
        kind: 'step',
        quest: 'washed_crate',
        step: 'deliver_report',
        from: 'available',
        to: 'active',
      },
    ])
  })

  it('reads real quest state in choice conditions through the runtime resolver', () => {
    const session = new PlaytestSession(branching, 'washed_crate')
    session.start()
    const play = startConversation(branchingDialogue, 'crate_found', {
      resolve: (path) => session.engine.resolve(path),
      emit: (event) => session.emit(event.name, event.payload),
    })
    expect(session.engine.resolve('step.find_crate')).toBe('active')
    play.choose(1)
    play.advance()
    expect(states(session).choose_keep).toBe('locked')
    expect(session.snapshot().outcome).toBeNull()
  })
})
