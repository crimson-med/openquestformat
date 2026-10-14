/**
 * Calendar arithmetic for the recurrence features: day, week and month indices
 * for the `time.*` namespace, and the boundaries the calendar durations wait
 * for. The rules are in docs/14-recurrence.md.
 *
 * Every index is computed on the wall clock of the calendar's zone, shifted by
 * `dayStartsAt`, so a "day" that rolls over at 04:00 is one unit here. Fixed
 * spans never come through this module; they are plain millisecond arithmetic.
 */
import { type DurationKeyword, MS_PER_DAY, MS_PER_HOUR, type TimeVariable } from '@oqf/core'

export interface CalendarOptions {
  /** IANA zone, such as `Europe/Paris`. Default: the host's local zone. */
  timeZone?: string
  /** 0 Sunday to 6 Saturday. Default 1, Monday. */
  weekStart?: number
  /** The hour at which the day rolls over. Default 0. */
  dayStartsAt?: number
}

/** The wall clock in the calendar's zone, as the pieces the indices are built from. */
export interface WallClock {
  year: number
  /** 0 to 11. */
  month: number
  /** 1 to 31. */
  day: number
  hour: number
  minute: number
  second: number
}

/** Day 0 of the epoch, 1970-01-01, was a Thursday: 4 when Sunday is 0. */
const EPOCH_WEEKDAY = 4

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(timeZone: string): Intl.DateTimeFormat {
  let found = formatters.get(timeZone)
  if (found === undefined) {
    found = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
    formatters.set(timeZone, found)
  }
  return found
}

function wallClock(ms: number, timeZone: string | undefined): WallClock {
  if (timeZone === undefined) {
    const date = new Date(ms)
    return {
      year: date.getFullYear(),
      month: date.getMonth(),
      day: date.getDate(),
      hour: date.getHours(),
      minute: date.getMinutes(),
      second: date.getSeconds(),
    }
  }
  const parts: Record<string, number> = {}
  for (const part of formatter(timeZone).formatToParts(new Date(ms))) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value)
  }
  return {
    year: parts.year,
    month: parts.month - 1,
    day: parts.day,
    // Some engines print midnight as 24 with hourCycle h23; fold it back.
    hour: parts.hour === 24 ? 0 : parts.hour,
    minute: parts.minute,
    second: parts.second,
  }
}

/** The zone's offset from UTC at that instant, in milliseconds. */
function offsetAt(ms: number, timeZone: string | undefined): number {
  const wall = wallClock(ms, timeZone)
  const asUtc = Date.UTC(wall.year, wall.month, wall.day, wall.hour, wall.minute, wall.second)
  // The input may carry sub-second precision the wall clock drops.
  return asUtc - (ms - (((ms % 1000) + 1000) % 1000))
}

/** Milliseconds since the epoch read as if the zone's wall clock were UTC. */
function toLocal(ms: number, timeZone: string | undefined): number {
  return ms + offsetAt(ms, timeZone)
}

/**
 * The instant at which the zone's wall clock reads `local`. Two rounds through
 * the offset settle a boundary that sits just after a daylight saving change.
 */
function fromLocal(local: number, timeZone: string | undefined, near: number): number {
  const first = local - offsetAt(near, timeZone)
  return local - offsetAt(first, timeZone)
}

export class Calendar {
  readonly timeZone: string | undefined
  readonly weekStart: number
  readonly dayStartsAt: number

  constructor(options: CalendarOptions = {}) {
    this.timeZone = options.timeZone
    this.weekStart = options.weekStart ?? 1
    this.dayStartsAt = options.dayStartsAt ?? 0
    if (!Number.isInteger(this.weekStart) || this.weekStart < 0 || this.weekStart > 6) {
      throw new Error(
        `calendar weekStart must be 0 (Sunday) to 6 (Saturday), got ${this.weekStart}`,
      )
    }
    if (!Number.isInteger(this.dayStartsAt) || this.dayStartsAt < 0 || this.dayStartsAt > 23) {
      throw new Error(`calendar dayStartsAt must be an hour from 0 to 23, got ${this.dayStartsAt}`)
    }
    // Fail now rather than on the first tick when the zone name is unknown.
    if (this.timeZone !== undefined) formatter(this.timeZone)
  }

  /** The wall clock in the calendar's zone, unshifted by `dayStartsAt`. */
  wallClock(ms: number): WallClock {
    return wallClock(ms, this.timeZone)
  }

  /** Local wall time shifted so that the day boundary sits at 00:00. */
  private shifted(ms: number): number {
    return toLocal(ms, this.timeZone) - this.dayStartsAt * MS_PER_HOUR
  }

  /** `time.day`: the calendar day index, counted from the epoch. */
  day(ms: number): number {
    return Math.floor(this.shifted(ms) / MS_PER_DAY)
  }

  /** `time.weekday`: 0 to 6, where 0 is `weekStart`. */
  weekday(ms: number): number {
    return (((this.day(ms) + EPOCH_WEEKDAY - this.weekStart) % 7) + 7) % 7
  }

  /** `time.week`: the calendar week index, weeks beginning on `weekStart`. */
  week(ms: number): number {
    return Math.floor((this.day(ms) + EPOCH_WEEKDAY - this.weekStart) / 7)
  }

  /** The month index, years times twelve plus the month, of the shifted wall time. */
  month(ms: number): number {
    const wall = new Date(this.shifted(ms))
    return wall.getUTCFullYear() * 12 + wall.getUTCMonth()
  }

  /** The index of the period a calendar duration counts in. Consecutive periods differ by one. */
  period(ms: number, unit: DurationKeyword): number {
    if (unit === 'day') return this.day(ms)
    if (unit === 'week') return this.week(ms)
    return this.month(ms)
  }

  /** The instant the day with that index begins. */
  private dayStart(day: number, near: number): number {
    const local = day * MS_PER_DAY + this.dayStartsAt * MS_PER_HOUR
    return fromLocal(local, this.timeZone, near)
  }

  /** The first boundary of the unit strictly after `ms`. */
  nextBoundary(ms: number, unit: DurationKeyword): number {
    if (unit === 'day') return this.dayStart(this.day(ms) + 1, ms)
    if (unit === 'week') {
      const firstOfNext = (this.week(ms) + 1) * 7 - EPOCH_WEEKDAY + this.weekStart
      return this.dayStart(firstOfNext, ms)
    }
    const wall = new Date(this.shifted(ms))
    const local =
      Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth() + 1, 1) + this.dayStartsAt * MS_PER_HOUR
    return fromLocal(local, this.timeZone, ms)
  }

  /** Every `time.*` value at that instant. */
  timeVariables(ms: number): Record<TimeVariable, number> {
    const wall = this.wallClock(ms)
    return {
      now: ms,
      day: this.day(ms),
      week: this.week(ms),
      weekday: this.weekday(ms),
      hour: wall.hour,
      minute: wall.minute,
    }
  }
}
