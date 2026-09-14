import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { DialogueContext, DialogueEvent, OnceStore } from '../bridge.js'
import { parseOqd } from '../compact/parse.js'
import type { Conversation, DialogueDocument } from '../model.js'
import { MAX_ADVANCES, OqfDialogueProvider } from './provider.js'

function read(name: string): string {
  return readFileSync(new URL(`../../../examples/quests/${name}`, import.meta.url), 'utf8')
}

interface Harness {
  context: DialogueContext
  events: DialogueEvent[]
  keys: Set<string>
}

/** A recording emit and a fake once store, so a whole conversation can be replayed. */
function harness(variables: Record<string, unknown> = {}): Harness {
  const events: DialogueEvent[] = []
  const keys = new Set<string>()
  const once: OnceStore = {
    has: (key) => keys.has(key),
    add: (key) => {
      keys.add(key)
    },
  }
  return {
    events,
    keys,
    context: {
      resolve: (path) => variables[path],
      emit: (event) => {
        events.push(event)
      },
      once,
    },
  }
}

function doc(...conversations: Conversation[]): DialogueDocument {
  return { speakers: [], conversations }
}

const reference = new OqfDialogueProvider([parseOqd(read('harbormasters-ledger.oqd'))])

describe('the provider', () => {
  it('is named oqf and knows every conversation in the documents', () => {
    expect(reference.name).toBe('oqf')
    expect(reference.ids()).toEqual([
      'ines_intro',
      'gulls_hint',
      'otter_trade',
      'ines_return',
      'smuggler_deal',
    ])
    expect(reference.has('ines_intro')).toBe(true)
    expect(reference.has('nope')).toBe(false)
  })

  it('refuses to start an unknown conversation', () => {
    expect(() => reference.start('nope', harness().context)).toThrow('unknown conversation "nope"')
  })

  it('keeps the first conversation when two documents declare the same id', () => {
    const provider = new OqfDialogueProvider([
      doc({ id: 'a', start: 'g', nodes: [{ id: 'g', text: 'first' }] }),
      doc({ id: 'a', start: 'g', nodes: [{ id: 'g', text: 'second' }] }),
    ])
    const context = harness().context
    expect(provider.start('a', context).current()?.text).toBe('first')
  })
})

describe('ines_intro, end to end', () => {
  it('walks a lore branch, comes back and ends on the promise', () => {
    const { context, events } = harness()
    const session = reference.start('ines_intro', context)

    const opening = session.current()
    expect(opening).toMatchObject({
      conversation: 'ines_intro',
      node: 'greet',
      speaker: 'harbormaster',
      linear: false,
    })
    expect(opening?.choices.map((choice) => choice.index)).toEqual([0, 1, 2, 3])
    expect(opening?.choices.every((choice) => !choice.disabled)).toBe(true)

    session.choose(0)
    expect(session.current()).toMatchObject({ node: 'lighthouse', linear: true })
    session.advance()
    expect(session.current()?.node).toBe('greet')

    session.choose(3)
    expect(session.current()).toMatchObject({ node: 'promise', linear: true })
    session.advance()

    expect(session.ended).toBe(true)
    expect(session.current()).toBeNull()
    expect(events).toEqual([
      { name: 'dialogue.started', payload: { actor: 'harbormaster', node: 'ines_intro' } },
      { name: 'dialogue.choice', payload: { node: 'greet', choice: 0 } },
      { name: 'dialogue.choice', payload: { node: 'greet', choice: 3 } },
      {
        name: 'dialogue.ended',
        payload: { actor: 'harbormaster', node: 'ines_intro', at: 'promise' },
      },
    ])
  })

  it('emits nothing but the frame on any lore path, which is what lore promises', () => {
    for (const index of [0, 1, 2]) {
      const { context, events } = harness()
      const session = reference.start('ines_intro', context)
      session.choose(index)
      session.advance()
      session.choose(3)
      session.advance()
      expect(events.map((event) => event.name)).toEqual([
        'dialogue.started',
        'dialogue.choice',
        'dialogue.choice',
        'dialogue.ended',
      ])
    }
  })
})

describe('gulls_hint, end to end', () => {
  it('sets knows_otter when the player asks about the ledger', () => {
    const { context, events } = harness()
    const session = reference.start('gulls_hint', context)
    session.choose(0)
    expect(session.current()?.node).toBe('tell')
    session.advance()

    expect(events).toEqual([
      { name: 'dialogue.started', payload: { actor: 'gull_feeder', node: 'gulls_hint' } },
      { name: 'dialogue.choice', payload: { node: 'ask', choice: 0 } },
      { name: 'flag.set', payload: { flag: 'knows_otter', value: true } },
      { name: 'dialogue.ended', payload: { actor: 'gull_feeder', node: 'gulls_hint', at: 'tell' } },
    ])
  })

  it('sets nothing on the lore branch or on the way out', () => {
    for (const index of [1, 2]) {
      const { context, events } = harness()
      const session = reference.start('gulls_hint', context)
      session.choose(index)
      if (!session.ended) session.advance()
      expect(events.map((event) => event.name)).toEqual([
        'dialogue.started',
        'dialogue.choice',
        'dialogue.ended',
      ])
    }
  })
})

describe('otter_trade, end to end', () => {
  it('lists the hand over as disabled until the player has five koi', () => {
    const { context } = harness({ 'count.trade': 2 })
    const session = reference.start('otter_trade', context)
    expect(session.current()?.choices).toEqual([
      { index: 0, text: 'Here. Five silver koi, fresh off the line.', disabled: true },
      { index: 1, text: 'What does an otter want with a harbor ledger?', disabled: false },
      { index: 2, text: 'I do not have the fish yet.', disabled: false },
    ])
    expect(() => session.choose(0)).toThrow('is disabled')
  })

  it('sends the player away and ends when they have no fish', () => {
    const { context, events } = harness({ 'count.trade': 0 })
    const session = reference.start('otter_trade', context)
    session.choose(2)
    expect(session.current()?.node).toBe('come_back')
    session.advance()
    expect(events).toEqual([
      { name: 'dialogue.started', payload: { actor: 'otter', node: 'otter_trade' } },
      { name: 'dialogue.choice', payload: { node: 'offer', choice: 2 } },
      { name: 'dialogue.ended', payload: { actor: 'otter', node: 'otter_trade', at: 'come_back' } },
    ])
  })

  it('hands the ledger over once the count condition holds', () => {
    const { context, events, keys } = harness({ 'count.trade': 5 })
    const session = reference.start('otter_trade', context)
    expect(session.current()?.choices[0].disabled).toBe(false)
    session.choose(0)
    expect(session.current()?.node).toBe('handover')
    session.advance()

    expect(events).toEqual([
      { name: 'dialogue.started', payload: { actor: 'otter', node: 'otter_trade' } },
      { name: 'flag.set', payload: { flag: 'otter_agreed', value: true } },
      { name: 'flag.set', payload: { flag: 'otter_traded', value: true } },
      { name: 'dialogue.choice', payload: { node: 'offer', choice: 0 } },
      { name: 'cozycoast.ledger.handed', payload: { from: 'otter' } },
      { name: 'dialogue.ended', payload: { actor: 'otter', node: 'otter_trade', at: 'handover' } },
    ])
    expect([...keys]).toEqual(['otter_trade#offer#0'])
  })

  it('hides the hand over on a later visit, even with the fish in hand', () => {
    const { context, keys } = harness({ 'count.trade': 5 })
    keys.add('otter_trade#offer#0')
    const session = reference.start('otter_trade', context)
    expect(session.current()?.choices.map((choice) => choice.index)).toEqual([1, 2])
    expect(() => session.choose(0)).toThrow('is hidden')
  })

  it('loops through the curiosity branch and back to the offer', () => {
    const { context } = harness({ 'count.trade': 0 })
    const session = reference.start('otter_trade', context)
    session.choose(1)
    expect(session.current()?.node).toBe('curiosity')
    session.advance()
    expect(session.current()?.node).toBe('offer')
  })
})

describe('ines_return, end to end', () => {
  it('runs two linear nodes and ends', () => {
    const { context, events } = harness()
    const session = reference.start('ines_return', context)
    expect(session.current()).toMatchObject({ node: 'thanks', linear: true, choices: [] })
    session.advance()
    expect(session.current()?.node).toBe('farewell')
    session.advance()
    expect(session.ended).toBe(true)
    expect(events).toEqual([
      { name: 'dialogue.started', payload: { actor: 'harbormaster', node: 'ines_return' } },
      {
        name: 'dialogue.ended',
        payload: { actor: 'harbormaster', node: 'ines_return', at: 'farewell' },
      },
    ])
  })
})

describe('smuggler_deal, end to end', () => {
  it('takes the deal and emits the custom event', () => {
    const { context, events } = harness()
    const session = reference.start('smuggler_deal', context)
    session.choose(0)
    session.advance()
    expect(session.current()?.node).toBe('offer')
    session.choose(1)
    expect(session.current()?.node).toBe('accept')
    session.advance()
    expect(events).toEqual([
      { name: 'dialogue.started', payload: { actor: 'smuggler', node: 'smuggler_deal' } },
      { name: 'dialogue.choice', payload: { node: 'offer', choice: 0 } },
      { name: 'cozycoast.smuggler.deal', payload: { price: 200 } },
      { name: 'dialogue.choice', payload: { node: 'offer', choice: 1 } },
      {
        name: 'dialogue.ended',
        payload: { actor: 'smuggler', node: 'smuggler_deal', at: 'accept' },
      },
    ])
  })

  it('backs out without emitting anything but the frame', () => {
    const { context, events } = harness()
    const session = reference.start('smuggler_deal', context)
    session.choose(2)
    expect(session.current()?.node).toBe('walk_away')
    session.advance()
    expect(events).toEqual([
      { name: 'dialogue.started', payload: { actor: 'smuggler', node: 'smuggler_deal' } },
      { name: 'dialogue.choice', payload: { node: 'offer', choice: 2 } },
      {
        name: 'dialogue.ended',
        payload: { actor: 'smuggler', node: 'smuggler_deal', at: 'walk_away' },
      },
    ])
  })
})

describe('showing a node', () => {
  it('applies set before emit, once per visit', () => {
    const provider = new OqfDialogueProvider([
      doc({
        id: 'a',
        start: 'g',
        nodes: [
          {
            id: 'g',
            text: 'x',
            next: 'h',
            set: [{ flag: 'f', value: 2 }],
            emit: [{ event: 'e', payload: { k: 'v' } }],
          },
          { id: 'h', text: 'y', next: 'g' },
        ],
      }),
    ])
    const { context, events } = harness()
    const session = provider.start('a', context)
    session.advance()
    session.advance()
    expect(events).toEqual([
      { name: 'dialogue.started', payload: { actor: '', node: 'a' } },
      { name: 'flag.set', payload: { flag: 'f', value: 2 } },
      { name: 'e', payload: { k: 'v' } },
      { name: 'flag.set', payload: { flag: 'f', value: 2 } },
      { name: 'e', payload: { k: 'v' } },
    ])
  })

  it('defaults a flag with no value to true', () => {
    const provider = new OqfDialogueProvider([
      doc({ id: 'a', start: 'g', nodes: [{ id: 'g', text: 'x', set: [{ flag: 'f' }] }] }),
    ])
    const { context, events } = harness()
    provider.start('a', context)
    expect(events[1]).toEqual({ name: 'flag.set', payload: { flag: 'f', value: true } })
  })

  it('uses the conversation actor as the speaker unless the node names one', () => {
    const provider = new OqfDialogueProvider([
      doc({
        id: 'a',
        actor: 'ines',
        start: 'g',
        nodes: [
          { id: 'g', text: 'x', next: 'h' },
          { id: 'h', speaker: 'otter', text: 'y' },
        ],
      }),
    ])
    const session = provider.start('a', harness().context)
    expect(session.current()?.speaker).toBe('ines')
    session.advance()
    expect(session.current()?.speaker).toBe('otter')
  })

  it('sends an empty actor when the conversation has none', () => {
    const provider = new OqfDialogueProvider([
      doc({ id: 'a', start: 'g', nodes: [{ id: 'g', text: 'x' }] }),
    ])
    const { context, events } = harness()
    const session = provider.start('a', context)
    expect(session.current()?.speaker).toBeUndefined()
    session.advance()
    expect(events).toEqual([
      { name: 'dialogue.started', payload: { actor: '', node: 'a' } },
      { name: 'dialogue.ended', payload: { actor: '', node: 'a', at: 'g' } },
    ])
  })

  it('throws when a next names a node the conversation does not have', () => {
    const provider = new OqfDialogueProvider([
      doc({ id: 'a', start: 'g', nodes: [{ id: 'g', text: 'x', next: 'gone' }] }),
    ])
    const session = provider.start('a', harness().context)
    expect(() => session.advance()).toThrow('conversation "a" has no node "gone"')
  })

  it('throws when the start node is missing', () => {
    const provider = new OqfDialogueProvider([doc({ id: 'a', start: 'gone', nodes: [] })])
    expect(() => provider.start('a', harness().context)).toThrow('has no node "gone"')
  })
})

describe('advance and choose', () => {
  const branching = new OqfDialogueProvider([
    doc({
      id: 'a',
      start: 'g',
      nodes: [
        {
          id: 'g',
          text: 'x',
          choices: [{ text: 'gated', condition: { var: 'flag.open' } }, { text: 'always' }],
        },
      ],
    }),
  ])

  it('is a no-op on a node with choices', () => {
    const { context, events } = harness()
    const session = branching.start('a', context)
    session.advance()
    session.advance()
    expect(session.current()?.node).toBe('g')
    expect(events).toHaveLength(1)
  })

  it('evaluates choice conditions on every call to current', () => {
    const flags: Record<string, unknown> = { 'flag.open': false }
    const events: DialogueEvent[] = []
    const session = branching.start('a', {
      resolve: (path) => flags[path],
      emit: (event) => {
        events.push(event)
      },
    })
    expect(session.current()?.choices.map((choice) => choice.index)).toEqual([1])
    flags['flag.open'] = true
    expect(session.current()?.choices.map((choice) => choice.index)).toEqual([0, 1])
  })

  it('throws on a hidden, an out of range and a fractional choice', () => {
    const session = branching.start('a', harness().context)
    expect(() => session.choose(0)).toThrow('is hidden')
    expect(() => session.choose(2)).toThrow('unknown choice 2')
    expect(() => session.choose(-1)).toThrow('unknown choice -1')
    expect(() => session.choose(1.5)).toThrow('unknown choice 1.5')
  })

  it('throws once the conversation has ended', () => {
    const provider = new OqfDialogueProvider([
      doc({ id: 'a', start: 'g', nodes: [{ id: 'g', text: 'x' }] }),
    ])
    const session = provider.start('a', harness().context)
    session.advance()
    expect(() => session.advance()).toThrow('it has ended')
    expect(() => session.choose(0)).toThrow('it has ended')
  })

  it('gives up on a linear loop after the advance budget', () => {
    const provider = new OqfDialogueProvider([
      doc({
        id: 'a',
        start: 'g',
        nodes: [
          { id: 'g', text: 'x', next: 'h' },
          { id: 'h', text: 'y', next: 'g' },
        ],
      }),
    ])
    const session = provider.start('a', harness().context)
    for (let step = 0; step < MAX_ADVANCES; step += 1) session.advance()
    expect(() => session.advance()).toThrow('it is looping')
  })

  it('records a once choice only when it is taken', () => {
    const provider = new OqfDialogueProvider([
      doc({
        id: 'a',
        start: 'g',
        nodes: [
          {
            id: 'g',
            text: 'x',
            choices: [
              { text: 'plain', next: 'g' },
              { text: 'single', once: true },
            ],
          },
        ],
      }),
    ])
    const { context, keys } = harness()
    const session = provider.start('a', context)
    session.choose(0)
    expect([...keys]).toEqual([])
    session.choose(1)
    expect([...keys]).toEqual(['a#g#1'])
  })

  it('works without a once store', () => {
    const provider = new OqfDialogueProvider([
      doc({
        id: 'a',
        start: 'g',
        nodes: [{ id: 'g', text: 'x', choices: [{ text: 'single', once: true }] }],
      }),
    ])
    const events: DialogueEvent[] = []
    const session = provider.start('a', {
      resolve: () => undefined,
      emit: (event) => {
        events.push(event)
      },
    })
    session.choose(0)
    expect(session.ended).toBe(true)
  })
})
