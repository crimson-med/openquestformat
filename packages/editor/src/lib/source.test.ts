import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { emptyDocument } from '@oqf/core'
import { parseCompact } from '@oqf/core'
import { emptyDialogueDocument, parseOqd } from '@oqf/dialogue'
import { describe, expect, it } from 'vitest'
import { dialogueSource, lineCount, questSource } from './source'

function fixture(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../../examples/quests/${name}`, import.meta.url)),
    'utf8',
  )
}

const questText = fixture('harbormasters-ledger.oqf')
const dialogueText = fixture('harbormasters-ledger.oqd')

describe('questSource', () => {
  it('shows the compact text the editor would write', () => {
    const view = questSource(parseCompact(questText), 'oqf')
    expect(view.error).toBeUndefined()
    expect(view.text).toBe(questText)
  })

  it('shows JSON and markdown', () => {
    const document = parseCompact(questText)
    expect(questSource(document, 'json').text.startsWith('{')).toBe(true)
    expect(questSource(document, 'md').text).toContain('The Harbormaster')
  })

  it('writes an empty document as the magic line alone', () => {
    expect(questSource(emptyDocument(), 'oqf').text.trim()).toBe('OQF1')
  })

  it('reports a document the serializer refuses instead of throwing', () => {
    const document = emptyDocument()
    document.quests.push({
      id: 'broken',
      version: 1,
      title: 'Broken',
      tags: [],
      steps: [],
      rewards: [],
      ext: { 'not-an-ext-key': 1 },
    })
    const view = questSource(document, 'oqf')
    expect(view.text).toBe('')
    expect(view.error).toContain('not-an-ext-key')
  })
})

describe('dialogueSource', () => {
  it('shows the compact dialogue text', () => {
    const view = dialogueSource(parseOqd(dialogueText), 'oqd')
    expect(view.error).toBeUndefined()
    expect(view.text).toBe(dialogueText)
  })

  it('shows the JSON form', () => {
    expect(dialogueSource(parseOqd(dialogueText), 'json').text).toContain('"conversations"')
  })

  it('writes an empty dialogue document as the magic line alone', () => {
    expect(dialogueSource(emptyDialogueDocument(), 'oqd').text.trim()).toBe('OQD1')
  })
})

describe('lineCount', () => {
  it('does not count the trailing newline as a line', () => {
    expect(lineCount('')).toBe(0)
    expect(lineCount('a\n')).toBe(1)
    expect(lineCount('a\nb')).toBe(2)
    expect(lineCount('a\nb\n')).toBe(2)
  })
})
