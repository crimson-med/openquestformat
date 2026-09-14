/**
 * Opening and exporting files.
 *
 * The editor never guesses from the extension alone: a `.txt` holding a quest
 * still opens, because the magic line and the JSON envelope say what the text
 * is. Export goes the other way, from one document to any format that can
 * carry it.
 */
import { type OqfDocument, parseCompact, parseJson, toCompact, toJson, toMarkdown } from '@oqf/core'
import {
  type DialogueDocument,
  parseDialogueJson,
  parseOqd,
  toDialogueJson,
  toOqd,
} from '@oqf/dialogue'

export type QuestFormat = 'oqf' | 'json' | 'md'
export type DialogueFormat = 'oqd' | 'json'

/** What a piece of text turned out to be. */
export type FileKind = 'oqf' | 'oqf-json' | 'oqd' | 'oqd-json'

export interface OpenedFile {
  kind: FileKind
  quests?: OqfDocument
  dialogues?: DialogueDocument
}

function firstMeaningfulLine(text: string): string {
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    return trimmed
  }
  return ''
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
}

function jsonKind(text: string): FileKind | undefined {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  if (value === null || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  if ('oqd' in record || 'conversations' in record || 'speakers' in record) return 'oqd-json'
  if ('oqf' in record || 'quests' in record || 'dictionaries' in record) return 'oqf-json'
  return undefined
}

/**
 * The kind of a file, from its magic line first, then its JSON envelope, then
 * its extension. Undefined when nothing identifies it.
 */
export function detectFormat(name: string, text: string): FileKind | undefined {
  const magic = firstMeaningfulLine(text)
  if (magic.startsWith('OQF')) return 'oqf'
  if (magic.startsWith('OQD')) return 'oqd'
  if (magic.startsWith('{') || magic.startsWith('[')) {
    const kind = jsonKind(text)
    if (kind !== undefined) return kind
  }
  const extension = extensionOf(name)
  if (extension === 'oqf') return 'oqf'
  if (extension === 'oqd') return 'oqd'
  if (extension === 'json') return jsonKind(text)
  return undefined
}

/** Parse a file the editor was handed. Throws with a readable message. */
export function openFile(name: string, text: string): OpenedFile {
  const kind = detectFormat(name, text)
  if (kind === undefined) {
    throw new Error(`${name} is not an OQF file. Expected an OQF1 or OQD1 line, or OQF JSON.`)
  }
  switch (kind) {
    case 'oqf':
      return { kind, quests: parseCompact(text) }
    case 'oqf-json':
      return { kind, quests: parseJson(text) }
    case 'oqd':
      return { kind, dialogues: parseOqd(text) }
    case 'oqd-json':
      return { kind, dialogues: parseDialogueJson(text) }
    default: {
      const unreachable: never = kind
      throw new Error(`unknown file kind ${String(unreachable)}`)
    }
  }
}

export function serializeQuests(document: OqfDocument, format: QuestFormat): string {
  if (format === 'oqf') return toCompact(document)
  if (format === 'json') return toJson(document)
  return toMarkdown(document)
}

export function serializeDialogues(document: DialogueDocument, format: DialogueFormat): string {
  return format === 'oqd' ? toOqd(document) : toDialogueJson(document)
}

export const MIME_TYPES: Record<QuestFormat | DialogueFormat, string> = {
  oqf: 'text/plain;charset=utf-8',
  oqd: 'text/plain;charset=utf-8',
  json: 'application/json;charset=utf-8',
  md: 'text/markdown;charset=utf-8',
}

/** `harbormasters-ledger.oqf` from a base name and a format. */
export function downloadName(base: string, format: QuestFormat | DialogueFormat): string {
  const clean = base.trim() === '' ? 'quests' : base.trim().replace(/[^A-Za-z0-9._-]+/g, '-')
  return `${clean}.${format}`
}
