/**
 * Condition trees to and from Ink and Yarn Spinner expression syntax.
 *
 * The two dialects differ in three places only, so one renderer and one parser
 * serve both:
 *
 * | Concern | Ink | Yarn |
 * |---------|-----|------|
 * | variable | `flag__met` | `$flag__met` |
 * | membership | `["spring", "summer"] ? var__season` | `$var__season in ["spring", "summer"]` |
 * | boolean words | `and` `or` `not` | `and` `or` `not` |
 *
 * Neither language has an inline list literal, so `in` is an OQF extension in
 * both. A host that runs the exported file has to expand it, usually into a
 * chain of `==` comparisons. Everything else is ordinary Ink and Yarn: `==`,
 * `!=`, `<`, `<=`, `>`, `>=`, parentheses, numbers, quoted strings, `true` and
 * `false`.
 *
 * Rendering is canonical: lowercase keywords, single spaces, double quoted
 * strings and the fewest parentheses that still reproduce the tree. No sugar is
 * applied, so `{ '==': [{ var: 'flag.x' }, true] }` renders as `flag__x == true`
 * and a bare `{ var: 'flag.x' }` renders as `flag__x`, and the two read back
 * apart. `parseExpression(renderExpression(t, d), d)` returns `t`.
 */
import type { Condition } from '@oqf/core'
import { fromIdentifier, toIdentifier } from './naming.js'

export type Dialect = 'ink' | 'yarn'

/** Thrown when an expression cannot be read. Importers turn this into a warning. */
export class ExpressionError extends Error {
  readonly offset: number

  constructor(message: string, offset: number) {
    super(message)
    this.name = 'ExpressionError'
    this.offset = offset
  }
}

const LEVEL_OR = 1
const LEVEL_AND = 2
const LEVEL_NOT = 3
const LEVEL_COMPARISON = 4

const COMPARISONS = ['==', '!=', '<', '<=', '>', '>=']

interface Entry {
  operator: string
  args: unknown
}

function entry(node: unknown): Entry | undefined {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return undefined
  const keys = Object.keys(node)
  if (keys.length !== 1) return undefined
  return { operator: keys[0], args: (node as Record<string, unknown>)[keys[0]] }
}

function operands(args: unknown): unknown[] {
  return Array.isArray(args) ? args : [args]
}

function quote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function renderLiteral(value: unknown): string {
  if (typeof value === 'string') return quote(value)
  if (Array.isArray(value)) return `[${value.map(renderLiteral).join(', ')}]`
  return String(value)
}

function renderVariable(path: string, dialect: Dialect): string {
  return dialect === 'yarn' ? `$${toIdentifier(path)}` : toIdentifier(path)
}

function wrap(text: string, level: number, required: number): string {
  return level < required ? `(${text})` : text
}

function renderOperand(node: unknown, dialect: Dialect): string {
  const current = entry(node)
  if (current === undefined) return renderLiteral(node)
  if (current.operator === 'var') return renderVariable(String(current.args), dialect)
  return `(${render(node, dialect, LEVEL_OR)})`
}

function render(node: unknown, dialect: Dialect, required: number): string {
  const current = entry(node)
  if (current === undefined) return renderLiteral(node)
  if (current.operator === 'var') return renderVariable(String(current.args), dialect)
  if (current.operator === 'and') {
    const parts = operands(current.args).map((part) => render(part, dialect, LEVEL_NOT))
    return wrap(parts.join(' and '), LEVEL_AND, required)
  }
  if (current.operator === 'or') {
    const parts = operands(current.args).map((part) => render(part, dialect, LEVEL_AND))
    return wrap(parts.join(' or '), LEVEL_OR, required)
  }
  if (current.operator === '!') {
    return wrap(`not ${render(operands(current.args)[0], dialect, LEVEL_NOT)}`, LEVEL_NOT, required)
  }
  if (current.operator === 'in') {
    const [value, list] = operands(current.args)
    const text =
      dialect === 'yarn'
        ? `${renderOperand(value, dialect)} in ${renderOperand(list, dialect)}`
        : `${renderOperand(list, dialect)} ? ${renderOperand(value, dialect)}`
    return wrap(text, LEVEL_COMPARISON, required)
  }
  if (COMPARISONS.includes(current.operator)) {
    const [left, right] = operands(current.args)
    const text = `${renderOperand(left, dialect)} ${current.operator} ${renderOperand(right, dialect)}`
    return wrap(text, LEVEL_COMPARISON, required)
  }
  throw new ExpressionError(`cannot render condition operator "${current.operator}"`, 0)
}

/** Render a condition tree as an Ink or Yarn expression. */
export function renderExpression(condition: Condition, dialect: Dialect): string {
  return render(condition, dialect, LEVEL_OR)
}

interface Token {
  kind: 'name' | 'number' | 'string' | 'punct'
  text: string
  value?: string | number
  offset: number
}

const PUNCTUATION = [
  '==',
  '!=',
  '<=',
  '>=',
  '&&',
  '||',
  '(',
  ')',
  '[',
  ']',
  ',',
  '<',
  '>',
  '!',
  '?',
]

function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  let index = 0
  while (index < text.length) {
    const char = text[index]
    if (/\s/.test(char)) {
      index += 1
      continue
    }
    if (char === '"') {
      let value = ''
      let cursor = index + 1
      let closed = false
      while (cursor < text.length) {
        const inner = text[cursor]
        if (inner === '\\') {
          value += text[cursor + 1] ?? ''
          cursor += 2
          continue
        }
        if (inner === '"') {
          closed = true
          cursor += 1
          break
        }
        value += inner
        cursor += 1
      }
      if (!closed) throw new ExpressionError('unterminated string literal', index)
      tokens.push({ kind: 'string', text: text.slice(index, cursor), value, offset: index })
      index = cursor
      continue
    }
    if (/[0-9]/.test(char) || (char === '-' && /[0-9]/.test(text[index + 1] ?? ''))) {
      const match = /^-?[0-9]+(?:\.[0-9]+)?(?:[eE][-+]?[0-9]+)?/.exec(text.slice(index))
      if (match === null) throw new ExpressionError('malformed number', index)
      tokens.push({ kind: 'number', text: match[0], value: Number(match[0]), offset: index })
      index += match[0].length
      continue
    }
    if (/[A-Za-z_$]/.test(char)) {
      const match = /^\$?[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(index))
      if (match === null) throw new ExpressionError('malformed identifier', index)
      tokens.push({ kind: 'name', text: match[0], offset: index })
      index += match[0].length
      continue
    }
    const punct = PUNCTUATION.find((item) => text.startsWith(item, index))
    if (punct === undefined) {
      throw new ExpressionError(`unexpected character ${JSON.stringify(char)}`, index)
    }
    tokens.push({ kind: 'punct', text: punct, offset: index })
    index += punct.length
  }
  return tokens
}

class Parser {
  private readonly tokens: Token[]
  private readonly dialect: Dialect
  private readonly length: number
  private position = 0

  constructor(tokens: Token[], dialect: Dialect, length: number) {
    this.tokens = tokens
    this.dialect = dialect
    this.length = length
  }

  private peek(): Token | undefined {
    return this.tokens[this.position]
  }

  private at(text: string): boolean {
    const token = this.peek()
    if (token === undefined) return false
    if (token.kind === 'punct') return token.text === text
    return token.kind === 'name' && token.text.toLowerCase() === text
  }

  private take(): Token {
    const token = this.tokens[this.position]
    if (token === undefined) throw new ExpressionError('unexpected end of expression', this.length)
    this.position += 1
    return token
  }

  private expect(text: string): void {
    if (!this.at(text)) {
      const token = this.peek()
      throw new ExpressionError(
        `expected ${JSON.stringify(text)}`,
        token === undefined ? this.length : token.offset,
      )
    }
    this.position += 1
  }

  parse(): Condition {
    const value = this.parseOr()
    const rest = this.peek()
    if (rest !== undefined) {
      throw new ExpressionError(`unexpected ${JSON.stringify(rest.text)}`, rest.offset)
    }
    return value
  }

  private parseOr(): Condition {
    const parts = [this.parseAnd()]
    while (this.at('or') || this.at('||')) {
      this.position += 1
      parts.push(this.parseAnd())
    }
    return parts.length === 1 ? parts[0] : { or: parts }
  }

  private parseAnd(): Condition {
    const parts = [this.parseNot()]
    while (this.at('and') || this.at('&&')) {
      this.position += 1
      parts.push(this.parseNot())
    }
    return parts.length === 1 ? parts[0] : { and: parts }
  }

  private parseNot(): Condition {
    if (this.at('not') || this.at('!')) {
      this.position += 1
      return { '!': [this.parseNot()] }
    }
    return this.parseComparison()
  }

  private parseComparison(): Condition {
    const left = this.parsePrimary()
    const token = this.peek()
    if (token === undefined) return left
    if (token.kind === 'punct' && COMPARISONS.includes(token.text)) {
      this.position += 1
      const right = this.parsePrimary()
      return { [token.text]: [left, right] } as Condition
    }
    if (this.dialect === 'ink' && token.kind === 'punct' && token.text === '?') {
      this.position += 1
      return { in: [this.parsePrimary(), left] }
    }
    if (this.dialect === 'yarn' && token.kind === 'name' && token.text.toLowerCase() === 'in') {
      this.position += 1
      return { in: [left, this.parsePrimary()] }
    }
    return left
  }

  private parsePrimary(): Condition {
    const token = this.take()
    if (token.kind === 'number') return token.value as number
    if (token.kind === 'string') return token.value as string
    if (token.kind === 'punct' && token.text === '(') {
      const inner = this.parseOr()
      this.expect(')')
      return inner
    }
    if (token.kind === 'punct' && token.text === '[') {
      const items: (string | number | boolean)[] = []
      if (!this.at(']')) {
        for (;;) {
          const item = this.parsePrimary()
          if (typeof item === 'object') {
            throw new ExpressionError('a list may only hold scalars', token.offset)
          }
          items.push(item as string | number | boolean)
          if (!this.at(',')) break
          this.position += 1
        }
      }
      this.expect(']')
      return items
    }
    if (token.kind === 'punct' && (token.text === '!' || token.text === '-')) {
      throw new ExpressionError(`unexpected ${JSON.stringify(token.text)}`, token.offset)
    }
    if (token.kind !== 'name') {
      throw new ExpressionError(`unexpected ${JSON.stringify(token.text)}`, token.offset)
    }
    if (token.text === 'true') return true
    if (token.text === 'false') return false
    if (this.at('(')) {
      throw new ExpressionError(`function call "${token.text}" has no OQF equivalent`, token.offset)
    }
    const bare = token.text.startsWith('$') ? token.text.slice(1) : token.text
    return { var: fromIdentifier(bare) }
  }
}

/** Read an Ink or Yarn expression into a condition tree. Throws ExpressionError. */
export function parseExpression(text: string, dialect: Dialect): Condition {
  const trimmed = text.trim()
  if (trimmed === '') throw new ExpressionError('empty expression', 0)
  return new Parser(tokenize(trimmed), dialect, trimmed.length).parse()
}
