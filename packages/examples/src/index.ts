import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const at = (name: string) => fileURLToPath(new URL(`../quests/${name}`, import.meta.url))

/** Fixture name to absolute path on disk. */
export const EXAMPLES = {
  'harbormasters-ledger.oqf': at('harbormasters-ledger.oqf'),
  'harbormasters-ledger.json': at('harbormasters-ledger.json'),
  'minimal.oqf': at('minimal.oqf'),
  'minimal.json': at('minimal.json'),
  'broken/wrong-magic.oqf': at('broken/wrong-magic.oqf'),
  'broken/duplicate-step-id.oqf': at('broken/duplicate-step-id.oqf'),
  'broken/unknown-reward-ref.oqf': at('broken/unknown-reward-ref.oqf'),
  'broken/dictionary-index-out-of-range.oqf': at('broken/dictionary-index-out-of-range.oqf'),
  'broken/bad-condition-syntax.oqf': at('broken/bad-condition-syntax.oqf'),
  'broken/cycle-without-repeat.oqf': at('broken/cycle-without-repeat.oqf'),
  'broken/outcome-with-dependents.oqf': at('broken/outcome-with-dependents.oqf'),
  'broken/unreachable-step.oqf': at('broken/unreachable-step.oqf'),
  'broken/unknown-objective-kind.oqf': at('broken/unknown-objective-kind.oqf'),
  'broken/ext-without-namespace.oqf': at('broken/ext-without-namespace.oqf'),
} as const satisfies Record<string, string>

export type ExampleName = keyof typeof EXAMPLES

/** Read a fixture as UTF-8 text, bytes exactly as they sit on disk. */
export function readExample(name: ExampleName): string {
  return readFileSync(EXAMPLES[name], 'utf8')
}
