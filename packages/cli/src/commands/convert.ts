/**
 * `oqf convert <path> --to oqf|json|md|oqd|ink|yarn [--out <file>]`
 *
 * Parse one file, serialize it in another form, write it to stdout or to a
 * file. Quests go to oqf, json or md, dialogue to oqd, json, ink or yarn.
 * Markdown, Ink and Yarn Spinner are one way here: reading Ink and Yarn back
 * is what `oqf import` is for, and there is no Markdown parser at all.
 */
import { type OqfDocument, toCompact, toJson, toMarkdown } from '@oqf/core'
import { type DialogueDocument, toDialogueJson, toInk, toOqd, toYarn } from '@oqf/dialogue'
import { type Io, UsageError, loadDocument } from '../load.js'

export const CONVERT_HELP = `oqf convert <path> --to oqf|json|md|oqd|ink|yarn [--out <file>]

Read one file and write it in another form. The targets a file accepts follow
from what it holds.

  Quests     oqf for the compact line format, json, or md for Markdown
  Dialogue   oqd for the compact line format, json, ink, or yarn

  --to <form>   The form to write
  --out <file>  Write to this file instead of stdout

  oqf convert quests/harbormasters-ledger.oqf --to json --out harbor.json
  oqf convert quests/harbormasters-ledger.oqd --to ink --out harbor.ink
`

const TARGETS = ['oqf', 'json', 'md', 'oqd', 'ink', 'yarn'] as const
type Target = (typeof TARGETS)[number]

const QUEST_TARGETS: readonly Target[] = ['oqf', 'json', 'md']
const DIALOGUE_TARGETS: readonly Target[] = ['oqd', 'json', 'ink', 'yarn']

/** `a, b or c`, the way every usage message in the CLI lists its choices. */
function list(values: readonly string[]): string {
  if (values.length < 2) return values.join('')
  return `${values.slice(0, -1).join(', ')} or ${values[values.length - 1]}`
}

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
        throw new UsageError(`unknown target: ${target}, expected ${list(TARGETS)}`)
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
  if (to === undefined) throw new UsageError(`convert needs --to ${list(TARGETS)}`)
  return out === undefined ? { path, to } : { path, to, out }
}

function serializeQuest(document: OqfDocument, to: Target): string {
  if (to === 'oqf') return toCompact(document)
  if (to === 'json') return toJson(document)
  return toMarkdown(document)
}

function serializeDialogue(document: DialogueDocument, to: Target): string {
  if (to === 'oqd') return toOqd(document)
  if (to === 'json') return toDialogueJson(document)
  return to === 'ink' ? toInk(document) : toYarn(document)
}

export function convertCommand(argv: string[], io: Io): number {
  const options = parseArgs(argv)
  const loaded = loadDocument(options.path, io)
  const allowed = loaded.kind === 'quest' ? QUEST_TARGETS : DIALOGUE_TARGETS
  if (!allowed.includes(options.to)) {
    throw new UsageError(
      `cannot convert ${loaded.kind === 'quest' ? 'quests' : 'dialogue'} to ${options.to}, expected ${list(allowed)}`,
    )
  }
  const text =
    loaded.kind === 'quest'
      ? serializeQuest(loaded.document, options.to)
      : serializeDialogue(loaded.document, options.to)
  if (options.out === undefined) io.stdout(text)
  else io.writeFile(options.out, text)
  return 0
}
