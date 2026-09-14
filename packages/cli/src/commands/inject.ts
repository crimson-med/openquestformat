/**
 * `oqf inject <paths...> --table <file> [--missing keep|throw|empty]`
 *
 * The inverse of `oqf extract --write`: read a translated table and write its
 * values back into the sources, each in the form it was read in. Injection
 * always rewrites in place, because a pack with key references in it is not
 * something anyone wants two copies of.
 */
import { injectAll } from '@oqf/i18n'
import { type Io, UsageError, loadAll, serializeLoaded } from '../load.js'
import { readTable, tableFormat } from '../table.js'

export const INJECT_HELP = `oqf inject <paths...> --table <file> [--missing keep|throw|empty]

Write the values of a string table back into a pack, in place. A path may be a
file or a directory of .oqf, .oqd and .json files. The table extension picks
the form: .json, .csv, .po or .xliff.

  --table <file>       The table to read. Required
  --missing <strategy> What to do with a key the table has no value for:
                       keep the reference (default), throw, or write an empty string

  oqf inject packages/examples/quests --table strings.fr.json
`

const STRATEGIES = ['keep', 'throw', 'empty'] as const
type Strategy = (typeof STRATEGIES)[number]

function isStrategy(value: string): value is Strategy {
  return (STRATEGIES as readonly string[]).includes(value)
}

interface Options {
  paths: string[]
  table: string
  missing: Strategy
}

function value(argv: string[], index: number, flag: string): string {
  const found = argv[index]
  if (found === undefined || found.startsWith('-')) {
    throw new UsageError(`${flag} needs a value`)
  }
  return found
}

function parseArgs(argv: string[]): Options {
  const paths: string[] = []
  let table: string | undefined
  let missing: Strategy = 'keep'

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--table') {
      table = value(argv, index + 1, '--table')
      index += 1
    } else if (arg === '--missing') {
      const strategy = value(argv, index + 1, '--missing')
      if (!isStrategy(strategy)) {
        throw new UsageError(`unknown missing strategy: ${strategy}, expected keep, throw or empty`)
      }
      missing = strategy
      index += 1
    } else if (arg.startsWith('-')) {
      throw new UsageError(`unknown option for inject: ${arg}`)
    } else {
      paths.push(arg)
    }
  }

  if (paths.length === 0) throw new UsageError('inject needs at least one path')
  if (table === undefined) throw new UsageError('inject needs --table <file>')
  return { paths, table, missing }
}

export function injectCommand(argv: string[], io: Io): number {
  const options = parseArgs(argv)
  const format = tableFormat(options.table)
  const table = readTable(io.readFile(options.table), format)
  const loaded = loadAll(options.paths, io)

  const questFiles = loaded.filter((file) => file.kind === 'quest')
  const dialogueFiles = loaded.filter((file) => file.kind === 'dialogue')
  const injected = injectAll(
    {
      quests: questFiles.map((file) => file.document),
      dialogues: dialogueFiles.map((file) => file.document),
    },
    table,
    { missing: options.missing },
  )

  questFiles.forEach((file, index) => {
    io.writeFile(file.path, serializeLoaded({ ...file, document: injected.quests[index] }))
  })
  dialogueFiles.forEach((file, index) => {
    io.writeFile(file.path, serializeLoaded({ ...file, document: injected.dialogues[index] }))
  })
  return 0
}
