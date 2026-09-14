/**
 * Evaluation, variable collection and whitelist checking for condition trees.
 *
 * Semantics are deliberately strict. `==` and `!=` compare with strict equality
 * after folding undefined into null, ordering comparisons hold only between two
 * numbers or two strings, and `in` is false unless its right side is an array.
 */
import { CONDITION_OPERATORS, type Condition } from '../model.js'
import type { ConditionError } from './errors.js'
import { PATH_PATTERN, isVariableNamespace, variableNamespace } from './paths.js'

/** Resolves a dotted variable path to a value. Unknown reads undefined. */
export type VariableResolver = (path: string) => unknown

const ORDERINGS = ['<', '<=', '>', '>=']

function operands(args: unknown): unknown[] {
  return Array.isArray(args) ? args : [args]
}

function truthy(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0
  return Boolean(value)
}

function normalize(value: unknown): unknown {
  return value === undefined ? null : value
}

function rank(operator: string, less: boolean, equal: boolean): boolean {
  if (operator === '<') return less
  if (operator === '<=') return less || equal
  if (operator === '>') return !less && !equal
  return !less
}

function order(operator: string, left: unknown, right: unknown): boolean {
  if (typeof left === 'number' && typeof right === 'number') {
    return rank(operator, left < right, left === right)
  }
  if (typeof left === 'string' && typeof right === 'string') {
    return rank(operator, left < right, left === right)
  }
  return false
}

function evaluateNode(node: unknown, resolve: VariableResolver): unknown {
  if (node === null || typeof node !== 'object') return node
  if (Array.isArray(node)) return node
  const keys = Object.keys(node)
  if (keys.length !== 1) {
    throw new Error(`condition object must have exactly one operator, found ${keys.length}`)
  }
  const operator = keys[0]
  const args = (node as Record<string, unknown>)[operator]
  if (!(CONDITION_OPERATORS as readonly string[]).includes(operator)) {
    throw new Error(`unknown condition operator "${operator}"`)
  }
  if (operator === 'var') return normalize(resolve(String(args)))
  if (operator === 'and') {
    for (const part of operands(args)) {
      if (!truthy(evaluateNode(part, resolve))) return false
    }
    return true
  }
  if (operator === 'or') {
    for (const part of operands(args)) {
      if (truthy(evaluateNode(part, resolve))) return true
    }
    return false
  }
  if (operator === '!') return !truthy(evaluateNode(operands(args)[0], resolve))
  const [leftNode, rightNode] = operands(args)
  const left = normalize(evaluateNode(leftNode, resolve))
  const right = normalize(evaluateNode(rightNode, resolve))
  if (operator === '==') return left === right
  if (operator === '!=') return left !== right
  if (ORDERINGS.includes(operator)) return order(operator, left, right)
  return Array.isArray(right) && right.some((item) => item === left)
}

/** Evaluate a condition tree. Throws on operators outside the whitelist. */
export function evaluateCondition(condition: Condition, resolve: VariableResolver): boolean {
  return truthy(evaluateNode(condition, resolve))
}

function collectVariables(node: unknown, found: string[]): void {
  if (node === null || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const item of node) collectVariables(item, found)
    return
  }
  for (const [operator, args] of Object.entries(node)) {
    if (operator === 'var' && typeof args === 'string') {
      if (!found.includes(args)) found.push(args)
      continue
    }
    collectVariables(args, found)
  }
}

/** Every `var` path a condition reads, in source order, deduplicated. */
export function conditionVariables(condition: Condition): string[] {
  const found: string[] = []
  collectVariables(condition, found)
  return found
}

function isScalar(value: unknown): boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

function fail(errors: ConditionError[], message: string): void {
  errors.push({ message, offset: -1 })
}

function checkVariable(args: unknown, errors: ConditionError[]): void {
  if (typeof args !== 'string') {
    fail(errors, '"var" expects a string path')
    return
  }
  if (!PATH_PATTERN.test(args)) {
    fail(errors, `invalid variable path ${JSON.stringify(args)}`)
    return
  }
  const namespace = variableNamespace(args)
  if (!isVariableNamespace(namespace)) {
    fail(errors, `unknown variable namespace "${namespace}"`)
  }
}

function checkNode(node: unknown, errors: ConditionError[]): void {
  if (isScalar(node)) return
  if (Array.isArray(node)) {
    for (const item of node) {
      if (!isScalar(item)) fail(errors, 'a list may only contain numbers, strings and booleans')
    }
    return
  }
  if (node === null || typeof node !== 'object') {
    fail(errors, `${node === null ? 'null' : typeof node} is not a valid condition value`)
    return
  }
  const keys = Object.keys(node)
  if (keys.length === 0) {
    fail(errors, 'condition object has no operator')
    return
  }
  if (keys.length > 1) {
    fail(errors, `condition object has more than one key: ${keys.join(', ')}`)
    return
  }
  const operator = keys[0]
  const args = (node as Record<string, unknown>)[operator]
  if (!(CONDITION_OPERATORS as readonly string[]).includes(operator)) {
    fail(errors, `unknown operator "${operator}"`)
    return
  }
  if (operator === 'var') {
    checkVariable(args, errors)
    return
  }
  if (operator === 'and' || operator === 'or') {
    if (!Array.isArray(args) || args.length < 2) {
      fail(errors, `"${operator}" expects an array of at least two conditions`)
      return
    }
    for (const part of args) checkNode(part, errors)
    return
  }
  if (operator === '!') {
    if (!Array.isArray(args) || args.length !== 1) {
      fail(errors, '"!" expects an array of exactly one condition')
      return
    }
    checkNode(args[0], errors)
    return
  }
  if (!Array.isArray(args) || args.length !== 2) {
    fail(errors, `"${operator}" expects an array of exactly two operands`)
    return
  }
  checkNode(args[0], errors)
  checkNode(args[1], errors)
}

/** Walk the tree and return a list of whitelist violations, empty when valid. */
export function checkCondition(condition: unknown): ConditionError[] {
  const errors: ConditionError[] = []
  checkNode(condition, errors)
  return errors
}
