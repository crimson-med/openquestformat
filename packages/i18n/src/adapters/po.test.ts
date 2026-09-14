import { describe, expect, it } from 'vitest'
import { I18nError } from '../errors.js'
import { awkwardTable } from '../fixtures.js'
import { fromPo, toPo } from './po.js'

describe('toPo', () => {
  it('writes the key as the context and the source as the id', () => {
    expect(toPo({ 'ledger.title': 'The ledger' }, { header: false })).toBe(
      'msgctxt "ledger.title"\nmsgid "The ledger"\nmsgstr ""\n',
    )
  })

  it('writes a header entry by default', () => {
    const text = toPo({ a: 'b' })
    expect(text.startsWith('msgid ""\nmsgstr ""\n')).toBe(true)
    expect(text).toContain('"Content-Type: text/plain; charset=UTF-8\\n"')
  })

  it('names the language in the header when asked', () => {
    expect(toPo({ a: 'b' }, { language: 'fr' })).toContain('"Language: fr\\n"')
  })

  it('escapes quotes, backslashes and line breaks', () => {
    const text = toPo({ a: 'say "hi"\\\nnow' }, { header: false })
    expect(text).toContain('msgid "say \\"hi\\"\\\\\\nnow"')
    expect(text.split('\n')).toHaveLength(4)
  })
})

describe('fromPo', () => {
  it('round-trips awkward values through empty translations', () => {
    const table = awkwardTable()
    expect(fromPo(toPo(table))).toEqual(table)
  })

  it('round-trips without a header', () => {
    const table = awkwardTable()
    expect(fromPo(toPo(table, { header: false }))).toEqual(table)
  })

  it('prefers a filled in translation', () => {
    const text = [
      'msgctxt "ledger.title"',
      'msgid "The ledger"',
      'msgstr "Le registre"',
      '',
      'msgctxt "ledger.summary"',
      'msgid "A summary"',
      'msgstr ""',
      '',
    ].join('\n')
    expect(fromPo(text)).toEqual({ 'ledger.title': 'Le registre', 'ledger.summary': 'A summary' })
  })

  it('ignores comments and the header entry', () => {
    const text = [
      '# a translator note',
      'msgid ""',
      'msgstr ""',
      '"Content-Type: text/plain; charset=UTF-8\\n"',
      '',
      '#: quests/ledger.oqf',
      'msgctxt "ledger.title"',
      'msgid "The ledger"',
      'msgstr ""',
    ].join('\n')
    expect(fromPo(text)).toEqual({ 'ledger.title': 'The ledger' })
  })

  it('joins continuation lines', () => {
    const text = ['msgctxt "a"', 'msgid ""', '"one "', '"two"', 'msgstr ""'].join('\n')
    expect(fromPo(text)).toEqual({ a: 'one two' })
  })

  it('falls back to the id as the key when there is no context', () => {
    expect(fromPo('msgid "The ledger"\nmsgstr "Le registre"')).toEqual({
      'The ledger': 'Le registre',
    })
  })

  it('rejects a line it cannot read', () => {
    expect(() => fromPo('msgctxt nope\nmsgid "a"\nmsgstr ""')).toThrow(I18nError)
    expect(() => fromPo('"orphan continuation"')).toThrow(I18nError)
  })

  it('reads an empty document', () => {
    expect(fromPo('')).toEqual({})
  })
})
