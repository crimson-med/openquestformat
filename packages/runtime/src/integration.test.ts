/**
 * End to end integration for The Harbormaster's Ledger.
 *
 * Both reference fixtures are read from packages/examples and parsed with the
 * real compact parsers, then driven through the real `QuestRuntime` and the
 * real `OqfDialogueProvider`. No step is completed by a hand rolled
 * `dialogue.ended`: every conversation is played by the provider, so this file
 * fails if the quest, the dialogue, the parsers, the runtime or the provider
 * drift apart. One route per `it`, each written as a short script.
 */
import { readFileSync } from 'node:fs'
import type { Payload, StepState } from '@oqf/core'
import { parseCompact } from '@oqf/core'
import type { DialogueContext, DialogueView, OnceStore } from '@oqf/dialogue'
import { OqfDialogueProvider, parseOqd } from '@oqf/dialogue'
import { describe, expect, it } from 'vitest'
import { EVENT_REWARD_GRANTED, questOutcomeEvent, stepEvent } from './events.js'
import { QuestRuntime } from './runtime.js'
import type { QuestState } from './state.js'

const QUEST = 'harbormasters_ledger'

const QUEST_SOURCE = readFileSync(
  new URL('../../examples/quests/harbormasters-ledger.oqf', import.meta.url),
  'utf8',
)

const DIALOGUE_SOURCE = readFileSync(
  new URL('../../examples/quests/harbormasters-ledger.oqd', import.meta.url),
  'utf8',
)

/** Every step of the reference quest, so a route can assert the whole board. */
const STEP_IDS = [
  'talk_ines',
  'ask_gulls',
  'find_otter',
  'trade',
  'steal',
  'have_ledger',
  'return_ledger',
  'sell_ledger',
  'caught',
] as const

/** Cozy Coast speaks `fish.caught`; the runtime is told what that means. */
const EVENT_MAP = { 'fish.caught': 'item.collected' }

interface Inbound {
  /** `game` is an event this file emitted, `dialogue` one the provider emitted. */
  source: 'game' | 'dialogue'
  name: string
  payload: Payload
}

interface Outbound {
  name: string
  payload: Payload
  /** The input the runtime was processing when it emitted this, for causality. */
  cause: Inbound | null
}

type Chooser = (view: DialogueView) => number | 'advance'

interface WorldOptions {
  night?: boolean
}

/**
 * A game: one runtime, one dialogue provider wired to it, and a recording of
 * everything that crossed the boundary in either direction.
 */
function world(options: WorldOptions = {}) {
  let night = options.night ?? false
  let cause: Inbound | null = null
  const inbound: Inbound[] = []
  const outbound: Outbound[] = []
  const onceKeys = new Map<string, true>()

  const once: OnceStore = {
    has: (key) => onceKeys.has(key),
    add: (key) => {
      onceKeys.set(key, true)
    },
  }

  const runtime = new QuestRuntime({
    documents: [parseCompact(QUEST_SOURCE)],
    resolveVar: (path) => (path === 'var.time.isNight' ? night : undefined),
    eventMap: EVENT_MAP,
  })

  runtime.on((event) => {
    outbound.push({ name: event.name, payload: event.payload, cause })
  })

  function feed(source: Inbound['source'], name: string, payload: Payload): void {
    const entry: Inbound = { source, name, payload }
    inbound.push(entry)
    cause = entry
    try {
      runtime.emit(name, payload)
    } finally {
      cause = null
    }
  }

  /** The dialogue context reads conditions straight through the runtime, as docs/13 wires it. */
  function resolve(path: string): unknown {
    return runtime.resolve(path)
  }

  const provider = new OqfDialogueProvider([parseOqd(DIALOGUE_SOURCE)])

  const context: DialogueContext = {
    resolve,
    emit: (event) => {
      feed('dialogue', event.name, event.payload)
    },
    once,
  }

  /** Play a conversation from its start node to its end, one chooser callback. */
  function talk(conversationId: string, choose: Chooser): DialogueView[] {
    const session = provider.start(conversationId, context)
    const views: DialogueView[] = []
    for (let guard = 0; guard < 100 && !session.ended; guard += 1) {
      const view = session.current()
      if (view === null) break
      views.push(view)
      const picked = choose(view)
      if (picked === 'advance') session.advance()
      else session.choose(picked)
    }
    if (!session.ended) throw new Error(`conversation "${conversationId}" refused to end`)
    return views
  }

  function rewards(): Outbound[] {
    return outbound.filter((event) => event.name === EVENT_REWARD_GRANTED)
  }

  return {
    runtime,
    provider,
    context,
    talk,
    inbound,
    outbound,
    setNight: (value: boolean) => {
      night = value
    },
    emit: (name: string, payload: Payload = {}) => {
      feed('game', name, payload)
    },
    state: (): QuestState => runtime.getState(QUEST),
    steps: (): Record<string, StepState> => {
      const state = runtime.getState(QUEST)
      const board: Record<string, StepState> = {}
      for (const id of STEP_IDS) board[id] = state.steps[id].state
      return board
    },
    rewardIds: (): unknown[] => rewards().map((event) => event.payload.reward),
    rewardRefs: (): unknown[] => rewards().map((event) => event.payload.ref),
    outcomes: (): Payload[] =>
      outbound
        .filter((event) => event.name === questOutcomeEvent(QUEST))
        .map((event) => event.payload),
    names: (): string[] => outbound.map((event) => event.name),
    causeOf: (name: string): Inbound | null =>
      outbound.find((event) => event.name === name)?.cause ?? null,
  }
}

type World = ReturnType<typeof world>

/** Pick the choice whose text contains `snippet`, by its real index. */
function pick(view: DialogueView, snippet: string): number {
  const found = view.choices.find((choice) => choice.text.includes(snippet))
  if (found === undefined) {
    throw new Error(`no choice matching "${snippet}" on node "${view.node}"`)
  }
  return found.index
}

/** Ines' intro: one lore branch first, then the branch that ends the talk. */
function inesIntro(): Chooser {
  let lore = false
  return (view) => {
    if (view.node !== 'greet') return 'advance'
    if (!lore) {
      lore = true
      return pick(view, 'old lighthouse')
    }
    return pick(view, 'I will find it')
  }
}

const ASK_THE_GULL_FEEDER: Chooser = (view) =>
  view.node === 'ask' ? pick(view, 'big leather book') : 'advance'

const HAND_OVER_THE_KOI: Chooser = (view) =>
  view.node === 'offer' ? pick(view, 'Five silver koi, fresh') : 'advance'

const NOT_ENOUGH_KOI: Chooser = (view) =>
  view.node === 'offer' ? pick(view, 'do not have the fish yet') : 'advance'

const ACCEPT_THE_DEAL: Chooser = (view) => (view.node === 'offer' ? pick(view, 'Deal.') : 'advance')

const WALK_AWAY: Chooser = (view) => (view.node === 'offer' ? pick(view, 'Not today') : 'advance')

/** For conversations with nothing to decide. */
const READ_ON: Chooser = () => 'advance'

function take(w: World): void {
  w.runtime.offer(QUEST)
  w.runtime.accept(QUEST)
}

function catchKoi(w: World, count = 5): void {
  for (let index = 0; index < count; index += 1) w.emit('fish.caught', { item: 'fish.rare' })
}

/** The step was completed by the provider's `dialogue.ended`, nothing else. */
function endedBy(w: World, stepId: string, conversation: string): void {
  expect(w.causeOf(stepEvent(QUEST, stepId, 'done'))).toMatchObject({
    source: 'dialogue',
    name: 'dialogue.ended',
    payload: { node: conversation },
  })
}

/** Nothing in this file ever hand emits `dialogue.ended`. */
function onlyTheProviderTalks(w: World): void {
  const handRolled = w.inbound.filter(
    (event) => event.name === 'dialogue.ended' && event.source === 'game',
  )
  expect(handRolled).toEqual([])
}

describe('the harbormaster ledger, end to end', () => {
  it('honest route: ask the gulls, trade for the ledger, return it', () => {
    const w = world()
    take(w)
    w.talk('ines_intro', inesIntro())
    w.talk('gulls_hint', ASK_THE_GULL_FEEDER)
    w.emit('location.entered', { location: 'otter_den' })
    catchKoi(w)
    w.talk('otter_trade', HAND_OVER_THE_KOI)
    w.talk('ines_return', READ_ON)

    expect(w.state().status).toBe('closed')
    expect(w.state().outcome).toBe('returned')
    expect(w.outcomes()).toEqual([{ name: 'returned', failed: false }])
    expect(w.steps()).toEqual({
      talk_ines: 'done',
      ask_gulls: 'done',
      find_otter: 'done',
      trade: 'done',
      steal: 'skipped',
      have_ledger: 'done',
      return_ledger: 'done',
      sell_ledger: 'skipped',
      caught: 'skipped',
    })
    expect(w.rewardIds()).toEqual([
      'coins_hint',
      'xp_trade',
      'rep_returned',
      'lure_returned',
      'event_restored',
    ])
    expect(w.rewardRefs()).toEqual([
      'coins',
      'xp',
      'harbor',
      'lure.golden',
      'cozycoast.ledger.restored',
    ])
    expect(w.names()).toContain('cozycoast.ledger.restored')
    endedBy(w, 'talk_ines', 'ines_intro')
    endedBy(w, 'ask_gulls', 'gulls_hint')
    endedBy(w, 'return_ledger', 'ines_return')
    onlyTheProviderTalks(w)
  })

  it('honest route, then sells the ledger to the smuggler instead', () => {
    const w = world()
    take(w)
    w.talk('ines_intro', inesIntro())
    w.talk('gulls_hint', ASK_THE_GULL_FEEDER)
    w.emit('location.entered', { location: 'otter_den' })
    catchKoi(w)
    w.talk('otter_trade', HAND_OVER_THE_KOI)
    w.talk('smuggler_deal', ACCEPT_THE_DEAL)

    expect(w.state().status).toBe('closed')
    expect(w.state().outcome).toBe('sold')
    expect(w.outcomes()).toEqual([{ name: 'sold', failed: false }])
    expect(w.steps()).toEqual({
      talk_ines: 'done',
      ask_gulls: 'done',
      find_otter: 'done',
      trade: 'done',
      steal: 'skipped',
      have_ledger: 'done',
      return_ledger: 'skipped',
      sell_ledger: 'done',
      caught: 'skipped',
    })
    expect(w.rewardIds()).toEqual([
      'coins_hint',
      'xp_trade',
      'coins_sold',
      'rep_sold',
      'flag_vendor',
    ])
    expect(w.rewardRefs()).toEqual(['coins', 'xp', 'coins', 'harbor', 'smuggler_vendor_open'])
    expect(w.names()).not.toContain('cozycoast.ledger.restored')
    endedBy(w, 'sell_ledger', 'smuggler_deal')
    onlyTheProviderTalks(w)
  })

  it('steals the ledger at night and returns it anyway', () => {
    const w = world()
    take(w)
    w.talk('ines_intro', inesIntro())
    w.emit('location.entered', { location: 'otter_den' })
    w.setNight(true)
    w.emit('object.interacted', { object: 'ledger_chest' })
    w.talk('ines_return', READ_ON)

    expect(w.state().status).toBe('closed')
    expect(w.state().outcome).toBe('returned')
    expect(w.outcomes()).toEqual([{ name: 'returned', failed: false }])
    expect(w.steps()).toEqual({
      talk_ines: 'done',
      ask_gulls: 'skipped',
      find_otter: 'done',
      trade: 'skipped',
      steal: 'done',
      have_ledger: 'done',
      return_ledger: 'done',
      sell_ledger: 'skipped',
      caught: 'skipped',
    })
    expect(w.rewardIds()).toEqual(['rep_returned', 'lure_returned', 'event_restored'])
    expect(w.rewardRefs()).toEqual(['harbor', 'lure.golden', 'cozycoast.ledger.restored'])
    endedBy(w, 'talk_ines', 'ines_intro')
    endedBy(w, 'return_ledger', 'ines_return')
    onlyTheProviderTalks(w)
  })

  it('is caught in the den and the ledger is confiscated', () => {
    const w = world()
    take(w)
    w.talk('ines_intro', inesIntro())
    w.emit('location.entered', { location: 'otter_den' })
    w.setNight(true)
    w.emit('guard.caught', {})

    expect(w.state().status).toBe('closed')
    expect(w.state().outcome).toBe('confiscated')
    expect(w.outcomes()).toEqual([{ name: 'confiscated', failed: true }])
    // `caught` carries a failed outcome, and docs/01-model.md step 1 of outcome
    // handling marks the ending step `done`, or `failed` when the outcome is a
    // failure. So `caught` lands on `failed`, never on `done`.
    expect(w.steps()).toEqual({
      talk_ines: 'done',
      ask_gulls: 'skipped',
      find_otter: 'done',
      trade: 'skipped',
      steal: 'failed',
      have_ledger: 'skipped',
      return_ledger: 'skipped',
      sell_ledger: 'skipped',
      caught: 'failed',
    })
    expect(w.rewardIds()).toEqual(['rep_confiscated'])
    expect(w.rewardRefs()).toEqual(['harbor'])
    expect(w.names()).toContain(stepEvent(QUEST, 'caught', 'failed'))
    onlyTheProviderTalks(w)
  })

  it('saves after the koi are caught and finishes in a fresh runtime', () => {
    const first = world()
    take(first)
    first.talk('ines_intro', inesIntro())
    first.talk('gulls_hint', ASK_THE_GULL_FEEDER)
    first.emit('location.entered', { location: 'otter_den' })
    catchKoi(first)
    const savegame = first.runtime.save()
    expect(first.state().steps.trade.count).toBe(5)

    const second = world()
    second.runtime.load(savegame)
    expect(second.state().status).toBe('open')
    expect(second.state().steps.trade.count).toBe(5)

    second.talk('otter_trade', HAND_OVER_THE_KOI)
    second.talk('ines_return', READ_ON)

    expect(second.state().status).toBe('closed')
    expect(second.state().outcome).toBe('returned')
    expect(second.outcomes()).toEqual([{ name: 'returned', failed: false }])
    expect(second.steps()).toEqual({
      talk_ines: 'done',
      ask_gulls: 'done',
      find_otter: 'done',
      trade: 'done',
      steal: 'skipped',
      have_ledger: 'done',
      return_ledger: 'done',
      sell_ledger: 'skipped',
      caught: 'skipped',
    })
    // `coins_hint` was granted before the save, so the fresh runtime does not
    // hand it out twice.
    expect(second.rewardIds()).toEqual([
      'xp_trade',
      'rep_returned',
      'lure_returned',
      'event_restored',
    ])
    expect(second.state().rewards).toEqual([
      'coins_hint',
      'xp_trade',
      'rep_returned',
      'lure_returned',
      'event_restored',
    ])
    endedBy(second, 'return_ledger', 'ines_return')
    onlyTheProviderTalks(second)
  })

  // docs/11 says backing out of `smuggler_deal` leaves the step active. The
  // `sell_ledger` objective binds to `smuggler_deal#accept`, so only that exit
  // completes it (decision D20).
  it('lets the player back out of the smuggler deal', () => {
    const w = world()
    take(w)
    w.talk('ines_intro', inesIntro())
    w.emit('location.entered', { location: 'otter_den' })
    w.setNight(true)
    w.emit('object.interacted', { object: 'ledger_chest' })
    expect(w.steps().sell_ledger).toBe('active')

    w.talk('smuggler_deal', WALK_AWAY)
    expect(w.steps().sell_ledger).toBe('active')
    expect(w.state().outcome).toBeNull()
    expect(w.state().status).toBe('open')

    w.talk('ines_return', READ_ON)
    expect(w.state().outcome).toBe('returned')
  })

  it('offers the otter hand over disabled until five koi are in the basket', () => {
    const w = world()
    take(w)
    w.talk('ines_intro', inesIntro())
    w.emit('location.entered', { location: 'otter_den' })

    const [poor] = w.talk('otter_trade', NOT_ENOUGH_KOI)
    expect(poor.choices).toEqual([
      { index: 0, text: 'Here. Five silver koi, fresh off the line.', disabled: true },
      { index: 1, text: 'What does an otter want with a harbor ledger?', disabled: false },
      { index: 2, text: 'I do not have the fish yet.', disabled: false },
    ])

    catchKoi(w)

    const [rich] = w.talk('otter_trade', NOT_ENOUGH_KOI)
    expect(rich.choices[0]).toEqual({
      index: 0,
      text: 'Here. Five silver koi, fresh off the line.',
      disabled: false,
    })
    expect(w.steps().trade).toBe('active')
    expect(w.state().outcome).toBeNull()
  })

  it('hides a once choice in a later session of the same conversation', () => {
    const w = world()
    take(w)
    w.talk('ines_intro', inesIntro())
    w.emit('location.entered', { location: 'otter_den' })
    catchKoi(w)

    const [first] = w.talk('otter_trade', HAND_OVER_THE_KOI)
    expect(first.choices.map((choice) => choice.index)).toEqual([0, 1, 2])
    expect(w.steps().trade).toBe('done')

    const [second] = w.talk('otter_trade', NOT_ENOUGH_KOI)
    expect(second.choices.map((choice) => choice.index)).toEqual([1, 2])
    expect(second.choices.some((choice) => choice.text.includes('Five silver koi'))).toBe(false)
  })

  // A dialogue provider calls the resolver outside any quest evaluation, so
  // `count.*` must resolve by searching loaded quests (decision D21).
  it('serves count.* to a dialogue provider through runtime.resolve', () => {
    const w = world()
    take(w)
    w.talk('ines_intro', inesIntro())
    w.emit('location.entered', { location: 'otter_den' })
    catchKoi(w)
    expect(w.state().steps.trade.count).toBe(5)

    expect(w.runtime.resolve('count.trade')).toBe(5)

    const unpatched: DialogueContext = {
      resolve: (path) => w.runtime.resolve(path),
      emit: (event) => {
        w.emit(event.name, event.payload)
      },
    }
    const session = w.provider.start('otter_trade', unpatched)
    expect(session.current()?.choices[0].disabled).toBe(false)
  })
})
