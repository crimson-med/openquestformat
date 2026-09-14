/**
 * Small text encodings the inspector borrows from the compact format, so what
 * you type in a field is what the file will hold: `key=value;key=value` for
 * payloads and flag sets, `event;event:k=v` for emitted events.
 */
import type { Payload, Scalar } from '@oqf/core'
import type { EmitSpec, FlagSet } from '@oqf/dialogue'

/** `true`, `false` and numbers are typed, everything else stays a string. */
export function typedValue(text: string): Scalar {
  if (text === 'true') return true
  if (text === 'false') return false
  if (text.trim() !== '' && !Number.isNaN(Number(text))) return Number(text)
  return text
}

function scalarText(value: Scalar): string {
  return typeof value === 'string' ? value : String(value)
}

function splitUnescaped(text: string, separator: string): string[] {
  const parts: string[] = []
  let current = ''
  for (let at = 0; at < text.length; at += 1) {
    const character = text[at]
    if (character === '\\' && at + 1 < text.length) {
      current += text[at + 1]
      at += 1
      continue
    }
    if (character === separator) {
      parts.push(current)
      current = ''
      continue
    }
    current += character
  }
  parts.push(current)
  return parts
}

function escapeChars(text: string, characters: string): string {
  let out = ''
  for (const character of text) {
    if (characters.includes(character)) out += '\\'
    out += character
  }
  return out
}

export function parsePayloadText(text: string): Payload | undefined {
  const payload: Payload = {}
  let found = false
  for (const part of splitUnescaped(text, ';')) {
    if (part.trim() === '') continue
    const equals = splitUnescaped(part, '=')
    const key = equals[0].trim()
    if (key === '') continue
    payload[key] = equals.length > 1 ? typedValue(equals.slice(1).join('=')) : true
    found = true
  }
  return found ? payload : undefined
}

export function formatPayloadText(payload: Payload | undefined): string {
  if (payload === undefined) return ''
  return Object.entries(payload)
    .map(([key, value]) => `${escapeChars(key, ';=')}=${escapeChars(scalarText(value), ';=')}`)
    .join(';')
}

/** `met_ines;coins=10`. A bare name means true. */
export function parseFlagSets(text: string): FlagSet[] | undefined {
  const sets: FlagSet[] = []
  for (const part of splitUnescaped(text, ';')) {
    if (part.trim() === '') continue
    const equals = splitUnescaped(part, '=')
    const flag = equals[0].trim()
    if (flag === '') continue
    if (equals.length > 1) sets.push({ flag, value: typedValue(equals.slice(1).join('=')) })
    else sets.push({ flag })
  }
  return sets.length === 0 ? undefined : sets
}

export function formatFlagSets(sets: FlagSet[] | undefined): string {
  if (sets === undefined) return ''
  return sets
    .map((entry) =>
      entry.value === undefined || entry.value === true
        ? escapeChars(entry.flag, ';=')
        : `${escapeChars(entry.flag, ';=')}=${escapeChars(scalarText(entry.value), ';=')}`,
    )
    .join(';')
}

/** `quest.started;cozycoast.ledger.restored:feature=catch_log`. */
export function parseEmits(text: string): EmitSpec[] | undefined {
  const emits: EmitSpec[] = []
  for (const part of splitUnescaped(text, ';')) {
    if (part.trim() === '') continue
    const colon = splitUnescaped(part, ':')
    const event = colon[0].trim()
    if (event === '') continue
    if (colon.length === 1) {
      emits.push({ event })
      continue
    }
    const payload: Payload = {}
    for (const pair of splitUnescaped(colon.slice(1).join(':'), ',')) {
      if (pair.trim() === '') continue
      const equals = splitUnescaped(pair, '=')
      const key = equals[0].trim()
      if (key === '') continue
      payload[key] = equals.length > 1 ? typedValue(equals.slice(1).join('=')) : true
    }
    emits.push(Object.keys(payload).length === 0 ? { event } : { event, payload })
  }
  return emits.length === 0 ? undefined : emits
}

export function formatEmits(emits: EmitSpec[] | undefined): string {
  if (emits === undefined) return ''
  return emits
    .map((entry) => {
      const name = escapeChars(entry.event, ';:,=')
      if (entry.payload === undefined) return name
      const payload = Object.entries(entry.payload)
        .map(
          ([key, value]) => `${escapeChars(key, ';:,=')}=${escapeChars(scalarText(value), ';:,=')}`,
        )
        .join(',')
      return payload === '' ? name : `${name}:${payload}`
    })
    .join(';')
}
