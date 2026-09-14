/**
 * Condition trees and objectives back to their one canonical spelling.
 *
 * Lowercase keywords, single spaces, double quoted strings and the fewest
 * parentheses that still reproduce the tree. `parseCondition(formatCondition(t))`
 * returns `t` for every tree the parser can produce.
 *
 * One shape falls outside that set: a bare `{ var: 'flag.x' }` sitting in boolean
 * position. The authoring string has no syntax for it, since a bare path there is
 * always sugar for a comparison, so it is printed as the path on a best effort
 * basis and reads back as `flag.x == true`.
 */
import type { Condition, Objective } from '../model.js'
import { variableNamespace } from './paths.js'

/** Binding power, loosest first. A child below the required level gets parentheses. */
const LEVEL_OR = 1
const LEVEL_AND = 2
const LEVEL_NOT = 3
const LEVEL_COMPARISON = 4

const COMPARISONS = ['==', '!=', '<', '<=', '>', '>=', 'in']

interface Entry {
  operator: string
  args: unknown
}

function entry(node: unknown): Entry | undefined {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return undefined
  const keys = Object.keys(node)
  if (keys.length !== 1) return undefined
  const operator = keys[0]
  return { operator, args: (node as Record<string, unknown>)[operator] }
}

function operands(args: unknown): unknown[] {
  return Array.isArray(args) ? args : [args]
}

function formatString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function formatLiteral(value: unknown): string {
  if (typeof value === 'string') return formatString(value)
  if (Array.isArray(value)) return `[${value.map(formatLiteral).join(', ')}]`
  return String(value)
}

/** The bare path spelling of a sugared comparison, when the sugar reads back unchanged. */
function sugaredPath(node: Entry): string | undefined {
  if (node.operator !== '==') return undefined
  const args = node.args
  if (!Array.isArray(args) || args.length !== 2) return undefined
  const left = entry(args[0])
  if (left === undefined || left.operator !== 'var' || typeof left.args !== 'string') {
    return undefined
  }
  const path = left.args
  if (variableNamespace(path) === 'step') return args[1] === 'done' ? path : undefined
  return args[1] === true ? path : undefined
}

function wrap(text: string, level: number, required: number): string {
  return level < required ? `(${text})` : text
}

/** Boolean position: bare path sugar applies here. */
function formatBoolean(node: unknown, required: number): string {
  const current = entry(node)
  if (current === undefined) return formatLiteral(node)
  if (current.operator === 'var') return String(current.args)
  const sugared = sugaredPath(current)
  if (sugared !== undefined) return sugared
  if (current.operator === 'and') {
    const parts = operands(current.args).map((part) => formatBoolean(part, LEVEL_NOT))
    return wrap(parts.join(' and '), LEVEL_AND, required)
  }
  if (current.operator === 'or') {
    const parts = operands(current.args).map((part) => formatBoolean(part, LEVEL_AND))
    return wrap(parts.join(' or '), LEVEL_OR, required)
  }
  if (current.operator === '!') {
    const inner = formatBoolean(operands(current.args)[0], LEVEL_NOT)
    return wrap(`not ${inner}`, LEVEL_NOT, required)
  }
  if (COMPARISONS.includes(current.operator)) {
    const [left, right] = operands(current.args)
    const text = `${formatOperand(left)} ${current.operator} ${formatOperand(right)}`
    return wrap(text, LEVEL_COMPARISON, required)
  }
  throw new Error(`cannot format unknown condition operator "${current.operator}"`)
}

/** Value position: only literals and variables stand alone, everything else parenthesises. */
function formatOperand(node: unknown): string {
  const current = entry(node)
  if (current === undefined) return formatLiteral(node)
  if (current.operator === 'var') return String(current.args)
  return `(${formatBoolean(node, LEVEL_OR)})`
}

/** Render a condition tree as canonical infix text. Inverse of parseCondition. */
export function formatCondition(condition: Condition): string {
  return formatBoolean(condition, LEVEL_OR)
}

/** Render an objective as canonical infix text. Inverse of parseObjective. */
export function formatObjective(objective: Objective): string {
  switch (objective.kind) {
    case 'kill':
      return `kill ${objective.actor}${objective.count === undefined ? '' : ` ${objective.count}`}`
    case 'collect':
      return `collect ${objective.item}${objective.count === undefined ? '' : ` ${objective.count}`}`
    case 'reach':
      return `reach ${objective.location}`
    case 'talk':
      return `talk ${objective.actor}${objective.dialogue === undefined ? '' : ` ${objective.dialogue}`}`
    case 'interact':
      return `interact ${objective.object}`
    case 'event':
      return `event ${objective.event}${objective.count === undefined ? '' : ` ${objective.count}`}`
    case 'custom':
      return `custom ${objective.custom}${objective.args.length === 0 ? '' : ` ${objective.args.join(' ')}`}`
    default: {
      const unreachable: never = objective
      throw new Error(`cannot format unknown objective ${JSON.stringify(unreachable)}`)
    }
  }
}

/** Render objective and condition back into one `complete` cell. */
export function formatCompletion(parts: {
  objective?: Objective
  condition?: Condition
}): string {
  const objective = parts.objective === undefined ? undefined : formatObjective(parts.objective)
  const condition = parts.condition === undefined ? undefined : formatCondition(parts.condition)
  if (objective !== undefined && condition !== undefined) return `${objective} and ${condition}`
  if (objective !== undefined) return objective
  if (condition !== undefined) return condition
  return ''
}
