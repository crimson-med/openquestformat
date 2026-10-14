import { describe, expect, it } from 'vitest'
import { createResolver, formatText, textPlaceholders } from './resolver.js'

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

describe('text arguments', () => {
  const tables = {
    en: { 'gus_daily.catch.title': 'Catch {n} {fish} for {giver}' },
    fr: { 'gus_daily.catch.title': 'Pêchez {n} {fish} pour {giver}' },
  }

  it('fills placeholders in a literal and in a resolved key', () => {
    const resolve = createResolver(tables, { locale: 'fr', fallback: 'en' })
    const args = { n: 3, fish: 'koi', giver: 'Gus' }
    expect(resolve('Catch {n} {fish}', args)).toBe('Catch 3 koi')
    expect(resolve('@gus_daily.catch.title', args)).toBe('Pêchez 3 koi pour Gus')
  })

  it('leaves an unknown placeholder as written and a text without arguments alone', () => {
    const resolve = createResolver(tables, { locale: 'en' })
    expect(resolve('Catch {n} {fish}', { n: 3 })).toBe('Catch 3 {fish}')
    expect(resolve('Catch {n} {fish}')).toBe('Catch {n} {fish}')
    expect(resolve('@gus_daily.catch.title')).toBe('Catch {n} {fish} for {giver}')
  })

  it('lets a translation reorder the placeholders', () => {
    const resolve = createResolver({ de: { k: '{fish}: {n} Stück' } }, { locale: 'de' })
    expect(resolve('@k', { n: 2, fish: 'Koi' })).toBe('Koi: 2 Stück')
  })

  it('formats with count and target the way the runtime hands them out', () => {
    expect(formatText('{count} of {target} caught', { count: 2, target: 5 })).toBe('2 of 5 caught')
  })

  it('lists the placeholders of a text once each', () => {
    expect(textPlaceholders('Catch {n} {fish}, then {n} more')).toEqual(['n', 'fish'])
    expect(textPlaceholders('No placeholders')).toEqual([])
    expect(textPlaceholders('{1bad} {ok}')).toEqual(['ok'])
  })
})
