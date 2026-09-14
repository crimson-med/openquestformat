/**
 * `oqf graph <path> [--quest <id>]`
 *
 * A mermaid flowchart of the step dependency graph, ready to paste into a doc
 * or a pull request. Ending steps get the double bracket shape, optional steps
 * a dashed border.
 */
import { type Quest, type Step, stepGraph } from '@oqf/core'
import { type Io, UsageError, loadDocument } from '../load.js'

export const GRAPH_HELP = `oqf graph <path> [--quest <id>]

Print the step dependency graph of a file as a mermaid flowchart. Without
--quest every quest in the file is printed, separated by a blank line.

  --quest <id>  Only this quest

  oqf graph packages/examples/quests/harbormasters-ledger.oqf --quest harbormasters_ledger
`

interface Options {
  path: string
  quest?: string
}

function parseArgs(argv: string[]): Options {
  let path: string | undefined
  let quest: string | undefined

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--quest') {
      const found = argv[index + 1]
      if (found === undefined || found.startsWith('-'))
        throw new UsageError('--quest needs a value')
      quest = found
      index += 1
    } else if (arg.startsWith('-')) {
      throw new UsageError(`unknown option for graph: ${arg}`)
    } else if (path === undefined) {
      path = arg
    } else {
      throw new UsageError('graph takes a single path')
    }
  }

  if (path === undefined) throw new UsageError('graph needs a path')
  return quest === undefined ? { path } : { path, quest }
}

/** Mermaid labels are quoted, so a quote inside a label has to be entity escaped. */
function label(value: string): string {
  return value.replaceAll('"', '#quot;')
}

function node(step: Step): string {
  const text = `"${label(step.title)}"`
  return step.outcome === undefined ? `  ${step.id}[${text}]` : `  ${step.id}[[${text}]]`
}

function questFlowchart(quest: Quest): string {
  const graph = stepGraph(quest)
  const steps = new Map(quest.steps.map((step) => [step.id, step]))
  const lines = ['flowchart TD']

  for (const id of graph.nodes) {
    const step = steps.get(id)
    if (step !== undefined) lines.push(node(step))
  }
  for (const [from, to] of graph.edges) lines.push(`  ${from} --> ${to}`)
  for (const step of quest.steps) {
    if (step.optional === true) lines.push(`  style ${step.id} stroke-dasharray: 5 5`)
  }

  return lines.join('\n')
}

export function graphCommand(argv: string[], io: Io): number {
  const options = parseArgs(argv)
  const { document } = loadDocument(options.path, io)
  const quests =
    options.quest === undefined
      ? document.quests
      : document.quests.filter((quest) => quest.id === options.quest)

  if (quests.length === 0) {
    const what = options.quest === undefined ? 'no quests' : `no quest "${options.quest}"`
    io.stderr(`oqf: ${what} in ${options.path}\n`)
    return 1
  }

  io.stdout(`${quests.map(questFlowchart).join('\n\n')}\n`)
  return 0
}
