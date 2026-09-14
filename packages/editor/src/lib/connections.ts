/**
 * Step dependencies as graph edges.
 *
 * A dependency is nothing but condition text: an edge from A to B on the canvas
 * means a condition on B reads `step.A` or `count.A`. Drawing an edge adds that
 * read to B's `unlock`, deleting one removes every such read from B's
 * conditions. Hand-written conditions stay as they are otherwise, so the
 * inspector and the graph edit the same thing.
 */
import {
  type Condition,
  STEP_CONDITION_FIELDS,
  type Step,
  conditionVariables,
  parseCondition,
  stepDependencies,
} from '@oqf/core'

/** The leaf the unlock text `step.<id>` parses to. */
function doneLeaf(stepId: string): Condition {
  return parseCondition(`step.${stepId}`)
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

/** Make `target` depend on `fromId`: its `unlock` now also requires `step.<fromId>` done. */
export function linkSteps(target: Step, fromId: string): Step {
  if (stepDependencies(target).includes(fromId)) return target
  const leaf = doneLeaf(fromId)
  let unlock: Condition
  if (target.unlock === undefined) unlock = leaf
  else if (isAnd(target.unlock)) unlock = { and: [...target.unlock.and, leaf] }
  else unlock = { and: [target.unlock, leaf] }
  // A start step with an unlock is a contradiction; the unlock wins.
  const { start: _start, ...rest } = target
  return { ...rest, unlock }
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
