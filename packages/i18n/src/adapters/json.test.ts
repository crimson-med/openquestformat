import { describe, expect, it } from 'vitest'
import { I18nError } from '../errors.js'
import { awkwardTable } from '../fixtures.js'
import { fromJson, toJson } from './json.js'

describe('toJson', () => {
  it('writes a flat map indented with two spaces and a trailing newline', () => {
    expect(toJson({ 'ledger.title': 'The ledger' })).toBe('{\n  "ledger.title": "The ledger"\n}\n')
  })

  it('keeps insertion order', () => {
    const text = toJson({ b: '2', a: '1' })
    expect(text.indexOf('"b"')).toBeLessThan(text.indexOf('"a"'))
  })

  it('writes an empty table', () => {
    expect(toJson({})).toBe('{}\n')
  })
})

describe('fromJson', () => {
  it('round-trips awkward values', () => {
    const table = awkwardTable()
    expect(fromJson(toJson(table))).toEqual(table)
  })

  it('round-trips an empty table', () => {
    expect(fromJson(toJson({}))).toEqual({})
  })

  it('rejects text that is not JSON', () => {
    expect(() => fromJson('{ nope')).toThrow(I18nError)
  })

  it('rejects a non-object document', () => {
    expect(() => fromJson('["a"]')).toThrow(I18nError)
    expect(() => fromJson('null')).toThrow(I18nError)
  })

  it('rejects a value that is not a string', () => {
    expect(() => fromJson('{"a": 1}')).toThrow(/value of a is not a string/)
  })
})
