/**
 * Step dependencies as graph edges.
 *
 * A dependency is nothing but condition text: an edge from A to B on the canvas
 * means a condition on B reads `step.A` or `count.A`. Drawing an edge adds that
 * read to one of B's condition fields (`unlock` unless told otherwise), deleting
 * one removes every such read from B's conditions. Hand-written conditions stay
 * as they are otherwise, so the inspector and the graph edit the same thing.
 */
import {
  type Condition,
  type Quest,
  STEP_CONDITION_FIELDS,
  type Step,
  type StepConditionField,
  conditionVariables,
  parseCondition,
  stepDependencies,
  stepGraph,
} from '@oqf/core'

/** The step field a dependency is written into. */
export type DependencyField = StepConditionField
export const DEPENDENCY_FIELDS: readonly DependencyField[] = STEP_CONDITION_FIELDS

/** The state of the source step a dependency waits for. `locked` is never worth waiting for. */
export const DEPENDENCY_STATES = ['done', 'failed', 'active', 'available', 'skipped'] as const
export type DependencyState = (typeof DEPENDENCY_STATES)[number]

export interface LinkOptions {
  /** Defaults to `unlock`. */
  field?: DependencyField | undefined
  /** Defaults to `done`. */
  state?: DependencyState | undefined
}

/** The field and state an existing edge stands for. */
export interface EdgeSpec {
  field: DependencyField
  state: DependencyState
}

/**
 * The leaf a dependency parses to. `done` keeps the bare `step.<id>` spelling so
 * files written before states could be picked do not churn.
 */
function stateLeaf(stepId: string, state: DependencyState): Condition {
  if (state === 'done') return parseCondition(`step.${stepId}`)
  return parseCondition(`step.${stepId} == "${state}"`)
}

function isAnd(condition: Condition): condition is { and: Condition[] } {
  return (
    typeof condition === 'object' &&
    condition !== null &&
    !Array.isArray(condition) &&
    'and' in condition &&
    Array.isArray(condition.and)
  )
}

/**
 * Make `target` depend on `fromId`: the chosen field (default `unlock`) now also
 * requires `step.<fromId>` to be in the chosen state (default `done`). For
 * `complete` the leaf sits next to the objective, which is left alone.
 */
export function linkSteps(target: Step, fromId: string, options: LinkOptions = {}): Step {
  if (stepDependencies(target).includes(fromId)) return target
  const field = options.field ?? 'unlock'
  const leaf = stateLeaf(fromId, options.state ?? 'done')
  const current = target[field]
  let condition: Condition
  if (current === undefined) condition = leaf
  else if (isAnd(current)) condition = { and: [...current.and, leaf] }
  else condition = { and: [current, leaf] }
  if (field !== 'unlock') return { ...target, [field]: condition }
  // A start step with an unlock is a contradiction; the unlock wins.
  const { start: _start, ...rest } = target
  return { ...rest, unlock: condition }
}

/**
 * True when the node is a leaf of the boolean tree: a comparison, a bare
 * variable, or a literal. Leaves are dropped whole rather than rewritten.
 */
function isLeaf(condition: Condition): boolean {
  if (typeof condition !== 'object' || condition === null || Array.isArray(condition)) return true
  return !('and' in condition || 'or' in condition || '!' in condition)
}

function readsStep(condition: Condition, stepId: string): boolean {
  const paths = conditionVariables(condition)
  return paths.includes(`step.${stepId}`) || paths.includes(`count.${stepId}`)
}

/**
 * The condition with every leaf that reads the step removed, or undefined when
 * nothing is left. An `and` or `or` with one child collapses to that child.
 *
 * Removing a leaf from an `or` widens the condition (the other branch alone now
 * opens it). That is the author's intent when they delete the edge: the step
 * should no longer wait on the removed one, whatever the other branches say.
 */
function withoutStep(condition: Condition, stepId: string): Condition | undefined {
  if (isLeaf(condition)) return readsStep(condition, stepId) ? undefined : condition
  const node = condition as Record<string, unknown>
  if ('!' in node) {
    const inner = withoutStep((node['!'] as [Condition])[0], stepId)
    return inner === undefined ? undefined : { '!': [inner] }
  }
  const operator = 'and' in node ? 'and' : 'or'
  const children: Condition[] = []
  for (const child of node[operator] as Condition[]) {
    const kept = withoutStep(child, stepId)
    if (kept !== undefined) children.push(kept)
  }
  if (children.length === 0) return undefined
  if (children.length === 1) return children[0]
  return { [operator]: children } as Condition
}

/**
 * Remove every read of `step.<fromId>` and `count.<fromId>` from the target's
 * `unlock`, `activate`, `complete` and `fail`. The objective is left alone.
 */
export function unlinkSteps(target: Step, fromId: string): Step {
  const next: Step = { ...target }
  for (const field of STEP_CONDITION_FIELDS) {
    const condition = target[field]
    if (condition === undefined) continue
    const kept = withoutStep(condition, fromId)
    if (kept === undefined) delete next[field]
    else next[field] = kept
  }
  return next
}

const COMPARISONS = ['==', '!=', '<', '<=', '>', '>=', 'in']

/** The operator with its operands swapped, so `2 <= count.x` reads as `count.x >= 2`. */
const MIRRORED: Record<string, string> = { '<': '>', '<=': '>=', '>': '<', '>=': '<=' }

/** One leaf of a target's conditions that reads the source step. */
interface DependencyRead {
  field: DependencyField
  namespace: 'step' | 'count'
  operator: string
  value: unknown
  /** True under an odd number of `not`. */
  negated: boolean
}

function varPath(node: unknown): string | undefined {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return undefined
  const path = (node as { var?: unknown }).var
  return typeof path === 'string' && Object.keys(node).length === 1 ? path : undefined
}

function namespaceOf(path: string | undefined, fromId: string): 'step' | 'count' | undefined {
  if (path === `step.${fromId}`) return 'step'
  if (path === `count.${fromId}`) return 'count'
  return undefined
}

function leafRead(
  leaf: Condition,
  fromId: string,
): Pick<DependencyRead, 'namespace' | 'operator' | 'value'> | undefined {
  const bare = namespaceOf(varPath(leaf), fromId)
  if (bare !== undefined) {
    return { namespace: bare, operator: '==', value: bare === 'step' ? 'done' : true }
  }
  if (leaf === null || typeof leaf !== 'object' || Array.isArray(leaf)) return undefined
  const keys = Object.keys(leaf)
  if (keys.length !== 1 || !COMPARISONS.includes(keys[0])) return undefined
  const operator = keys[0]
  const args = (leaf as Record<string, unknown>)[operator]
  if (!Array.isArray(args) || args.length !== 2) return undefined
  const left = namespaceOf(varPath(args[0]), fromId)
  if (left !== undefined) return { namespace: left, operator, value: args[1] }
  const right = namespaceOf(varPath(args[1]), fromId)
  if (right !== undefined) {
    return { namespace: right, operator: MIRRORED[operator] ?? operator, value: args[0] }
  }
  return undefined
}

function collectReads(
  condition: Condition,
  field: DependencyField,
  fromId: string,
  negated: boolean,
  found: DependencyRead[],
): void {
  if (isLeaf(condition)) {
    const read = leafRead(condition, fromId)
    if (read !== undefined) found.push({ field, negated, ...read })
    return
  }
  const node = condition as Record<string, unknown>
  if ('!' in node) {
    collectReads((node['!'] as [Condition])[0], field, fromId, !negated, found)
    return
  }
  const operator = 'and' in node ? 'and' : 'or'
  for (const child of node[operator] as Condition[]) {
    collectReads(child, field, fromId, negated, found)
  }
}

/** Every read of the source step in the target's conditions, in field order. */
function dependencyReads(target: Step, fromId: string): DependencyRead[] {
  const found: DependencyRead[] = []
  for (const field of STEP_CONDITION_FIELDS) {
    const condition = target[field]
    if (condition !== undefined) collectReads(condition, field, fromId, false, found)
  }
  return found
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return `[${value.map(formatValue).join(', ')}]`
  return String(value)
}

/** The part of a label that says what is waited for; empty for the plain done check. */
function statePart(read: DependencyRead): string {
  if (read.namespace === 'count') {
    const text = `count ${read.operator} ${formatValue(read.value)}`
    return read.negated ? `not ${text}` : text
  }
  const value = formatValue(read.value)
  const equals = read.negated ? read.operator === '!=' : read.operator === '=='
  const differs = read.negated ? read.operator === '==' : read.operator === '!='
  if (equals) return value === 'done' ? '' : value
  if (differs) return `not ${value}`
  const text = `${read.operator} ${value}`
  return read.negated ? `not ${text}` : text
}

function readLabel(read: DependencyRead): string {
  const parts: string[] = []
  if (read.field !== 'unlock') parts.push(read.field)
  const state = statePart(read)
  if (state !== '') parts.push(state)
  return parts.join(' ')
}

/**
 * A short label per edge of `stepGraph(quest)`, keyed `<from>-><to>`: the field
 * when it is not `unlock`, the state when it is not `done`, a `count >= 2` style
 * marker for counter reads, and the empty string for the plain unlock-on-done
 * case. An edge read from several places lists each distinct label once.
 */
export function edgeLabels(quest: Quest): Record<string, string> {
  const labels: Record<string, string> = {}
  for (const [from, to] of stepGraph(quest).edges) {
    const target = quest.steps.find((step) => step.id === to)
    if (target === undefined) continue
    const distinct: string[] = []
    for (const read of dependencyReads(target, from)) {
      const label = readLabel(read)
      if (!distinct.includes(label)) distinct.push(label)
    }
    labels[`${from}->${to}`] = distinct.filter((label) => label !== '').join(', ')
  }
  return labels
}

/**
 * The field and state of an existing edge, taken from the first field that reads
 * the source. A read that is not a plain `step.<from> == "<state>"` check (a
 * counter, a `!=`, a negation) reports `done`, the state a fresh link would use.
 */
export function edgeSpec(quest: Quest, from: string, to: string): EdgeSpec | undefined {
  const target = quest.steps.find((step) => step.id === to)
  if (target === undefined) return undefined
  const read = dependencyReads(target, from)[0]
  if (read === undefined) return undefined
  const plain = read.namespace === 'step' && read.operator === '==' && !read.negated
  const state = (DEPENDENCY_STATES as readonly unknown[]).includes(read.value)
    ? (read.value as DependencyState)
    : 'done'
  return { field: read.field, state: plain ? state : 'done' }
}
