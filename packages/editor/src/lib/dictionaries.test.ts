import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { type OqfDocument, parseCompact, toCompact } from '@oqf/core'
import { type DialogueDocument, parseOqd, toOqd } from '@oqf/dialogue'
import { describe, expect, it } from 'vitest'
import { sampleDialogues, sampleQuests } from '../store/fixtures'
import {
  type Documents,
  addEntry,
  entriesOf,
  entryIdError,
  removeEntry,
  renameEntry,
  renameUsages,
  unusedEntries,
  usagesOf,
} from './dictionaries'

function fixture(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../../examples/quests/${name}`, import.meta.url)),
    'utf8',
  )
}

const questText = fixture('harbormasters-ledger.oqf')
const dialogueText = fixture('harbormasters-ledger.oqd')

function reference(): Documents {
  return { quests: parseCompact(questText), dialogues: parseOqd(dialogueText) }
}

function sample(): Documents {
  return { quests: sampleQuests(), dialogues: sampleDialogues() }
}

describe('entriesOf', () => {
  it('reads the quest dictionaries and the dialogue speakers', () => {
    const docs = reference()
    expect(entriesOf(docs, 'actors').map((ref) => ref.id)).toEqual([
      'harbormaster',
      'gull_feeder',
      'otter',
      'smuggler',
    ])
    expect(entriesOf(docs, 'tags')).toEqual([{ id: 'main' }, { id: 'harbor' }])
    expect(entriesOf(docs, 'speakers')).toBe(docs.dialogues.speakers)
  })
})

describe('entryIdError', () => {
  const refs = [{ id: 'otter' }, { id: 'gull' }]

  it('rejects empty, spaced and taken ids', () => {
    expect(entryIdError(refs, '')).toBe('An id is required.')
    expect(entryIdError(refs, 'old salt')).toBe('An id cannot contain whitespace.')
    expect(entryIdError(refs, 'otter')).toBe('otter already exists.')
    expect(entryIdError(refs, 'ines')).toBeUndefined()
  })

  it('lets an entry keep its own id', () => {
    expect(entryIdError(refs, 'otter', 'otter')).toBeUndefined()
    expect(entryIdError(refs, 'gull', 'otter')).toBe('gull already exists.')
  })
})

describe('addEntry, renameEntry, removeEntry', () => {
  const refs = [{ id: 'otter', name: 'Old Salt Otter' }, { id: 'gull' }]

  it('appends an entry with or without a name', () => {
    expect(addEntry(refs, 'ines', 'Harbormaster Ines')).toEqual([
      ...refs,
      { id: 'ines', name: 'Harbormaster Ines' },
    ])
    expect(addEntry(refs, 'ines')).toEqual([...refs, { id: 'ines' }])
    expect(addEntry(refs, 'ines', '')).toEqual([...refs, { id: 'ines' }])
  })

  it('returns the same array for an empty, spaced or duplicate id', () => {
    expect(addEntry(refs, '')).toBe(refs)
    expect(addEntry(refs, 'a b')).toBe(refs)
    expect(addEntry(refs, 'otter')).toBe(refs)
  })

  it('renames an entry and keeps its name unless told otherwise', () => {
    expect(renameEntry(refs, 'otter', 'salt')).toEqual([
      { id: 'salt', name: 'Old Salt Otter' },
      { id: 'gull' },
    ])
    expect(renameEntry(refs, 'otter', 'otter', 'The Otter')[0]).toEqual({
      id: 'otter',
      name: 'The Otter',
    })
    expect(renameEntry(refs, 'otter', 'otter', '')[0]).toEqual({ id: 'otter' })
  })

  it('refuses a rename that would collide or empty the id', () => {
    expect(renameEntry(refs, 'otter', 'gull')).toBe(refs)
    expect(renameEntry(refs, 'otter', '')).toBe(refs)
    expect(renameEntry(refs, 'otter', 'a b')).toBe(refs)
    expect(renameEntry(refs, 'ghost', 'x')).toBe(refs)
  })

  it('removes by id', () => {
    expect(removeEntry(refs, 'gull')).toEqual([refs[0]])
    expect(removeEntry(refs, 'ghost')).toEqual(refs)
  })
})

describe('usagesOf on the reference quest', () => {
  const docs = reference()
  const quest = 'harbormasters_ledger'

  it('finds actors in step actors and talk objectives', () => {
    expect(usagesOf(docs, 'actors', 'harbormaster')).toEqual([
      { quest, step: 'talk_ines', field: 'actors' },
      { quest, step: 'talk_ines', field: 'objective' },
      { quest, step: 'return_ledger', field: 'actors' },
      { quest, step: 'return_ledger', field: 'objective' },
    ])
    expect(usagesOf(docs, 'actors', 'otter')).toEqual([{ quest, step: 'trade', field: 'actors' }])
  })

  it('finds locations in step locations and reach objectives', () => {
    expect(usagesOf(docs, 'locations', 'otter_den')).toEqual([
      { quest, step: 'find_otter', field: 'location' },
      { quest, step: 'find_otter', field: 'objective' },
      { quest, step: 'trade', field: 'location' },
      { quest, step: 'steal', field: 'location' },
      { quest, step: 'caught', field: 'location' },
    ])
  })

  it('finds items in collect objectives and item rewards', () => {
    expect(usagesOf(docs, 'items', 'fish.rare')).toEqual([
      { quest, step: 'trade', field: 'objective' },
    ])
    expect(usagesOf(docs, 'items', 'lure.golden')).toEqual([
      { quest, reward: 'lure_returned', field: 'ref' },
    ])
    expect(usagesOf(docs, 'items', 'ledger')).toEqual([])
  })

  it('finds tags on quests', () => {
    expect(usagesOf(docs, 'tags', 'harbor')).toEqual([{ quest, field: 'tags' }])
    expect(usagesOf(docs, 'tags', 'nope')).toEqual([])
  })

  it('finds speakers on conversations and nodes', () => {
    expect(usagesOf(docs, 'speakers', 'harbormaster')).toEqual([
      { conversation: 'ines_intro', field: 'actor' },
      { conversation: 'ines_return', field: 'actor' },
    ])
    const spoken = sample()
    spoken.dialogues.conversations[0].nodes[1].speaker = 'harbormaster'
    expect(usagesOf(spoken, 'speakers', 'harbormaster')).toEqual([
      { conversation: 'ines_intro', field: 'actor' },
      { conversation: 'ines_intro', node: 'thanks', field: 'speaker' },
    ])
  })

  it('finds a kill objective and a fail objective', () => {
    const docs = sample()
    docs.quests.quests[0].steps[1].objective = { kind: 'kill', actor: 'harbormaster' }
    docs.quests.quests[0].steps[1].failObjective = { kind: 'reach', location: 'harbor' }
    expect(usagesOf(docs, 'actors', 'harbormaster')).toEqual([
      { quest: 'ledger', step: 'talk_ines', field: 'actors' },
      { quest: 'ledger', step: 'talk_ines', field: 'objective' },
      { quest: 'ledger', step: 'find_it', field: 'objective' },
    ])
    expect(usagesOf(docs, 'locations', 'harbor')).toEqual([
      { quest: 'ledger', step: 'find_it', field: 'failObjective' },
    ])
  })
})

describe('unusedEntries', () => {
  it('lists what nothing references', () => {
    const docs = reference()
    expect(unusedEntries(docs, 'items').map((ref) => ref.id)).toEqual(['ledger'])
    expect(unusedEntries(docs, 'actors')).toEqual([])
    expect(unusedEntries(docs, 'speakers')).toEqual([])
    docs.dialogues.speakers.push({ id: 'ghost' })
    expect(unusedEntries(docs, 'speakers')).toEqual([{ id: 'ghost' }])
  })
})

describe('renameUsages', () => {
  it('rewrites every usage and leaves the rest alone', () => {
    const before = reference()
    const after = renameUsages(before, 'actors', 'harbormaster', 'ines')
    expect(usagesOf(after, 'actors', 'harbormaster')).toEqual([])
    expect(usagesOf(after, 'actors', 'ines')).toHaveLength(4)
    expect(after.dialogues).toBe(before.dialogues)
    expect(after.quests.dictionaries).toBe(before.quests.dictionaries)
    const steps = after.quests.quests[0].steps
    const untouched = before.quests.quests[0].steps
    expect(steps[2]).toBe(untouched[2])
    expect(steps[0].actors).toEqual(['ines'])
    expect(steps[0].objective).toEqual({ kind: 'talk', actor: 'ines', dialogue: 'ines_intro' })
  })

  it('rewrites locations, items, tags and speakers', () => {
    const docs = reference()
    const moved = renameUsages(docs, 'locations', 'otter_den', 'den')
    expect(usagesOf(moved, 'locations', 'den')).toHaveLength(5)
    const swapped = renameUsages(docs, 'items', 'lure.golden', 'lure.silver')
    expect(
      swapped.quests.quests[0].rewards.find((reward) => reward.id === 'lure_returned')?.ref,
    ).toBe('lure.silver')
    const tagged = renameUsages(docs, 'tags', 'main', 'story')
    expect(tagged.quests.quests[0].tags).toEqual(['story', 'harbor'])
    const spoken = renameUsages(docs, 'speakers', 'harbormaster', 'ines')
    expect(spoken.quests).toBe(docs.quests)
    expect(spoken.dialogues.conversations[0].actor).toBe('ines')
    expect(spoken.dialogues.conversations[1]).toBe(docs.dialogues.conversations[1])
  })

  it('returns the same documents when nothing uses the id', () => {
    const docs = reference()
    expect(renameUsages(docs, 'items', 'ledger', 'book')).toBe(docs)
    expect(renameUsages(docs, 'actors', 'otter', 'otter')).toBe(docs)
  })

  it('keeps the renamed documents serializable', () => {
    const docs = reference()
    const renamed = renameUsages(docs, 'actors', 'harbormaster', 'ines')
    const quests: OqfDocument = {
      ...renamed.quests,
      dictionaries: {
        ...renamed.quests.dictionaries,
        actors: renameEntry(renamed.quests.dictionaries.actors, 'harbormaster', 'ines'),
      },
    }
    const dialogues: DialogueDocument = renamed.dialogues
    expect(toCompact(quests)).toContain('talk ines ines_intro')
    expect(toOqd(dialogues)).toBe(dialogueText)
  })
})
