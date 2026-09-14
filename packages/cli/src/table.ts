import { extname } from 'node:path'
/**
 * The string table file, shared by `oqf extract` and `oqf inject`.
 *
 * The extension picks the adapter, so a translator gets the format their tools
 * already read and the CLI never needs a `--format` flag.
 */
import {
  type StringTable,
  fromCsv,
  fromJson,
  fromPo,
  fromXliff,
  toCsv,
  toJson,
  toPo,
  toXliff,
} from '@oqf/i18n'
import { UsageError } from './load.js'

export type { StringTable } from '@oqf/i18n'

/** The table forms the CLI reads and writes. */
export type TableFormat = 'json' | 'csv' | 'po' | 'xliff'

const BY_EXTENSION = new Map<string, TableFormat>([
  ['.json', 'json'],
  ['.csv', 'csv'],
  ['.po', 'po'],
  ['.xliff', 'xliff'],
])

/** The table format a file name claims, or a usage error naming the four. */
export function tableFormat(path: string): TableFormat {
  const format = BY_EXTENSION.get(extname(path).toLowerCase())
  if (format === undefined) {
    throw new UsageError(
      `unsupported table extension: ${path}, expected .json, .csv, .po or .xliff`,
    )
  }
  return format
}

export function writeTable(table: StringTable, format: TableFormat): string {
  if (format === 'json') return toJson(table)
  if (format === 'csv') return toCsv(table)
  if (format === 'po') return toPo(table)
  return toXliff(table)
}

export function readTable(text: string, format: TableFormat): StringTable {
  if (format === 'json') return fromJson(text)
  if (format === 'csv') return fromCsv(text)
  if (format === 'po') return fromPo(text)
  return fromXliff(text)
}
