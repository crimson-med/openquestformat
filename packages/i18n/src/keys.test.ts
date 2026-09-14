import { describe, expect, it } from 'vitest'
import { I18nError } from './errors.js'
import {
  choiceTextKey,
  conversationTitleKey,
  isKey,
  keyOf,
  nodeTextKey,
  outcomeTitleKey,
  questSummaryKey,
  questTitleKey,
  stepJournalKey,
  stepTitleKey,
  toKeyRef,
} from './keys.js'

describe('isKey', () => {
  it('recognizes a key reference', () => {
    expect(isKey('@quest.title')).toBe(true)
  })

  it('treats anything else as a literal', () => {
    expect(isKey('Find the ledger')).toBe(false)
    expect(isKey('')).toBe(false)
    expect(isKey('mail@example.com')).toBe(false)
  })
})

describe('keyOf', () => {
  it('drops the prefix', () => {
    expect(keyOf('@quest.title')).toBe('quest.title')
  })

  it('throws on a literal', () => {
    expect(() => keyOf('Find the ledger')).toThrow(I18nError)
  })
})

describe('toKeyRef', () => {
  it('round-trips with keyOf', () => {
    expect(keyOf(toKeyRef('a.b.c'))).toBe('a.b.c')
  })
})

describe('quest keys', () => {
  it('are built from structure', () => {
    expect(questTitleKey('ledger')).toBe('ledger.title')
    expect(questSummaryKey('ledger')).toBe('ledger.summary')
    expect(stepTitleKey('ledger', 'trade')).toBe('ledger.trade.title')
    expect(stepJournalKey('ledger', 'trade')).toBe('ledger.trade.journal')
    expect(outcomeTitleKey('ledger', 'caught')).toBe('ledger.caught.outcome.title')
  })
})

describe('dialogue keys', () => {
  it('are built from structure', () => {
    expect(conversationTitleKey('ines_intro')).toBe('ines_intro.title')
    expect(nodeTextKey('ines_intro', 'greet')).toBe('ines_intro.greet.text')
    expect(choiceTextKey('ines_intro', 'greet', 1)).toBe('ines_intro.greet.1.text')
  })
})
