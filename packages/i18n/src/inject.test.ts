import { readFileSync } from 'node:fs'
import { type OqfDocument, parseJson } from '@oqf/core'
import { describe, expect, it } from 'vitest'
import { I18nError } from './errors.js'
import { extractAll, extractDialogue, extractDocument } from './extract.js'
import { conversationDocument } from './fixtures.js'
import { injectAll, injectDialogue, injectDocument } from './inject.js'

function referenceDocument(): OqfDocument {
  const path = new URL('../../examples/quests/harbormasters-ledger.json', import.meta.url)
  return parseJson(readFileSync(path, 'utf8'))
}

describe('injectDocument', () => {
  it('restores the original document after extraction', () => {
    const original = referenceDocument()
    const { document, table } = extractDocument(original)
    expect(injectDocument(document, table)).toEqual(original)
  })

  it('keeps literals as they are', () => {
    const original = referenceDocument()
    expect(injectDocument(original, {})).toEqual(original)
  })

  it('returns the input untouched when there is nothing to inject', () => {
    const original = referenceDocument()
    expect(injectDocument(original, {})).toBe(original)
  })

  it('keeps an unknown key by default', () => {
    const { document } = extractDocument(referenceDocument())
    const injected = injectDocument(document, {})
    expect(injected.quests[0]?.title).toBe('@harbormasters_ledger.title')
  })

  it('throws on an unknown key with missing: throw', () => {
    const { document } = extractDocument(referenceDocument())
    expect(() => injectDocument(document, {}, { missing: 'throw' })).toThrow(I18nError)
    expect(() => injectDocument(document, {}, { missing: 'throw' })).toThrow(
      /harbormasters_ledger\.title/,
    )
  })

  it('blanks an unknown key with missing: empty', () => {
    const { document } = extractDocument(referenceDocument())
    const injected = injectDocument(document, {}, { missing: 'empty' })
    expect(injected.quests[0]?.title).toBe('')
    expect(injected.quests[0]?.steps[0]?.journal).toBe('')
  })

  it('does not mutate the document it is given', () => {
    const { document, table } = extractDocument(referenceDocument())
    injectDocument(document, table)
    expect(document.quests[0]?.title).toBe('@harbormasters_ledger.title')
  })

  it('takes a translated table', () => {
    const { document, table } = extractDocument(referenceDocument())
    const french = { ...table, 'harbormasters_ledger.title': 'Le registre du capitaine' }
    expect(injectDocument(document, french).quests[0]?.title).toBe('Le registre du capitaine')
  })
})

describe('injectDialogue', () => {
  it('restores the original conversation after extraction', () => {
    const original = conversationDocument()
    const { document, table } = extractDialogue(original)
    expect(injectDialogue(document, table)).toEqual(original)
  })

  it('blanks unknown keys with missing: empty', () => {
    const { document } = extractDialogue(conversationDocument())
    const injected = injectDialogue(document, {}, { missing: 'empty' })
    expect(injected.conversations[0]?.title).toBe('')
    expect(injected.conversations[0]?.nodes[0]?.choices?.[1]?.text).toBe('')
  })
})

describe('injectAll', () => {
  it('round-trips quests and dialogues through one table', () => {
    const quest = referenceDocument()
    const dialogue = conversationDocument()
    const extracted = extractAll({ quests: [quest], dialogues: [dialogue] })
    const injected = injectAll(
      { quests: extracted.quests, dialogues: extracted.dialogues },
      extracted.table,
    )
    expect(injected.quests[0]).toEqual(quest)
    expect(injected.dialogues[0]).toEqual(dialogue)
  })

  it('accepts an empty input', () => {
    expect(injectAll({}, {})).toEqual({ quests: [], dialogues: [] })
  })
})
