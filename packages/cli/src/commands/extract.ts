/**
 * `oqf extract <paths...> --out <table.json|.csv|.po|.xliff> [--write]`
 *
 * Pull every literal string out of a pack into one table. Quests and dialogue
 * share the table, because a key collision between the two is worth knowing
 * about and a translator wants one file, not two.
 *
 * Without `--write` the sources are left alone and only the table is written,
 * which is the safe way to look at what a pack would give up. With `--write`
 * every source file is rewritten in place with key references in it, each in
 * the form it was read in.
 */
import { extractAll } from '@oqf/i18n'
import { type Io, UsageError, loadAll, serializeLoaded } from '../load.js'
import { tableFormat, writeTable } from '../table.js'

export const EXTRACT_HELP = `oqf extract <paths...> --out <table> [--write]

Extract every literal string of a pack into one table. A path may be a file or
a directory of .oqf, .oqd and .json files. The table extension picks the form:
.json, .csv, .po or .xliff. Write it outside the pack directory, or the next
run reads it back in as a source.

  --out <table>  Where to write the table. Required
  --write        Also rewrite every source file in place with key references

  oqf extract packages/examples/quests --out strings.json
  oqf extract quests/harbormasters-ledger.oqf --out strings.po --write
`

interface Options {
  paths: string[]
  out: string
  write: boolean
}

function parseArgs(argv: string[]): Options {
  const paths: string[] = []
  let out: string | undefined
  let write = false

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--out') {
      const found = argv[index + 1]
      if (found === undefined || found.startsWith('-')) throw new UsageError('--out needs a value')
      out = found
      index += 1
    } else if (arg === '--write') {
      write = true
    } else if (arg.startsWith('-')) {
      throw new UsageError(`unknown option for extract: ${arg}`)
    } else {
      paths.push(arg)
    }
  }

  if (paths.length === 0) throw new UsageError('extract needs at least one path')
  if (out === undefined) throw new UsageError('extract needs --out <table>')
  return { paths, out, write }
}

export function extractCommand(argv: string[], io: Io): number {
  const options = parseArgs(argv)
  const format = tableFormat(options.out)
  const loaded = loadAll(options.paths, io)

  const questFiles = loaded.filter((file) => file.kind === 'quest')
  const dialogueFiles = loaded.filter((file) => file.kind === 'dialogue')
  const extracted = extractAll({
    quests: questFiles.map((file) => file.document),
    dialogues: dialogueFiles.map((file) => file.document),
  })

  io.writeFile(options.out, writeTable(extracted.table, format))
  if (!options.write) return 0

  questFiles.forEach((file, index) => {
    io.writeFile(file.path, serializeLoaded({ ...file, document: extracted.quests[index] }))
  })
  dialogueFiles.forEach((file, index) => {
    io.writeFile(file.path, serializeLoaded({ ...file, document: extracted.dialogues[index] }))
  })
  return 0
}
