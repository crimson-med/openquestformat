/**
 * Naming, escaping and payload rules shared by the Ink and the Yarn interop.
 *
 * Both target languages use plain identifiers where OQF uses dotted variable
 * paths, and both carry an event payload as a single string. The rules live in
 * one module so the two exporters and the two importers agree character for
 * character. The Yarn side imports from here on purpose: it is the same
 * contract, not a second one.
 *
 * ## Identifier translation
 *
 * An OQF variable path matches `[A-Za-z_][A-Za-z0-9_#.-]*`. Ink and Yarn
 * identifiers allow only letters, digits and underscores, so the extra
 * characters are escaped with underscore sequences:
 *
 * | Path character | Identifier |
 * |----------------|------------|
 * | `.`            | `__`       |
 * | `-`            | `_h_`      |
 * | `#`            | `_s_`      |
 * | a literal `_` that would otherwise be read back as one of the above | `_e_` |
 *
 * The namespace is part of the path, so `flag.met_ines` becomes
 * `flag__met_ines`, `count.trade` becomes `count__trade` and
 * `step.harbor#deliver` becomes `step__harbor_s_deliver`.
 *
 * The reverse, `fromIdentifier`, scans left to right: on an underscore it reads
 * `__` as `.`, `_h_` as `-`, `_s_` as `#` and `_e_` as a literal `_`, and
 * otherwise emits a literal `_`. Because every escape starts with `_` and is
 * self delimiting, the pair is exact for every path the condition language
 * accepts.
 *
 * ## Payloads
 *
 * An event payload is a flat `Record<string, Scalar>` and travels as
 * `k=v,k=v`. Keys and string values escape `\`, `,`, `=` and a leading or
 * trailing space with a backslash. A value reads back as a number when it looks
 * like one, as a boolean for `true` and `false`, and as a string otherwise, the
 * same typing rule the compact format uses. A string that spells a number or a
 * boolean therefore reads back as that number or boolean.
 *
 * ## Extension bags
 *
 * An `Ext` bag is `key=value;key=value`. A value is either a scalar or a nested
 * record written `{k=v,k=v}`. Scalars escape `\`, `;`, `=`, `,`, `{` and `}`.
 */
import type { Ext, Payload, Scalar } from '@oqf/core'

/** A construct an importer could not map, named by source line. */
export interface ImportWarning {
  line: number
  construct: string
  message: string
}

/** Separators escaped inside an event payload. */
export const PAYLOAD_SPECIALS = ',='

/** Separators escaped inside an extension bag. */
export const EXT_SPECIALS = ';=,{}'

const NUMBER_PATTERN = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][-+]?[0-9]+)?$/

/** True when a literal underscore would otherwise be read back as an escape. */
function ambiguousUnderscore(path: string, index: number): boolean {
  const next = path[index + 1]
  if (next === '_') return true
  if (next !== 'h' && next !== 's' && next !== 'e') return false
  return path[index + 2] === '_'
}

/** Translate an OQF variable path into an Ink or Yarn identifier. */
export function toIdentifier(path: string): string {
  let out = ''
  for (let index = 0; index < path.length; index += 1) {
    const char = path[index]
    if (char === '.') out += '__'
    else if (char === '-') out += '_h_'
    else if (char === '#') out += '_s_'
    else if (char === '_' && ambiguousUnderscore(path, index)) out += '_e_'
    else out += char
  }
  return out
}

/** Translate an Ink or Yarn identifier back into an OQF variable path. */
export function fromIdentifier(identifier: string): string {
  let out = ''
  let index = 0
  while (index < identifier.length) {
    const char = identifier[index]
    if (char !== '_') {
      out += char
      index += 1
      continue
    }
    const next = identifier[index + 1]
    if (next === '_') {
      out += '.'
      index += 2
      continue
    }
    if (identifier[index + 2] === '_' && (next === 'h' || next === 's' || next === 'e')) {
      out += next === 'h' ? '-' : next === 's' ? '#' : '_'
      index += 3
      continue
    }
    out += '_'
    index += 1
  }
  return out
}

/** Backslash escape every separator, plus a leading or trailing space. */
export function escapeParts(value: string, specials: string): string {
  let out = ''
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    const edge = index === 0 || index === value.length - 1
    if (char === '\\' || specials.includes(char) || (edge && (char === ' ' || char === '\t'))) {
      out += '\\'
    }
    out += char
  }
  return out
}

/** True when the character at `index` is preceded by an odd run of backslashes. */
export function escapedAt(text: string, index: number): boolean {
  let count = 0
  let cursor = index - 1
  while (cursor >= 0 && text[cursor] === '\\') {
    count += 1
    cursor -= 1
  }
  return count % 2 === 1
}

/** Trim whitespace that no backslash protects. */
export function trimEscaped(text: string): string {
  const left = text.replace(/^\s+/, '')
  let end = left.length
  while (end > 0 && /\s/.test(left[end - 1]) && !escapedAt(left, end - 1)) end -= 1
  return left.slice(0, end)
}

/** Drop one level of backslash escaping. */
export function unescapeParts(text: string): string {
  let out = ''
  let escaped = false
  for (const char of text) {
    if (escaped) {
      out += char
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    out += char
  }
  return out
}

/** Split on a separator that backslashes may escape. Escapes are left in place. */
export function splitEscaped(text: string, separator: string): string[] {
  const parts: string[] = []
  let current = ''
  let escaped = false
  for (const char of text) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === '\\') {
      current += char
      escaped = true
      continue
    }
    if (char === separator) {
      parts.push(current)
      current = ''
      continue
    }
    current += char
  }
  parts.push(current)
  return parts
}

/** Split once on the first separator a backslash does not escape. */
export function splitFirstEscaped(text: string, separator: string): [string, string | undefined] {
  let escaped = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === separator) return [text.slice(0, index), text.slice(index + 1)]
  }
  return [text, undefined]
}

/** Type a payload or extension value the way the compact format does. */
export function decodeScalar(text: string): Scalar {
  if (text === 'true') return true
  if (text === 'false') return false
  if (text !== '' && NUMBER_PATTERN.test(text)) return Number(text)
  return text
}

/** Write a scalar into a payload or extension cell. */
export function encodeScalar(value: Scalar, specials: string): string {
  return typeof value === 'string' ? escapeParts(value, specials) : String(value)
}

/** Render a flat payload as `k=v,k=v`. */
export function encodePayload(payload: Payload): string {
  return Object.entries(payload)
    .map(([key, value]) => {
      return `${escapeParts(key, PAYLOAD_SPECIALS)}=${encodeScalar(value, PAYLOAD_SPECIALS)}`
    })
    .join(',')
}

/** Read a `k=v,k=v` payload. A bare key means `true`. */
export function decodePayload(text: string): Payload {
  const payload: Payload = {}
  if (text.trim() === '') return payload
  for (const part of splitEscaped(text, ',')) {
    const cell = trimEscaped(part)
    if (cell === '') continue
    const [rawKey, rawValue] = splitFirstEscaped(cell, '=')
    const key = unescapeParts(trimEscaped(rawKey))
    if (key === '') continue
    payload[key] =
      rawValue === undefined ? true : decodeScalar(unescapeParts(trimEscaped(rawValue)))
  }
  return payload
}

/** Render an extension bag as `key=value;key=value`, nested records in braces. */
export function encodeExt(ext: Ext): string {
  return Object.entries(ext)
    .map(([key, value]) => {
      const name = escapeParts(key, EXT_SPECIALS)
      if (value !== null && typeof value === 'object') {
        const inner = Object.entries(value)
          .map(([k, v]) => `${escapeParts(k, EXT_SPECIALS)}=${encodeScalar(v, EXT_SPECIALS)}`)
          .join(',')
        return `${name}={${inner}}`
      }
      return `${name}=${encodeScalar(value, EXT_SPECIALS)}`
    })
    .join(';')
}

/** Read a `key=value;key=value` extension bag. */
export function decodeExt(text: string): Ext {
  const ext: Ext = {}
  if (text.trim() === '') return ext
  for (const part of splitEscaped(text, ';')) {
    const cell = trimEscaped(part)
    if (cell === '') continue
    const [rawKey, rawValue] = splitFirstEscaped(cell, '=')
    const key = unescapeParts(trimEscaped(rawKey))
    if (key === '' || rawValue === undefined) continue
    const raw = trimEscaped(rawValue)
    if (raw.startsWith('{') && raw.endsWith('}') && !raw.endsWith('\\}')) {
      const record: Record<string, Scalar> = {}
      for (const entry of splitEscaped(raw.slice(1, -1), ',')) {
        const inner = trimEscaped(entry)
        if (inner === '') continue
        const [innerKey, innerValue] = splitFirstEscaped(inner, '=')
        const name = unescapeParts(trimEscaped(innerKey))
        if (name === '') continue
        record[name] =
          innerValue === undefined ? true : decodeScalar(unescapeParts(trimEscaped(innerValue)))
      }
      ext[key] = record
      continue
    }
    ext[key] = decodeScalar(unescapeParts(raw))
  }
  return ext
}

/** Render the speakers dictionary entry `id|name`, name optional. */
export function encodeSpeaker(id: string, name: string | undefined): string {
  const head = escapeParts(id, '|')
  return name === undefined ? head : `${head}|${escapeParts(name, '|')}`
}

const TAG_UNSAFE = /[%\\#|{}\n\r]/g

/**
 * Percent encode the characters an ink tag cannot carry.
 *
 * Ink's tag parser rejects `|` and reads `{` as the start of inline logic, and
 * its own backslash escapes would eat the ones the payload codecs put there. A
 * percent escape survives all of that, and because `#` is encoded too, a tag
 * value can never be mistaken for the start of the next tag.
 */
export function encodeTagValue(value: string): string {
  return value.replace(TAG_UNSAFE, (char) => {
    return `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`
  })
}

/** Undo `encodeTagValue`. */
export function decodeTagValue(value: string): string {
  return value.replace(/%([0-9A-Fa-f]{2})/g, (_match, hex: string) => {
    return String.fromCharCode(Number.parseInt(hex, 16))
  })
}

/** Render the whole speakers dictionary as one comma separated line. */
export function encodeSpeakerList(speakers: readonly { id: string; name?: string }[]): string {
  return speakers
    .map((speaker) => {
      const head = escapeParts(speaker.id, '|,')
      return speaker.name === undefined ? head : `${head}|${escapeParts(speaker.name, '|,')}`
    })
    .join(', ')
}

/** Read a comma separated speakers dictionary line. */
export function decodeSpeakerList(text: string): { id: string; name?: string }[] {
  const speakers: { id: string; name?: string }[] = []
  for (const cell of splitEscaped(text, ',')) {
    if (cell.trim() === '') continue
    speakers.push(decodeSpeaker(cell))
  }
  return speakers
}

/** Read an `id|name` speakers dictionary entry. */
export function decodeSpeaker(text: string): { id: string; name?: string } {
  const [rawId, rawName] = splitFirstEscaped(text.trim(), '|')
  const id = unescapeParts(rawId.trim())
  if (rawName === undefined) return { id }
  const name = unescapeParts(rawName.trim())
  return name === '' ? { id } : { id, name }
}
