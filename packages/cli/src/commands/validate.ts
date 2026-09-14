/**
 * `oqf validate <paths...> [--strict] [--json]`
 *
 * Every path is read into one pack and validated together, because ids are
 * unique across a pack and conditions reach across it. A file that fails to
 * parse contributes a `parse-error` finding and is left out of the pack, so a
 * broken file never hides the findings of its neighbours.
 */
import { CompactFormatError, JsonFormatError, type OqfDocument, validatePack } from '@oqf/core'
import { type FileFinding, formatReport, sortFindings } from '../format.js'
import { type Io, UsageError, expandPaths, loadDocument } from '../load.js'

export const VALIDATE_HELP = `oqf validate <paths...> [--strict] [--json]

Parse every path into one pack and report what the validator finds. A path may
be a file or a directory of .oqf and .json files.

  --strict   Turn on the advisory checks and treat no-ending-reachable as an error
  --json     Print { findings, ok } as JSON instead of one line per finding

Exits 1 when there is at least one error, 0 otherwise.

  oqf validate packages/examples/quests/harbormasters-ledger.oqf
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

/** The line or path a core parse error points at, so the finding stays actionable. */
function errorPath(error: unknown): string | undefined {
  if (error instanceof CompactFormatError) return `line ${error.line}`
  if (error instanceof JsonFormatError && error.path !== '') return error.path
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

export function validateCommand(argv: string[], io: Io): number {
  const options = parseArgs(argv)
  const files = expandPaths(options.paths, io)

  const findings: FileFinding[] = []
  const documents: OqfDocument[] = []
  // Which file declared a quest, so a finding can name the file it belongs to.
  const owners = new Map<string, string>()

  for (const file of files) {
    try {
      const loaded = loadDocument(file, io)
      documents.push(loaded.document)
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
  for (const finding of validatePack(documents, { strict: options.strict }).findings) {
    const owner = finding.quest === undefined ? undefined : owners.get(finding.quest)
    findings.push({ ...finding, file: owner ?? fallback })
  }

  const sorted = sortFindings(findings)
  const ok = !sorted.some((finding) => finding.level === 'error')
  if (options.json) io.stdout(`${JSON.stringify({ findings: sorted, ok }, null, 2)}\n`)
  else io.stdout(formatReport(sorted))
  return ok ? 0 : 1
}
