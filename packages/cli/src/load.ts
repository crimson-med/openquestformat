import { extname, join } from 'node:path'
/**
 * Path expansion, format detection and parsing for every command.
 *
 * A path is either a file or a directory. A directory contributes every `.oqf`,
 * `.oqd` and `.json` file directly inside it, sorted by name. It is never
 * walked deeper: a pack is one directory, not a tree.
 *
 * A file holds either quests or dialogue. The extension says which for `.oqf`
 * and `.oqd`. A `.json` file is sniffed by its top level key, `oqf` or `oqd`,
 * so both forms can live in one directory under the same extension.
 */
import { type OqfDocument, parseCompact, parseJson, toCompact, toJson } from '@oqf/core'
import {
  type DialogueDocument,
  parseDialogueJson,
  parseOqd,
  toDialogueJson,
  toOqd,
} from '@oqf/dialogue'

/** Everything the CLI is allowed to touch outside its own process. */
export interface Io {
  stdout: (text: string) => void
  stderr: (text: string) => void
  readFile: (path: string) => string
  writeFile: (path: string, text: string) => void
  readDir: (path: string) => string[]
  stat: (path: string) => { isDirectory: boolean }
}

/** An unknown command, a bad flag or a path that is not there. Exit code 2. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UsageError'
  }
}

/**
 * The file forms the CLI reads. `oqf` is the compact quest format, `oqd` the
 * compact dialogue format, `json` the JSON form of either.
 */
export type Format = 'oqf' | 'json' | 'oqd'

/** What a file holds. */
export type Kind = 'quest' | 'dialogue'

export interface LoadedQuest {
  path: string
  format: 'oqf' | 'json'
  kind: 'quest'
  document: OqfDocument
}

export interface LoadedDialogue {
  path: string
  format: 'oqd' | 'json'
  kind: 'dialogue'
  document: DialogueDocument
}

/** One parsed file, tagged with the form it was read in so it can be written back. */
export type Loaded = LoadedQuest | LoadedDialogue

/** The format a file name claims. Undefined for anything the CLI does not read. */
export function detectFormat(path: string): Format | undefined {
  const extension = extname(path).toLowerCase()
  if (extension === '.oqf') return 'oqf'
  if (extension === '.oqd') return 'oqd'
  if (extension === '.json') return 'json'
  return undefined
}

function requireFormat(path: string): Format {
  const format = detectFormat(path)
  if (format === undefined) {
    throw new UsageError(`unsupported extension: ${path}, expected .oqf, .oqd or .json`)
  }
  return format
}

/**
 * What a JSON file holds, read from its top level key. Anything that is not an
 * object with an `oqd` key goes to the quest parser, so a malformed file is
 * reported by core rather than by a sniffer with less to say.
 */
export function detectJsonKind(text: string): Kind {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return 'quest'
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'quest'
  return 'oqd' in value ? 'dialogue' : 'quest'
}

/**
 * Turn the paths given on the command line into a list of files to read.
 * Order follows the command line, with each directory's own files sorted.
 */
export function expandPaths(paths: string[], io: Io): string[] {
  const files: string[] = []
  for (const path of paths) {
    let directory: boolean
    try {
      directory = io.stat(path).isDirectory
    } catch {
      throw new UsageError(`no such file or directory: ${path}`)
    }
    if (!directory) {
      requireFormat(path)
      files.push(path)
      continue
    }
    const entries = io
      .readDir(path)
      .filter((entry) => detectFormat(entry) !== undefined)
      .sort()
    for (const entry of entries) files.push(join(path, entry))
  }
  return files
}

/**
 * Read and parse one file. Parse failures are thrown as they come out of core,
 * so the caller decides whether they become a finding or a message on stderr.
 */
export function loadDocument(path: string, io: Io): Loaded {
  const format = requireFormat(path)
  const text = io.readFile(path)
  if (format === 'oqf') return { path, format, kind: 'quest', document: parseCompact(text) }
  if (format === 'oqd') return { path, format, kind: 'dialogue', document: parseOqd(text) }
  return detectJsonKind(text) === 'dialogue'
    ? { path, format, kind: 'dialogue', document: parseDialogueJson(text) }
    : { path, format, kind: 'quest', document: parseJson(text) }
}

/**
 * Expand and parse every path at once, for the commands that work on a whole
 * pack. A parse failure stops the command, because rewriting half a pack is
 * worse than rewriting none of it.
 */
export function loadAll(paths: string[], io: Io): Loaded[] {
  return expandPaths(paths, io).map((file) => loadDocument(file, io))
}

/** Read a file a quest only command was pointed at. Dialogue is a usage error. */
export function loadQuest(path: string, io: Io): LoadedQuest {
  const loaded = loadDocument(path, io)
  if (loaded.kind === 'dialogue') {
    throw new UsageError(`${path} holds dialogue, expected quests`)
  }
  return loaded
}

/** Write a document back in the form its file was read in. */
export function serializeLoaded(loaded: Loaded): string {
  if (loaded.kind === 'quest') {
    return loaded.format === 'oqf' ? toCompact(loaded.document) : toJson(loaded.document)
  }
  return loaded.format === 'oqd' ? toOqd(loaded.document) : toDialogueJson(loaded.document)
}

/**
 * A stable string for a parsed document, with object keys sorted, so the same
 * document read from a compact file and from its JSON twin compares equal
 * whatever order the two parsers happen to build their objects in.
 */
export function documentKey(document: OqfDocument | DialogueDocument): string {
  return canonical(document)
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : 1))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}
