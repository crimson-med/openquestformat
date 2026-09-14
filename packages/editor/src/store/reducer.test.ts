import { parseCondition } from '@oqf/core'
import { describe, expect, it } from 'vitest'
import { readPosition } from '../lib/position'
import type { Action } from './actions'
import { sampleDialogues, sampleQuests } from './fixtures'
import { createState, reducer, uniqueId } from './reducer'
import type { EditorState } from './types'

function start(): EditorState {
  return createState(sampleQuests(), sampleDialogues())
}

function run(state: EditorState, ...actions: Action[]): EditorState {
  return actions.reduce(reducer, state)
}

const quest = (state: EditorState) => state.quests.quests[0]
const conversation = (state: EditorState) => state.dialogues.conversations[0]

describe('uniqueId', () => {
  it('keeps the base when it is free', () => {
    expect(uniqueId(['a'], 'b')).toBe('b')
  })

  it('counts up past collisions', () => {
    expect(uniqueId(['b', 'b_2'], 'b')).toBe('b_3')
  })
})

describe('documents', () => {
  it('starts clean and validated', () => {
    const state = start()
    expect(state.dirty).toBe(false)
    expect(state.past).toHaveLength(0)
    expect(state.findings.filter((finding) => finding.level === 'error')).toHaveLength(0)
  })

  it('loads documents and forgets history', () => {
    const state = run(start(), { type: 'quest/add' })
    const loaded = reducer(state, { type: 'doc/load', quests: sampleQuests() })
    expect(loaded.quests.quests).toHaveLength(1)
    expect(loaded.past).toHaveLength(0)
    expect(loaded.dirty).toBe(false)
  })

  it('resets to an empty document', () => {
    const state = reducer(start(), { type: 'doc/reset' })
    expect(state.quests.quests).toHaveLength(0)
    expect(state.dialogues.conversations).toHaveLength(0)
    expect(state.selection.kind).toBe('none')
  })

  it('marks the document saved without touching it', () => {
    const dirty = run(start(), { type: 'quest/add' })
    const saved = reducer(dirty, { type: 'doc/markSaved' })
    expect(saved.dirty).toBe(false)
    expect(saved.quests).toBe(dirty.quests)
  })

  it('selects without pushing history', () => {
    const state = reducer(start(), {
      type: 'select',
      selection: { kind: 'quest', quest: 'ledger' },
    })
    expect(state.selection).toEqual({ kind: 'quest', quest: 'ledger' })
    expect(state.past).toHaveLength(0)
    expect(state.dirty).toBe(false)
  })

  it('replaces the dictionaries and the speakers', () => {
    const state = run(
      start(),
      { type: 'dict/set', kind: 'items', refs: [{ id: 'lure' }] },
      { type: 'speakers/set', speakers: [{ id: 'otter' }] },
    )
    expect(state.quests.dictionaries.items).toEqual([{ id: 'lure' }])
    expect(state.dialogues.speakers).toEqual([{ id: 'otter' }])
  })
})

describe('quests', () => {
  it('adds, renames, reorders and removes', () => {
    let state = reducer(start(), { type: 'quest/add', title: 'Second' })
    expect(state.quests.quests).toHaveLength(2)
    expect(state.selection).toEqual({ kind: 'quest', quest: 'new_quest' })

    state = reducer(state, { type: 'quest/set', quest: 'new_quest', field: 'id', value: 'second' })
    expect(state.selection).toEqual({ kind: 'quest', quest: 'second' })

    state = reducer(state, { type: 'quest/move', quest: 'second', to: 0 })
    expect(state.quests.quests.map((entry) => entry.id)).toEqual(['second', 'ledger'])

    state = reducer(state, { type: 'quest/remove', quest: 'second' })
    expect(state.quests.quests.map((entry) => entry.id)).toEqual(['ledger'])
    expect(state.selection.kind).toBe('none')
  })

  it('writes every quest field', () => {
    const state = run(
      start(),
      { type: 'quest/set', quest: 'ledger', field: 'title', value: 'Renamed' },
      { type: 'quest/set', quest: 'ledger', field: 'summary', value: 'A summary' },
      { type: 'quest/set', quest: 'ledger', field: 'version', value: 3 },
      { type: 'quest/set', quest: 'ledger', field: 'repeat', value: true },
      { type: 'quest/set', quest: 'ledger', field: 'tags', value: [] },
      { type: 'quest/set', quest: 'ledger', field: 'unlock', value: parseCondition('flag.open') },
    )
    const target = quest(state)
    expect(target.title).toBe('Renamed')
    expect(target.summary).toBe('A summary')
    expect(target.version).toBe(3)
    expect(target.repeat).toBe(true)
    expect(target.tags).toEqual([])
    expect(target.unlock).toEqual({ '==': [{ var: 'flag.open' }, true] })
  })

  it('removes a key when the value is undefined', () => {
    const state = reducer(start(), {
      type: 'quest/set',
      quest: 'ledger',
      field: 'summary',
      value: undefined,
    })
    expect('summary' in quest(state)).toBe(false)
  })
})

describe('steps', () => {
  it('adds after a named step and selects it', () => {
    const state = reducer(start(), { type: 'step/add', quest: 'ledger', after: 'talk_ines' })
    expect(quest(state).steps.map((step) => step.id)).toEqual(['talk_ines', 'new_step', 'find_it'])
    expect(state.selection).toEqual({ kind: 'step', quest: 'ledger', step: 'new_step' })
  })

  it('writes every step field', () => {
    const state = run(
      start(),
      { type: 'step/set', quest: 'ledger', step: 'talk_ines', field: 'title', value: 'Talk' },
      { type: 'step/set', quest: 'ledger', step: 'talk_ines', field: 'journal', value: 'Entry' },
      { type: 'step/set', quest: 'ledger', step: 'talk_ines', field: 'optional', value: true },
      { type: 'step/set', quest: 'ledger', step: 'talk_ines', field: 'repeat', value: true },
      { type: 'step/set', quest: 'ledger', step: 'talk_ines', field: 'location', value: 'harbor' },
      { type: 'step/set', quest: 'ledger', step: 'talk_ines', field: 'rewards', value: ['coins'] },
      {
        type: 'step/set',
        quest: 'ledger',
        step: 'talk_ines',
        field: 'dialogue',
        value: { provider: 'oqf', ref: 'ines_intro' },
      },
      {
        type: 'step/set',
        quest: 'ledger',
        step: 'talk_ines',
        field: 'activate',
        value: parseCondition('flag.ready'),
      },
      {
        type: 'step/set',
        quest: 'ledger',
        step: 'talk_ines',
        field: 'failObjective',
        value: { kind: 'event', event: 'guard.caught' },
      },
    )
    const step = quest(state).steps[0]
    expect(step.title).toBe('Talk')
    expect(step.journal).toBe('Entry')
    expect(step.optional).toBe(true)
    expect(step.repeat).toBe(true)
    expect(step.location).toBe('harbor')
    expect(step.rewards).toEqual(['coins'])
    expect(step.dialogue).toEqual({ provider: 'oqf', ref: 'ines_intro' })
    expect(step.activate).toEqual({ '==': [{ var: 'flag.ready' }, true] })
    expect(step.failObjective).toEqual({ kind: 'event', event: 'guard.caught' })
  })

  it('follows a renamed step with the selection', () => {
    const state = run(
      start(),
      { type: 'select', selection: { kind: 'step', quest: 'ledger', step: 'talk_ines' } },
      { type: 'step/set', quest: 'ledger', step: 'talk_ines', field: 'id', value: 'meet_ines' },
    )
    expect(state.selection).toEqual({ kind: 'step', quest: 'ledger', step: 'meet_ines' })
  })

  it('moves and removes steps', () => {
    let state = reducer(start(), { type: 'step/move', quest: 'ledger', step: 'find_it', to: 0 })
    expect(quest(state).steps.map((step) => step.id)).toEqual(['find_it', 'talk_ines'])

    state = run(
      state,
      { type: 'select', selection: { kind: 'step', quest: 'ledger', step: 'find_it' } },
      { type: 'step/remove', quest: 'ledger', step: 'find_it' },
    )
    expect(quest(state).steps.map((step) => step.id)).toEqual(['talk_ines'])
    expect(state.selection).toEqual({ kind: 'quest', quest: 'ledger' })
  })

  it('writes graph positions into the extension bag', () => {
    const one = reducer(start(), {
      type: 'step/position',
      quest: 'ledger',
      step: 'talk_ines',
      position: { x: 12.4, y: 40.6 },
    })
    expect(readPosition(quest(one).steps[0].ext)).toEqual({ x: 12, y: 41 })

    const many = reducer(one, {
      type: 'step/positions',
      quest: 'ledger',
      positions: { talk_ines: { x: 0, y: 0 }, find_it: { x: 100, y: 200 } },
    })
    expect(readPosition(quest(many).steps[0].ext)).toEqual({ x: 0, y: 0 })
    expect(readPosition(quest(many).steps[1].ext)).toEqual({ x: 100, y: 200 })
  })

  it('edits the outcome of an ending step', () => {
    const state = run(
      start(),
      { type: 'outcome/set', quest: 'ledger', step: 'find_it', field: 'name', value: 'sold' },
      { type: 'outcome/set', quest: 'ledger', step: 'find_it', field: 'failed', value: true },
      { type: 'outcome/set', quest: 'ledger', step: 'find_it', field: 'title', value: 'Sold out' },
    )
    expect(quest(state).steps[1].outcome).toEqual({
      name: 'sold',
      failed: true,
      title: 'Sold out',
    })
  })
})

describe('rewards', () => {
  it('adds, edits, moves and removes', () => {
    let state = reducer(start(), { type: 'reward/add', quest: 'ledger' })
    expect(state.selection).toEqual({ kind: 'reward', quest: 'ledger', reward: 'new_reward' })

    state = run(
      state,
      { type: 'reward/set', quest: 'ledger', reward: 'new_reward', field: 'kind', value: 'xp' },
      { type: 'reward/set', quest: 'ledger', reward: 'new_reward', field: 'ref', value: 'xp' },
      { type: 'reward/set', quest: 'ledger', reward: 'new_reward', field: 'amount', value: 50 },
      {
        type: 'reward/set',
        quest: 'ledger',
        reward: 'new_reward',
        field: 'outcome',
        value: 'returned',
      },
      {
        type: 'reward/set',
        quest: 'ledger',
        reward: 'new_reward',
        field: 'payload',
        value: { source: 'ines' },
      },
    )
    expect(quest(state).rewards[1]).toEqual({
      id: 'new_reward',
      kind: 'xp',
      ref: 'xp',
      amount: 50,
      outcome: 'returned',
      payload: { source: 'ines' },
    })

    state = reducer(state, { type: 'reward/move', quest: 'ledger', reward: 'new_reward', to: 0 })
    expect(quest(state).rewards.map((reward) => reward.id)).toEqual(['new_reward', 'coins'])
  })

  it('renames the reward everywhere it is referenced', () => {
    const state = reducer(start(), {
      type: 'reward/set',
      quest: 'ledger',
      reward: 'coins',
      field: 'id',
      value: 'payout',
    })
    expect(quest(state).steps[1].rewards).toEqual(['payout'])
  })

  it('drops the reference when a reward is removed', () => {
    const state = reducer(start(), { type: 'reward/remove', quest: 'ledger', reward: 'coins' })
    expect(quest(state).rewards).toHaveLength(0)
    expect(quest(state).steps[1].rewards).toEqual([])
  })
})

describe('dialogue', () => {
  it('adds, renames, moves and removes conversations', () => {
    let state = reducer(start(), { type: 'conversation/add' })
    expect(state.selection).toEqual({ kind: 'conversation', conversation: 'new_conversation' })

    state = reducer(state, {
      type: 'conversation/set',
      conversation: 'new_conversation',
      field: 'id',
      value: 'otter_trade',
    })
    expect(state.selection).toEqual({ kind: 'conversation', conversation: 'otter_trade' })

    state = run(
      state,
      { type: 'conversation/set', conversation: 'otter_trade', field: 'actor', value: 'otter' },
      { type: 'conversation/set', conversation: 'otter_trade', field: 'title', value: 'Trade' },
      { type: 'conversation/set', conversation: 'otter_trade', field: 'start', value: 'start' },
      { type: 'conversation/move', conversation: 'otter_trade', to: 0 },
    )
    expect(state.dialogues.conversations.map((entry) => entry.id)).toEqual([
      'otter_trade',
      'ines_intro',
    ])

    state = reducer(state, { type: 'conversation/remove', conversation: 'otter_trade' })
    expect(state.dialogues.conversations).toHaveLength(1)
    expect(state.selection.kind).toBe('none')
  })

  it('adds and edits nodes', () => {
    let state = reducer(start(), {
      type: 'node/add',
      conversation: 'ines_intro',
      after: 'greet',
    })
    expect(conversation(state).nodes.map((node) => node.id)).toEqual([
      'greet',
      'new_node',
      'thanks',
    ])

    state = run(
      state,
      {
        type: 'node/set',
        conversation: 'ines_intro',
        node: 'new_node',
        field: 'text',
        value: 'A line',
      },
      {
        type: 'node/set',
        conversation: 'ines_intro',
        node: 'new_node',
        field: 'speaker',
        value: 'harbormaster',
      },
      {
        type: 'node/set',
        conversation: 'ines_intro',
        node: 'new_node',
        field: 'next',
        value: 'thanks',
      },
      {
        type: 'node/set',
        conversation: 'ines_intro',
        node: 'new_node',
        field: 'lore',
        value: true,
      },
      {
        type: 'node/set',
        conversation: 'ines_intro',
        node: 'new_node',
        field: 'set',
        value: [{ flag: 'heard_lore' }],
      },
      {
        type: 'node/set',
        conversation: 'ines_intro',
        node: 'new_node',
        field: 'emit',
        value: [{ event: 'lore.heard' }],
      },
    )
    const node = conversation(state).nodes[1]
    expect(node.text).toBe('A line')
    expect(node.speaker).toBe('harbormaster')
    expect(node.next).toBe('thanks')
    expect(node.lore).toBe(true)
    expect(node.set).toEqual([{ flag: 'heard_lore' }])
    expect(node.emit).toEqual([{ event: 'lore.heard' }])
  })

  it('moves, renames and removes nodes', () => {
    let state = run(
      start(),
      { type: 'select', selection: { kind: 'node', conversation: 'ines_intro', node: 'thanks' } },
      { type: 'node/set', conversation: 'ines_intro', node: 'thanks', field: 'id', value: 'bye' },
    )
    expect(state.selection).toEqual({
      kind: 'node',
      conversation: 'ines_intro',
      node: 'bye',
    })

    state = reducer(state, { type: 'node/move', conversation: 'ines_intro', node: 'bye', to: 0 })
    expect(conversation(state).nodes.map((node) => node.id)).toEqual(['bye', 'greet'])

    state = reducer(state, { type: 'node/remove', conversation: 'ines_intro', node: 'bye' })
    expect(conversation(state).nodes.map((node) => node.id)).toEqual(['greet'])
    expect(state.selection).toEqual({ kind: 'conversation', conversation: 'ines_intro' })
  })

  it('stores dialogue node positions', () => {
    const one = reducer(start(), {
      type: 'node/position',
      conversation: 'ines_intro',
      node: 'greet',
      position: { x: 8, y: 9 },
    })
    expect(readPosition(conversation(one).nodes[0].ext)).toEqual({ x: 8, y: 9 })

    const many = reducer(one, {
      type: 'node/positions',
      conversation: 'ines_intro',
      positions: { thanks: { x: 50, y: 60 } },
    })
    expect(readPosition(conversation(many).nodes[1].ext)).toEqual({ x: 50, y: 60 })
  })

  it('adds, edits, moves and removes choices', () => {
    let state = reducer(start(), { type: 'choice/add', conversation: 'ines_intro', node: 'greet' })
    expect(state.selection).toEqual({
      kind: 'choice',
      conversation: 'ines_intro',
      node: 'greet',
      choice: 2,
    })

    state = run(
      state,
      {
        type: 'choice/set',
        conversation: 'ines_intro',
        node: 'greet',
        choice: 2,
        field: 'text',
        value: 'Tell me more.',
      },
      {
        type: 'choice/set',
        conversation: 'ines_intro',
        node: 'greet',
        choice: 2,
        field: 'next',
        value: 'thanks',
      },
      {
        type: 'choice/set',
        conversation: 'ines_intro',
        node: 'greet',
        choice: 2,
        field: 'condition',
        value: parseCondition('flag.met_ines'),
      },
      {
        type: 'choice/set',
        conversation: 'ines_intro',
        node: 'greet',
        choice: 2,
        field: 'show',
        value: 'disabled',
      },
      {
        type: 'choice/set',
        conversation: 'ines_intro',
        node: 'greet',
        choice: 2,
        field: 'once',
        value: true,
      },
      {
        type: 'choice/set',
        conversation: 'ines_intro',
        node: 'greet',
        choice: 2,
        field: 'emit',
        value: [{ event: 'asked.more' }],
      },
    )
    expect(conversation(state).nodes[0].choices?.[2]).toEqual({
      text: 'Tell me more.',
      next: 'thanks',
      condition: { '==': [{ var: 'flag.met_ines' }, true] },
      show: 'disabled',
      once: true,
      emit: [{ event: 'asked.more' }],
    })

    state = reducer(state, {
      type: 'choice/move',
      conversation: 'ines_intro',
      node: 'greet',
      choice: 2,
      to: 0,
    })
    expect(conversation(state).nodes[0].choices?.[0].text).toBe('Tell me more.')

    state = reducer(state, {
      type: 'choice/remove',
      conversation: 'ines_intro',
      node: 'greet',
      choice: 0,
    })
    expect(conversation(state).nodes[0].choices).toHaveLength(2)
  })

  it('drops the choices key when the last choice goes', () => {
    let state = start()
    state = reducer(state, {
      type: 'choice/remove',
      conversation: 'ines_intro',
      node: 'greet',
      choice: 1,
    })
    state = reducer(state, {
      type: 'choice/remove',
      conversation: 'ines_intro',
      node: 'greet',
      choice: 0,
    })
    expect(conversation(state).nodes[0].choices).toBeUndefined()
  })
})

describe('history', () => {
  it('undoes and redoes an edit', () => {
    const edited = reducer(start(), {
      type: 'step/set',
      quest: 'ledger',
      step: 'talk_ines',
      field: 'title',
      value: 'Changed',
    })
    const undone = reducer(edited, { type: 'undo' })
    expect(quest(undone).steps[0].title).toBe('Speak with Ines')
    const redone = reducer(undone, { type: 'redo' })
    expect(quest(redone).steps[0].title).toBe('Changed')
  })

  it('does nothing at the ends of the stack', () => {
    const state = start()
    expect(reducer(state, { type: 'undo' })).toBe(state)
    expect(reducer(state, { type: 'redo' })).toBe(state)
  })

  it('drops the redo stack on a new edit', () => {
    let state = reducer(start(), { type: 'quest/add' })
    state = reducer(state, { type: 'undo' })
    expect(state.future).toHaveLength(1)
    state = reducer(state, { type: 'quest/add', id: 'other' })
    expect(state.future).toHaveLength(0)
  })

  it('bounds the undo stack', () => {
    let state = start()
    for (let index = 0; index < 60; index += 1) {
      state = reducer(state, {
        type: 'step/set',
        quest: 'ledger',
        step: 'talk_ines',
        field: 'title',
        value: `Title ${index}`,
      })
    }
    expect(state.past).toHaveLength(50)
  })
})

describe('validation', () => {
  it('recomputes findings when a step breaks a reference', () => {
    const broken = reducer(start(), {
      type: 'step/set',
      quest: 'ledger',
      step: 'find_it',
      field: 'unlock',
      value: parseCondition('step.ghost == "done"'),
    })
    expect(broken.findings.map((finding) => finding.code)).toContain('unknown-step-ref')

    const fixed = reducer(broken, {
      type: 'step/set',
      quest: 'ledger',
      step: 'find_it',
      field: 'unlock',
      value: parseCondition('step.talk_ines == "done"'),
    })
    expect(fixed.findings.map((finding) => finding.code)).not.toContain('unknown-step-ref')
  })

  it('reports dialogue findings with the node they belong to', () => {
    const broken = reducer(start(), {
      type: 'node/set',
      conversation: 'ines_intro',
      node: 'thanks',
      field: 'next',
      value: 'nowhere',
    })
    const finding = broken.findings.find((entry) => entry.code === 'unknown-next')
    expect(finding).toBeDefined()
    expect(finding?.source).toBe('dialogue')
    expect(finding?.conversation).toBe('ines_intro')
    expect(finding?.node).toBe('thanks')
  })
})
