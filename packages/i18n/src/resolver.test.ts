import { describe, expect, it } from 'vitest'
import { createResolver } from './resolver.js'

const tables = {
  en: { 'ledger.title': "The Harbormaster's Ledger", 'ledger.only_en': 'Gulls' },
  fr: { 'ledger.title': 'Le registre du capitaine' },
}

describe('createResolver', () => {
  it('passes literals through', () => {
    const resolve = createResolver(tables, { locale: 'fr', fallback: 'en' })
    expect(resolve('Find the ledger')).toBe('Find the ledger')
    expect(resolve('')).toBe('')
  })

  it('reads the active locale first', () => {
    const resolve = createResolver(tables, { locale: 'fr', fallback: 'en' })
    expect(resolve('@ledger.title')).toBe('Le registre du capitaine')
  })

  it('falls back when the active locale has no value', () => {
    const resolve = createResolver(tables, { locale: 'fr', fallback: 'en' })
    expect(resolve('@ledger.only_en')).toBe('Gulls')
  })

  it('returns the key reference when neither locale has it', () => {
    const resolve = createResolver(tables, { locale: 'fr', fallback: 'en' })
    expect(resolve('@ledger.missing')).toBe('@ledger.missing')
  })

  it('works without a fallback', () => {
    const resolve = createResolver(tables, { locale: 'fr' })
    expect(resolve('@ledger.only_en')).toBe('@ledger.only_en')
  })

  it('survives an unknown locale', () => {
    const resolve = createResolver(tables, { locale: 'de', fallback: 'en' })
    expect(resolve('@ledger.title')).toBe("The Harbormaster's Ledger")
    const lonely = createResolver(tables, { locale: 'de' })
    expect(lonely('@ledger.title')).toBe('@ledger.title')
  })

  it('returns an empty translation as it is', () => {
    const resolve = createResolver({ fr: { 'ledger.title': '' } }, { locale: 'fr', fallback: 'en' })
    expect(resolve('@ledger.title')).toBe('')
  })
})
