import { extname, join } from 'node:path'
/**
 * Path expansion, format detection and parsing for every command.
 *
 * A path is either a file or a directory. A directory contributes every `.oqf`
 * and `.json` file directly inside it, sorted by name. It is never walked
 * deeper: a pack is one directory, not a tree.
 */
import { type OqfDocument, parseCompact, parseJson } from '@oqf/core'

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

/** The two file forms of OQF. `oqf` is the compact line format, `json` the JSON one. */
export type Format = 'oqf' | 'json'

export interface LoadedDocument {
  path: string
  format: Format
  document: OqfDocument
}

/** The format a file name claims. Undefined for anything the CLI does not read. */
export function detectFormat(path: string): Format | undefined {
  const extension = extname(path).toLowerCase()
  if (extension === '.oqf') return 'oqf'
  if (extension === '.json') return 'json'
  return undefined
}

function requireFormat(path: string): Format {
  const format = detectFormat(path)
  if (format === undefined) {
    throw new UsageError(`unsupported extension: ${path}, expected .oqf or .json`)
  }
  return format
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
export function loadDocument(path: string, io: Io): LoadedDocument {
  const format = requireFormat(path)
  const text = io.readFile(path)
  return { path, format, document: format === 'oqf' ? parseCompact(text) : parseJson(text) }
}
