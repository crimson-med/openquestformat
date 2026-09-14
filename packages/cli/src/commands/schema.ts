/** `oqf schema`: print the published JSON Schema for the JSON form. */
import { schemaJson } from '@oqf/core'
import { type Io, UsageError } from '../load.js'

export const SCHEMA_HELP = `oqf schema

Print the JSON Schema for the JSON form of OQF on stdout.

  oqf schema > oqf.schema.json
`

export function schemaCommand(argv: string[], io: Io): number {
  if (argv.length > 0) throw new UsageError(`schema takes no arguments, got ${argv[0]}`)
  io.stdout(`${schemaJson()}\n`)
  return 0
}
