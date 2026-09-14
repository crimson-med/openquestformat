/**
 * `oqf convert <path> --to oqf|json|md [--out <file>]`
 *
 * Parse one file, serialize it in another form, write it to stdout or to a
 * file. Markdown is a one-way export: there is no Markdown parser.
 */
import { type OqfDocument, toCompact, toJson, toMarkdown } from '@oqf/core'
import { type Io, UsageError, loadDocument } from '../load.js'

export const CONVERT_HELP = `oqf convert <path> --to oqf|json|md [--out <file>]

Read one quest file and write it in another form. Markdown is export only.

  --to <form>   oqf for the compact line format, json, or md for Markdown
  --out <file>  Write to this file instead of stdout

  oqf convert quests/harbormasters-ledger.oqf --to json --out harbor.json
`

const TARGETS = ['oqf', 'json', 'md'] as const
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
      if (!isTarget(target))
        throw new UsageError(`unknown target: ${target}, expected oqf, json or md`)
      to = target
      index += 1
    } else if (arg === '--out') {
      out = value(argv, index + 1, '--out')
      index += 1
    } else if (arg.startsWith('-')) {
      throw new UsageError(`unknown option for convert: ${arg}`)
    } else if (path === undefined) {
      path = arg
    } else {
      throw new UsageError('convert takes a single path')
    }
  }

  if (path === undefined) throw new UsageError('convert needs a path')
  if (to === undefined) throw new UsageError('convert needs --to oqf, json or md')
  return out === undefined ? { path, to } : { path, to, out }
}

function serialize(document: OqfDocument, to: Target): string {
  if (to === 'oqf') return toCompact(document)
  if (to === 'json') return toJson(document)
  return toMarkdown(document)
}

export function convertCommand(argv: string[], io: Io): number {
  const options = parseArgs(argv)
  const { document } = loadDocument(options.path, io)
  const text = serialize(document, options.to)
  if (options.out === undefined) io.stdout(text)
  else io.writeFile(options.out, text)
  return 0
}
