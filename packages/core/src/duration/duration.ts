/**
 * Durations on quests and steps: an ISO 8601 span restricted to weeks, days,
 * hours, minutes and seconds, or one of the calendar keywords `day`, `week` and
 * `month`. The encoding is specified in docs/01-model.md.
 *
 * A fixed span is a number of milliseconds measured from its anchor. A calendar
 * keyword waits for the next boundary after the anchor, which only the runtime's
 * calendar can place, so this module stops at classifying it.
 */
import { DURATION_KEYWORDS, type Duration, type DurationKeyword } from '../model.js'

export type ParsedDuration =
  | {
      kind: 'fixed'
      ms: number
      weeks: number
      days: number
      hours: number
      minutes: number
      seconds: number
    }
  | { kind: 'calendar'; unit: DurationKeyword }

const ISO = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/

export const MS_PER_SECOND = 1000
export const MS_PER_MINUTE = 60 * MS_PER_SECOND
export const MS_PER_HOUR = 60 * MS_PER_MINUTE
export const MS_PER_DAY = 24 * MS_PER_HOUR
export const MS_PER_WEEK = 7 * MS_PER_DAY

/** Parse a duration. Returns undefined when the text is not a valid duration. */
export function parseDuration(text: Duration): ParsedDuration | undefined {
  if ((DURATION_KEYWORDS as readonly string[]).includes(text)) {
    return { kind: 'calendar', unit: text as DurationKeyword }
  }
  const match = ISO.exec(text)
  if (match === null) return undefined
  // A lone "T" with nothing after it matches the regex but is not a duration.
  if (text.endsWith('T')) return undefined
  const [weeks, days, hours, minutes, seconds] = match
    .slice(1)
    .map((part) => (part === undefined ? 0 : Number(part)))
  const ms =
    weeks * MS_PER_WEEK +
    days * MS_PER_DAY +
    hours * MS_PER_HOUR +
    minutes * MS_PER_MINUTE +
    seconds * MS_PER_SECOND
  if (ms === 0 || !Number.isFinite(ms)) return undefined
  return { kind: 'fixed', ms, weeks, days, hours, minutes, seconds }
}

/** True when the text is a valid duration. */
export function isDuration(text: string): boolean {
  return parseDuration(text) !== undefined
}

/** True when the duration is a calendar keyword rather than a fixed span. */
export function isCalendarDuration(text: Duration): boolean {
  return parseDuration(text)?.kind === 'calendar'
}

/**
 * The one canonical spelling of a parsed duration: uppercase ISO 8601 with the
 * zero components dropped and no leading zeros, or the bare keyword.
 */
export function formatDuration(duration: ParsedDuration): Duration {
  if (duration.kind === 'calendar') return duration.unit
  const date = `${duration.weeks > 0 ? `${duration.weeks}W` : ''}${
    duration.days > 0 ? `${duration.days}D` : ''
  }`
  const time = `${duration.hours > 0 ? `${duration.hours}H` : ''}${
    duration.minutes > 0 ? `${duration.minutes}M` : ''
  }${duration.seconds > 0 ? `${duration.seconds}S` : ''}`
  return `P${date}${time === '' ? '' : `T${time}`}`
}

/**
 * The canonical spelling of a valid duration, or the text unchanged when it is
 * not one, so an invalid value survives to be reported by the validator.
 */
export function normalizeDuration(text: Duration): Duration {
  const parsed = parseDuration(text)
  return parsed === undefined ? text : formatDuration(parsed)
}
