import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { type Io, UsageError, detectFormat, expandPaths, loadDocument } from './load.js'

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
    expect(detectFormat('quests/a.json')).toBe('json')
    expect(detectFormat('quests/A.OQF')).toBe('oqf')
  })

  it('returns undefined for anything else', () => {
    expect(detectFormat('quests/a.md')).toBeUndefined()
    expect(detectFormat('quests/a')).toBeUndefined()
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

  it('skips files the CLI cannot read', () => {
    const files = expandPaths([QUESTS], io)
    expect(files.some((file) => file.endsWith('.oqf'))).toBe(true)
    expect(files.some((file) => file.endsWith('.json'))).toBe(true)
    expect(files.some((file) => file.endsWith('broken'))).toBe(false)
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
    expect(loaded.format).toBe('oqf')
    expect(loaded.document.quests[0].id).toBe('minimal')
  })

  it('parses the JSON form', () => {
    const loaded = loadDocument(`${QUESTS}minimal.json`, io)
    expect(loaded.format).toBe('json')
    expect(loaded.document.quests[0].id).toBe('minimal')
  })
})
