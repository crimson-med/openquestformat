/**
 * Localization for the editor, on top of `@oqf/i18n`.
 *
 * The documents hold either literals or `@key` references. This module lists
 * every player-facing text with a readable path, extracts literals into a
 * table and injects a table back, compares a pack against a language table,
 * and reads and writes tables in every format the package speaks. Language
 * tables are editor state rather than document state, so the blob that keeps
 * them in local storage is serialized and parsed here too, DOM free.
 */
import type { OqfDocument, Text } from '@oqf/core'
import type { DialogueDocument } from '@oqf/dialogue'
import {
  type Resolver,
  type StringTable,
  choiceTextKey,
  conversationTitleKey,
  createResolver,
  extractAll,
  fromCsv,
  fromJson,
  fromPo,
  fromXliff,
  injectAll,
  isKey,
  keyOf,
  nodeTextKey,
  outcomeTitleKey,
  questSummaryKey,
  questTitleKey,
  stepJournalKey,
  stepTitleKey,
  toCsv,
  toJson,
  toPo,
  toXliff,
} from '@oqf/i18n'

/** One table per language code. */
export type LanguageTables = Record<string, StringTable>

export interface PackDocuments {
  quests: OqfDocument
  dialogues: DialogueDocument
}

/** One player-facing text in the pack. */
export interface StringEntry {
  /** Where the text lives, such as `Step ledger / find_it: journal`. */
  path: string
  /** The key the field holds, or the one extraction would give it. */
  key: string
  /** What the field holds right now: a literal or a key reference. */
  text: Text
  /** True when the field holds a key reference rather than a literal. */
  isKey: boolean
}

function entry(path: string, generated: string, text: Text): StringEntry {
  const ref = isKey(text)
  return { path, key: ref ? keyOf(text) : generated, text, isKey: ref }
}

/** Every player-facing text in document order, quests first. */
export function listStrings(quests: OqfDocument, dialogues: DialogueDocument): StringEntry[] {
  const out: StringEntry[] = []
  for (const quest of quests.quests) {
    out.push(entry(`Quest ${quest.id}: title`, questTitleKey(quest.id), quest.title))
    if (quest.summary !== undefined) {
      out.push(entry(`Quest ${quest.id}: summary`, questSummaryKey(quest.id), quest.summary))
    }
    for (const step of quest.steps) {
      const at = `${quest.id} / ${step.id}`
      out.push(entry(`Step ${at}: title`, stepTitleKey(quest.id, step.id), step.title))
      if (step.journal !== undefined) {
        out.push(entry(`Step ${at}: journal`, stepJournalKey(quest.id, step.id), step.journal))
      }
      if (step.outcome?.title !== undefined) {
        out.push(
          entry(`Outcome ${at}: title`, outcomeTitleKey(quest.id, step.id), step.outcome.title),
        )
      }
    }
  }
  for (const conversation of dialogues.conversations) {
    if (conversation.title !== undefined) {
      out.push(
        entry(
          `Conversation ${conversation.id}: title`,
          conversationTitleKey(conversation.id),
          conversation.title,
        ),
      )
    }
    for (const node of conversation.nodes) {
      const at = `${conversation.id} / ${node.id}`
      out.push(entry(`Node ${at}: text`, nodeTextKey(conversation.id, node.id), node.text))
      for (const [index, choice] of (node.choices ?? []).entries()) {
        out.push(
          entry(
            `Choice ${at} / ${index}: text`,
            choiceTextKey(conversation.id, node.id, index),
            choice.text,
          ),
        )
      }
    }
  }
  return out
}

export interface ExtractedPack extends PackDocuments {
  /** The literals that were moved out, under their new keys. */
  table: StringTable
}

/** Turns every literal into a key reference. Throws `I18nError` on a key collision. */
export function extractStrings(docs: PackDocuments): ExtractedPack {
  const result = extractAll({ quests: [docs.quests], dialogues: [docs.dialogues] })
  return {
    quests: result.quests[0] ?? docs.quests,
    dialogues: result.dialogues[0] ?? docs.dialogues,
    table: result.table,
  }
}

/** Writes a table back over the key references. Keys the table lacks stay as they are. */
export function injectStrings(docs: PackDocuments, table: StringTable): PackDocuments {
  const result = injectAll({ quests: [docs.quests], dialogues: [docs.dialogues] }, table)
  return {
    quests: result.quests[0] ?? docs.quests,
    dialogues: result.dialogues[0] ?? docs.dialogues,
  }
}

/** The keys the pack references, without duplicates, in document order. */
export function packKeys(entries: StringEntry[]): string[] {
  const seen = new Set<string>()
  for (const item of entries) {
    if (item.isKey) seen.add(item.key)
  }
  return [...seen]
}

/** Keys the pack references that the table has no value for. */
export function missingKeys(entries: StringEntry[], table: StringTable): string[] {
  return packKeys(entries).filter((key) => table[key] === undefined)
}

/** Table keys that nothing in the pack references. */
export function orphanKeys(entries: StringEntry[], table: StringTable): string[] {
  const referenced = new Set(packKeys(entries))
  return Object.keys(table).filter((key) => !referenced.has(key))
}

/**
 * Resolves texts for display in `preview`, falling back to `source` and then to
 * the key reference itself. No preview means every text is shown as it is.
 */
export function previewResolver(
  tables: LanguageTables,
  preview: string | undefined,
  source?: string,
): Resolver {
  if (preview === undefined) return (text) => text
  return createResolver(tables, { locale: preview, fallback: source })
}

/** The four table formats, by their file extension. */
export type TableFormat = 'json' | 'csv' | 'po' | 'xliff'

export const TABLE_FORMATS: TableFormat[] = ['json', 'csv', 'po', 'xliff']

export const TABLE_MIME_TYPES: Record<TableFormat, string> = {
  json: 'application/json;charset=utf-8',
  csv: 'text/csv;charset=utf-8',
  po: 'text/plain;charset=utf-8',
  xliff: 'application/xliff+xml;charset=utf-8',
}

/** The format a table file name implies. `.xlf` counts as XLIFF. */
export function tableFormatOf(name: string): TableFormat | undefined {
  const dot = name.lastIndexOf('.')
  const extension = dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
  if (extension === 'xlf') return 'xliff'
  return TABLE_FORMATS.includes(extension as TableFormat) ? (extension as TableFormat) : undefined
}

export interface TableOptions {
  /** The language the table is in, written into PO and XLIFF headers. */
  language?: string
}

export function serializeTable(
  table: StringTable,
  format: TableFormat,
  options: TableOptions = {},
): string {
  switch (format) {
    case 'json':
      return toJson(table)
    case 'csv':
      return toCsv(table)
    case 'po':
      return toPo(table, { language: options.language })
    case 'xliff':
      return toXliff(table, { sourceLanguage: options.language })
    default: {
      const unreachable: never = format
      throw new Error(`unknown table format ${String(unreachable)}`)
    }
  }
}

/** Parses a table. Throws `I18nError` with a readable message on bad input. */
export function parseTable(text: string, format: TableFormat): StringTable {
  switch (format) {
    case 'json':
      return fromJson(text)
    case 'csv':
      return fromCsv(text)
    case 'po':
      return fromPo(text)
    case 'xliff':
      return fromXliff(text)
    default: {
      const unreachable: never = format
      throw new Error(`unknown table format ${String(unreachable)}`)
    }
  }
}

/** `harbormasters-ledger.fr.csv` from a base name, a language and a format. */
export function tableDownloadName(base: string, language: string, format: TableFormat): string {
  const clean = base.trim() === '' ? 'strings' : base.trim().replace(/[^A-Za-z0-9._-]+/g, '-')
  return `${clean}.${language}.${format}`
}

/** A BCP 47 style code: `fr`, `pt-BR`, `zh-Hant`. */
export function isLanguageCode(code: string): boolean {
  return /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(code)
}

/** What the editor keeps about localization between sessions. */
export interface StringsState {
  tables: LanguageTables
  preview: string | undefined
}

export const STRINGS_KEY = 'oqf-editor.strings.v1'

export function serializeStrings(state: StringsState): string {
  return JSON.stringify({ version: 1, tables: state.tables, preview: state.preview })
}

function isTable(value: unknown): value is StringTable {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value as Record<string, unknown>).every((item) => typeof item === 'string')
}

/** Parses a saved blob. Anything unrecognizable reads as no save at all. */
export function restoreStrings(text: string | null): StringsState | undefined {
  if (text === null || text === '') return undefined
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  if (value === null || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  if (record.tables === null || typeof record.tables !== 'object') return undefined
  const tables: LanguageTables = {}
  for (const [language, table] of Object.entries(record.tables as Record<string, unknown>)) {
    if (isTable(table)) tables[language] = table
  }
  const preview = typeof record.preview === 'string' ? record.preview : undefined
  return { tables, preview: preview !== undefined && preview in tables ? preview : undefined }
}
