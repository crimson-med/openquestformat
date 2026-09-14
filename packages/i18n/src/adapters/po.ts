/**
 * A minimal gettext PO table. The OQF key is the message context, the source
 * string is the message id, and the translation is the message string, which
 * is written empty because a freshly extracted table holds source text only.
 */
import { I18nError } from '../errors.js'
import type { StringTable } from '../extract.js'

export interface PoOptions {
  /** Writes the header entry that names the charset. Defaults to true. */
  header?: boolean
  /** Locale written into the header, such as `fr`. */
  language?: string
}

function escapePo(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\t', '\\t')
}

function unescapePo(value: string): string {
  let out = ''
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (char !== '\\') {
      out += char
      continue
    }
    index += 1
    const next = value[index]
    if (next === 'n') out += '\n'
    else if (next === 'r') out += '\r'
    else if (next === 't') out += '\t'
    else if (next === undefined) out += '\\'
    else out += next
  }
  return out
}

/** Writes a table as PO entries with empty translations. */
export function toPo(table: StringTable, options: PoOptions = {}): string {
  const entries: string[] = []
  if (options.header !== false) {
    const lines = ['msgid ""', 'msgstr ""', '"MIME-Version: 1.0\\n"']
    if (options.language !== undefined) lines.push(`"Language: ${escapePo(options.language)}\\n"`)
    lines.push('"Content-Type: text/plain; charset=UTF-8\\n"')
    lines.push('"Content-Transfer-Encoding: 8bit\\n"')
    entries.push(lines.join('\n'))
  }
  for (const [key, text] of Object.entries(table)) {
    entries.push(
      [`msgctxt "${escapePo(key)}"`, `msgid "${escapePo(text)}"`, 'msgstr ""'].join('\n'),
    )
  }
  return `${entries.join('\n\n')}\n`
}

/** The text inside a PO string literal, or undefined when the line is not one. */
function literal(line: string): string | undefined {
  if (!line.startsWith('"') || !line.endsWith('"') || line.length < 2) return undefined
  return line.slice(1, -1)
}

interface Entry {
  msgctxt?: string
  msgid?: string
  msgstr?: string
}

/** Reads a PO table, taking the translation when it is filled in and the source otherwise. */
export function fromPo(text: string): StringTable {
  const table: StringTable = {}
  let entry: Entry = {}
  let field: keyof Entry | undefined

  const flush = () => {
    const { msgctxt, msgid, msgstr } = entry
    entry = {}
    field = undefined
    if (msgid === undefined) return
    if (msgctxt === undefined && msgid === '') return
    const key = msgctxt ?? msgid
    table[key] = msgstr !== undefined && msgstr !== '' ? msgstr : msgid
  }

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '') {
      flush()
      continue
    }
    if (line.startsWith('#')) continue
    let matched = false
    for (const name of ['msgctxt', 'msgid', 'msgstr'] as const) {
      if (!line.startsWith(`${name} `)) continue
      const value = literal(line.slice(name.length + 1).trim())
      if (value === undefined) throw new I18nError(`invalid PO table: bad ${name} line: ${line}`)
      entry[name] = unescapePo(value)
      field = name
      matched = true
      break
    }
    if (matched) continue
    const continuation = literal(line)
    if (continuation === undefined || field === undefined) {
      throw new I18nError(`invalid PO table: unexpected line: ${line}`)
    }
    entry[field] = `${entry[field] ?? ''}${unescapePo(continuation)}`
  }
  flush()
  return table
}
