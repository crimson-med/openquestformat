import { describe, expect, it } from 'vitest'
import { referenceQuest } from './fixtures.js'
import {
  ORPHANED_KEY,
  QUEST_STATUSES,
  STATE_VERSION,
  cloneQuestState,
  newQuestState,
  newStepRuntime,
} from './state.js'

describe('newQuestState', () => {
  it('starts every step locked with both counters at zero', () => {
    const state = newQuestState(referenceQuest())
    expect(Object.keys(state.steps)).toEqual([
      'talk_ines',
      'ask_gulls',
      'find_otter',
      'trade',
      'steal',
      'have_ledger',
      'return_ledger',
      'sell_ledger',
      'caught',
    ])
    for (const step of Object.values(state.steps)) {
      expect(step).toEqual({ state: 'locked', count: 0, failCount: 0 })
    }
  })

  it('carries the quest id, both versions and an unseen status', () => {
    const quest = referenceQuest()
    quest.version = 7
    const state = newQuestState(quest)
    expect(state.quest).toBe(quest.id)
    expect(state.questVersion).toBe(7)
    expect(state.stateVersion).toBe(STATE_VERSION)
    expect(state.status).toBe('unseen')
    expect(state.outcome).toBeNull()
    expect(state.flags).toEqual({})
    expect(state.rewards).toEqual([])
    expect(state.log).toEqual([])
    expect(state.ext).toEqual({})
  })
})

describe('state constants', () => {
  it('pins the schema version at 1', () => {
    expect(STATE_VERSION).toBe(1)
  })

  it('lists the four quest statuses from docs/05-state.md', () => {
    expect(QUEST_STATUSES).toEqual(['unseen', 'offered', 'open', 'closed'])
  })

  it('parks unknown steps under a namespaced ext key', () => {
    expect(ORPHANED_KEY).toBe('x-oqf.orphaned')
  })
})

describe('newStepRuntime', () => {
  it('is locked with no enteredAt', () => {
    expect(newStepRuntime()).toEqual({ state: 'locked', count: 0, failCount: 0 })
  })
})

describe('cloneQuestState', () => {
  it('copies every nested container', () => {
    const state = newQuestState(referenceQuest())
    state.flags.knows_otter = true
    state.rewards.push('gulls_coins')
    state.log.push({ step: 'talk_ines', from: 'locked', to: 'available', at: 3 })
    state.ext['x-cozycoast.lobby'] = { id: 'pier' }
    const copy = cloneQuestState(state)
    expect(copy).toEqual(state)
    copy.steps.talk_ines.state = 'done'
    copy.flags.knows_otter = false
    copy.rewards.push('trade_xp')
    copy.log[0].at = 9
    ;(copy.ext['x-cozycoast.lobby'] as Record<string, string>).id = 'cove'
    expect(state.steps.talk_ines.state).toBe('locked')
    expect(state.flags.knows_otter).toBe(true)
    expect(state.rewards).toEqual(['gulls_coins'])
    expect(state.log[0].at).toBe(3)
    expect(state.ext['x-cozycoast.lobby']).toEqual({ id: 'pier' })
  })
})
