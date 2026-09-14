/**
 * The step dependency graph of a quest and the analyses built on top of it.
 *
 * An edge from A to B means B depends on A: one of B's conditions reads A's
 * state or A's counter, so A has to move before B can. The graph drives cycle
 * detection and reachability here, and drawing in the CLI and the markdown
 * writer.
 *
 * Reachability is the conservative analysis described in docs/08-validation.md.
 * Every namespace except `var` is owned by the runtime, so the validator can
 * search for an assignment that unlocks a step. Steps that are not reachable yet
 * are pinned to `locked` and their counters to zero; everything else is free.
 * The search enumerates a small candidate set per variable and reuses the real
 * evaluator, so its semantics cannot drift from the runtime. When the candidate
 * space is too large the answer is "satisfiable", which keeps the analysis on
 * the safe side: it never claims a step is unreachable unless it proved it.
 */
import { conditionVariables, evaluateCondition } from '../condition/index.js'
import { type Condition, type Quest, STEP_STATES, type Scalar, type Step } from '../model.js'

/** The step fields that hold a condition, in evaluation order. */
export const STEP_CONDITION_FIELDS = ['unlock', 'activate', 'complete', 'fail'] as const
export type StepConditionField = (typeof STEP_CONDITION_FIELDS)[number]

/** The fields that decide whether a step can be completed at all. */
const PROGRESS_FIELDS: StepConditionField[] = ['unlock', 'activate', 'complete']

export interface StepCondition {
  field: StepConditionField
  condition: Condition
}

export interface StepGraph {
  nodes: string[]
  edges: Array<[from: string, to: string]>
}

export interface ReachabilityOptions {
  /**
   * Pin every `var.*` read to null, the value a game that promises nothing
   * supplies, and additionally require that a step can be completed before it
   * counts as a stepping stone. What is left is the part of the quest the
   * validator can prove on its own.
   */
  ignoreVars?: boolean
}

/** The conditions a step carries, with the fields it leaves empty dropped. */
export function stepConditions(step: Step): StepCondition[] {
  const found: StepCondition[] = []
  for (const field of STEP_CONDITION_FIELDS) {
    const condition = step[field]
    if (condition !== undefined) found.push({ field, condition })
  }
  return found
}

/** The namespace of a dotted variable path: the part before the first dot. */
export function pathNamespace(path: string): string {
  const dot = path.indexOf('.')
  return dot === -1 ? path : path.slice(0, dot)
}

/** The part of a dotted variable path after the namespace. Empty when absent. */
export function pathRest(path: string): string {
  const dot = path.indexOf('.')
  return dot === -1 ? '' : path.slice(dot + 1)
}

/** True when the step begins `available` as soon as the quest opens. */
export function isStartStep(step: Step): boolean {
  return step.start === true || step.unlock === undefined
}

/** True when reaching or completing this step depends on a game-provided variable. */
export function readsGameVariables(step: Step): boolean {
  for (const { field, condition } of stepConditions(step)) {
    if (!PROGRESS_FIELDS.includes(field)) continue
    for (const path of conditionVariables(condition)) {
      if (pathNamespace(path) === 'var') return true
    }
  }
  return false
}

/**
 * Step ids in the same quest that this step's conditions read.
 *
 * A step reading its own counter in `activate`, `complete` or `fail` is not a
 * dependency: that is the step watching its own objective, which is what a
 * counter is for. Reading its own state is a dependency, and a cycle.
 */
export function stepDependencies(step: Step): string[] {
  const found: string[] = []
  for (const { field, condition } of stepConditions(step)) {
    for (const path of conditionVariables(condition)) {
      const namespace = pathNamespace(path)
      if (namespace !== 'step' && namespace !== 'count') continue
      const rest = pathRest(path)
      if (rest === '' || rest.includes('#')) continue
      if (namespace === 'count' && rest === step.id && field !== 'unlock') continue
      if (!found.includes(rest)) found.push(rest)
    }
  }
  return found
}

/**
 * The dependency graph of one quest. An edge `[a, b]` means b depends on a.
 * References to steps outside the quest are left out; the validator reports them.
 */
export function stepGraph(quest: Quest): StepGraph {
  const nodes = quest.steps.map((step) => step.id)
  const known = new Set(nodes)
  const edges: Array<[string, string]> = []
  const seen = new Set<string>()
  for (const step of quest.steps) {
    for (const from of stepDependencies(step)) {
      if (!known.has(from)) continue
      const key = `${from} -> ${step.id}`
      if (seen.has(key)) continue
      seen.add(key)
      edges.push([from, step.id])
    }
  }
  return { nodes, edges }
}

/**
 * Every cycle in the graph, as one entry per strongly connected component that
 * can reach itself. Tarjan's algorithm, so the result is deterministic.
 */
export function findCycles(graph: StepGraph): string[][] {
  const adjacency = new Map<string, string[]>()
  for (const node of graph.nodes) adjacency.set(node, [])
  for (const [from, to] of graph.edges) adjacency.get(from)?.push(to)
  const selfLoops = new Set(graph.edges.filter(([from, to]) => from === to).map(([from]) => from))
  const index = new Map<string, number>()
  const low = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: string[] = []
  const cycles: string[][] = []
  let counter = 0

  function visit(node: string): void {
    index.set(node, counter)
    low.set(node, counter)
    counter += 1
    stack.push(node)
    onStack.add(node)
    for (const next of adjacency.get(node) ?? []) {
      if (!index.has(next)) {
        visit(next)
        low.set(node, Math.min(low.get(node) ?? 0, low.get(next) ?? 0))
      } else if (onStack.has(next)) {
        low.set(node, Math.min(low.get(node) ?? 0, index.get(next) ?? 0))
      }
    }
    if (low.get(node) !== index.get(node)) return
    const component: string[] = []
    for (;;) {
      const popped = stack.pop()
      if (popped === undefined) break
      onStack.delete(popped)
      component.push(popped)
      if (popped === node) break
    }
    if (component.length > 1 || selfLoops.has(node)) cycles.push(component.reverse())
  }

  for (const node of graph.nodes) {
    if (!index.has(node)) visit(node)
  }
  return cycles
}

/** How many assignments the satisfiability search will try before giving up. */
const SEARCH_LIMIT = 20000

const QUEST_STATES = ['unseen', 'open', 'closed']
const WILD_VALUES: unknown[] = [null, true, false, 0, 1]

export interface SearchContext {
  inQuest: Set<string>
  reachable: Set<string>
  /** Pin `var.*` to null instead of trying candidate values. */
  ignoreVars?: boolean
  /** The step being examined. Its own counter is free rather than pinned to zero. */
  self?: string
}

function collectLiterals(node: unknown, found: Scalar[]): void {
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') {
    if (!found.includes(node)) found.push(node)
    return
  }
  if (Array.isArray(node)) {
    for (const item of node) collectLiterals(item, found)
    return
  }
  if (node === null || typeof node !== 'object') return
  for (const [operator, args] of Object.entries(node)) {
    if (operator === 'var') continue
    collectLiterals(args, found)
  }
}

function numberProbes(literals: Scalar[]): unknown[] {
  const probes: unknown[] = [0]
  for (const literal of literals) {
    if (typeof literal !== 'number') continue
    for (const value of [literal, literal + 1]) {
      if (!probes.includes(value)) probes.push(value)
    }
  }
  return probes
}

function wildProbes(literals: Scalar[]): unknown[] {
  const probes = [...WILD_VALUES]
  for (const literal of literals) {
    if (!probes.includes(literal)) probes.push(literal)
  }
  return probes
}

function domainFor(path: string, context: SearchContext, literals: Scalar[]): unknown[] {
  const namespace = pathNamespace(path)
  const rest = pathRest(path)
  if (namespace === 'step') {
    if (rest.includes('#') || !context.inQuest.has(rest)) return [...STEP_STATES]
    return context.reachable.has(rest) ? [...STEP_STATES] : ['locked']
  }
  if (namespace === 'count') {
    if (rest !== context.self && context.inQuest.has(rest) && !context.reachable.has(rest)) {
      return [0]
    }
    return numberProbes(literals)
  }
  if (namespace === 'flag' || namespace === 'outcome') return [true, false]
  if (namespace === 'quest') return [...QUEST_STATES]
  if (namespace === 'var' && context.ignoreVars === true) return [null]
  return wildProbes(literals)
}

/**
 * True when some assignment of the owned namespaces makes the condition true.
 * Returns true when the search space is too large to enumerate, so a caller may
 * read a false as proof and a true as "not disproved".
 */
export function satisfiable(condition: Condition, context: SearchContext): boolean {
  const literals: Scalar[] = []
  collectLiterals(condition, literals)
  const paths = conditionVariables(condition)
  const domains = paths.map((path) => domainFor(path, context, literals))
  let total = 1
  for (const domain of domains) total *= Math.max(domain.length, 1)
  if (total > SEARCH_LIMIT) return true
  for (let attempt = 0; attempt < total; attempt += 1) {
    const assignment = new Map<string, unknown>()
    let rest = attempt
    for (let slot = 0; slot < paths.length; slot += 1) {
      const domain = domains[slot]
      assignment.set(paths[slot], domain[rest % domain.length])
      rest = Math.floor(rest / domain.length)
    }
    try {
      if (evaluateCondition(condition, (path) => assignment.get(path))) return true
    } catch {
      // A malformed tree is reported as condition-invalid. Do not also call it unreachable.
      return true
    }
  }
  return false
}

/** True when nothing but the unlock stands between the step and `done`. */
function canProgress(step: Step, context: SearchContext): boolean {
  const own: SearchContext = { ...context, self: step.id }
  for (const { field, condition } of stepConditions(step)) {
    if (field === 'unlock' || !PROGRESS_FIELDS.includes(field)) continue
    if (!satisfiable(condition, own)) return false
  }
  return true
}

/**
 * The steps a player can get to from a start step. Start steps are the ones
 * marked `start` or left without an `unlock`. The set grows to a fixpoint: as
 * more steps become reachable more states become possible for the steps that
 * read them.
 *
 * Plain reachability asks only whether a step can be unlocked, which is what
 * docs/08-validation.md defines. With `ignoreVars` it also asks whether the step
 * can be completed without help from the game, which is what proving an ending
 * needs.
 */
export function reachableSteps(quest: Quest, options: ReachabilityOptions = {}): Set<string> {
  const ignoreVars = options.ignoreVars === true
  const inQuest = new Set(quest.steps.map((step) => step.id))
  const reachable = new Set<string>()
  const context: SearchContext = { inQuest, reachable, ignoreVars }
  let changed = true
  while (changed) {
    changed = false
    for (const step of quest.steps) {
      if (reachable.has(step.id)) continue
      if (ignoreVars && !canProgress(step, context)) continue
      const unlock = step.unlock
      if (!isStartStep(step) && (unlock === undefined || !satisfiable(unlock, context))) continue
      reachable.add(step.id)
      changed = true
    }
  }
  return reachable
}
