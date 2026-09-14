import { describe, expect, it } from 'vitest'
import { I18nError } from '../errors.js'
import { awkwardTable } from '../fixtures.js'
import { fromXliff, toXliff } from './xliff.js'

describe('toXliff', () => {
  it('writes one trans-unit per key', () => {
    expect(toXliff({ 'ledger.title': 'The ledger' })).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">',
        '  <file original="oqf" datatype="plaintext" source-language="en">',
        '    <body>',
        '      <trans-unit id="ledger.title">',
        '        <source>The ledger</source>',
        '      </trans-unit>',
        '    </body>',
        '  </file>',
        '</xliff>',
        '',
      ].join('\n'),
    )
  })

  it('writes the languages it is given and empty targets', () => {
    const text = toXliff(
      { a: 'b' },
      { sourceLanguage: 'en-GB', targetLanguage: 'fr', original: 'ledger.oqf' },
    )
    expect(text).toContain('original="ledger.oqf"')
    expect(text).toContain('source-language="en-GB"')
    expect(text).toContain('target-language="fr"')
    expect(text).toContain('<target></target>')
  })

  it('escapes markup, quotes and line breaks', () => {
    const text = toXliff({ 'a"b': 'Fish & chips <b>hot</b>\nnow' })
    expect(text).toContain('id="a&quot;b"')
    expect(text).toContain('<source>Fish &amp; chips &lt;b&gt;hot&lt;/b&gt;&#10;now</source>')
  })
})

describe('fromXliff', () => {
  it('round-trips awkward values', () => {
    const table = awkwardTable()
    expect(fromXliff(toXliff(table))).toEqual(table)
  })

  it('round-trips when empty targets are written', () => {
    const table = awkwardTable()
    expect(fromXliff(toXliff(table, { targetLanguage: 'fr' }))).toEqual(table)
  })

  it('round-trips an empty table', () => {
    expect(fromXliff(toXliff({}))).toEqual({})
  })

  it('prefers a filled in target', () => {
    const text = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<xliff version="1.2">',
      '  <file source-language="en" target-language="fr">',
      '    <body>',
      '      <trans-unit id="ledger.title">',
      '        <source>The ledger</source>',
      '        <target>Le registre</target>',
      '      </trans-unit>',
      '      <trans-unit id="ledger.summary">',
      '        <source>A summary</source>',
      '        <target></target>',
      '      </trans-unit>',
      '      <trans-unit id="ledger.note">',
      '        <source>A note</source>',
      '        <target/>',
      '      </trans-unit>',
      '    </body>',
      '  </file>',
      '</xliff>',
    ].join('\n')
    expect(fromXliff(text)).toEqual({
      'ledger.title': 'Le registre',
      'ledger.summary': 'A summary',
      'ledger.note': 'A note',
    })
  })

  it('decodes named and numeric entities', () => {
    const text =
      '<xliff><file><body><trans-unit id="a"><source>&amp;&lt;&gt;&quot;&apos;&#65;&#x42;</source></trans-unit></body></file></xliff>'
    expect(fromXliff(text)).toEqual({ a: '&<>"\'AB' })
  })

  it('skips comments and declarations', () => {
    const text =
      '<?xml version="1.0"?><!-- a note --><!DOCTYPE xliff><xliff><file><body><trans-unit id="a"><source>b</source></trans-unit></body></file></xliff>'
    expect(fromXliff(text)).toEqual({ a: 'b' })
  })

  it('rejects a trans-unit without an id', () => {
    expect(() => fromXliff('<xliff><trans-unit><source>a</source></trans-unit></xliff>')).toThrow(
      I18nError,
    )
  })

  it('rejects broken markup', () => {
    expect(() => fromXliff('<trans-unit id=nope><source>a</source></trans-unit>')).toThrow(
      I18nError,
    )
    expect(() => fromXliff('<xliff><source>&amp</source>')).toThrow(I18nError)
  })
})
