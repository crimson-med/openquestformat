/**
 * The v0.2 recurrence features on a fake clock: cooldowns, expiry, deadlines,
 * templated quests, the quest record and the time, runs and streak namespaces.
 * Every instant is UTC so the calendar arithmetic reads the same on any host.
 */
import type { OqfDocument, Quest, Step } from '@oqf/core'
import { emptyDictionaries, parseCondition, parseObjective } from '@oqf/core'
import { describe, expect, it } from 'vitest'
import type { OqfEvent } from './events.js'
import { type BindHook, QuestRuntime, type QuestRuntimeOptions } from './runtime.js'
import type { QuestRecord, QuestState } from './state.js'

const HOUR = 3_600_000
const DAY = 24 * HOUR

/** Milliseconds since the epoch for a UTC wall clock reading. */
function utc(year: number, month: number, day: number, hour = 0, minute = 0): number {
  return Date.UTC(year, month - 1, day, hour, minute)
}

/** Thursday 2026-10-15, 10:00 UTC. */
const START = utc(2026, 10, 15, 10)

function step(fields: Partial<Step> & { id: string }): Step {
  return { title: fields.id, rewards: [], actors: [], ...fields }
}

function document(quests: Quest[]): OqfDocument {
  return { dictionaries: emptyDictionaries(), quests }
}

function quest(id: string, patch: Partial<Quest>, steps?: Step[]): Quest {
  return {
    id,
    version: 1,
    title: id,
    tags: [],
    steps: steps ?? [
      step({
        id: 'go',
        start: true,
        objective: parseObjective('event go'),
        outcome: { name: 'done' },
      }),
    ],
    rewards: [],
    ...patch,
  }
}

/** A repeatable one step quest with the given cooldown, offered by hand. */
function daily(cooldown: string, patch: Partial<Quest> = {}): OqfDocument {
  return document([quest('daily', { repeat: true, cooldown, ...patch })])
}

interface Harness {
  runtime: QuestRuntime
  seen: OqfEvent[]
  names: () => string[]
  at: (ms: number) => void
  advance: (ms: number) => void
  now: () => number
}

function harness(
  documents: OqfDocument[],
  options: Partial<QuestRuntimeOptions> & { start?: number } = {},
): Harness {
  let now = options.start ?? START
  const seen: OqfEvent[] = []
  const runtime = new QuestRuntime({
    documents,
    clock: () => now,
    calendar: { timeZone: 'UTC' },
    ...options,
  })
  runtime.on((event) => seen.push(event))
  return {
    runtime,
    seen,
    names: () => seen.map((event) => event.name),
    at: (ms) => {
      now = ms
    },
    advance: (ms) => {
      now += ms
    },
    now: () => now,
  }
}

/** Take the quest and finish it in one go. */
function complete(h: Harness, id = 'daily'): void {
  expect(h.runtime.offer(id)).toBe(true)
  h.runtime.accept(id)
  h.runtime.emit('go')
  expect(h.runtime.getRecord(id).lastOutcomeAt).toBe(h.now())
}

describe('construction', () => {
  it('refuses a timed quest on the default counter clock', () => {
    for (const patch of [
      { repeat: true, cooldown: 'day' },
      { expire: 'P1D' },
      { unlock: parseCondition('time.hour >= 20') },
    ]) {
      expect(() => new QuestRuntime({ documents: [document([quest('q', patch)])] })).toThrow(
        /QuestRuntimeOptions.clock must return milliseconds/,
      )
    }
    const timedStep = quest('q', {}, [step({ id: 'a', start: true, deadline: 'PT1H' })])
    expect(() => new QuestRuntime({ documents: [document([timedStep])] })).toThrow(/clock/)
  })

  it('accepts an untimed quest on the counter and reads time without settling', () => {
    const runtime = new QuestRuntime({ documents: [document([quest('q', {})])] })
    runtime.offer('q')
    // The counter read once for the offer is what time.now reports, and reading it does not tick.
    expect(runtime.resolve('time.now')).toBe(0)
    expect(runtime.resolve('time.now')).toBe(0)
    expect(typeof runtime.resolve('time.hour')).toBe('number')
  })
})

describe('a retaken quest (D24)', () => {
  it('starts a fresh instance unseen, numbered after the runs so far', () => {
    const h = harness([daily('PT1H')])
    complete(h)
    const fresh = h.runtime.getState('daily')
    expect(fresh.status).toBe('unseen')
    expect(fresh.instance).toBe(2)
    expect(fresh.startedAt).toBeNull()
    expect(fresh.outcome).toBeNull()
    expect(h.runtime.history[0].instance).toBe(1)
    expect(h.runtime.history[0].outcomeAt).toBe(START)
    // The runtime never reopens it by itself.
    h.advance(2 * HOUR)
    h.runtime.tick()
    expect(h.runtime.getState('daily').status).toBe('unseen')
  })
})

describe('fixed cooldowns', () => {
  it('gates offer and accept until the span has passed since the last outcome', () => {
    const h = harness([daily('PT20H')])
    complete(h)
    expect(h.runtime.offer('daily')).toBe(false)
    h.runtime.accept('daily')
    expect(h.runtime.getState('daily').status).toBe('unseen')
    h.advance(20 * HOUR - 1)
    expect(h.runtime.offer('daily')).toBe(false)
    h.advance(1)
    expect(h.runtime.offer('daily')).toBe(true)
    expect(h.runtime.getState('daily').status).toBe('offered')
  })

  it('offers an unlocked quest by itself on tick once the cooldown passes', () => {
    const h = harness([daily('PT1H', { unlock: parseCondition('flag.intro') })])
    h.runtime.emit('flag.set', { flag: 'intro', value: true })
    expect(h.runtime.getState('daily').status).toBe('offered')
    h.runtime.accept('daily')
    h.runtime.emit('go')
    expect(h.runtime.getState('daily').status).toBe('unseen')
    h.advance(HOUR - 1)
    h.runtime.tick()
    expect(h.runtime.getState('daily').status).toBe('unseen')
    h.advance(1)
    h.runtime.tick()
    expect(h.runtime.getState('daily').status).toBe('offered')
    expect(h.names().filter((name) => name === 'quest.daily.offered')).toHaveLength(2)
  })

  it('is read as passed by a clock that jumped forwards across several spans', () => {
    const h = harness([daily('PT1H')])
    complete(h)
    h.advance(50 * HOUR)
    expect(h.runtime.offer('daily')).toBe(true)
  })

  it('never locks the player out for longer than one span when the clock moves backwards', () => {
    const h = harness([daily('PT1H')])
    complete(h)
    // Thirty minutes back: the last outcome is in the future, so wait one full span from now.
    h.advance(-30 * 60_000)
    expect(h.runtime.offer('daily')).toBe(false)
    expect(h.runtime.getRecord('daily').lastOutcomeAt).toBe(h.now())
    h.advance(HOUR - 1)
    expect(h.runtime.offer('daily')).toBe(false)
    h.advance(1)
    expect(h.runtime.offer('daily')).toBe(true)
  })

  it('counts a last outcome more than a whole span in the future as passed', () => {
    const h = harness([daily('PT1H')])
    complete(h)
    h.advance(-2 * HOUR)
    expect(h.runtime.offer('daily')).toBe(true)
  })
})

describe('calendar cooldowns', () => {
  it('day: offers again at the next midnight, not twenty four hours later', () => {
    const h = harness([daily('day')])
    complete(h)
    h.at(utc(2026, 10, 15, 23, 59))
    expect(h.runtime.offer('daily')).toBe(false)
    h.at(utc(2026, 10, 16))
    expect(h.runtime.offer('daily')).toBe(true)
  })

  it('day with dayStartsAt: the boundary is the configured hour', () => {
    const h = harness([daily('day')], { calendar: { timeZone: 'UTC', dayStartsAt: 4 } })
    h.at(utc(2026, 10, 15, 3))
    complete(h)
    h.at(utc(2026, 10, 15, 3, 59))
    expect(h.runtime.offer('daily')).toBe(false)
    h.at(utc(2026, 10, 15, 4))
    expect(h.runtime.offer('daily')).toBe(true)
    h.runtime.accept('daily')
    h.runtime.emit('go')
    // Finished at 04:00, the next period starts tomorrow at 04:00.
    h.at(utc(2026, 10, 16, 3, 59))
    expect(h.runtime.offer('daily')).toBe(false)
    h.at(utc(2026, 10, 16, 4))
    expect(h.runtime.offer('daily')).toBe(true)
  })

  it('week: offers again on the next weekStart', () => {
    const monday = harness([daily('week')])
    complete(monday)
    monday.at(utc(2026, 10, 18, 23, 59))
    expect(monday.runtime.offer('daily')).toBe(false)
    monday.at(utc(2026, 10, 19))
    expect(monday.runtime.offer('daily')).toBe(true)

    const sunday = harness([daily('week')], { calendar: { timeZone: 'UTC', weekStart: 0 } })
    complete(sunday)
    sunday.at(utc(2026, 10, 17, 23, 59))
    expect(sunday.runtime.offer('daily')).toBe(false)
    sunday.at(utc(2026, 10, 18))
    expect(sunday.runtime.offer('daily')).toBe(true)
  })

  it('month: offers again on the first of the next month', () => {
    const h = harness([daily('month')])
    complete(h)
    h.at(utc(2026, 10, 31, 23, 59))
    expect(h.runtime.offer('daily')).toBe(false)
    h.at(utc(2026, 11, 1))
    expect(h.runtime.offer('daily')).toBe(true)
  })

  it('reads a last outcome two periods ahead as passed, and one period ahead as now', () => {
    const h = harness([daily('day')])
    h.at(utc(2026, 10, 17, 12))
    complete(h)
    // Back to the 15th: the outcome sits two periods ahead, the clock is broken, let the player in.
    h.at(utc(2026, 10, 15, 12))
    expect(h.runtime.offer('daily')).toBe(true)
    h.runtime.accept('daily')
    h.runtime.emit('go')
    // Now the outcome is at the 15th. One period ahead counts as now: wait for the 16th.
    h.at(utc(2026, 10, 16, 12))
    expect(h.runtime.offer('daily')).toBe(true)
    h.runtime.accept('daily')
    h.runtime.emit('go')
    h.at(utc(2026, 10, 15, 20))
    expect(h.runtime.offer('daily')).toBe(false)
    h.at(utc(2026, 10, 16))
    expect(h.runtime.offer('daily')).toBe(true)
  })

  it('survives a reload in the middle of a cooldown', () => {
    const first = harness([daily('day')])
    complete(first)
    const states = first.runtime.save()
    const records = first.runtime.saveRecords()
    expect(records[0]).toEqual<QuestRecord>({
      quest: 'daily',
      runs: 1,
      outcomes: { done: 1 },
      lastOutcome: 'done',
      lastOutcomeAt: START,
      streak: 1,
    })

    const second = harness([daily('day')], { start: utc(2026, 10, 15, 18) })
    second.runtime.load(states, records)
    expect(second.runtime.offer('daily')).toBe(false)
    expect(second.runtime.getState('daily').instance).toBe(2)
    second.at(utc(2026, 10, 16))
    expect(second.runtime.offer('daily')).toBe(true)

    const noRecords = harness([daily('day')], { start: utc(2026, 10, 15, 18) })
    noRecords.runtime.load(states)
    expect(noRecords.runtime.offer('daily')).toBe(true)
  })
})

describe('expire (D26)', () => {
  function expiring(expire: string, patch: Partial<Quest> = {}): OqfDocument {
    return document([
      quest(
        'job',
        {
          expire,
          rewards: [
            { id: 'late_fee', kind: 'currency', ref: 'coins', amount: -5, outcome: 'done' },
          ],
          ...patch,
        },
        [
          step({ id: 'a', start: true, objective: parseObjective('event a') }),
          step({ id: 'b', unlock: parseCondition('step.a'), outcome: { name: 'done' } }),
        ],
      ),
    ])
  }

  it('reaches the built-in failed outcome once the span has passed since the instance opened', () => {
    const h = harness([expiring('P1D')])
    h.runtime.offer('job')
    h.advance(5 * DAY)
    // An offer that was never accepted does not run out.
    h.runtime.tick()
    expect(h.runtime.getState('job').status).toBe('offered')
    h.runtime.accept('job')
    const opened = h.now()
    h.advance(DAY - 1)
    h.runtime.tick()
    expect(h.runtime.getState('job').status).toBe('open')
    h.advance(1)
    h.runtime.tick()
    const state = h.runtime.getState('job')
    expect(state.status).toBe('closed')
    expect(state.outcome).toBe('expired')
    expect(state.outcomeAt).toBe(opened + DAY)
    expect(state.steps.a.state).toBe('skipped')
    expect(state.steps.b.state).toBe('skipped')
    expect(state.rewards).toEqual([])
    expect(h.seen.find((event) => event.name === 'quest.job.outcome')?.payload).toEqual({
      name: 'expired',
      failed: true,
    })
    expect(h.runtime.resolve('outcome.job.expired')).toBe(true)
    expect(h.runtime.resolve('runs.job.expired')).toBe(1)
    expect(h.runtime.getRecord('job').lastOutcome).toBe('expired')
  })

  it('expires on the next entry point, not only on tick', () => {
    const h = harness([expiring('PT2H')])
    h.runtime.accept('job')
    h.advance(3 * HOUR)
    h.runtime.emit('a')
    expect(h.runtime.getState('job').outcome).toBe('expired')
    expect(h.runtime.getState('job').steps.a.state).toBe('skipped')
  })

  it('expires at the calendar boundary and starts the cooldown of a repeat quest', () => {
    const h = harness([expiring('day', { repeat: true, cooldown: 'day' })])
    h.runtime.accept('job')
    h.at(utc(2026, 10, 16))
    h.runtime.tick()
    expect(h.runtime.history[0].outcome).toBe('expired')
    expect(h.runtime.getState('job').status).toBe('unseen')
    expect(h.runtime.getState('job').instance).toBe(2)
    expect(h.runtime.offer('job')).toBe(false)
    h.at(utc(2026, 10, 17))
    expect(h.runtime.offer('job')).toBe(true)
  })
})

describe('deadline (D27)', () => {
  function timed(fields: Partial<Step>): OqfDocument {
    return document([
      quest('run', {}, [
        step({
          id: 'a',
          start: true,
          objective: parseObjective('event a'),
          deadline: 'PT2H',
          ...fields,
        }),
        step({
          id: 'b',
          unlock: parseCondition('step.a == "failed"'),
          outcome: { name: 'late', failed: true },
        }),
        step({ id: 'c', unlock: parseCondition('step.a'), outcome: { name: 'done' } }),
      ]),
    ])
  }

  it('fails the step when the span passes, with no fail rule needed', () => {
    const h = harness([timed({})])
    h.runtime.accept('run')
    h.advance(2 * HOUR - 1)
    h.runtime.tick()
    expect(h.runtime.getState('run').steps.a.state).toBe('active')
    h.advance(1)
    h.runtime.tick()
    const state = h.runtime.getState('run')
    expect(state.steps.a.state).toBe('failed')
    // D23: the quest carries on, and here the failure route closes it.
    expect(state.outcome).toBe('late')
    expect(h.names()).toContain('quest.run.step.a.failed')
  })

  it('restarts the span when a step with an activate condition activates', () => {
    const h = harness([timed({ activate: parseCondition('flag.ready') })])
    h.runtime.accept('run')
    h.advance(3 * HOUR)
    h.runtime.tick()
    expect(h.runtime.getState('run').steps.a.state).toBe('failed')

    const g = harness([timed({ activate: parseCondition('flag.ready') })])
    g.runtime.accept('run')
    g.advance(HOUR)
    g.runtime.emit('flag.set', { flag: 'ready', value: true })
    expect(g.runtime.getState('run').steps.a.state).toBe('active')
    g.advance(2 * HOUR - 1)
    g.runtime.tick()
    expect(g.runtime.getState('run').steps.a.state).toBe('active')
    g.advance(1)
    g.runtime.tick()
    expect(g.runtime.getState('run').steps.a.state).toBe('failed')
  })

  it('leaves a step alone once it is done, and on a clock moved backwards', () => {
    const h = harness([timed({})])
    h.runtime.accept('run')
    h.advance(-5 * HOUR)
    h.runtime.tick()
    expect(h.runtime.getState('run').steps.a.state).toBe('active')
    h.runtime.emit('a')
    expect(h.runtime.getState('run').outcome).toBe('done')
    h.advance(10 * HOUR)
    h.runtime.tick()
    expect(h.runtime.getState('run').steps.a.state).toBe('done')
  })
})

describe('templated quests (D28)', () => {
  function templated(patch: Partial<Quest> = {}): OqfDocument {
    return document([
      quest(
        'request',
        {
          repeat: true,
          params: [
            { name: 'fish', type: 'item', constraint: 'fish.catchable' },
            { name: 'n', type: 'number', constraint: '1..40' },
            { name: 'giver', type: 'actor' },
          ],
          ...patch,
        },
        [
          step({ id: 'catch', start: true, objective: parseObjective('collect $fish $n') }),
          step({
            id: 'turn_in',
            unlock: parseCondition('step.catch and count.catch >= $n'),
            objective: parseObjective('talk $giver'),
            outcome: { name: 'done' },
          }),
        ],
      ),
    ])
  }

  const bind: BindHook = () => ({ fish: 'fish.koi', n: 3, giver: 'gus' })

  it('is never offered without a bind hook', () => {
    const h = harness([templated({ unlock: parseCondition('flag.intro') })])
    h.runtime.emit('flag.set', { flag: 'intro', value: true })
    expect(h.runtime.getState('request').status).toBe('unseen')
    expect(h.runtime.offer('request')).toBe(false)
  })

  it('binds on offer, substitutes in objectives and conditions, and stores the values', () => {
    const calls: Array<[string, number, string[]]> = []
    const h = harness([templated()], {
      bind: (id, instance, params) => {
        calls.push([id, instance, params.map((parameter) => parameter.name)])
        return bind(id, instance, params)
      },
    })
    expect(h.runtime.offer('request')).toBe(true)
    expect(calls).toEqual([['request', 1, ['fish', 'n', 'giver']]])
    h.runtime.accept('request')
    expect(h.runtime.getState('request').params).toEqual({ fish: 'fish.koi', n: 3, giver: 'gus' })
    h.runtime.emit('item.collected', { item: 'fish.bass', amount: 3 })
    expect(h.runtime.getState('request').steps.catch.count).toBe(0)
    h.runtime.emit('item.collected', { item: 'fish.koi', amount: 2 })
    expect(h.runtime.getState('request').steps.catch.state).toBe('active')
    h.runtime.emit('item.collected', { item: 'fish.koi' })
    expect(h.runtime.getState('request').steps.catch.state).toBe('done')
    expect(h.runtime.getState('request').steps.turn_in.state).toBe('active')
    h.runtime.emit('dialogue.ended', { actor: 'milo', node: 'x' })
    expect(h.runtime.getState('request').status).toBe('open')
    h.runtime.emit('dialogue.ended', { actor: 'gus', node: 'x' })
    expect(h.runtime.history[0].outcome).toBe('done')
    // The next instance binds afresh.
    expect(h.runtime.offer('request')).toBe(true)
    expect(calls[1]).toEqual(['request', 2, ['fish', 'n', 'giver']])
  })

  it('declines a missing or out of constraint value and asks again next time', () => {
    const answers: Array<Record<string, string | number> | undefined> = [
      undefined,
      { fish: 'fish.koi', n: 3 },
      { fish: 'fish.koi', n: 41, giver: 'gus' },
      { fish: 'fish.koi', n: 'three', giver: 'gus' },
      { fish: 7, n: 3, giver: 'gus' },
      { fish: 'fish.koi', n: 1, giver: 'gus' },
    ]
    const h = harness([templated({ unlock: parseCondition('flag.intro') })], {
      bind: () => answers.shift(),
    })
    h.runtime.emit('flag.set', { flag: 'intro', value: true })
    // One bind attempt per input: the emit above, then five ticks for the five remaining answers.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(h.runtime.getState('request').status).toBe('unseen')
      h.runtime.tick()
    }
    expect(h.runtime.getState('request').status).toBe('offered')
    expect(h.runtime.getState('request').params).toEqual({ fish: 'fish.koi', n: 1, giver: 'gus' })
    expect(answers).toEqual([])
  })

  it('restores the same values from a saved instance', () => {
    const h = harness([templated()], { bind })
    h.runtime.accept('request')
    const saved = h.runtime.save()
    const g = harness([templated()], { bind: () => ({ fish: 'fish.other', n: 9, giver: 'x' }) })
    g.runtime.load(saved)
    expect(g.runtime.getState('request').params).toEqual({ fish: 'fish.koi', n: 3, giver: 'gus' })
    g.runtime.emit('item.collected', { item: 'fish.koi', amount: 3 })
    expect(g.runtime.getState('request').steps.catch.state).toBe('done')
  })

  it('hands text arguments out: the parameters, plus count and target for a step', () => {
    const h = harness([templated()], { bind })
    h.runtime.accept('request')
    h.runtime.emit('item.collected', { item: 'fish.koi', amount: 2 })
    expect(h.runtime.textArgs('request')).toEqual({ fish: 'fish.koi', n: 3, giver: 'gus' })
    expect(h.runtime.textArgs('request', 'catch')).toEqual({
      fish: 'fish.koi',
      n: 3,
      giver: 'gus',
      count: 2,
      target: 3,
    })
    expect(h.runtime.textArgs('request', 'turn_in')).toMatchObject({ count: 0, target: 1 })
    expect(() => h.runtime.textArgs('request', 'nope')).toThrow(/unknown step/)
  })
})

describe('the quest record and the new namespaces', () => {
  it('counts runs per outcome across instances and saves with the states', () => {
    const h = harness([
      document([
        quest('q', { repeat: true, expire: 'PT1H' }, [
          step({
            id: 'win',
            start: true,
            objective: parseObjective('event win'),
            outcome: { name: 'won' },
          }),
          step({
            id: 'lose',
            start: true,
            objective: parseObjective('event lose'),
            outcome: { name: 'lost', failed: true },
          }),
        ]),
      ]),
    ])
    h.runtime.accept('q')
    h.runtime.emit('win')
    h.runtime.accept('q')
    h.runtime.emit('lose')
    h.runtime.accept('q')
    h.advance(HOUR)
    h.runtime.tick()
    h.runtime.accept('q')
    h.runtime.emit('win')
    expect(h.runtime.resolve('runs.q')).toBe(4)
    expect(h.runtime.resolve('runs.q.won')).toBe(2)
    expect(h.runtime.resolve('runs.q.lost')).toBe(1)
    expect(h.runtime.resolve('runs.q.expired')).toBe(1)
    expect(h.runtime.resolve('runs.q.never')).toBe(0)
    expect(h.runtime.resolve('runs.ghost')).toBeUndefined()
    expect(h.runtime.getState('q').instance).toBe(5)
    const records = h.runtime.saveRecords()
    expect(records[0].outcomes).toEqual({ won: 2, lost: 1, expired: 1 })
    records[0].runs = 99
    expect(h.runtime.getRecord('q').runs).toBe(4)
  })

  it('serves time.* from the calendar at the instant of the input', () => {
    const h = harness([daily('day')])
    h.at(utc(2026, 10, 15, 20, 45))
    expect(h.runtime.resolve('time.now')).toBe(utc(2026, 10, 15, 20, 45))
    expect(h.runtime.resolve('time.hour')).toBe(20)
    expect(h.runtime.resolve('time.minute')).toBe(45)
    expect(h.runtime.resolve('time.weekday')).toBe(3)
    const day = Math.floor(utc(2026, 10, 15) / DAY)
    expect(h.runtime.resolve('time.day')).toBe(day)
    // Day 0 was a Thursday (4 with Sunday as 0) and weeks start on Monday (1).
    expect(h.runtime.resolve('time.week')).toBe(Math.floor((day + 4 - 1) / 7))
    expect(h.runtime.resolve('time.second')).toBeUndefined()
  })

  it('reads time.* inside conditions', () => {
    const h = harness([
      document([quest('night', { unlock: parseCondition('time.hour >= 20 or time.hour < 6') })]),
    ])
    h.at(utc(2026, 10, 15, 12))
    h.runtime.tick()
    expect(h.runtime.getState('night').status).toBe('unseen')
    h.at(utc(2026, 10, 15, 20))
    h.runtime.tick()
    expect(h.runtime.getState('night').status).toBe('offered')
  })

  it('serves time.* in a named zone', () => {
    const h = harness([daily('day')], { calendar: { timeZone: 'Asia/Tokyo' } })
    h.at(utc(2026, 10, 15, 20))
    expect(h.runtime.resolve('time.hour')).toBe(5)
    expect(h.runtime.resolve('time.weekday')).toBe(4)
  })
})

describe('streak (D30)', () => {
  function finishOn(h: Harness, ms: number): void {
    h.at(ms)
    complete(h)
  }

  it('grows over consecutive periods, holds for one missed read, and breaks after a gap', () => {
    const h = harness([daily('day')])
    finishOn(h, utc(2026, 10, 15, 10))
    expect(h.runtime.resolve('streak.daily')).toBe(1)
    finishOn(h, utc(2026, 10, 16, 9))
    finishOn(h, utc(2026, 10, 17, 23))
    expect(h.runtime.getRecord('daily').streak).toBe(3)
    // The 18th has no outcome yet: still three.
    h.at(utc(2026, 10, 18, 12))
    expect(h.runtime.resolve('streak.daily')).toBe(3)
    // Two periods on with nothing in between, the streak reads zero while the record still holds three.
    h.at(utc(2026, 10, 19, 12))
    expect(h.runtime.resolve('streak.daily')).toBe(0)
    expect(h.runtime.getRecord('daily').streak).toBe(3)
    finishOn(h, utc(2026, 10, 19, 12))
    expect(h.runtime.resolve('streak.daily')).toBe(1)
  })

  it('is broken by an expired outcome and kept by an author declared failure', () => {
    const doc = document([
      quest('d', { repeat: true, cooldown: 'day', expire: 'day' }, [
        step({
          id: 'win',
          start: true,
          objective: parseObjective('event win'),
          outcome: { name: 'won' },
        }),
        step({
          id: 'lose',
          start: true,
          objective: parseObjective('event lose'),
          outcome: { name: 'lost', failed: true },
        }),
      ]),
    ])
    const h = harness([doc])
    h.runtime.accept('d')
    h.runtime.emit('win')
    h.at(utc(2026, 10, 16, 10))
    h.runtime.accept('d')
    h.runtime.emit('lose')
    expect(h.runtime.resolve('streak.d')).toBe(2)
    h.at(utc(2026, 10, 17, 10))
    h.runtime.accept('d')
    h.at(utc(2026, 10, 18, 10))
    h.runtime.tick()
    expect(h.runtime.getRecord('d').lastOutcome).toBe('expired')
    expect(h.runtime.resolve('streak.d')).toBe(0)
    h.at(utc(2026, 10, 19, 10))
    h.runtime.accept('d')
    h.runtime.emit('win')
    expect(h.runtime.resolve('streak.d')).toBe(1)
  })

  it('counts weeks for a weekly cooldown and reads undefined without a calendar one', () => {
    const weekly = harness([daily('week')])
    finishOn(weekly, utc(2026, 10, 15))
    finishOn(weekly, utc(2026, 10, 19))
    finishOn(weekly, utc(2026, 11, 1))
    expect(weekly.runtime.resolve('streak.daily')).toBe(3)
    weekly.at(utc(2026, 11, 16))
    expect(weekly.runtime.resolve('streak.daily')).toBe(0)

    const fixed = harness([daily('PT1H')])
    complete(fixed)
    expect(fixed.runtime.resolve('streak.daily')).toBeUndefined()
    expect(fixed.runtime.getRecord('daily').streak).toBe(0)
  })

  it('survives a reload with the records', () => {
    const h = harness([daily('day')])
    finishOn(h, utc(2026, 10, 15, 10))
    finishOn(h, utc(2026, 10, 16, 10))
    const states: QuestState[] = h.runtime.save()
    const g = harness([daily('day')], { start: utc(2026, 10, 17, 10) })
    g.runtime.load(states, h.runtime.saveRecords())
    expect(g.runtime.resolve('streak.daily')).toBe(2)
    complete(g)
    expect(g.runtime.resolve('streak.daily')).toBe(3)
  })
})

describe('legacy state documents', () => {
  it('fills the version 2 fields when a version 1 document is loaded', () => {
    const h = harness([daily('day')])
    complete(h)
    const [saved] = h.runtime.save()
    const legacy = { ...saved, stateVersion: 1 } as Partial<QuestState>
    legacy.instance = undefined
    legacy.startedAt = undefined
    legacy.outcomeAt = undefined
    legacy.params = undefined
    legacy.status = 'open'
    const g = harness([daily('day')], { start: utc(2026, 10, 20) })
    g.runtime.load([legacy as QuestState], h.runtime.saveRecords())
    const state = g.runtime.getState('daily')
    expect(state.instance).toBe(2)
    expect(state.startedAt).toBe(utc(2026, 10, 20))
    expect(state.outcomeAt).toBeNull()
    expect(state.params).toEqual({})
    expect(state.stateVersion).toBe(2)
  })
})
