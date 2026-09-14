import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseCompact } from '@oqf/core'
import { parseOqd } from '@oqf/dialogue'
import { I18nError, type StringTable } from '@oqf/i18n'
import { describe, expect, it } from 'vitest'
import {
  type PackDocuments,
  STRINGS_KEY,
  TABLE_FORMATS,
  extractStrings,
  injectStrings,
  isLanguageCode,
  listStrings,
  missingKeys,
  orphanKeys,
  packKeys,
  parseTable,
  previewResolver,
  restoreStrings,
  serializeStrings,
  serializeTable,
  tableDownloadName,
  tableFormatOf,
} from './strings'

function fixture(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../../examples/quests/${name}`, import.meta.url)),
    'utf8',
  )
}

function reference(): PackDocuments {
  return {
    quests: parseCompact(fixture('harbormasters-ledger.oqf')),
    dialogues: parseOqd(fixture('harbormasters-ledger.oqd')),
  }
}

/** Values that stress every adapter: separators, quotes, breaks, markup, non-ASCII. */
function awkwardTable(): StringTable {
  return {
    'ledger.title': "The Harbormaster's Ledger",
    'ledger.comma': 'Find it, then decide, quickly',
    'ledger.quote': 'She said "take it" and walked off',
    'ledger.newline': 'Line one\nLine two',
    'ledger.tab': 'name\tvalue',
    'ledger.markup': 'Fish & chips <b>with</b> vinegar',
    'ledger.backslash': 'C:\\harbor\\ledger',
    'ledger.unicode': 'Ötter über den Fjord, 港の記録, 🐟',
  }
}

describe('listStrings', () => {
  it('lists every player-facing text with a path and a key', () => {
    const docs = reference()
    const entries = listStrings(docs.quests, docs.dialogues)
    const quest = docs.quests.quests[0]
    if (quest === undefined) throw new Error('fixture has no quest')
    expect(entries[0]).toEqual({
      path: `Quest ${quest.id}: title`,
      key: `${quest.id}.title`,
      text: quest.title,
      isKey: false,
    })
    const paths = entries.map((item) => item.path)
    expect(paths.some((path) => path.startsWith('Step ') && path.endsWith(': title'))).toBe(true)
    expect(paths.some((path) => path.startsWith('Node ') && path.endsWith(': text'))).toBe(true)
    expect(paths.some((path) => path.startsWith('Choice '))).toBe(true)
    expect(entries.every((item) => !item.isKey)).toBe(true)
    expect(new Set(entries.map((item) => item.key)).size).toBe(entries.length)
  })

  it('marks key references and keeps their key', () => {
    const entries = listStrings(
      {
        dictionaries: { actors: [], locations: [], items: [], tags: [] },
        quests: [{ id: 'q', version: 1, title: '@q.title', tags: [], steps: [], rewards: [] }],
      },
      { speakers: [], conversations: [] },
    )
    expect(entries).toEqual([
      { path: 'Quest q: title', key: 'q.title', text: '@q.title', isKey: true },
    ])
  })

  it('reports a hand-written key rather than the generated one', () => {
    const entries = listStrings(
      {
        dictionaries: { actors: [], locations: [], items: [], tags: [] },
        quests: [{ id: 'q', version: 1, title: '@custom.name', tags: [], steps: [], rewards: [] }],
      },
      { speakers: [], conversations: [] },
    )
    expect(entries[0]?.key).toBe('custom.name')
    expect(missingKeys(entries, {})).toEqual(['custom.name'])
  })
})

describe('extract and inject', () => {
  it('round trips the reference quest and dialogue', () => {
    const docs = reference()
    const extracted = extractStrings(docs)
    const entries = listStrings(extracted.quests, extracted.dialogues)
    expect(entries.length).toBeGreaterThan(0)
    expect(entries.every((item) => item.isKey)).toBe(true)
    expect(Object.keys(extracted.table)).toHaveLength(entries.length)
    for (const item of entries) expect(extracted.table[item.key]).toBeDefined()

    const back = injectStrings(
      { quests: extracted.quests, dialogues: extracted.dialogues },
      extracted.table,
    )
    expect(back.quests).toEqual(docs.quests)
    expect(back.dialogues).toEqual(docs.dialogues)
  })

  it('leaves the input untouched', () => {
    const docs = reference()
    const before = JSON.stringify(docs)
    extractStrings(docs)
    expect(JSON.stringify(docs)).toBe(before)
  })

  it('keeps keys the table lacks', () => {
    const docs = reference()
    const extracted = extractStrings(docs)
    const back = injectStrings({ quests: extracted.quests, dialogues: extracted.dialogues }, {})
    expect(back.quests).toEqual(extracted.quests)
  })

  it('reports a key collision', () => {
    const docs = reference()
    const quest = docs.quests.quests[0]
    if (quest === undefined) throw new Error('fixture has no quest')
    docs.dialogues.conversations.push({
      id: quest.id,
      title: 'Not the quest title',
      start: 'a',
      nodes: [{ id: 'a', text: 'hi' }],
    })
    expect(() => extractStrings(docs)).toThrow(I18nError)
  })
})

describe('missing and orphan keys', () => {
  const extracted = extractStrings(reference())
  const entries = listStrings(extracted.quests, extracted.dialogues)

  it('finds nothing missing or orphaned for the extracted table', () => {
    expect(missingKeys(entries, extracted.table)).toEqual([])
    expect(orphanKeys(entries, extracted.table)).toEqual([])
  })

  it('reports pack keys with no entry', () => {
    const keys = packKeys(entries)
    const first = keys[0]
    if (first === undefined) throw new Error('no keys')
    const { [first]: _dropped, ...rest } = extracted.table
    expect(missingKeys(entries, rest)).toEqual([first])
    expect(missingKeys(entries, {})).toEqual(keys)
  })

  it('reports entries with no key in the pack', () => {
    expect(orphanKeys(entries, { ...extracted.table, 'old.key': 'gone' })).toEqual(['old.key'])
  })

  it('treats literals as neither missing nor keys', () => {
    const docs = reference()
    expect(missingKeys(listStrings(docs.quests, docs.dialogues), {})).toEqual([])
  })
})

describe('previewResolver', () => {
  const tables = { en: { 'q.title': 'Ledger' }, fr: { 'q.title': 'Le registre' } }

  it('shows texts as they are without a preview', () => {
    expect(previewResolver(tables, undefined)('@q.title')).toBe('@q.title')
  })

  it('resolves through the preview language, then the source, then the key', () => {
    expect(previewResolver(tables, 'fr')('@q.title')).toBe('Le registre')
    expect(previewResolver({ en: tables.en, fr: {} }, 'fr', 'en')('@q.title')).toBe('Ledger')
    expect(previewResolver({}, 'fr', 'en')('@q.title')).toBe('@q.title')
    expect(previewResolver(tables, 'fr')('A literal')).toBe('A literal')
  })
})

describe('table formats', () => {
  it.each(TABLE_FORMATS)('round trips awkward values through %s', (format) => {
    const table = awkwardTable()
    expect(parseTable(serializeTable(table, format, { language: 'fr' }), format)).toEqual(table)
  })

  it('round trips the extracted reference table through every format', () => {
    const { table } = extractStrings(reference())
    for (const format of TABLE_FORMATS) {
      expect(parseTable(serializeTable(table, format), format)).toEqual(table)
    }
  })

  it('reads the format from the extension', () => {
    expect(tableFormatOf('strings.fr.json')).toBe('json')
    expect(tableFormatOf('strings.CSV')).toBe('csv')
    expect(tableFormatOf('fr.po')).toBe('po')
    expect(tableFormatOf('fr.xliff')).toBe('xliff')
    expect(tableFormatOf('fr.xlf')).toBe('xliff')
    expect(tableFormatOf('fr.txt')).toBeUndefined()
    expect(tableFormatOf('fr')).toBeUndefined()
  })

  it('reports bad input', () => {
    expect(() => parseTable('{', 'json')).toThrow(I18nError)
  })

  it('names the download after the base, language and format', () => {
    expect(tableDownloadName('harbormasters ledger', 'fr', 'csv')).toBe(
      'harbormasters-ledger.fr.csv',
    )
    expect(tableDownloadName('  ', 'en', 'json')).toBe('strings.en.json')
  })
})

describe('isLanguageCode', () => {
  it('accepts plain and regional codes', () => {
    expect(isLanguageCode('fr')).toBe(true)
    expect(isLanguageCode('pt-BR')).toBe(true)
    expect(isLanguageCode('zh-Hant')).toBe(true)
  })

  it('rejects junk', () => {
    expect(isLanguageCode('')).toBe(false)
    expect(isLanguageCode('FR')).toBe(false)
    expect(isLanguageCode('french language')).toBe(false)
  })
})

describe('persisted strings', () => {
  it('has a versioned key', () => {
    expect(STRINGS_KEY).toBe('oqf-editor.strings.v1')
  })

  it('round trips tables and the preview', () => {
    const state = { tables: { en: { a: 'A' }, fr: { a: 'Un' } }, preview: 'fr' }
    expect(restoreStrings(serializeStrings(state))).toEqual(state)
  })

  it('drops a preview that names no table', () => {
    const restored = restoreStrings(serializeStrings({ tables: { en: {} }, preview: 'fr' }))
    expect(restored).toEqual({ tables: { en: {} }, preview: undefined })
  })

  it('skips tables that are not key to string', () => {
    const restored = restoreStrings(
      JSON.stringify({ version: 1, tables: { en: { a: 'A' }, bad: { a: 1 }, list: ['x'] } }),
    )
    expect(restored).toEqual({ tables: { en: { a: 'A' } }, preview: undefined })
  })

  it('treats anything unrecognizable as no save', () => {
    expect(restoreStrings(null)).toBeUndefined()
    expect(restoreStrings('')).toBeUndefined()
    expect(restoreStrings('{')).toBeUndefined()
    expect(restoreStrings('42')).toBeUndefined()
    expect(restoreStrings('{"tables":null}')).toBeUndefined()
  })
})
