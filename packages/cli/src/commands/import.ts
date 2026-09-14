import { extname } from 'node:path'
/**
 * `oqf import <path.ink|path.yarn> --to oqd|json [--out <file>]`
 *
 * The other direction of `oqf convert --to ink|yarn`. Ink and Yarn Spinner say
 * more than the dialogue model can hold, so the importers report what they had
 * to drop. Every warning goes to stderr as `<file>:<line>: <construct>:
 * <message>` and the document is still written: the import is a starting point
 * to review, not a failure.
 */
import {
  type DialogueDocument,
  type ImportWarning,
  fromInk,
  fromYarn,
  toDialogueJson,
  toOqd,
} from '@oqf/dialogue'
import { type Io, UsageError } from '../load.js'

export const IMPORT_HELP = `oqf import <path.ink|path.yarn> --to oqd|json [--out <file>]

Read an Ink or Yarn Spinner file and write it as a dialogue document. What the
importer could not carry over is printed on stderr, one line per construct.

  --to <form>   oqd for the compact line format, or json
  --out <file>  Write to this file instead of stdout

  oqf import story.ink --to oqd --out story.oqd
`

const TARGETS = ['oqd', 'json'] as const
type Target = (typeof TARGETS)[number]

function isTarget(value: string): value is Target {
  return (TARGETS as readonly string[]).includes(value)
}

interface Options {
  path: string
  to: Target
  out?: string
}

function value(argv: string[], index: number, flag: string): string {
  const found = argv[index]
  if (found === undefined || found.startsWith('-')) {
    throw new UsageError(`${flag} needs a value`)
  }
  return found
}

function parseArgs(argv: string[]): Options {
  let path: string | undefined
  let to: Target | undefined
  let out: string | undefined

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--to') {
      const target = value(argv, index + 1, '--to')
      if (!isTarget(target)) throw new UsageError(`unknown target: ${target}, expected oqd or json`)
      to = target
      index += 1
    } else if (arg === '--out') {
      out = value(argv, index + 1, '--out')
      index += 1
    } else if (arg.startsWith('-')) {
      throw new UsageError(`unknown option for import: ${arg}`)
    } else if (path === undefined) {
      path = arg
    } else {
      throw new UsageError('import takes a single path')
    }
  }

  if (path === undefined) throw new UsageError('import needs a path')
  if (to === undefined) throw new UsageError('import needs --to oqd or json')
  return out === undefined ? { path, to } : { path, to, out }
}

/** The importer a file name asks for. There is no sniffing here: Ink and Yarn look alike. */
function importer(path: string): (source: string) => {
  document: DialogueDocument
  warnings: ImportWarning[]
} {
  const extension = extname(path).toLowerCase()
  if (extension === '.ink') return fromInk
  if (extension === '.yarn') return fromYarn
  throw new UsageError(`unsupported extension: ${path}, expected .ink or .yarn`)
}

export function importCommand(argv: string[], io: Io): number {
  const options = parseArgs(argv)
  const read = importer(options.path)
  const { document, warnings } = read(io.readFile(options.path))

  for (const warning of warnings) {
    io.stderr(`${options.path}:${warning.line}: ${warning.construct}: ${warning.message}\n`)
  }

  const text = options.to === 'oqd' ? toOqd(document) : toDialogueJson(document)
  if (options.out === undefined) io.stdout(text)
  else io.writeFile(options.out, text)
  return 0
}
