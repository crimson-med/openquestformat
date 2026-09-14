/**
 * Read-only Markdown export: one heading per quest, a table of steps, the
 * quest-level rewards grouped by outcome, and a mermaid graph of the step
 * transitions. Meant for design review and for pasting into a doc.
 */
import { conditionVariables, formatCompletion, formatCondition } from '../condition/index.js'
import type { Condition, Objective, OqfDocument, Quest, Reward, Step } from '../model.js'

const STEP_PREFIX = 'step.'
const HEADERS = ['ID', 'Title', 'Unlock', 'Complete', 'Fail', 'Outcome', 'Rewards']

/** Table cells are pipe separated, so a pipe inside a cell has to be escaped. */
function cell(value: string): string {
  return value.replaceAll('|', '\\|')
}

function row(cells: string[]): string {
  return `| ${cells.map(cell).join(' | ')} |`
}

function code(value: string): string {
  return `\`${value}\``
}

function condition(value: Condition | undefined): string {
  return value === undefined ? '' : formatCondition(value)
}

/** An objective and a condition share one cell, the way the authoring form writes them. */
function completion(objective: Objective | undefined, condition: Condition | undefined): string {
  if (objective === undefined && condition === undefined) return ''
  return formatCompletion({ objective, condition })
}

function outcomeCell(step: Step): string {
  if (step.outcome === undefined) return ''
  return step.outcome.failed === true ? `!${step.outcome.name}` : step.outcome.name
}

function stepRow(step: Step): string {
  return row([
    code(step.id),
    step.title,
    condition(step.unlock),
    completion(step.objective, step.complete),
    completion(step.failObjective, step.fail),
    outcomeCell(step),
    step.rewards.map(code).join(', '),
  ])
}

function rewardLine(reward: Reward): string {
  const amount = reward.amount === undefined ? '' : ` (${reward.amount})`
  return `- ${code(reward.id)} ${reward.kind} ${code(reward.ref)}${amount}`
}

/** Quest-level rewards, in first appearance order of the outcome they belong to. */
function rewardsByOutcome(quest: Quest): Map<string, Reward[]> {
  const grouped = new Map<string, Reward[]>()
  for (const reward of quest.rewards) {
    if (reward.outcome === undefined) continue
    const group = grouped.get(reward.outcome)
    if (group === undefined) grouped.set(reward.outcome, [reward])
    else group.push(reward)
  }
  return grouped
}

/** Mermaid labels are quoted, so a quote inside a label has to be entity escaped. */
function label(value: string): string {
  return value.replaceAll('"', '#quot;')
}

function node(step: Step): string {
  const text = `"${label(step.title)}"`
  return step.outcome === undefined ? `  ${step.id}[${text}]` : `  ${step.id}[[${text}]]`
}

/** Step ids another step names in its unlock condition, as `source --> target` edges. */
function edges(quest: Quest): string[] {
  const ids = new Set(quest.steps.map((step) => step.id))
  const seen = new Set<string>()
  const lines: string[] = []

  for (const step of quest.steps) {
    if (step.unlock === undefined) continue
    for (const path of conditionVariables(step.unlock)) {
      if (!path.startsWith(STEP_PREFIX) || path.includes('#')) continue
      const rest = path.slice(STEP_PREFIX.length)
      const source = ids.has(rest) ? rest : rest.split('.')[0]
      if (!ids.has(source)) continue
      const edge = `  ${source} --> ${step.id}`
      if (seen.has(edge)) continue
      seen.add(edge)
      lines.push(edge)
    }
  }
  return lines
}

function graph(quest: Quest): string[] {
  return ['```mermaid', 'flowchart TD', ...quest.steps.map(node), ...edges(quest), '```']
}

function questSection(quest: Quest): string {
  const lines: string[] = [`# ${quest.title} ${code(quest.id)}`]

  if (quest.summary !== undefined) lines.push('', quest.summary)

  lines.push('', '## Steps', '')
  lines.push(row(HEADERS))
  lines.push(`| ${HEADERS.map(() => '---').join(' | ')} |`)
  for (const step of quest.steps) lines.push(stepRow(step))

  const grouped = rewardsByOutcome(quest)
  if (grouped.size > 0) {
    lines.push('', '## Rewards')
    for (const [outcome, rewards] of grouped) {
      lines.push('', `### ${outcome}`, '')
      for (const reward of rewards) lines.push(rewardLine(reward))
    }
  }

  lines.push('')
  lines.push(...graph(quest))

  return lines.join('\n')
}

/** Render the document as Markdown. One way: there is no Markdown parser. */
export function toMarkdown(doc: OqfDocument): string {
  if (doc.quests.length === 0) return ''
  return `${doc.quests.map(questSection).join('\n\n\n')}\n`
}
