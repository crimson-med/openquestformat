import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Scalar } from '@oqf/core'
import { type DialogueEvent, parseOqd } from '@oqf/dialogue'
import { describe, expect, it } from 'vitest'
import { type DialoguePlay, flagsResolver, memoryOnce, startConversation } from './dialoguePlay'

const dialogues = parseOqd(
  readFileSync(
    fileURLToPath(new URL('../../../examples/quests/harbormasters-ledger.oqd', import.meta.url)),
    'utf8',
  ),
)

function pick(play: DialoguePlay, snippet: string): number {
  const view = play.current()
  const found = view?.choices.find((choice) => String(choice.text).includes(snippet))
  if (found === undefined) throw new Error(`no choice matching "${snippet}"`)
  return found.index
}

describe('startConversation', () => {
  it('records the start event, every line, every choice and every emit in order', () => {
    const heard: DialogueEvent[] = []
    const play = startConversation(dialogues, 'gulls_hint', {
      resolve: () => false,
      emit: (event) => heard.push(event),
    })
    expect(play.conversation).toBe('gulls_hint')
    expect(play.ended).toBe(false)
    expect(play.current()?.node).toBe('ask')
    expect(play.transcript).toEqual([
      { kind: 'event', text: 'dialogue.started', detail: 'actor=gull_feeder node=gulls_hint' },
      {
        kind: 'line',
        text: 'Careful where you step. They remember faces, these birds.',
        detail: 'gull_feeder',
      },
    ])

    play.choose(pick(play, 'big leather book'))
    expect(play.transcript.slice(2)).toEqual([
      { kind: 'choice', text: 'Has anyone come past with a big leather book?' },
      { kind: 'event', text: 'dialogue.choice', detail: 'node=ask choice=0' },
      { kind: 'event', text: 'flag.set', detail: 'flag=knows_otter value=true' },
      {
        kind: 'line',
        text: 'Old Salt Otter took it, down in the den under the boardwalk. He reads it like a bedtime story.',
        detail: 'gull_feeder',
      },
    ])

    play.advance()
    expect(play.ended).toBe(true)
    expect(play.current()).toBeNull()
    expect(play.transcript.at(-1)).toEqual({
      kind: 'event',
      text: 'dialogue.ended',
      detail: 'actor=gull_feeder node=gulls_hint at=tell',
    })
    expect(heard.map((event) => event.name)).toEqual([
      'dialogue.started',
      'dialogue.choice',
      'flag.set',
      'dialogue.ended',
    ])
    expect(play.error).toBeUndefined()
  })

  it('throws on an unknown conversation, records a provider error otherwise', () => {
    expect(() => startConversation(dialogues, 'missing', { resolve: () => false })).toThrow(
      'unknown conversation',
    )
    const play = startConversation(dialogues, 'otter_trade', { resolve: () => false })
    play.choose(0)
    expect(play.error).toContain('disabled')
    expect(play.current()?.node).toBe('offer')
    expect(play.transcript.filter((entry) => entry.kind === 'choice')).toHaveLength(1)
    play.choose(pick(play, 'do not have the fish'))
    expect(play.error).toBeUndefined()
  })

  it('reads choice conditions through the resolver as things stand now', () => {
    let count = 0
    const play = startConversation(dialogues, 'otter_trade', {
      resolve: (path) => (path === 'count.trade' ? count : undefined),
    })
    expect(play.current()?.choices[0]).toMatchObject({ index: 0, disabled: true })
    count = 5
    expect(play.current()?.choices[0]).toMatchObject({ index: 0, disabled: false })
    play.choose(0)
    expect(
      play.transcript.filter((entry) => entry.kind === 'event').map((entry) => entry.text),
    ).toEqual([
      'dialogue.started',
      'flag.set',
      'flag.set',
      'dialogue.choice',
      'cozycoast.ledger.handed',
    ])
  })

  it('hides a once choice on the next play that shares the store', () => {
    const once = memoryOnce()
    const context = { resolve: (path: string) => (path === 'count.trade' ? 5 : undefined), once }
    const first = startConversation(dialogues, 'otter_trade', context)
    expect(first.current()?.choices.map((choice) => choice.index)).toEqual([0, 1, 2])
    first.choose(0)
    const second = startConversation(dialogues, 'otter_trade', context)
    expect(second.current()?.choices.map((choice) => choice.index)).toEqual([1, 2])
    const fresh = startConversation(dialogues, 'otter_trade', { resolve: context.resolve })
    expect(fresh.current()?.choices.map((choice) => choice.index)).toEqual([0, 1, 2])
  })
})

describe('flagsResolver', () => {
  it('reads the map through flag.* and bare names, unset flags as false', () => {
    const flags: Record<string, Scalar> = { otter_agreed: true, mood: 'grim' }
    const resolve = flagsResolver(() => flags)
    expect(resolve('flag.otter_agreed')).toBe(true)
    expect(resolve('otter_agreed')).toBe(true)
    expect(resolve('flag.mood')).toBe('grim')
    expect(resolve('flag.unknown')).toBe(false)
    flags.otter_agreed = false
    expect(resolve('flag.otter_agreed')).toBe(false)
  })
})
