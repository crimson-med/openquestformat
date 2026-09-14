/**
 * Condition language: infix text <-> JSON Logic tree, plus evaluation.
 *
 * The grammar and the operator whitelist live in docs/02-conditions.md. Parsing
 * is in parse.ts, canonical printing in format.ts, evaluation and whitelist
 * checking in evaluate.ts.
 */
export type { ConditionError } from './errors.js'
export { ConditionSyntaxError } from './errors.js'
export type { VariableResolver } from './evaluate.js'
export { checkCondition, conditionVariables, evaluateCondition } from './evaluate.js'
export { formatCompletion, formatCondition, formatObjective } from './format.js'
export { parseCompletion, parseCondition, parseObjective } from './parse.js'
