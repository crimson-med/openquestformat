import { describe, expect, it } from 'vitest'
import { I18nError } from '../errors.js'
import { awkwardTable } from '../fixtures.js'
import { fromCsv, toCsv } from './csv.js'

describe('toCsv', () => {
  it('writes a header and one row per key', () => {
    expect(toCsv({ 'ledger.title': 'The ledger' })).toBe('key,text\nledger.title,The ledger\n')
  })

  it('quotes separators, quotes and line breaks', () => {
    expect(toCsv({ a: 'one, two' })).toContain('a,"one, two"')
    expect(toCsv({ a: 'say "hi"' })).toContain('a,"say ""hi"""')
    expect(toCsv({ a: 'one\ntwo' })).toContain('a,"one\ntwo"')
  })

  it('writes CRLF when asked', () => {
    expect(toCsv({ a: 'b' }, { eol: '\r\n' })).toBe('key,text\r\na,b\r\n')
  })

  it('writes only the header for an empty table', () => {
    expect(toCsv({})).toBe('key,text\n')
  })
})

describe('fromCsv', () => {
  it('round-trips awkward values', () => {
    const table = awkwardTable()
    expect(fromCsv(toCsv(table))).toEqual(table)
  })

  it('round-trips awkward values written with CRLF', () => {
    const table = awkwardTable()
    expect(fromCsv(toCsv(table, { eol: '\r\n' }))).toEqual(table)
  })

  it('round-trips an empty table', () => {
    expect(fromCsv(toCsv({}))).toEqual({})
  })

  it('reads a file without a trailing newline', () => {
    expect(fromCsv('key,text\na,b')).toEqual({ a: 'b' })
  })

  it('rejects an unterminated quoted field', () => {
    expect(() => fromCsv('key,text\na,"b')).toThrow(I18nError)
  })

  it('rejects a row with the wrong field count', () => {
    expect(() => fromCsv('key,text\na,b,c')).toThrow(/3 fields/)
  })
})
