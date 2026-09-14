import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  MIME_TYPES,
  detectFormat,
  downloadName,
  openFile,
  serializeDialogues,
  serializeQuests,
} from './files'

/** Narrows an optional the fixtures guarantee, without a non-null assertion. */
function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value')
  return value
}

function fixture(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../../examples/quests/${name}`, import.meta.url)),
    'utf8',
  )
}

const quest = fixture('harbormasters-ledger.oqf')
const questJson = fixture('harbormasters-ledger.json')
const dialogue = fixture('harbormasters-ledger.oqd')

describe('detectFormat', () => {
  it('reads the magic line before anything else', () => {
    expect(detectFormat('anything.txt', quest)).toBe('oqf')
    expect(detectFormat('anything.txt', dialogue)).toBe('oqd')
  })

  it('skips comments and blank lines to find the magic', () => {
    expect(detectFormat('x', `# a note\n\n${quest}`)).toBe('oqf')
  })

  it('tells the two JSON envelopes apart', () => {
    expect(detectFormat('quests.json', questJson)).toBe('oqf-json')
    expect(detectFormat('d.json', '{"oqd":1,"speakers":[],"conversations":[]}')).toBe('oqd-json')
  })

  it('falls back to the extension when there is no magic', () => {
    expect(detectFormat('quests.oqf', 'S\tsomething')).toBe('oqf')
    expect(detectFormat('lines.oqd', 'N\tgreet')).toBe('oqd')
  })

  it('gives up on anything else', () => {
    expect(detectFormat('notes.txt', 'hello')).toBeUndefined()
    expect(detectFormat('broken.json', '{ not json')).toBeUndefined()
    expect(detectFormat('other.json', '{"hello":1}')).toBeUndefined()
  })
})

describe('openFile', () => {
  it('opens the compact quest fixture', () => {
    const opened = openFile('harbormasters-ledger.oqf', quest)
    expect(opened.kind).toBe('oqf')
    expect(opened.quests?.quests[0].id).toBe('harbormasters_ledger')
    expect(opened.dialogues).toBeUndefined()
  })

  it('opens the JSON quest fixture', () => {
    const opened = openFile('harbormasters-ledger.json', questJson)
    expect(opened.kind).toBe('oqf-json')
    expect(opened.quests?.quests[0].steps.length).toBeGreaterThan(0)
  })

  it('opens the dialogue fixture', () => {
    const opened = openFile('harbormasters-ledger.oqd', dialogue)
    expect(opened.kind).toBe('oqd')
    expect(opened.dialogues?.conversations.length).toBeGreaterThan(0)
  })

  it('refuses a file it cannot identify', () => {
    expect(() => openFile('notes.txt', 'hello')).toThrow(/not an OQF file/)
  })
})

describe('serializing', () => {
  it('round-trips the compact quest byte for byte', () => {
    const opened = openFile('harbormasters-ledger.oqf', quest)
    expect(serializeQuests(must(opened.quests), 'oqf')).toBe(quest)
  })

  it('round-trips the dialogue byte for byte', () => {
    const opened = openFile('harbormasters-ledger.oqd', dialogue)
    expect(serializeDialogues(must(opened.dialogues), 'oqd')).toBe(dialogue)
  })

  it('writes JSON and markdown too', () => {
    const opened = openFile('harbormasters-ledger.oqf', quest)
    expect(serializeQuests(must(opened.quests), 'json')).toContain('"quests"')
    expect(serializeQuests(must(opened.quests), 'md')).toContain('#')
    expect(serializeDialogues(must(openFile('d.oqd', dialogue).dialogues), 'json')).toContain(
      '"conversations"',
    )
  })
})

describe('download names', () => {
  it('joins a clean base and the format', () => {
    expect(downloadName('harbormasters_ledger', 'oqf')).toBe('harbormasters_ledger.oqf')
    expect(downloadName('a quest/name', 'json')).toBe('a-quest-name.json')
    expect(downloadName('  ', 'md')).toBe('quests.md')
  })

  it('has a mime type for every format', () => {
    expect(Object.keys(MIME_TYPES).sort()).toEqual(['json', 'md', 'oqd', 'oqf'])
  })
})
