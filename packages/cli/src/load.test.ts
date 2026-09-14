import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  type Io,
  UsageError,
  detectFormat,
  detectJsonKind,
  documentKey,
  expandPaths,
  loadAll,
  loadDocument,
  loadQuest,
  serializeLoaded,
} from './load.js'

const QUESTS = fileURLToPath(new URL('../../examples/quests/', import.meta.url))

const io: Io = {
  stdout: () => {},
  stderr: () => {},
  readFile: (path) => readFileSync(path, 'utf8'),
  writeFile: () => {},
  readDir: (path) => readdirSync(path),
  stat: (path) => ({ isDirectory: statSync(path).isDirectory() }),
}

describe('detectFormat', () => {
  it('reads the extension', () => {
    expect(detectFormat('quests/a.oqf')).toBe('oqf')
    expect(detectFormat('quests/a.oqd')).toBe('oqd')
    expect(detectFormat('quests/a.json')).toBe('json')
    expect(detectFormat('quests/A.OQF')).toBe('oqf')
    expect(detectFormat('quests/A.OQD')).toBe('oqd')
  })

  it('returns undefined for anything else', () => {
    expect(detectFormat('quests/a.md')).toBeUndefined()
    expect(detectFormat('quests/a')).toBeUndefined()
  })
})

describe('detectJsonKind', () => {
  it('sniffs the top level key', () => {
    expect(detectJsonKind('{"oqf":1,"quests":[]}')).toBe('quest')
    expect(detectJsonKind('{"oqd":1,"conversations":[]}')).toBe('dialogue')
  })

  it('leaves anything else to the quest parser', () => {
    expect(detectJsonKind('{"nope":1}')).toBe('quest')
    expect(detectJsonKind('[1, 2]')).toBe('quest')
    expect(detectJsonKind('not json at all')).toBe('quest')
  })
})

describe('expandPaths', () => {
  it('keeps a file path as it is', () => {
    const file = `${QUESTS}minimal.oqf`
    expect(expandPaths([file], io)).toEqual([file])
  })

  it('expands a directory to its quest files, sorted, without recursing', () => {
    const files = expandPaths([`${QUESTS}broken`], io)
    expect(files).toHaveLength(10)
    expect(files.every((file) => file.endsWith('.oqf'))).toBe(true)
    expect([...files].sort()).toEqual(files)
    expect(files[0].endsWith('bad-condition-syntax.oqf')).toBe(true)
  })

  it('picks up dialogue files alongside quest files', () => {
    const files = expandPaths([QUESTS], io)
    expect(files.some((file) => file.endsWith('.oqf'))).toBe(true)
    expect(files.some((file) => file.endsWith('.oqd'))).toBe(true)
    expect(files.some((file) => file.endsWith('.dialogue.json'))).toBe(true)
  })

  it('skips files the CLI cannot read', () => {
    const files = expandPaths([QUESTS], io)
    expect(files.some((file) => file.endsWith('.json'))).toBe(true)
    expect(files.some((file) => file.endsWith('broken'))).toBe(false)
    expect(files.some((file) => file.endsWith('.md'))).toBe(false)
  })

  it('takes several paths in command line order', () => {
    const files = expandPaths([`${QUESTS}minimal.json`, `${QUESTS}minimal.oqf`], io)
    expect(files).toEqual([`${QUESTS}minimal.json`, `${QUESTS}minimal.oqf`])
  })

  it('rejects a path that is not there', () => {
    expect(() => expandPaths([`${QUESTS}nope.oqf`], io)).toThrow(UsageError)
  })

  it('rejects a file with an extension it does not know', () => {
    expect(() => expandPaths([`${QUESTS}../README.md`], io)).toThrow(UsageError)
  })
})

describe('loadDocument', () => {
  it('parses the compact form', () => {
    const loaded = loadDocument(`${QUESTS}minimal.oqf`, io)
    expect(loaded.kind).toBe('quest')
    expect(loaded.format).toBe('oqf')
    if (loaded.kind !== 'quest') throw new Error('expected quests')
    expect(loaded.document.quests[0].id).toBe('minimal')
  })

  it('parses the JSON form', () => {
    const loaded = loadDocument(`${QUESTS}minimal.json`, io)
    expect(loaded.kind).toBe('quest')
    expect(loaded.format).toBe('json')
    if (loaded.kind !== 'quest') throw new Error('expected quests')
    expect(loaded.document.quests[0].id).toBe('minimal')
  })

  it('parses the compact dialogue form', () => {
    const loaded = loadDocument(`${QUESTS}harbormasters-ledger.oqd`, io)
    expect(loaded.kind).toBe('dialogue')
    expect(loaded.format).toBe('oqd')
    if (loaded.kind !== 'dialogue') throw new Error('expected dialogue')
    expect(loaded.document.conversations[0].id).toBe('ines_intro')
  })

  it('sniffs a JSON file that holds dialogue', () => {
    const loaded = loadDocument(`${QUESTS}harbormasters-ledger.dialogue.json`, io)
    expect(loaded.kind).toBe('dialogue')
    expect(loaded.format).toBe('json')
    if (loaded.kind !== 'dialogue') throw new Error('expected dialogue')
    expect(loaded.document.conversations[0].id).toBe('ines_intro')
  })

  it('rejects an extension it does not know', () => {
    expect(() => loadDocument(`${QUESTS}../README.md`, io)).toThrow(UsageError)
  })
})

describe('loadQuest', () => {
  it('returns a quest document', () => {
    expect(loadQuest(`${QUESTS}minimal.oqf`, io).document.quests[0].id).toBe('minimal')
  })

  it('rejects a dialogue file', () => {
    expect(() => loadQuest(`${QUESTS}harbormasters-ledger.oqd`, io)).toThrow(UsageError)
  })
})

describe('loadAll', () => {
  it('parses a whole directory into quests and dialogue', () => {
    const loaded = loadAll([QUESTS], io)
    expect(loaded.filter((file) => file.kind === 'quest').length).toBe(4)
    expect(loaded.filter((file) => file.kind === 'dialogue').length).toBe(2)
  })
})

describe('serializeLoaded', () => {
  it('writes every form back byte for byte', () => {
    for (const name of [
      'minimal.oqf',
      'minimal.json',
      'harbormasters-ledger.oqf',
      'harbormasters-ledger.json',
      'harbormasters-ledger.oqd',
      'harbormasters-ledger.dialogue.json',
    ]) {
      const loaded = loadDocument(`${QUESTS}${name}`, io)
      expect(serializeLoaded(loaded), name).toBe(readFileSync(`${QUESTS}${name}`, 'utf8'))
    }
  })
})

describe('documentKey', () => {
  it('is the same for a document read from either of its forms', () => {
    const compact = loadDocument(`${QUESTS}harbormasters-ledger.oqf`, io)
    const json = loadDocument(`${QUESTS}harbormasters-ledger.json`, io)
    expect(documentKey(compact.document)).toBe(documentKey(json.document))
  })

  it('tells two different documents apart', () => {
    const harbor = loadDocument(`${QUESTS}harbormasters-ledger.oqf`, io)
    const minimal = loadDocument(`${QUESTS}minimal.oqf`, io)
    expect(documentKey(harbor.document)).not.toBe(documentKey(minimal.document))
  })
})
