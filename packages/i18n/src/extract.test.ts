import { readFileSync } from 'node:fs'
import { type OqfDocument, emptyDictionaries, parseJson } from '@oqf/core'
import { describe, expect, it } from 'vitest'
import { I18nError } from './errors.js'
import { extractAll, extractDialogue, extractDocument } from './extract.js'
import { conversationDocument } from './fixtures.js'
import { injectDocument } from './inject.js'
import { isKey } from './keys.js'

function referenceDocument(): OqfDocument {
  const path = new URL('../../examples/quests/harbormasters-ledger.json', import.meta.url)
  return parseJson(readFileSync(path, 'utf8'))
}

/** Every player-facing value in a quest document, in document order. */
function texts(doc: OqfDocument): string[] {
  const out: string[] = []
  for (const quest of doc.quests) {
    out.push(quest.title)
    if (quest.summary !== undefined) out.push(quest.summary)
    for (const step of quest.steps) {
      out.push(step.title)
      if (step.journal !== undefined) out.push(step.journal)
      if (step.outcome?.title !== undefined) out.push(step.outcome.title)
    }
  }
  return out
}

const EXPECTED_KEYS = [
  'harbormasters_ledger.title',
  'harbormasters_ledger.summary',
  'harbormasters_ledger.talk_ines.title',
  'harbormasters_ledger.talk_ines.journal',
  'harbormasters_ledger.ask_gulls.title',
  'harbormasters_ledger.find_otter.title',
  'harbormasters_ledger.trade.title',
  'harbormasters_ledger.steal.title',
  'harbormasters_ledger.have_ledger.title',
  'harbormasters_ledger.return_ledger.title',
  'harbormasters_ledger.return_ledger.outcome.title',
  'harbormasters_ledger.sell_ledger.title',
  'harbormasters_ledger.sell_ledger.outcome.title',
  'harbormasters_ledger.caught.title',
  'harbormasters_ledger.caught.outcome.title',
]

describe('extractDocument', () => {
  it('produces the expected keys in document order', () => {
    const { table } = extractDocument(referenceDocument())
    expect(Object.keys(table)).toEqual(EXPECTED_KEYS)
  })

  it('keeps the source strings under their keys', () => {
    const { table } = extractDocument(referenceDocument())
    expect(table['harbormasters_ledger.title']).toBe("The Harbormaster's Ledger")
    expect(table['harbormasters_ledger.caught.outcome.title']).toBe('Ledger confiscated')
    expect(table['harbormasters_ledger.talk_ines.journal']).toContain('Ines has lost the harbor')
  })

  it('leaves every text field holding a key', () => {
    const { document } = extractDocument(referenceDocument())
    expect(texts(document).every(isKey)).toBe(true)
    expect(texts(document)).toHaveLength(EXPECTED_KEYS.length)
  })

  it('does not mutate the input', () => {
    const original = referenceDocument()
    const before = texts(original)
    extractDocument(original)
    expect(texts(original)).toEqual(before)
    expect(before.some(isKey)).toBe(false)
  })

  it('leaves the dictionaries alone', () => {
    const original = referenceDocument()
    const { document } = extractDocument(original)
    expect(document.dictionaries).toBe(original.dictionaries)
  })

  it('is idempotent and shares structure on a second pass', () => {
    const { document } = extractDocument(referenceDocument())
    const second = extractDocument(document)
    expect(second.document).toBe(document)
    expect(second.table).toEqual({})
  })

  it('does not add an already keyed field to the table', () => {
    const doc = referenceDocument()
    const quest = doc.quests[0] as OqfDocument['quests'][number]
    quest.title = '@custom.title'
    const { document, table } = extractDocument(doc)
    expect(table['harbormasters_ledger.title']).toBeUndefined()
    expect(table['custom.title']).toBeUndefined()
    expect(document.quests[0]?.title).toBe('@custom.title')
  })

  it('throws on a key collision', () => {
    const doc = referenceDocument()
    const quest = doc.quests[0] as OqfDocument['quests'][number]
    quest.steps = [
      { ...(quest.steps[0] as (typeof quest.steps)[number]) },
      { ...(quest.steps[0] as (typeof quest.steps)[number]), title: 'A different line' },
    ]
    expect(() => extractDocument(doc)).toThrow(I18nError)
    expect(() => extractDocument(doc)).toThrow(/harbormasters_ledger\.talk_ines\.title/)
  })
})

describe('extractDialogue', () => {
  it('keys conversations, nodes and choices by index', () => {
    const { table } = extractDialogue(conversationDocument())
    expect(Object.keys(table)).toEqual([
      'ines_intro.title',
      'ines_intro.greet.text',
      'ines_intro.greet.0.text',
      'ines_intro.greet.1.text',
      'ines_intro.thanks.text',
    ])
    expect(table['ines_intro.greet.1.text']).toBe('Not my problem.')
  })

  it('rewrites every text field to a key', () => {
    const { document } = extractDialogue(conversationDocument())
    const conversation = document.conversations[0]
    expect(conversation?.title).toBe('@ines_intro.title')
    expect(conversation?.nodes[0]?.text).toBe('@ines_intro.greet.text')
    expect(conversation?.nodes[0]?.choices?.[0]?.text).toBe('@ines_intro.greet.0.text')
    expect(conversation?.nodes[1]?.text).toBe('@ines_intro.thanks.text')
  })

  it('keeps the speakers dictionary and unrelated fields', () => {
    const original = conversationDocument()
    const { document } = extractDialogue(original)
    expect(document.speakers).toBe(original.speakers)
    expect(document.conversations[0]?.start).toBe('greet')
    expect(document.conversations[0]?.nodes[0]?.choices?.[0]?.next).toBe('thanks')
  })
})

describe('extractAll', () => {
  it('collects quests and dialogues into one table', () => {
    const { quests, dialogues, table } = extractAll({
      quests: [referenceDocument()],
      dialogues: [conversationDocument()],
    })
    expect(quests).toHaveLength(1)
    expect(dialogues).toHaveLength(1)
    expect(Object.keys(table)).toEqual([
      ...EXPECTED_KEYS,
      'ines_intro.title',
      'ines_intro.greet.text',
      'ines_intro.greet.0.text',
      'ines_intro.greet.1.text',
      'ines_intro.thanks.text',
    ])
  })

  it('accepts an empty input', () => {
    expect(extractAll({})).toEqual({ quests: [], dialogues: [], table: {} })
  })

  it('accepts the same document twice because the literals match', () => {
    const { table } = extractAll({ quests: [referenceDocument(), referenceDocument()] })
    expect(Object.keys(table)).toEqual(EXPECTED_KEYS)
  })

  it('throws when two documents disagree on one key', () => {
    const second = referenceDocument()
    const quest = second.quests[0] as OqfDocument['quests'][number]
    quest.title = 'A second title'
    expect(() => extractAll({ quests: [referenceDocument(), second] })).toThrow(
      /harbormasters_ledger\.title/,
    )
  })
})

describe('placeholders', () => {
  it('carries {name} placeholders through extraction and injection untouched', () => {
    const doc: OqfDocument = {
      dictionaries: emptyDictionaries(),
      quests: [
        {
          id: 'gus_daily',
          version: 1,
          title: 'Catch {n} {fish}',
          summary: 'Gus wants {n} of the {fish}.',
          tags: [],
          params: [
            { name: 'fish', type: 'item' },
            { name: 'n', type: 'number' },
          ],
          steps: [{ id: 'catch', title: '{count} of {target} {fish}', rewards: [], actors: [] }],
          rewards: [],
        },
      ],
    }
    const extracted = extractDocument(doc)
    expect(extracted.table).toEqual({
      'gus_daily.title': 'Catch {n} {fish}',
      'gus_daily.summary': 'Gus wants {n} of the {fish}.',
      'gus_daily.catch.title': '{count} of {target} {fish}',
    })
    expect(extracted.document.quests[0].params).toBe(doc.quests[0].params)
    expect(injectDocument(extracted.document, extracted.table)).toEqual(doc)
  })
})
