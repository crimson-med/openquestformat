/**
 * Argument parsing and dispatch. Everything the CLI does to the outside world
 * goes through the injected `io`, so the whole surface is testable without
 * touching `process` or the real filesystem.
 */
import { fileURLToPath } from 'node:url'
import { CONVERT_HELP, convertCommand } from './commands/convert.js'
import { EXTRACT_HELP, extractCommand } from './commands/extract.js'
import { GRAPH_HELP, graphCommand } from './commands/graph.js'
import { IMPORT_HELP, importCommand } from './commands/import.js'
import { INJECT_HELP, injectCommand } from './commands/inject.js'
import { SCHEMA_HELP, schemaCommand } from './commands/schema.js'
import { VALIDATE_HELP, validateCommand } from './commands/validate.js'
import { type Io, UsageError } from './load.js'

export type { Io } from './load.js'

const USAGE = `oqf <command> [options]

Commands:
  validate <paths...>   Parse a pack and report what the validator finds
  convert <path>        Convert quests and dialogue between their forms
  import <path>         Read an Ink or Yarn Spinner file as dialogue
  graph <path>          Print a mermaid flowchart of the step graph
  extract <paths...>    Pull every literal string of a pack into a table
  inject <paths...>     Write a translated table back into a pack
  schema                Print the OQF or dialogue JSON Schema

Options:
  --help                Print this text
  --version             Print the version

Run "oqf <command> --help" for the options of one command.
`

type Command = (argv: string[], io: Io) => number

const COMMANDS = new Map<string, { run: Command; help: string }>([
  ['validate', { run: validateCommand, help: VALIDATE_HELP }],
  ['convert', { run: convertCommand, help: CONVERT_HELP }],
  ['import', { run: importCommand, help: IMPORT_HELP }],
  ['graph', { run: graphCommand, help: GRAPH_HELP }],
  ['extract', { run: extractCommand, help: EXTRACT_HELP }],
  ['inject', { run: injectCommand, help: INJECT_HELP }],
  ['schema', { run: schemaCommand, help: SCHEMA_HELP }],
])

const HELP_FLAGS = ['--help', '-h']

/** The version of this package, read from its own package.json at run time. */
function version(io: Io): string {
  const path = fileURLToPath(new URL('../package.json', import.meta.url))
  const manifest = JSON.parse(io.readFile(path)) as { version?: string }
  return manifest.version ?? '0.0.0'
}

function execute(argv: string[], io: Io): number {
  const command = argv[0]
  const rest = argv.slice(1)

  if (command === undefined) throw new UsageError('no command given')
  if (HELP_FLAGS.includes(command) || command === 'help') {
    io.stdout(USAGE)
    return 0
  }
  if (command === '--version' || command === '-v') {
    io.stdout(`${version(io)}\n`)
    return 0
  }

  const entry = COMMANDS.get(command)
  if (entry === undefined) throw new UsageError(`unknown command: ${command}`)
  if (rest.some((arg) => HELP_FLAGS.includes(arg))) {
    io.stdout(entry.help)
    return 0
  }
  return entry.run(rest, io)
}

/**
 * Run the CLI. Returns the exit code: 0 on success, 1 when validation found an
 * error or a file could not be used, 2 for an unknown command or a bad flag.
 */
export async function run(argv: string[], io: Io): Promise<number> {
  try {
    return execute(argv, io)
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(`oqf: ${error.message}\n\n${USAGE}`)
      return 2
    }
    io.stderr(`oqf: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}
