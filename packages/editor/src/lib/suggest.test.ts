import { describe, expect, it } from 'vitest'
import { sampleDialogues, sampleQuests } from '../store/fixtures'
import { createState } from '../store/reducer'
import { type Vocabulary, buildVocabulary, suggest } from './suggest'

function richState() {
  const quests = sampleQuests()
  const quest = quests.quests[0]
  quest.unlock = { '==': [{ var: 'var.season' }, 'spring'] }
  quest.rewards.push(
    { id: 'mark', kind: 'flag', ref: 'ledger_returned' },
    { id: 'ping', kind: 'event', ref: 'ledger.done' },
  )
  quest.steps.push(
    {
      id: 'open_gate',
      title: 'Open the gate',
      objective: { kind: 'interact', object: 'harbor_gate' },
      complete: { and: [{ var: 'flag.gate_key' }, { '>': [{ var: 'var.tide' }, 2] }] },
      rewards: [],
      actors: [],
    },
    {
      id: 'wait_bell',
      title: 'Wait for the bell',
      objective: { kind: 'event', event: 'bell.rung', count: 3 },
      failObjective: { kind: 'custom', custom: 'weather', args: ['storm'] },
      outcome: { name: 'drowned', failed: true },
      rewards: [],
      actors: [],
    },
  )
  quests.quests.push({
    id: 'lighthouse',
    version: 1,
    title: 'The lighthouse',
    tags: [],
    steps: [
      {
        id: 'climb',
        title: 'Climb',
        outcome: { name: 'restored' },
        rewards: [],
        actors: [],
      },
    ],
    rewards: [],
  })
  const dialogues = sampleDialogues()
  dialogues.conversations[0].nodes[1].set = [{ flag: 'thanked' }]
  dialogues.conversations[0].nodes[0].choices?.push({
    text: 'Only if you pay.',
    condition: { var: 'flag.greedy' },
  })
  return createState(quests, dialogues)
}

describe('buildVocabulary', () => {
  const vocabulary = buildVocabulary(richState(), 'ledger')

  it('lists the steps of the current quest only', () => {
    expect(vocabulary.steps).toEqual(['talk_ines', 'find_it', 'open_gate', 'wait_bell'])
    expect(buildVocabulary(richState(), 'lighthouse').steps).toEqual(['climb'])
    expect(buildVocabulary(richState(), undefined).steps).toEqual([])
  })

  it('lists quests and their outcomes', () => {
    expect(vocabulary.quests).toEqual(['ledger', 'lighthouse'])
    expect(vocabulary.outcomes).toEqual({
      ledger: ['returned', 'drowned'],
      lighthouse: ['restored'],
    })
  })

  it('gathers flags from rewards, dialogue sets and condition reads', () => {
    expect(vocabulary.flags).toEqual([
      'ledger_returned',
      'gate_key',
      'met_ines',
      'greedy',
      'thanked',
    ])
  })

  it('reads the dictionaries', () => {
    expect(vocabulary.actors).toEqual(['harbormaster'])
    expect(vocabulary.items).toEqual(['ledger'])
    expect(vocabulary.locations).toEqual(['harbor'])
  })

  it('gathers objects, events, custom kinds and var paths from the pack', () => {
    expect(vocabulary.objects).toEqual(['harbor_gate'])
    expect(vocabulary.events).toEqual(['ledger.done', 'bell.rung'])
    expect(vocabulary.customKinds).toEqual(['weather'])
    expect(vocabulary.vars).toEqual(['season', 'tide'])
    expect(vocabulary.conversations).toEqual(['ines_intro'])
  })
})

const vocabulary: Vocabulary = {
  steps: ['talk_ines', 'find_it', 'Trade'],
  quests: ['ledger', 'lighthouse'],
  outcomes: { ledger: ['returned'], lighthouse: ['restored', 'ruined'] },
  flags: ['met_ines', 'otter_agreed'],
  actors: ['harbormaster', 'otter'],
  items: ['ledger', 'fish.rare'],
  locations: ['harbor', 'lighthouse'],
  objects: ['harbor_gate'],
  events: ['bell.rung'],
  customKinds: ['weather'],
  vars: ['season'],
  conversations: ['ines_intro', 'otter_deal'],
}

function labels(text: string, mode: 'condition' | 'completion' = 'condition', caret = text.length) {
  return suggest(text, caret, vocabulary, mode).map((entry) => entry.label)
}

describe('suggest in a condition', () => {
  it('offers namespaces, keywords and literals for a bare token', () => {
    expect(labels('')).toEqual([
      'step.',
      'count.',
      'flag.',
      'outcome.',
      'quest.',
      'var.',
      'and',
      'or',
      'not',
      'true',
      'false',
    ])
    expect(labels('flag.met_ines a')).toEqual(['and'])
    expect(labels('flag.met_ines and n')).toEqual(['not'])
    expect(labels('t')).toEqual(['true'])
  })

  it('completes step ids after step. and count.', () => {
    expect(labels('step.')).toEqual(['step.talk_ines', 'step.find_it', 'step.Trade'])
    expect(labels('count.f')).toEqual(['count.find_it'])
  })

  it('completes flags, outcomes, quests and var paths after their namespace', () => {
    expect(labels('flag.')).toEqual(['flag.met_ines', 'flag.otter_agreed'])
    expect(labels('outcome.')).toEqual([
      'outcome.ledger.returned',
      'outcome.lighthouse.restored',
      'outcome.lighthouse.ruined',
    ])
    expect(labels('outcome.lighthouse.ru')).toEqual(['outcome.lighthouse.ruined'])
    expect(labels('quest.')).toEqual(['quest.ledger', 'quest.lighthouse'])
    expect(labels('var.')).toEqual(['var.season'])
    expect(labels('nope.')).toEqual([])
  })

  it('offers equality operators and states after a step path', () => {
    expect(labels('step.find_it ')).toEqual([
      '==',
      '!=',
      '"locked"',
      '"available"',
      '"active"',
      '"done"',
      '"failed"',
      '"skipped"',
    ])
    expect(labels('step.find_it d')).toEqual(['"done"'])
    expect(labels('step.find_it == ')).toEqual([
      '"locked"',
      '"available"',
      '"active"',
      '"done"',
      '"failed"',
      '"skipped"',
    ])
  })

  it('offers numeric comparisons after a count path', () => {
    expect(labels('count.find_it ')).toEqual(['>=', '>', '==', '<', '<='])
  })

  it('inserts a trailing space after operators, keywords and objective kinds', () => {
    const [equals] = suggest('step.find_it ', 13, vocabulary, 'condition')
    expect(equals.insert).toBe('== ')
    const [and] = suggest('flag.x a', 8, vocabulary, 'condition')
    expect(and.insert).toBe('and ')
  })

  it('replaces the token under the caret, not the whole text', () => {
    const text = 'flag.met_ines and step.f or flag.x'
    const caret = 'flag.met_ines and step.f'.length
    const [entry] = suggest(text, caret, vocabulary, 'condition')
    expect(entry.insert).toBe('step.find_it')
    expect(entry.range).toEqual({ start: 18, end: caret })
  })

  it('filters case-insensitively and ranks exact prefixes first', () => {
    expect(labels('step.t')).toEqual(['step.talk_ines', 'step.Trade'])
    expect(labels('step.T')).toEqual(['step.Trade', 'step.talk_ines'])
  })

  it('caps the list at twelve', () => {
    const many: Vocabulary = { ...vocabulary, flags: Array.from({ length: 30 }, (_, i) => `f${i}`) }
    expect(suggest('flag.', 5, many, 'condition')).toHaveLength(12)
  })

  it('stays quiet inside a double quoted string', () => {
    expect(labels('step.find_it == "d')).toEqual([])
    expect(labels('var.x == "a\\"b')).toEqual([])
    expect(labels('var.x == "done" and st')).toEqual(['step.'])
  })
})

describe('suggest in a completion', () => {
  it('offers objective kinds and condition starters at the start', () => {
    expect(labels('', 'completion').slice(0, 7)).toEqual([
      'collect',
      'kill',
      'reach',
      'talk',
      'interact',
      'event',
      'custom',
    ])
    expect(labels('co', 'completion')).toEqual(['collect', 'count.'])
    const [collect] = suggest('co', 2, vocabulary, 'completion')
    expect(collect.insert).toBe('collect ')
    expect(collect.detail).toBe('objective')
  })

  it('offers the reference each objective kind expects', () => {
    expect(labels('collect ', 'completion')).toEqual(['ledger', 'fish.rare'])
    expect(labels('collect fish', 'completion')).toEqual(['fish.rare'])
    expect(labels('kill ', 'completion')).toEqual(['harbormaster', 'otter'])
    expect(labels('talk ', 'completion')).toEqual(['harbormaster', 'otter'])
    expect(labels('reach ', 'completion')).toEqual(['harbor', 'lighthouse'])
    expect(labels('interact ', 'completion')).toEqual(['harbor_gate'])
    expect(labels('event ', 'completion')).toEqual(['bell.rung'])
    expect(labels('custom ', 'completion')).toEqual(['weather'])
    expect(suggest('collect ', 8, vocabulary, 'completion')[0].detail).toBe('item')
  })

  it('offers conversation ids after talk and an actor', () => {
    expect(labels('talk otter ', 'completion')).toEqual(['ines_intro', 'otter_deal', 'and'])
    expect(labels('talk otter ot', 'completion')).toEqual(['otter_deal'])
  })

  it('offers and after a complete objective', () => {
    expect(labels('collect fish.rare ', 'completion')).toEqual(['and'])
    expect(labels('collect fish.rare 5 ', 'completion')).toEqual(['and'])
    expect(labels('talk otter ines_intro ', 'completion')).toEqual(['and'])
    expect(labels('custom weather storm ', 'completion')).toEqual(['and'])
  })

  it('falls back to condition rules after and, and for a plain condition', () => {
    expect(labels('collect fish.rare and flag.', 'completion')).toEqual([
      'flag.met_ines',
      'flag.otter_agreed',
    ])
    expect(labels('collect fish.rare and step.find_it ', 'completion')[0]).toBe('==')
    expect(labels('flag.met_ines and st', 'completion')).toEqual(['step.'])
    expect(labels('step.', 'completion')).toEqual(['step.talk_ines', 'step.find_it', 'step.Trade'])
  })

  it('stays quiet inside a string', () => {
    expect(labels('collect fish and var.x == "sp', 'completion')).toEqual([])
  })
})
