import { describe, expect, it } from 'vitest'
import {
  formatEmits,
  formatFlagSets,
  formatPayloadText,
  parseEmits,
  parseFlagSets,
  parsePayloadText,
  typedValue,
} from './values'

describe('typedValue', () => {
  it('types booleans and numbers, leaves the rest alone', () => {
    expect(typedValue('true')).toBe(true)
    expect(typedValue('false')).toBe(false)
    expect(typedValue('10')).toBe(10)
    expect(typedValue('catch_log')).toBe('catch_log')
  })
})

describe('payloads', () => {
  it('round-trips a payload', () => {
    const payload = { feature: 'catch_log', amount: 3, ok: true }
    expect(parsePayloadText(formatPayloadText(payload))).toEqual(payload)
  })

  it('treats an empty cell as no payload', () => {
    expect(parsePayloadText('')).toBeUndefined()
    expect(formatPayloadText(undefined)).toBe('')
  })
})

describe('flag sets', () => {
  it('reads a bare flag as true and round-trips values', () => {
    expect(parseFlagSets('met_ines;coins=10')).toEqual([
      { flag: 'met_ines' },
      { flag: 'coins', value: 10 },
    ])
    expect(formatFlagSets([{ flag: 'met_ines' }, { flag: 'coins', value: 10 }])).toBe(
      'met_ines;coins=10',
    )
  })
})

describe('emitted events', () => {
  it('round-trips events with and without payloads', () => {
    const emits = [{ event: 'harbor.greeted' }, { event: 'ledger.hint', payload: { from: 'ines' } }]
    expect(parseEmits(formatEmits(emits))).toEqual(emits)
  })

  it('drops empty entries', () => {
    expect(parseEmits(' ; ')).toBeUndefined()
    expect(formatEmits(undefined)).toBe('')
  })
})
