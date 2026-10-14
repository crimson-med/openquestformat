import { describe, expect, it } from 'vitest'
import {
  MS_PER_DAY,
  MS_PER_HOUR,
  MS_PER_WEEK,
  formatDuration,
  isCalendarDuration,
  isDuration,
  normalizeDuration,
  parseDuration,
} from './duration.js'

describe('parseDuration', () => {
  it('reads the calendar keywords', () => {
    expect(parseDuration('day')).toEqual({ kind: 'calendar', unit: 'day' })
    expect(parseDuration('week')).toEqual({ kind: 'calendar', unit: 'week' })
    expect(parseDuration('month')).toEqual({ kind: 'calendar', unit: 'month' })
  })

  it('reads fixed spans in milliseconds', () => {
    expect(parseDuration('PT20H')?.kind).toBe('fixed')
    expect(parseDuration('PT20H')).toMatchObject({ ms: 20 * MS_PER_HOUR, hours: 20 })
    expect(parseDuration('P3D')).toMatchObject({ ms: 3 * MS_PER_DAY, days: 3 })
    expect(parseDuration('P1W')).toMatchObject({ ms: MS_PER_WEEK, weeks: 1 })
    expect(parseDuration('P1DT12H')).toMatchObject({ ms: 36 * MS_PER_HOUR })
    expect(parseDuration('PT90M')).toMatchObject({ ms: 90 * 60 * 1000 })
    expect(parseDuration('PT45S')).toMatchObject({ ms: 45 * 1000 })
  })

  it('rejects what is not a duration', () => {
    for (const text of [
      '',
      'P',
      'PT',
      'P1DT',
      'P1M',
      'P1Y',
      'PT0S',
      'P0D',
      '1d',
      'Day',
      'p1d',
      'P1.5D',
      'P-1D',
      'PT1H30',
      'tomorrow',
    ]) {
      expect(parseDuration(text), text).toBeUndefined()
      expect(isDuration(text), text).toBe(false)
    }
  })

  it('tells calendar durations apart', () => {
    expect(isCalendarDuration('week')).toBe(true)
    expect(isCalendarDuration('P1W')).toBe(false)
    expect(isCalendarDuration('nope')).toBe(false)
  })
})

describe('formatDuration and normalizeDuration', () => {
  it('drops zero components and leading zeros', () => {
    expect(normalizeDuration('P1DT12H0M')).toBe('P1DT12H')
    expect(normalizeDuration('P0W2DT0H5M')).toBe('P2DT5M')
    expect(normalizeDuration('PT0H0M30S')).toBe('PT30S')
    expect(normalizeDuration('P007D')).toBe('P7D')
  })

  it('leaves a canonical spelling and a keyword alone', () => {
    for (const text of ['PT20H', 'P3D', 'P1W', 'P1DT12H', 'day', 'week', 'month']) {
      expect(normalizeDuration(text)).toBe(text)
    }
  })

  it('leaves an invalid value untouched for the validator', () => {
    expect(normalizeDuration('tomorrow')).toBe('tomorrow')
  })

  it('round trips through parse', () => {
    for (const text of ['PT20H', 'P3D', 'P1W', 'P1W2DT3H4M5S', 'day']) {
      const parsed = parseDuration(text)
      expect(parsed).toBeDefined()
      expect(formatDuration(parsed as NonNullable<typeof parsed>)).toBe(text)
    }
  })
})
