/**
 * Infix condition text to the canonical tree, plus objective parsing.
 *
 * The grammar lives in docs/02-conditions.md. This is a precedence climbing
 * parser over a small hand written lexer, with no dependencies. Every error is
 * a ConditionSyntaxError carrying the character offset it was raised at.
 */
import { type Condition, OBJECTIVE_KINDS, type Objective, type Scalar } from '../model.js'
import { ConditionSyntaxError } from './errors.js'
import { PATH_PATTERN, REF_PATTERN, isVariableNamespace, variableNamespace } from './paths.js'

type TokenType = 'word' | 'number' | 'string' | 'op' | 'punct' | 'end'

interface Token {
  type: TokenType
  /** The source text of the token, or the empty string at end of input. */
  text: string
  /** The decoded literal, for number and string tokens only. */
  value?: Scalar
  start: number
}

const SPACE = /\s/
const WORD_START = /[A-Za-z_]/
/** Colons are lexed into words so that a path containing one reports a clear error. */
const WORD_CHAR = /[A-Za-z0-9_#.:-]/
const DIGIT = /[0-9]/
const INTEGER = /^[0-9]+$/
const COMPARISONS = ['==', '!=', '<=', '>=', '<', '>'] as const
const RESERVED = ['and', 'or', 'not', 'in']

function describe(token: Token): string {
  return token.type === 'end' ? 'end of input' : JSON.stringify(token.text)
}

function tokenize(source: string, from: number): Token[] {
  const tokens: Token[] = []
  let i = from
  while (i < source.length) {
    const ch = source[i]
    if (SPACE.test(ch)) {
      i += 1
      continue
    }
    const start = i
    if (ch === '(' || ch === ')' || ch === '[' || ch === ']' || ch === ',') {
      tokens.push({ type: 'punct', text: ch, start })
      i += 1
      continue
    }
    const pair = source.slice(i, i + 2)
    if (pair === '==' || pair === '!=' || pair === '<=' || pair === '>=') {
      tokens.push({ type: 'op', text: pair, start })
      i += 2
      continue
    }
    if (ch === '<' || ch === '>') {
      tokens.push({ type: 'op', text: ch, start })
      i += 1
      continue
    }
    if (ch === '"') {
      let j = i + 1
      let value = ''
      for (;;) {
        if (j >= source.length) throw new ConditionSyntaxError('unterminated string', start)
        const c = source[j]
        if (c === '"') {
          j += 1
          break
        }
        if (c === '\\') {
          if (j + 1 >= source.length) throw new ConditionSyntaxError('unterminated string', start)
          const escaped = source[j + 1]
          if (escaped !== '"' && escaped !== '\\') {
            throw new ConditionSyntaxError(`unknown escape "\\${escaped}"`, j)
          }
          value += escaped
          j += 2
          continue
        }
        value += c
        j += 1
      }
      tokens.push({ type: 'string', text: source.slice(start, j), value, start })
      i = j
      continue
    }
    if (ch === '-' || ch === '+' || DIGIT.test(ch)) {
      let j = ch === '-' || ch === '+' ? i + 1 : i
      const whole = j
      while (j < source.length && DIGIT.test(source[j])) j += 1
      if (j === whole) throw new ConditionSyntaxError('expected a digit', j)
      if (source[j] === '.') {
        j += 1
        const fraction = j
        while (j < source.length && DIGIT.test(source[j])) j += 1
        if (j === fraction) {
          throw new ConditionSyntaxError('expected a digit after the decimal point', j)
        }
      }
      const text = source.slice(start, j)
      tokens.push({ type: 'number', text, value: Number(text), start })
      i = j
      continue
    }
    if (WORD_START.test(ch)) {
      let j = i
      while (j < source.length && WORD_CHAR.test(source[j])) j += 1
      tokens.push({ type: 'word', text: source.slice(start, j), start })
      i = j
      continue
    }
    throw new ConditionSyntaxError(`unexpected character ${JSON.stringify(ch)}`, start)
  }
  tokens.push({ type: 'end', text: '', start: source.length })
  return tokens
}

function isKeyword(token: Token, keyword: string): boolean {
  return token.type === 'word' && token.text.toLowerCase() === keyword
}

/** Boolean position sugar: a bare path stands for a comparison against its resting value. */
function sugar(value: Condition): Condition {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value
  const path = (value as { var?: unknown }).var
  if (typeof path !== 'string') return value
  if (variableNamespace(path) === 'step') return { '==': [value as Condition, 'done'] }
  return { '==': [value as Condition, true] }
}

class Parser {
  private readonly tokens: Token[]
  private position = 0

  constructor(source: string, from: number) {
    this.tokens = tokenize(source, from)
  }

  private peek(): Token {
    return this.tokens[this.position]
  }

  private advance(): Token {
    const token = this.peek()
    this.position += 1
    return token
  }

  atEnd(): boolean {
    return this.peek().type === 'end'
  }

  expectEnd(): void {
    const token = this.peek()
    if (token.type !== 'end') {
      throw new ConditionSyntaxError(`unexpected ${describe(token)}`, token.start)
    }
  }

  expectKeyword(keyword: string): void {
    const token = this.peek()
    if (!isKeyword(token, keyword)) {
      throw new ConditionSyntaxError(`expected "${keyword}", got ${describe(token)}`, token.start)
    }
    this.advance()
  }

  private expectPunct(text: string): void {
    const token = this.peek()
    if (token.type !== 'punct' || token.text !== text) {
      throw new ConditionSyntaxError(`expected "${text}", got ${describe(token)}`, token.start)
    }
    this.advance()
  }

  parseExpression(): Condition {
    return this.parseOr()
  }

  private parseOr(): Condition {
    const first = this.parseAnd()
    if (!isKeyword(this.peek(), 'or')) return first
    const parts: Condition[] = [first]
    while (isKeyword(this.peek(), 'or')) {
      this.advance()
      parts.push(this.parseAnd())
    }
    return { or: parts }
  }

  private parseAnd(): Condition {
    const first = this.parseNot()
    if (!isKeyword(this.peek(), 'and')) return first
    const parts: Condition[] = [first]
    while (isKeyword(this.peek(), 'and')) {
      this.advance()
      parts.push(this.parseNot())
    }
    return { and: parts }
  }

  private parseNot(): Condition {
    if (isKeyword(this.peek(), 'not')) {
      this.advance()
      return { '!': [this.parseNot()] }
    }
    return this.parseComparison()
  }

  private parseComparison(): Condition {
    const left = this.parseValue()
    const token = this.peek()
    const operator = this.comparisonOperator(token)
    if (operator === undefined) return sugar(left)
    this.advance()
    const right = this.parseValue()
    return { [operator]: [left, right] } as Condition
  }

  private comparisonOperator(token: Token): string | undefined {
    if (token.type === 'op' && (COMPARISONS as readonly string[]).includes(token.text)) {
      return token.text
    }
    if (isKeyword(token, 'in')) return 'in'
    return undefined
  }

  private parseValue(): Condition {
    const token = this.advance()
    if (token.type === 'number' || token.type === 'string') return token.value as Scalar
    if (token.type === 'punct' && token.text === '(') {
      const inner = this.parseExpression()
      this.expectPunct(')')
      return inner
    }
    if (token.type === 'punct' && token.text === '[') return this.parseList()
    if (token.type === 'word') {
      const lowered = token.text.toLowerCase()
      if (lowered === 'true') return true
      if (lowered === 'false') return false
      if (RESERVED.includes(lowered)) {
        throw new ConditionSyntaxError(`unexpected keyword ${describe(token)}`, token.start)
      }
      if (!PATH_PATTERN.test(token.text)) {
        throw new ConditionSyntaxError(`invalid variable path ${describe(token)}`, token.start)
      }
      const namespace = variableNamespace(token.text)
      if (!isVariableNamespace(namespace)) {
        throw new ConditionSyntaxError(`unknown variable namespace "${namespace}"`, token.start)
      }
      return { var: token.text }
    }
    throw new ConditionSyntaxError(`expected a value, got ${describe(token)}`, token.start)
  }

  private parseList(): Scalar[] {
    const items: Scalar[] = []
    if (this.peek().type === 'punct' && this.peek().text === ']') {
      this.advance()
      return items
    }
    for (;;) {
      const token = this.advance()
      if (token.type === 'number' || token.type === 'string') {
        items.push(token.value as Scalar)
      } else if (token.type === 'word' && token.text.toLowerCase() === 'true') {
        items.push(true)
      } else if (token.type === 'word' && token.text.toLowerCase() === 'false') {
        items.push(false)
      } else {
        throw new ConditionSyntaxError(
          `a list may only contain numbers, strings and booleans, got ${describe(token)}`,
          token.start,
        )
      }
      const separator = this.advance()
      if (separator.type === 'punct' && separator.text === ',') continue
      if (separator.type === 'punct' && separator.text === ']') return items
      throw new ConditionSyntaxError(
        `expected "," or "]", got ${describe(separator)}`,
        separator.start,
      )
    }
  }
}

/** Parse infix text into a condition tree. Throws ConditionSyntaxError. */
export function parseCondition(source: string): Condition {
  const parser = new Parser(source, 0)
  const condition = parser.parseExpression()
  parser.expectEnd()
  return condition
}

interface Chunk {
  text: string
  start: number
  end: number
}

/** Objective words are whitespace delimited, unlike the condition lexer's tokens. */
function nextChunk(source: string, from: number): Chunk | undefined {
  let i = from
  while (i < source.length && SPACE.test(source[i])) i += 1
  if (i >= source.length) return undefined
  let j = i
  while (j < source.length && !SPACE.test(source[j])) j += 1
  return { text: source.slice(i, j), start: i, end: j }
}

function requireChunk(source: string, from: number, what: string): Chunk {
  const chunk = nextChunk(source, from)
  if (chunk === undefined) throw new ConditionSyntaxError(`expected ${what}`, source.length)
  return chunk
}

function requireRef(source: string, from: number, what: string): Chunk {
  const chunk = requireChunk(source, from, what)
  if (!REF_PATTERN.test(chunk.text)) {
    throw new ConditionSyntaxError(`invalid ${what} ${JSON.stringify(chunk.text)}`, chunk.start)
  }
  return chunk
}

/** Reads a trailing count when the next word is an integer, and leaves it alone otherwise. */
function optionalCount(source: string, from: number): { count?: number; end: number } {
  const chunk = nextChunk(source, from)
  if (chunk === undefined || !INTEGER.test(chunk.text)) return { end: from }
  const count = Number(chunk.text)
  if (count < 1) {
    throw new ConditionSyntaxError('count must be a positive integer', chunk.start)
  }
  return { count, end: chunk.end }
}

function parseObjectiveAt(source: string, from: number): { objective: Objective; end: number } {
  const head = requireChunk(source, from, 'an objective kind')
  const kind = head.text.toLowerCase()
  if (kind === 'kill') {
    const actor = requireRef(source, head.end, 'an actor reference')
    const { count, end } = optionalCount(source, actor.end)
    return {
      objective: { kind: 'kill', actor: actor.text, ...(count === undefined ? {} : { count }) },
      end,
    }
  }
  if (kind === 'collect') {
    const item = requireRef(source, head.end, 'an item reference')
    const { count, end } = optionalCount(source, item.end)
    return {
      objective: { kind: 'collect', item: item.text, ...(count === undefined ? {} : { count }) },
      end,
    }
  }
  if (kind === 'reach') {
    const location = requireRef(source, head.end, 'a location reference')
    return { objective: { kind: 'reach', location: location.text }, end: location.end }
  }
  if (kind === 'talk') {
    const actor = requireRef(source, head.end, 'an actor reference')
    const dialogue = nextChunk(source, actor.end)
    if (
      dialogue === undefined ||
      dialogue.text.toLowerCase() === 'and' ||
      !REF_PATTERN.test(dialogue.text)
    ) {
      return { objective: { kind: 'talk', actor: actor.text }, end: actor.end }
    }
    return {
      objective: { kind: 'talk', actor: actor.text, dialogue: dialogue.text },
      end: dialogue.end,
    }
  }
  if (kind === 'interact') {
    const object = requireRef(source, head.end, 'an object reference')
    return { objective: { kind: 'interact', object: object.text }, end: object.end }
  }
  if (kind === 'event') {
    const event = requireRef(source, head.end, 'an event name')
    const { count, end } = optionalCount(source, event.end)
    return {
      objective: { kind: 'event', event: event.text, ...(count === undefined ? {} : { count }) },
      end,
    }
  }
  if (kind === 'custom') {
    const custom = requireRef(source, head.end, 'a custom kind')
    const args: string[] = []
    let end = custom.end
    for (;;) {
      const chunk = nextChunk(source, end)
      if (chunk === undefined || chunk.text.toLowerCase() === 'and') break
      args.push(chunk.text)
      end = chunk.end
    }
    return { objective: { kind: 'custom', custom: custom.text, args }, end }
  }
  throw new ConditionSyntaxError(`unknown objective kind ${JSON.stringify(head.text)}`, head.start)
}

/** Parse a bare objective such as `collect fish.rare 5`. Throws ConditionSyntaxError. */
export function parseObjective(source: string): Objective {
  const { objective, end } = parseObjectiveAt(source, 0)
  const trailing = nextChunk(source, end)
  if (trailing !== undefined) {
    throw new ConditionSyntaxError(`unexpected ${JSON.stringify(trailing.text)}`, trailing.start)
  }
  return objective
}

/**
 * Parse a step `complete` cell: `<objective> [and <condition>]` or `<condition>`.
 * Returns whichever parts are present.
 */
export function parseCompletion(source: string): {
  objective?: Objective
  condition?: Condition
} {
  const head = nextChunk(source, 0)
  if (head === undefined) {
    throw new ConditionSyntaxError('expected an objective or a condition', 0)
  }
  if (!(OBJECTIVE_KINDS as readonly string[]).includes(head.text.toLowerCase())) {
    return { condition: parseCondition(source) }
  }
  const { objective, end } = parseObjectiveAt(source, 0)
  const parser = new Parser(source, end)
  if (parser.atEnd()) return { objective }
  parser.expectKeyword('and')
  const condition = parser.parseExpression()
  parser.expectEnd()
  return { objective, condition }
}
