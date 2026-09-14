import { describe, expect, it } from 'vitest'
import type { OqfDocument, Quest, Step } from '../model.js'
import { fullDocument, minimalDocument } from './fixtures.js'
import { fromJsonValue } from './parse.js'
import { toJson, toJsonValue } from './serialize.js'

type Json = Record<string, unknown>

function value(doc: OqfDocument): Json {
  return toJsonValue(doc) as Json
}

function firstQuest(doc: OqfDocument): Json {
  return (value(doc).quests as Json[])[0]
}

function stepNamed(doc: OqfDocument, id: string): Json {
  return (firstQuest(doc).steps as Json[]).find((step) => step.id === id) as Json
}

function rewardNamed(doc: OqfDocument, id: string): Json {
  return (firstQuest(doc).rewards as Json[]).find((reward) => reward.id === id) as Json
}

function withStep(patch: Partial<Step>): OqfDocument {
  const doc = minimalDocument()
  Object.assign(doc.quests[0].steps[0], patch)
  return doc
}

function withQuest(patch: Partial<Quest>): OqfDocument {
  const doc = minimalDocument()
  Object.assign(doc.quests[0], patch)
  return doc
}

describe('toJsonValue', () => {
  it('writes the document shape', () => {
    expect(value(minimalDocument())).toEqual({
      oqf: 1,
      dictionaries: { actors: [], locations: [], items: [], tags: [] },
      quests: [
        {
          id: 'first_light',
          version: 1,
          title: 'First Light',
          steps: [{ id: 'wake_up', title: 'Wake up' }],
        },
      ],
    })
  })

  it('keeps the document key order', () => {
    expect(Object.keys(value(fullDocument()))).toEqual(['oqf', 'dictionaries', 'quests'])
  })

  it('keeps the dictionaries key order', () => {
    expect(Object.keys(value(fullDocument()).dictionaries as Json)).toEqual([
      'actors',
      'locations',
      'items',
      'tags',
    ])
  })

  it('keeps the quest key order', () => {
    expect(Object.keys(firstQuest(fullDocument()))).toEqual([
      'id',
      'version',
      'title',
      'summary',
      'tags',
      'repeat',
      'unlock',
      'steps',
      'rewards',
      'ext',
    ])
  })

  it('keeps the step key order', () => {
    expect(Object.keys(stepNamed(fullDocument(), 'talk_ines'))).toEqual([
      'id',
      'title',
      'journal',
      'start',
      'objective',
      'rewards',
      'dialogue',
      'location',
      'actors',
      'ext',
    ])
    expect(Object.keys(stepNamed(fullDocument(), 'trade'))).toEqual([
      'id',
      'title',
      'unlock',
      'objective',
      'complete',
      'repeat',
      'rewards',
      'actors',
    ])
    expect(Object.keys(stepNamed(fullDocument(), 'steal'))).toEqual([
      'id',
      'title',
      'unlock',
      'objective',
      'failObjective',
      'fail',
    ])
  })

  it('keeps the reward key order', () => {
    expect(Object.keys(rewardNamed(fullDocument(), 'guard_report'))).toEqual([
      'id',
      'kind',
      'ref',
      'amount',
      'outcome',
      'payload',
      'ext',
    ])
  })

  it('keeps the outcome, dialogue and objective key order', () => {
    expect(Object.keys(stepNamed(fullDocument(), 'caught').outcome as Json)).toEqual([
      'name',
      'failed',
      'title',
    ])
    expect(Object.keys(stepNamed(fullDocument(), 'talk_ines').dialogue as Json)).toEqual([
      'provider',
      'ref',
    ])
    expect(Object.keys(stepNamed(fullDocument(), 'talk_ines').objective as Json)).toEqual([
      'kind',
      'actor',
      'dialogue',
    ])
    expect(Object.keys(stepNamed(fullDocument(), 'dawn_rite').objective as Json)).toEqual([
      'kind',
      'custom',
      'args',
    ])
    expect(stepNamed(fullDocument(), 'steal').failObjective).toEqual({
      kind: 'event',
      event: 'guard.caught',
    })
  })

  it('omits empty lists that default to empty', () => {
    const step = stepNamed(fullDocument(), 'watch_tide')
    expect(step).not.toHaveProperty('rewards')
    expect(step).not.toHaveProperty('actors')
    expect(firstQuest(minimalDocument())).not.toHaveProperty('tags')
    expect(firstQuest(minimalDocument())).not.toHaveProperty('rewards')
  })

  it('always writes the four dictionary sections', () => {
    expect(value(minimalDocument()).dictionaries).toEqual({
      actors: [],
      locations: [],
      items: [],
      tags: [],
    })
  })

  it('omits booleans that are false', () => {
    const doc = withStep({ start: false, optional: false, repeat: false })
    const step = (firstQuest(doc).steps as Json[])[0]
    expect(step).not.toHaveProperty('start')
    expect(step).not.toHaveProperty('optional')
    expect(step).not.toHaveProperty('repeat')
  })

  it('writes booleans that are true', () => {
    const step = (firstQuest(withStep({ optional: true })).steps as Json[])[0]
    expect(step.optional).toBe(true)
  })

  it('omits an empty extension bag', () => {
    expect(firstQuest(withQuest({ ext: {} }))).not.toHaveProperty('ext')
  })

  it('omits undefined optional fields', () => {
    const step = (firstQuest(minimalDocument()).steps as Json[])[0]
    expect(Object.keys(step)).toEqual(['id', 'title'])
  })

  it('writes references without a name as an object with one key', () => {
    const doc = minimalDocument()
    doc.dictionaries.actors = [{ id: 'otter' }, { id: 'ines', name: 'Harbormaster Ines' }]
    expect((value(doc).dictionaries as Json).actors).toEqual([
      { id: 'otter' },
      { id: 'ines', name: 'Harbormaster Ines' },
    ])
  })

  it('writes conditions as trees, never as strings', () => {
    const unlock = firstQuest(fullDocument()).unlock as Json
    expect(Object.keys(unlock)).toEqual(['and'])
    expect((unlock.and as unknown[])[0]).toEqual({ var: 'flag.pier_open' })
    expect((unlock.and as Json[])[1].or).toHaveLength(2)
  })

  it('copies conditions instead of aliasing the model', () => {
    const doc = fullDocument()
    const written = firstQuest(doc).unlock as { and: unknown[] }
    written.and.pop()
    const original = doc.quests[0].unlock as { and: unknown[] }
    expect(original.and).toHaveLength(3)
  })

  it('copies payloads and extension bags', () => {
    const doc = fullDocument()
    const payload = rewardNamed(doc, 'guard_report').payload as Json
    payload.severity = 'major'
    expect(doc.quests[0].rewards[7].payload).toEqual({ severity: 'minor' })
  })
})

describe('toJson', () => {
  it('pretty prints with two spaces and a trailing newline', () => {
    const text = toJson(minimalDocument())
    expect(text.endsWith('\n')).toBe(true)
    expect(text.split('\n')[1]).toBe('  "oqf": 1,')
    expect(text).toContain('\n  "quests": [')
  })

  it('writes one line when pretty is false', () => {
    const text = toJson(minimalDocument(), { pretty: false })
    expect(text).not.toContain('\n')
    expect(text.startsWith('{"oqf":1,')).toBe(true)
  })

  it('is stable for the same document', () => {
    expect(toJson(fullDocument())).toBe(toJson(fullDocument()))
  })

  it('is stable across a parse and write cycle', () => {
    const once = toJson(fullDocument())
    expect(toJson(fromJsonValue(JSON.parse(once)))).toBe(once)
  })
})
