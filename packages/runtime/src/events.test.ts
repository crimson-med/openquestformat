import { describe, expect, it } from 'vitest'
import {
  EVENT_ACTOR_KILLED,
  EVENT_DIALOGUE_ENDED,
  EVENT_FLAG_SET,
  EVENT_ITEM_COLLECTED,
  EVENT_LOCATION_ENTERED,
  EVENT_OBJECT_INTERACTED,
  EVENT_REWARD_GRANTED,
  OBJECTIVE_EVENTS,
  customObjectiveEvent,
  oqfEvent,
  questOfferedEvent,
  questOutcomeEvent,
  stepEvent,
  toEvent,
} from './events.js'

describe('consumed names', () => {
  it('matches the table in docs/03-events.md', () => {
    expect(EVENT_ACTOR_KILLED).toBe('actor.killed')
    expect(EVENT_ITEM_COLLECTED).toBe('item.collected')
    expect(EVENT_LOCATION_ENTERED).toBe('location.entered')
    expect(EVENT_DIALOGUE_ENDED).toBe('dialogue.ended')
    expect(EVENT_OBJECT_INTERACTED).toBe('object.interacted')
    expect(EVENT_FLAG_SET).toBe('flag.set')
  })

  it('lists the objective events in document order', () => {
    expect(OBJECTIVE_EVENTS).toEqual([
      'actor.killed',
      'item.collected',
      'location.entered',
      'dialogue.ended',
      'object.interacted',
      'flag.set',
    ])
  })
})

describe('emitted names', () => {
  it('prefixes every quest event with the quest id', () => {
    expect(questOfferedEvent('harbormasters_ledger')).toBe('quest.harbormasters_ledger.offered')
    expect(questOutcomeEvent('harbormasters_ledger')).toBe('quest.harbormasters_ledger.outcome')
    expect(stepEvent('harbormasters_ledger', 'trade', 'done')).toBe(
      'quest.harbormasters_ledger.step.trade.done',
    )
  })

  it('names the reward event', () => {
    expect(EVENT_REWARD_GRANTED).toBe('reward.granted')
  })

  it('builds the custom objective name from the step event shape', () => {
    expect(customObjectiveEvent('harbormasters_ledger', 'ritual')).toBe(
      stepEvent('harbormasters_ledger', 'ritual', 'custom'),
    )
  })
})

describe('event helpers', () => {
  it('defaults the payload to an empty map', () => {
    expect(oqfEvent('guard.caught')).toEqual({ name: 'guard.caught', payload: {} })
    expect(toEvent('guard.caught')).toEqual({ name: 'guard.caught', payload: {} })
  })

  it('accepts a name plus payload or a whole event', () => {
    expect(toEvent('item.collected', { item: 'fish.rare', amount: 2 })).toEqual({
      name: 'item.collected',
      payload: { item: 'fish.rare', amount: 2 },
    })
    expect(toEvent({ name: 'item.collected', payload: { item: 'fish.rare' } })).toEqual({
      name: 'item.collected',
      payload: { item: 'fish.rare' },
    })
  })
})
