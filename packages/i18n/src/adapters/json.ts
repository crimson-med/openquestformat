/** The default table format: a flat JSON object of key to string. */
import { I18nError } from '../errors.js'
import type { StringTable } from '../extract.js'

export interface JsonTableOptions {
  /** Spaces per level. Defaults to 2. */
  indent?: number
}

/** Writes a table as a pretty JSON object with a trailing newline. */
export function toJson(table: StringTable, options: JsonTableOptions = {}): string {
  return `${JSON.stringify(table, null, options.indent ?? 2)}\n`
}

/** Reads a flat JSON object of key to string. */
export function fromJson(text: string): StringTable {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new I18nError(`invalid JSON table: ${(error as Error).message}`)
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new I18nError('invalid JSON table: expected an object of key to string')
  }
  const table: StringTable = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string') {
      throw new I18nError(`invalid JSON table: value of ${key} is not a string`, key)
    }
    table[key] = entry
  }
  return table
}
