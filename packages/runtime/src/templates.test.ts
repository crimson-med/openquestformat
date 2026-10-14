/**
 * The recurrence templates in packages/examples/quests/templates, driven
 * through the runtime on a fake clock: daily, weekly, deadline and templated,
 * the last one with a bind hook standing in for the game.
 */
import { readFileSync } from 'node:fs'
import { type OqfDocument, parseCompact } from '@oqf/core'
import { describe, expect, it } from 'vitest'
import { type BindHook, QuestRuntime } from './runtime.js'

function template(name: string): OqfDocument {
  return parseCompact(
    readFileSync(new URL(`../../examples/quests/templates/${name}.oqf`, import.meta.url), 'utf8'),
  )
}

function utc(year: number, month: number, day: number, hour = 0, minute = 0): number {
  return Date.UTC(year, month - 1, day, hour, minute)
}

function clocked(name: string, start: number, bind?: BindHook) {
  let now = start
  const runtime = new QuestRuntime({
    documents: [template(name)],
    clock: () => now,
    calendar: { timeZone: 'UTC' },
    bind,
  })
  return {
    runtime,
    at: (ms: number) => {
      now = ms
    },
  }
}

describe('daily template', () => {
  it('runs once a day and expires a day after it starts', () => {
    const { runtime, at } = clocked('daily', utc(2026, 10, 15, 8))
    runtime.emit('flag.set', { flag: 'bakery_open', value: true })
    expect(runtime.getState('morning_delivery').status).toBe('offered')
    runtime.accept('morning_delivery')
    runtime.emit('dialogue.ended', { actor: 'baker', node: 'odile_order' })
    runtime.emit('item.collected', { item: 'driftwood', amount: 5 })
    runtime.emit('dialogue.ended', { actor: 'baker', node: 'odile_thanks' })
    expect(runtime.history[0].outcome).toBe('delivered')
    expect(runtime.getState('morning_delivery').status).toBe('unseen')
    // Offered again at midnight, not before.
    at(utc(2026, 10, 15, 23, 59))
    runtime.tick()
    expect(runtime.getState('morning_delivery').status).toBe('unseen')
    at(utc(2026, 10, 16))
    runtime.tick()
    expect(runtime.getState('morning_delivery').status).toBe('offered')
    runtime.accept('morning_delivery')
    at(utc(2026, 10, 17, 0, 1))
    runtime.tick()
    expect(runtime.history[1].outcome).toBe('expired')
    expect(runtime.resolve('runs.morning_delivery.expired')).toBe(1)
  })
})

describe('weekly template', () => {
  it('counts a streak of weeks', () => {
    const { runtime, at } = clocked('weekly', utc(2026, 10, 14, 9))
    runtime.emit('flag.set', { flag: 'warden_trusts_you', value: true })
    const clear = () => {
      runtime.accept('weekly_bounty')
      runtime.emit('dialogue.ended', { actor: 'warden', node: 'pell_bounty' })
      for (let gull = 0; gull < 8; gull += 1) runtime.emit('actor.killed', { actor: 'gull' })
      runtime.emit('dialogue.ended', { actor: 'warden', node: 'pell_report' })
    }
    clear()
    expect(runtime.resolve('streak.weekly_bounty')).toBe(1)
    at(utc(2026, 10, 18, 9))
    runtime.tick()
    expect(runtime.getState('weekly_bounty').status).toBe('unseen')
    at(utc(2026, 10, 19, 9))
    runtime.tick()
    clear()
    expect(runtime.resolve('streak.weekly_bounty')).toBe(2)
    at(utc(2026, 11, 9, 9))
    expect(runtime.resolve('streak.weekly_bounty')).toBe(0)
  })
})

describe('deadline template', () => {
  it('fails the race when ten minutes pass and saves the box otherwise', () => {
    const late = clocked('deadline', utc(2026, 10, 15, 8))
    late.runtime.accept('tide_race')
    late.runtime.emit('dialogue.ended', { actor: 'skipper', node: 'brann_panic' })
    late.at(utc(2026, 10, 15, 8, 10))
    late.runtime.emit('location.entered', { location: 'sandbar' })
    expect(late.runtime.getState('tide_race').steps.race_tide.state).toBe('failed')
    expect(late.runtime.getState('tide_race').outcome).toBe('drowned')

    const quick = clocked('deadline', utc(2026, 10, 15, 8))
    quick.runtime.accept('tide_race')
    quick.runtime.emit('dialogue.ended', { actor: 'skipper', node: 'brann_panic' })
    quick.at(utc(2026, 10, 15, 8, 9))
    quick.runtime.emit('location.entered', { location: 'sandbar' })
    quick.runtime.emit('object.interacted', { object: 'tackle_box' })
    expect(quick.runtime.getState('tide_race').outcome).toBe('saved')
  })
})

describe('templated template', () => {
  it('binds the fish and the count through the hook and plays the bound request', () => {
    const asked: number[] = []
    const { runtime, at } = clocked('templated', utc(2026, 10, 15, 8), (_quest, instance) => {
      asked.push(instance)
      return { fish: instance === 1 ? 'fish.koi' : 'fish.bass', n: instance === 1 ? 3 : 1 }
    })
    runtime.emit('flag.set', { flag: 'market_open', value: true })
    expect(asked).toEqual([1])
    runtime.accept('fishmongers_request')
    expect(runtime.textArgs('fishmongers_request', 'catch_fish')).toEqual({
      fish: 'fish.koi',
      n: 3,
      count: 0,
      target: 3,
    })
    runtime.emit('dialogue.ended', { actor: 'monger', node: 'hesper_request' })
    runtime.emit('item.collected', { item: 'fish.bass', amount: 3 })
    expect(runtime.getState('fishmongers_request').steps.catch_fish.count).toBe(0)
    runtime.emit('item.collected', { item: 'fish.koi', amount: 3 })
    runtime.emit('dialogue.ended', { actor: 'monger', node: 'hesper_thanks' })
    expect(runtime.history[0].outcome).toBe('filled')
    expect(runtime.history[0].params).toEqual({ fish: 'fish.koi', n: 3 })
    at(utc(2026, 10, 16))
    runtime.tick()
    expect(asked).toEqual([1, 2])
    expect(runtime.getState('fishmongers_request').params).toEqual({ fish: 'fish.bass', n: 1 })
  })

  it('is never offered without a bind hook', () => {
    const { runtime } = clocked('templated', utc(2026, 10, 15, 8))
    runtime.emit('flag.set', { flag: 'market_open', value: true })
    expect(runtime.getState('fishmongers_request').status).toBe('unseen')
  })
})
