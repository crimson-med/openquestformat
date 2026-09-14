/** `oqf schema [--dialogue]`: print the published JSON Schema for a JSON form. */
import { schemaJson } from '@oqf/core'
import { dialogueSchemaJson } from '@oqf/dialogue'
import { type Io, UsageError } from '../load.js'

export const SCHEMA_HELP = `oqf schema [--dialogue]

Print the JSON Schema for the JSON form of OQF on stdout.

  --dialogue  Print the schema for the dialogue form (.oqd JSON) instead

  oqf schema > oqf.schema.json
  oqf schema --dialogue > oqd.schema.json
`

export function schemaCommand(argv: string[], io: Io): number {
  let dialogue = false
  for (const arg of argv) {
    if (arg === '--dialogue') dialogue = true
    else if (arg.startsWith('-')) throw new UsageError(`unknown option for schema: ${arg}`)
    else throw new UsageError(`schema takes no arguments, got ${arg}`)
  }
  io.stdout(`${dialogue ? dialogueSchemaJson() : schemaJson()}\n`)
  return 0
}
