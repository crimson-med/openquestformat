import { describe, expect, it } from 'vitest'
import { Calendar } from './calendar.js'

const HOUR = 3_600_000
const DAY = 24 * HOUR

/** Milliseconds since the epoch for a UTC wall clock reading. */
function utc(year: number, month: number, day: number, hour = 0, minute = 0): number {
  return Date.UTC(year, month - 1, day, hour, minute)
}

describe('Calendar in UTC', () => {
  const calendar = new Calendar({ timeZone: 'UTC' })

  it('counts days from the epoch and knows Thursday was day zero', () => {
    expect(calendar.day(0)).toBe(0)
    expect(calendar.day(DAY - 1)).toBe(0)
    expect(calendar.day(DAY)).toBe(1)
    // Monday is weekday 0 with the default weekStart; 1970-01-01 was a Thursday.
    expect(calendar.weekday(0)).toBe(3)
    expect(calendar.weekday(utc(2026, 10, 12))).toBe(0)
    expect(calendar.weekday(utc(2026, 10, 18))).toBe(6)
  })

  it('numbers weeks so that consecutive Mondays differ by one', () => {
    const monday = utc(2026, 10, 12)
    expect(calendar.week(monday)).toBe(calendar.week(monday - 1) + 1)
    expect(calendar.week(monday + 6 * DAY)).toBe(calendar.week(monday))
    expect(calendar.week(monday + 7 * DAY)).toBe(calendar.week(monday) + 1)
  })

  it('reads the wall clock for hour and minute', () => {
    expect(calendar.timeVariables(utc(2026, 10, 15, 20, 45))).toEqual({
      now: utc(2026, 10, 15, 20, 45),
      day: calendar.day(utc(2026, 10, 15)),
      week: calendar.week(utc(2026, 10, 15)),
      weekday: 3,
      hour: 20,
      minute: 45,
    })
  })

  it('finds the next day, week and month boundary', () => {
    const at = utc(2026, 10, 15, 13, 30)
    expect(calendar.nextBoundary(at, 'day')).toBe(utc(2026, 10, 16))
    expect(calendar.nextBoundary(at, 'week')).toBe(utc(2026, 10, 19))
    expect(calendar.nextBoundary(at, 'month')).toBe(utc(2026, 11, 1))
    expect(calendar.nextBoundary(utc(2026, 12, 31, 23, 59), 'month')).toBe(utc(2027, 1, 1))
  })

  it('treats an instant on a boundary as the start of the new period', () => {
    const midnight = utc(2026, 10, 16)
    expect(calendar.nextBoundary(midnight, 'day')).toBe(utc(2026, 10, 17))
    expect(calendar.nextBoundary(midnight - 1, 'day')).toBe(midnight)
  })
})

describe('Calendar with dayStartsAt and weekStart', () => {
  const calendar = new Calendar({ timeZone: 'UTC', weekStart: 0, dayStartsAt: 4 })

  it('rolls the day over at the configured hour', () => {
    expect(calendar.day(utc(2026, 10, 15, 3, 59))).toBe(calendar.day(utc(2026, 10, 14, 12)))
    expect(calendar.day(utc(2026, 10, 15, 4))).toBe(calendar.day(utc(2026, 10, 14, 12)) + 1)
    expect(calendar.nextBoundary(utc(2026, 10, 15, 3), 'day')).toBe(utc(2026, 10, 15, 4))
    expect(calendar.nextBoundary(utc(2026, 10, 15, 5), 'day')).toBe(utc(2026, 10, 16, 4))
  })

  it('starts the week on Sunday at the configured hour', () => {
    // 2026-10-18 is a Sunday.
    expect(calendar.weekday(utc(2026, 10, 18, 12))).toBe(0)
    expect(calendar.weekday(utc(2026, 10, 18, 3))).toBe(6)
    expect(calendar.nextBoundary(utc(2026, 10, 15, 13), 'week')).toBe(utc(2026, 10, 18, 4))
  })

  it('starts the month on its first day at the configured hour', () => {
    expect(calendar.nextBoundary(utc(2026, 10, 31, 12), 'month')).toBe(utc(2026, 11, 1, 4))
    expect(calendar.nextBoundary(utc(2026, 11, 1, 3), 'month')).toBe(utc(2026, 11, 1, 4))
    expect(calendar.period(utc(2026, 11, 1, 3), 'month')).toBe(
      calendar.period(utc(2026, 10, 20), 'month'),
    )
  })

  it('leaves hour and minute unshifted', () => {
    expect(calendar.timeVariables(utc(2026, 10, 15, 3, 10))).toMatchObject({ hour: 3, minute: 10 })
  })
})

describe('Calendar in a named zone', () => {
  it('reads the wall clock of the zone', () => {
    const tokyo = new Calendar({ timeZone: 'Asia/Tokyo' })
    expect(tokyo.wallClock(0)).toEqual({
      year: 1970,
      month: 0,
      day: 1,
      hour: 9,
      minute: 0,
      second: 0,
    })
    expect(tokyo.timeVariables(utc(2026, 10, 15, 20))).toMatchObject({ hour: 5, minute: 0 })
    // 20:00 UTC is already the next day in Tokyo.
    expect(tokyo.day(utc(2026, 10, 15, 20))).toBe(
      new Calendar({ timeZone: 'UTC' }).day(utc(2026, 10, 16)),
    )
    expect(tokyo.nextBoundary(utc(2026, 10, 15, 20), 'day')).toBe(utc(2026, 10, 16, 15))
  })

  it('places the day boundary across a daylight saving change', () => {
    const paris = new Calendar({ timeZone: 'Europe/Paris' })
    // Clocks go back on 2026-10-25 at 03:00 CEST. Midnight on the 26th is 23:00 UTC on the 25th.
    expect(paris.nextBoundary(utc(2026, 10, 25, 12), 'day')).toBe(utc(2026, 10, 25, 23))
    // The day before the change still starts at 22:00 UTC.
    expect(paris.nextBoundary(utc(2026, 10, 24, 12), 'day')).toBe(utc(2026, 10, 24, 22))
  })

  it('rejects a bad zone, weekStart or dayStartsAt', () => {
    expect(() => new Calendar({ timeZone: 'Mars/Olympus' })).toThrow()
    expect(() => new Calendar({ weekStart: 7 })).toThrow(/weekStart/)
    expect(() => new Calendar({ dayStartsAt: 24 })).toThrow(/dayStartsAt/)
  })
})
