/**
 * XLIFF 1.2, one `trans-unit` per key. The XML is written by hand and read
 * back by a small hand-rolled scanner, so the package stays dependency free
 * and runs in a browser as happily as in Node.
 */
import { I18nError } from '../errors.js'
import type { StringTable } from '../extract.js'

export interface XliffOptions {
  /** `source-language` on the file element. Defaults to `en`. */
  sourceLanguage?: string
  /** `target-language` on the file element. Writing it also writes empty targets. */
  targetLanguage?: string
  /** `original` on the file element. Defaults to `oqf`. */
  original?: string
}

function escapeText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('\r', '&#13;')
    .replaceAll('\n', '&#10;')
    .replaceAll('\t', '&#9;')
}

function escapeAttribute(value: string): string {
  return escapeText(value).replaceAll('"', '&quot;').replaceAll("'", '&apos;')
}

/** Writes a table as an XLIFF 1.2 document. */
export function toXliff(table: StringTable, options: XliffOptions = {}): string {
  const source = options.sourceLanguage ?? 'en'
  const target = options.targetLanguage
  const original = options.original ?? 'oqf'
  const attributes = [
    `original="${escapeAttribute(original)}"`,
    'datatype="plaintext"',
    `source-language="${escapeAttribute(source)}"`,
  ]
  if (target !== undefined) attributes.push(`target-language="${escapeAttribute(target)}"`)
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">',
    `  <file ${attributes.join(' ')}>`,
    '    <body>',
  ]
  for (const [key, text] of Object.entries(table)) {
    lines.push(`      <trans-unit id="${escapeAttribute(key)}">`)
    lines.push(`        <source>${escapeText(text)}</source>`)
    if (target !== undefined) lines.push('        <target></target>')
    lines.push('      </trans-unit>')
  }
  lines.push('    </body>', '  </file>', '</xliff>')
  return `${lines.join('\n')}\n`
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

function decodeEntity(name: string): string {
  const named = NAMED_ENTITIES[name]
  if (named !== undefined) return named
  if (name.startsWith('#x') || name.startsWith('#X')) {
    const code = Number.parseInt(name.slice(2), 16)
    if (Number.isNaN(code)) throw new I18nError(`invalid XLIFF: bad entity &${name};`)
    return String.fromCodePoint(code)
  }
  if (name.startsWith('#')) {
    const code = Number.parseInt(name.slice(1), 10)
    if (Number.isNaN(code)) throw new I18nError(`invalid XLIFF: bad entity &${name};`)
    return String.fromCodePoint(code)
  }
  throw new I18nError(`invalid XLIFF: unknown entity &${name};`)
}

function decode(value: string): string {
  let out = ''
  let index = 0
  while (index < value.length) {
    const char = value[index] as string
    if (char !== '&') {
      out += char
      index += 1
      continue
    }
    const end = value.indexOf(';', index + 1)
    if (end === -1) throw new I18nError('invalid XLIFF: unterminated entity')
    out += decodeEntity(value.slice(index + 1, end))
    index = end + 1
  }
  return out
}

const WHITESPACE = new Set([' ', '\t', '\n', '\r'])

interface Tag {
  name: string
  attributes: Record<string, string>
  closing: boolean
  selfClosing: boolean
  /** Index just past the `>`. */
  end: number
}

/** Reads one tag starting at the `<` in `text`. */
function readTag(text: string, start: number): Tag {
  let index = start + 1
  const closing = text[index] === '/'
  if (closing) index += 1
  let name = ''
  while (index < text.length) {
    const char = text[index] as string
    if (WHITESPACE.has(char) || char === '>' || char === '/') break
    name += char
    index += 1
  }
  const attributes: Record<string, string> = {}
  let selfClosing = false
  while (index < text.length) {
    const char = text[index] as string
    if (WHITESPACE.has(char)) {
      index += 1
      continue
    }
    if (char === '/') {
      selfClosing = true
      index += 1
      continue
    }
    if (char === '>') {
      index += 1
      return { name, attributes, closing, selfClosing, end: index }
    }
    let attribute = ''
    while (index < text.length) {
      const inner = text[index] as string
      if (WHITESPACE.has(inner) || inner === '=' || inner === '>' || inner === '/') break
      attribute += inner
      index += 1
    }
    while (index < text.length && WHITESPACE.has(text[index] as string)) index += 1
    if (text[index] !== '=') {
      attributes[attribute] = ''
      continue
    }
    index += 1
    while (index < text.length && WHITESPACE.has(text[index] as string)) index += 1
    const quote = text[index]
    if (quote !== '"' && quote !== "'") {
      throw new I18nError(`invalid XLIFF: unquoted value for attribute ${attribute}`)
    }
    index += 1
    const close = text.indexOf(quote, index)
    if (close === -1) throw new I18nError(`invalid XLIFF: unterminated value for ${attribute}`)
    attributes[attribute] = decode(text.slice(index, close))
    index = close + 1
  }
  throw new I18nError('invalid XLIFF: unterminated tag')
}

/** Skips a comment, a declaration or a processing instruction, returning the index past it. */
function skipMarkup(text: string, start: number): number {
  const ends: [string, string][] = [
    ['<!--', '-->'],
    ['<?', '?>'],
    ['<!', '>'],
  ]
  for (const [open, close] of ends) {
    if (!text.startsWith(open, start)) continue
    const end = text.indexOf(close, start + open.length)
    if (end === -1) throw new I18nError(`invalid XLIFF: unterminated ${open}`)
    return end + close.length
  }
  return -1
}

/** Reads an XLIFF document, taking the target when it holds a translation. */
export function fromXliff(text: string): StringTable {
  const table: StringTable = {}
  let unitId: string | undefined
  let field: 'source' | 'target' | undefined
  let buffer = ''
  let source: string | undefined
  let target: string | undefined
  let index = 0

  while (index < text.length) {
    const next = text.indexOf('<', index)
    if (next === -1) break
    if (field !== undefined) buffer += decode(text.slice(index, next))
    const skipped = skipMarkup(text, next)
    if (skipped !== -1) {
      index = skipped
      continue
    }
    const tag = readTag(text, next)
    index = tag.end
    if (tag.name === 'trans-unit') {
      if (tag.closing || tag.selfClosing) {
        if (source !== undefined && unitId !== undefined) {
          table[unitId] = target !== undefined && target !== '' ? target : source
        }
        unitId = undefined
        source = undefined
        target = undefined
        continue
      }
      unitId = tag.attributes.id
      if (unitId === undefined) throw new I18nError('invalid XLIFF: trans-unit without an id')
      source = undefined
      target = undefined
      continue
    }
    if (tag.name !== 'source' && tag.name !== 'target') continue
    if (tag.selfClosing) {
      if (tag.name === 'source') source = ''
      else target = ''
      continue
    }
    if (tag.closing) {
      if (field === tag.name) {
        if (tag.name === 'source') source = buffer
        else target = buffer
      }
      field = undefined
      buffer = ''
      continue
    }
    field = tag.name
    buffer = ''
  }
  return table
}
