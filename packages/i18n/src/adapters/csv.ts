/**
 * A two column CSV table, `key,text`, quoted the RFC 4180 way: a field that
 * holds a delimiter, a quote or a line break is wrapped in double quotes, and
 * a quote inside a quoted field is doubled.
 */
import { I18nError } from '../errors.js'
import type { StringTable } from '../extract.js'

export interface CsvOptions {
  /** Line ending written between records. Defaults to `\n`. Both are read. */
  eol?: '\n' | '\r\n'
}

const HEADER = ['key', 'text']

function quote(field: string): string {
  if (!/["\r\n,]/.test(field)) return field
  return `"${field.replaceAll('"', '""')}"`
}

/** Writes a table as CSV with a `key,text` header row. */
export function toCsv(table: StringTable, options: CsvOptions = {}): string {
  const eol = options.eol ?? '\n'
  const rows = [HEADER.join(',')]
  for (const [key, text] of Object.entries(table)) {
    rows.push(`${quote(key)},${quote(text)}`)
  }
  return `${rows.join(eol)}${eol}`
}

/** Splits CSV text into records of fields, honouring quotes and embedded breaks. */
function parseRecords(text: string): string[][] {
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let quoted = false
  let started = false
  const push = () => {
    record.push(field)
    field = ''
    started = false
  }
  const endRecord = () => {
    push()
    records.push(record)
    record = []
  }
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          quoted = false
        }
      } else {
        field += char
      }
      continue
    }
    if (char === '"' && !started) {
      quoted = true
      started = true
      continue
    }
    if (char === ',') {
      push()
      continue
    }
    if (char === '\r' && text[index + 1] === '\n') {
      index += 1
      endRecord()
      continue
    }
    if (char === '\n' || char === '\r') {
      endRecord()
      continue
    }
    field += char
    started = true
  }
  if (quoted) throw new I18nError('invalid CSV table: unterminated quoted field')
  if (field !== '' || record.length > 0) endRecord()
  return records
}

/** Reads a two column CSV table. The first record is the header and is dropped. */
export function fromCsv(text: string): StringTable {
  const records = parseRecords(text)
  const table: StringTable = {}
  for (const [index, record] of records.entries()) {
    if (index === 0) continue
    if (record.length === 1 && record[0] === '') continue
    if (record.length !== 2) {
      throw new I18nError(`invalid CSV table: row ${index + 1} has ${record.length} fields`)
    }
    table[record[0] as string] = record[1] as string
  }
  return table
}
