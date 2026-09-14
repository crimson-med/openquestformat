/**
 * `oqf validate <paths...> [--strict] [--json]`
 *
 * Every path is read into one pack and validated together, because ids are
 * unique across a pack and conditions reach across it. Quests go to the core
 * validator, dialogue to the dialogue validator with the quests alongside, and
 * the two sets of findings are merged into one report. A file that fails to
 * parse contributes a `parse-error` finding and is left out of the pack, so a
 * broken file never hides the findings of its neighbours.
 *
 * The same document given twice, once compact and once as JSON, is read once.
 * A directory that holds both forms of a pack is a common layout, and the two
 * copies are not two quests with colliding ids.
 */
import {
  CompactFormatError,
  type Finding,
  JsonFormatError,
  type OqfDocument,
  validatePack,
} from '@oqf/core'
import {
  type DialogueDocument,
  DialogueJsonError,
  OqdFormatError,
  validateDialogue,
} from '@oqf/dialogue'
import { type FileFinding, formatReport, sortFindings } from '../format.js'
import { type Io, UsageError, documentKey, expandPaths, loadDocument } from '../load.js'

export const VALIDATE_HELP = `oqf validate <paths...> [--strict] [--json]

Parse every path into one pack and report what the validator finds. A path may
be a file or a directory of .oqf, .oqd and .json files. Quests and dialogue are
validated together, so a step that binds a conversation is checked against it.

  --strict   Turn on the advisory checks and treat no-ending-reachable as an error
  --json     Print { findings, ok } as JSON instead of one line per finding

The same document given twice, once compact and once as JSON, is read once.

Exits 1 when there is at least one error, 0 otherwise.

  oqf validate packages/examples/quests
`

interface Options {
  strict: boolean
  json: boolean
  paths: string[]
}

function parseArgs(argv: string[]): Options {
  const options: Options = { strict: false, json: false, paths: [] }
  for (const arg of argv) {
    if (arg === '--strict') options.strict = true
    else if (arg === '--json') options.json = true
    else if (arg.startsWith('-')) throw new UsageError(`unknown option for validate: ${arg}`)
    else options.paths.push(arg)
  }
  if (options.paths.length === 0) throw new UsageError('validate needs at least one path')
  return options
}

/** The line or path a parse error points at, so the finding stays actionable. */
function errorPath(error: unknown): string | undefined {
  if (error instanceof CompactFormatError) return `line ${error.line}`
  if (error instanceof OqdFormatError) return `line ${error.line}`
  if (error instanceof JsonFormatError && error.path !== '') return error.path
  if (error instanceof DialogueJsonError && error.path !== '') return error.path
  return undefined
}

function parseErrorFinding(file: string, error: unknown): FileFinding {
  const finding: FileFinding = {
    file,
    level: 'error',
    code: 'parse-error',
    message: error instanceof Error ? error.message : String(error),
  }
  const path = errorPath(error)
  if (path !== undefined) finding.path = path
  return finding
}

/**
 * Both validators prefix a finding path with `documents[<index>]` when they are
 * given more than one document, which is the only handle the CLI has on the
 * file a path-only finding belongs to.
 */
const DOCUMENT_PREFIX = /^documents\[(\d+)\]\./

function fileOfPath(finding: Finding, files: string[]): string | undefined {
  if (files.length === 1) return files[0]
  const match = DOCUMENT_PREFIX.exec(finding.path ?? '')
  return match === null ? undefined : files[Number(match[1])]
}

export function validateCommand(argv: string[], io: Io): number {
  const options = parseArgs(argv)
  const files = expandPaths(options.paths, io)

  const findings: FileFinding[] = []
  const quests: OqfDocument[] = []
  const dialogues: DialogueDocument[] = []
  const questFiles: string[] = []
  const dialogueFiles: string[] = []
  // Which file declared a quest, so a finding can name the file it belongs to.
  const owners = new Map<string, string>()
  const seen = new Set<string>()

  for (const file of files) {
    try {
      const loaded = loadDocument(file, io)
      const key = `${loaded.kind}:${documentKey(loaded.document)}`
      if (seen.has(key)) continue
      seen.add(key)
      if (loaded.kind === 'dialogue') {
        dialogues.push(loaded.document)
        dialogueFiles.push(file)
        continue
      }
      quests.push(loaded.document)
      questFiles.push(file)
      for (const quest of loaded.document.quests) {
        if (!owners.has(quest.id)) owners.set(quest.id, file)
      }
    } catch (error) {
      if (error instanceof UsageError) throw error
      findings.push(parseErrorFinding(file, error))
    }
  }

  // A pack-wide finding carries no quest id, so it is reported against the
  // first file of the pack.
  const fallback = files.length > 0 ? files[0] : ''
  for (const finding of validatePack(quests, { strict: options.strict }).findings) {
    const owner = finding.quest === undefined ? undefined : owners.get(finding.quest)
    findings.push({ ...finding, file: owner ?? fileOfPath(finding, questFiles) ?? fallback })
  }

  // Quests are only cross checked against dialogue when the pack holds some.
  // Validating one quest file on its own must not claim that every conversation
  // it binds is missing, when what is missing is the .oqd next to it.
  if (dialogues.length > 0) {
    const dialogueResult = validateDialogue(dialogues, { strict: options.strict, quests })
    for (const finding of dialogueResult.findings) {
      // A binding finding belongs to the quest that spells the binding out.
      const owner = finding.quest === undefined ? undefined : owners.get(finding.quest)
      findings.push({
        ...finding,
        file: owner ?? fileOfPath(finding, dialogueFiles) ?? dialogueFiles[0] ?? fallback,
      })
    }
  }

  const sorted = sortFindings(findings)
  const ok = !sorted.some((finding) => finding.level === 'error')
  if (options.json) io.stdout(`${JSON.stringify({ findings: sorted, ok }, null, 2)}\n`)
  else io.stdout(formatReport(sorted))
  return ok ? 0 : 1
}
