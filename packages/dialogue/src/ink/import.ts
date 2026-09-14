/**
 * Ink source text to an OQF dialogue document, best effort.
 *
 * This reads Ink the language, not the compiled JSON. It understands everything
 * `toInk` writes and the hand written forms that sit closest to it:
 *
 * - knots `=== name ===`, stitches `= name`, lines, tags, comments
 * - diverts `-> target`, `-> END`, `-> DONE`, and a divert at the end of a line
 * - choices `*` and `+`, a `{ guard }`, `[ bracket ]` text, a trailing divert
 * - gathers `-` used as a simple join, which become an implicit node
 * - `~ variable = value`, `~ oqf_emit(...)`, `VAR`, `EXTERNAL`
 *
 * Everything else is named in a warning and skipped: tunnels, threads, inline
 * logic and sequences inside a line, conditional blocks, `~ temp`, `~ return`,
 * other function calls, `CONST`, `LIST`, `INCLUDE`, glue, choice labels,
 * nested choices and gathers, unknown tags, `TODO:`, diverts that leave the
 * knot or point nowhere. The importer never throws on an unknown construct. It
 * throws only when the structure is unbalanced: an unterminated block comment
 * or an inline logic block that is never closed.
 *
 * Text that a line cannot hold literally is un-escaped here the way
 * `escapeInkText` wrote it, so `\#`, `\{`, `\n` and friends come back.
 *
 * Implicit nodes: a gather, a second line inside one stitch and any line inside
 * a choice body all need a node of their own, since an OQF node holds exactly
 * one line. They are named `<stitch>__1`, `<stitch>__2` and so on, or
 * `start__1` when they belong to the knot body itself.
 */
import type { Condition, Ref, Scalar } from '@oqf/core'
import type { Choice, Conversation, DialogueDocument, DialogueNode, EmitSpec } from '../model.js'
import { ExpressionError, parseExpression } from './expression.js'
import {
  type ImportWarning,
  decodeExt,
  decodePayload,
  decodeSpeakerList,
  decodeTagValue,
  fromIdentifier,
} from './naming.js'

export interface InkImportResult {
  document: DialogueDocument
  warnings: ImportWarning[]
}

interface RawTag {
  name: string
  value: string | undefined
  line: number
}

interface DivertRef {
  target: string
  line: number
}

type Statement =
  | { kind: 'knot'; name: string; line: number }
  | { kind: 'stitch'; name: string; line: number }
  | { kind: 'tag'; tag: RawTag; line: number }
  | { kind: 'logic'; text: string; line: number }
  | { kind: 'text'; text: string; tags: RawTag[]; divert?: DivertRef; line: number }
  | { kind: 'divert'; divert: DivertRef; line: number }
  | { kind: 'gather'; depth: number; line: number }
  | {
      kind: 'choice'
      depth: number
      sticky: boolean
      guard?: string
      text: string
      tags: RawTag[]
      divert?: DivertRef
      line: number
    }

/** Drop one level of Ink escaping from a line of text. */
export function unescapeInk(text: string): string {
  let out = ''
  let escaped = false
  for (const char of text) {
    if (escaped) {
      out += char === 'n' ? '\n' : char === 'r' ? '\r' : char === 't' ? '\t' : char
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    out += char
  }
  return out
}

function isEscaped(text: string, index: number): boolean {
  let count = 0
  let cursor = index - 1
  while (cursor >= 0 && text[cursor] === '\\') {
    count += 1
    cursor -= 1
  }
  return count % 2 === 1
}

/** Trim a line without eating whitespace a backslash protects. */
function trimInk(line: string): string {
  const left = line.replace(/^\s+/, '')
  let end = left.length
  while (end > 0 && /\s/.test(left[end - 1]) && !isEscaped(left, end - 1)) end -= 1
  return left.slice(0, end)
}

function findUnescaped(text: string, char: string, from: number): number {
  for (let index = from; index < text.length; index += 1) {
    if (text[index] === char && !isEscaped(text, index)) return index
  }
  return -1
}

function matchBrace(text: string, open: number): number {
  let depth = 0
  for (let index = open; index < text.length; index += 1) {
    if (isEscaped(text, index)) continue
    if (text[index] === '{') depth += 1
    else if (text[index] === '}') {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

class Importer {
  readonly warnings: ImportWarning[] = []

  warn(line: number, construct: string, message: string): void {
    this.warnings.push({ line, construct, message })
  }

  /** Strip comments, keeping line numbers. Throws on an unterminated block comment. */
  private strip(source: string): { text: string; line: number }[] {
    const out: { text: string; line: number }[] = []
    let inBlock = false
    let blockStart = 0
    const lines = source.split(/\r?\n/)
    for (let index = 0; index < lines.length; index += 1) {
      const number = index + 1
      let text = lines[index]
      let result = ''
      let cursor = 0
      while (cursor < text.length) {
        if (inBlock) {
          const close = text.indexOf('*/', cursor)
          if (close === -1) {
            cursor = text.length
            break
          }
          inBlock = false
          cursor = close + 2
          continue
        }
        const char = text[cursor]
        if (char === '\\') {
          result += text.slice(cursor, cursor + 2)
          cursor += 2
          continue
        }
        if (text.startsWith('//', cursor)) {
          cursor = text.length
          break
        }
        if (text.startsWith('/*', cursor)) {
          inBlock = true
          blockStart = number
          cursor += 2
          continue
        }
        result += char
        cursor += 1
      }
      text = result
      if (/^\s*TODO\s*:/.test(text)) {
        this.warn(number, 'todo', 'a TODO line has no OQF equivalent and was skipped')
        continue
      }
      out.push({ text, line: number })
    }
    if (inBlock) {
      throw new Error(
        `unbalanced ink source: block comment opened on line ${blockStart} is never closed`,
      )
    }
    return out
  }

  /** Pull tags, a trailing divert and inline logic out of the content part of a line. */
  private scanContent(
    raw: string,
    line: number,
  ): { text: string; tags: RawTag[]; divert?: DivertRef } {
    let text = raw
    const tags: RawTag[] = []
    const hash = findUnescaped(text, '#', 0)
    if (hash !== -1) {
      const tail = text.slice(hash + 1)
      text = text.slice(0, hash)
      let rest = tail
      for (;;) {
        const next = findUnescaped(rest, '#', 0)
        const piece = next === -1 ? rest : rest.slice(0, next)
        tags.push(this.readTag(piece, line))
        if (next === -1) break
        rest = rest.slice(next + 1)
      }
    }
    for (;;) {
      const open = findUnescaped(text, '{', 0)
      if (open === -1) break
      const close = matchBrace(text, open)
      if (close === -1) {
        throw new Error(`unbalanced ink source: "{" on line ${line} is never closed`)
      }
      const body = text.slice(open + 1, close)
      const construct = findUnescaped(body, '|', 0) === -1 ? 'inline-logic' : 'sequence'
      this.warn(
        line,
        construct,
        `inline ${construct === 'sequence' ? 'sequence' : 'logic'} "{${body}}" has no OQF equivalent and was dropped`,
      )
      text = text.slice(0, open) + text.slice(close + 1)
    }
    let divert: DivertRef | undefined
    const arrow = this.findArrow(text)
    if (arrow !== -1) {
      const target = trimInk(text.slice(arrow + 2))
      text = text.slice(0, arrow)
      divert = this.readDivert(target, line)
    }
    const glue = text.indexOf('<>')
    if (glue !== -1 && !isEscaped(text, glue)) {
      this.warn(line, 'glue', 'glue "<>" has no OQF equivalent and was dropped')
      text = text.split('<>').join('')
    }
    return { text: trimInk(text), tags, divert }
  }

  private findArrow(text: string): number {
    for (let index = 0; index + 1 < text.length; index += 1) {
      if (text[index] === '-' && text[index + 1] === '>' && !isEscaped(text, index)) return index
    }
    return -1
  }

  private readDivert(target: string, line: number): DivertRef {
    let value = target.trim()
    if (value.startsWith('->')) {
      this.warn(line, 'tunnel', 'a tunnel return "->->" has no OQF equivalent and was dropped')
      value = value.slice(2).trim()
    }
    if (value.endsWith('->')) {
      this.warn(line, 'tunnel', 'a tunnel call "-> knot ->" has no OQF equivalent and was dropped')
      value = value.slice(0, -2).trim()
    }
    return { target: value, line }
  }

  private readTag(piece: string, line: number): RawTag {
    const text = piece.trim()
    const colon = text.indexOf(':')
    if (colon === -1) return { name: text.toLowerCase(), value: undefined, line }
    return {
      name: text.slice(0, colon).trim().toLowerCase(),
      value: text.slice(colon + 1).trim(),
      line,
    }
  }

  /** Turn the source into a flat statement list, with declarations consumed. */
  lex(source: string): { statements: Statement[]; speakers: Ref[]; declared: boolean } {
    const statements: Statement[] = []
    const speakers: Ref[] = []
    let declared = false
    const lines = this.strip(source)
    let seenKnot = false
    let skipping = false
    for (let index = 0; index < lines.length; index += 1) {
      const { line } = lines[index]
      const text = trimInk(lines[index].text)
      if (text === '') continue
      const opens = findUnescaped(text, '{', 0)
      if (opens !== -1 && matchBrace(text, opens) === -1) {
        index = this.skipBlock(lines, index, line)
        continue
      }
      if (/^==+/.test(text)) {
        const name = text.replace(/^=+/, '').replace(/=+$/, '').trim()
        if (name === '') continue
        if (/[(]/.test(name) || /^function\b/.test(name)) {
          this.warn(
            line,
            'function',
            `ink function "${name}" has no OQF equivalent and was skipped`,
          )
          skipping = true
          continue
        }
        skipping = false
        seenKnot = true
        statements.push({ kind: 'knot', name, line })
        continue
      }
      if (skipping) continue
      if (/^=[^=]/.test(text) || text === '=') {
        const name = text.slice(1).trim()
        if (/[(]/.test(name)) {
          this.warn(
            line,
            'function',
            `ink function "${name}" has no OQF equivalent and was skipped`,
          )
          continue
        }
        statements.push({ kind: 'stitch', name, line })
        continue
      }
      if (/^(VAR|CONST|LIST|EXTERNAL|INCLUDE)\b/.test(text)) {
        this.declaration(text, line)
        continue
      }
      if (text.startsWith('#')) {
        const tag = this.readTag(text.slice(1), line)
        if (tag.name === 'oqf_speakers') {
          declared = true
          for (const speaker of decodeSpeakerList(decodeTagValue(tag.value ?? ''))) {
            speakers.push(speaker.name === undefined ? { id: speaker.id } : speaker)
          }
          continue
        }
        statements.push({ kind: 'tag', tag, line })
        continue
      }
      if (text.startsWith('<-')) {
        this.warn(line, 'thread', 'a thread "<-" has no OQF equivalent and was skipped')
        continue
      }
      if (text.startsWith('~')) {
        statements.push({ kind: 'logic', text: text.slice(1).trim(), line })
        continue
      }
      if (text.startsWith('->')) {
        statements.push({ kind: 'divert', divert: this.readDivert(text.slice(2), line), line })
        continue
      }
      if (text[0] === '*' || text[0] === '+') {
        statements.push(this.readChoice(text, line))
        continue
      }
      if (text[0] === '-' && (text.length === 1 || text[1] === ' ' || text[1] === '-')) {
        let depth = 0
        let cursor = 0
        while (cursor < text.length && text[cursor] === '-') {
          depth += 1
          cursor += 1
          while (text[cursor] === ' ') cursor += 1
        }
        statements.push({ kind: 'gather', depth, line })
        const rest = trimInk(text.slice(cursor))
        if (rest !== '') {
          if (rest.startsWith('->')) {
            statements.push({ kind: 'divert', divert: this.readDivert(rest.slice(2), line), line })
          } else {
            const scanned = this.scanContent(rest, line)
            statements.push({
              kind: 'text',
              text: scanned.text,
              tags: scanned.tags,
              divert: scanned.divert,
              line,
            })
          }
        }
        continue
      }
      if (!seenKnot) {
        this.warn(
          line,
          'stray-content',
          'content before the first knot has no OQF equivalent and was skipped',
        )
        continue
      }
      const scanned = this.scanContent(text, line)
      statements.push({
        kind: 'text',
        text: scanned.text,
        tags: scanned.tags,
        divert: scanned.divert,
        line,
      })
    }
    return { statements, speakers, declared }
  }

  private skipBlock(lines: { text: string; line: number }[], start: number, line: number): number {
    let depth = 0
    for (let index = start; index < lines.length; index += 1) {
      const text = lines[index].text
      for (let cursor = 0; cursor < text.length; cursor += 1) {
        if (isEscaped(text, cursor)) continue
        if (text[cursor] === '{') depth += 1
        else if (text[cursor] === '}') depth -= 1
      }
      if (depth <= 0) {
        this.warn(
          line,
          'conditional-block',
          'a multi line logic block has no OQF equivalent and was skipped',
        )
        return index
      }
    }
    throw new Error(`unbalanced ink source: "{" on line ${line} is never closed`)
  }

  private declaration(text: string, line: number): void {
    if (text.startsWith('VAR')) return
    if (text.startsWith('EXTERNAL')) {
      if (/^EXTERNAL\s+oqf_emit\b/.test(text)) return
      this.warn(line, 'external', `external function "${text}" is not oqf_emit and was skipped`)
      return
    }
    if (text.startsWith('CONST')) {
      this.warn(line, 'const', 'CONST has no OQF equivalent and was skipped')
      return
    }
    if (text.startsWith('LIST')) {
      this.warn(line, 'list', 'an ink LIST has no OQF equivalent and was skipped')
      return
    }
    this.warn(line, 'include', 'INCLUDE has no OQF equivalent and was skipped')
  }

  private readChoice(text: string, line: number): Statement {
    let depth = 0
    let cursor = 0
    const sticky = text[0] === '+'
    while (cursor < text.length && (text[cursor] === '*' || text[cursor] === '+')) {
      depth += 1
      cursor += 1
      while (text[cursor] === ' ') cursor += 1
    }
    let rest = trimInk(text.slice(cursor))
    if (rest.startsWith('(')) {
      const close = rest.indexOf(')')
      if (close !== -1) {
        this.warn(
          line,
          'choice-label',
          'a choice label "(name)" has no OQF equivalent and was dropped',
        )
        rest = trimInk(rest.slice(close + 1))
      }
    }
    let guard: string | undefined
    if (rest.startsWith('{')) {
      const close = matchBrace(rest, 0)
      if (close === -1) {
        throw new Error(`unbalanced ink source: choice guard on line ${line} is never closed`)
      }
      guard = rest.slice(1, close).trim()
      rest = trimInk(rest.slice(close + 1))
    }
    const scanned = this.scanContent(rest, line)
    return {
      kind: 'choice',
      depth,
      sticky,
      guard,
      text: scanned.text,
      tags: scanned.tags,
      divert: scanned.divert,
      line,
    }
  }

  /** Read a guard into a condition, warning instead of failing. */
  condition(text: string, line: number): Condition | undefined {
    try {
      return parseExpression(text, 'ink')
    } catch (error) {
      const reason = error instanceof ExpressionError ? error.message : String(error)
      const construct = reason.includes('function call') ? 'function' : 'condition'
      this.warn(line, construct, `guard "{${text}}" could not be read (${reason}) and was dropped`)
      return undefined
    }
  }
}

interface Pending {
  tags: RawTag[]
  set: { flag: string; value?: Scalar }[]
  emit: EmitSpec[]
}

function emptyPending(): Pending {
  return { tags: [], set: [], emit: [] }
}

/** Read one `~ ...` statement into a flag set, an emit, or a warning. */
function readLogic(importer: Importer, text: string, line: number, pending: Pending): void {
  if (/^temp\b/.test(text)) {
    importer.warn(line, 'temp', '"~ temp" declares a local and has no OQF equivalent, skipped')
    return
  }
  if (/^return\b/.test(text)) {
    importer.warn(line, 'return', '"~ return" has no OQF equivalent and was skipped')
    return
  }
  const call = /^([A-Za-z_][A-Za-z0-9_]*)\s*\((.*)\)\s*$/.exec(text)
  if (call !== null) {
    if (call[1] !== 'oqf_emit') {
      importer.warn(
        line,
        'function',
        `function call "${call[1]}(...)" has no OQF equivalent and was skipped`,
      )
      return
    }
    const args = readArguments(call[2])
    if (args.length === 0) {
      importer.warn(line, 'function', 'oqf_emit needs an event name and was skipped')
      return
    }
    const payload = decodePayload(args[1] ?? '')
    pending.emit.push(
      Object.keys(payload).length === 0 ? { event: args[0] } : { event: args[0], payload },
    )
    return
  }
  const assign = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(text)
  if (assign === null) {
    importer.warn(
      line,
      'logic',
      `"~ ${text}" is not an assignment or oqf_emit call and was skipped`,
    )
    return
  }
  const path = fromIdentifier(assign[1])
  let flag = path
  if (path.startsWith('flag.')) {
    flag = path.slice(5)
  } else {
    importer.warn(
      line,
      'variable',
      `"${assign[1]}" is not a flag.* variable, it was read as the flag "${path}"`,
    )
  }
  const value = readValue(assign[2].trim())
  pending.set.push(value === true ? { flag } : { flag, value })
}

function readValue(text: string): Scalar {
  if (text === 'true') return true
  if (text === 'false') return false
  if (text.startsWith('"')) {
    return text.slice(1, text.endsWith('"') ? -1 : undefined).replace(/\\(.)/g, '$1')
  }
  const number = Number(text)
  return Number.isNaN(number) ? text : number
}

/** Split `"a", "b"` into unquoted arguments. A quoted argument keeps its spaces. */
function readArguments(text: string): string[] {
  const args: string[] = []
  let current = ''
  let quoted = false
  let started = false
  let escaped = false
  for (const char of text) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '"') {
      if (!quoted && !started && current.trim() === '') current = ''
      quoted = !quoted
      started = true
      continue
    }
    if (char === ',' && !quoted) {
      args.push(started ? current : current.trim())
      current = ''
      started = false
      continue
    }
    current += char
  }
  if (started || current.trim() !== '' || args.length > 0) {
    args.push(started ? current : current.trim())
  }
  return args
}

interface StitchData {
  name: string
  /** The node id, from a `# node:` tag when there is one, else the stitch name. */
  id: string
  line: number
  body: Statement[]
}

interface KnotData {
  name: string
  /** The conversation id, from a `# conversation:` tag when there is one, else the knot name. */
  id: string
  line: number
  preamble: Statement[]
  stitches: StitchData[]
}

function group(statements: Statement[]): KnotData[] {
  const knots: KnotData[] = []
  let knot: KnotData | undefined
  let stitch: StitchData | undefined
  for (const statement of statements) {
    if (statement.kind === 'knot') {
      knot = {
        name: statement.name,
        id: statement.name,
        line: statement.line,
        preamble: [],
        stitches: [],
      }
      stitch = undefined
      knots.push(knot)
      continue
    }
    if (knot === undefined) continue
    if (statement.kind === 'stitch') {
      stitch = { name: statement.name, id: statement.name, line: statement.line, body: [] }
      knot.stitches.push(stitch)
      continue
    }
    if (
      statement.kind === 'tag' &&
      statement.tag.name === 'node' &&
      statement.tag.value !== undefined
    ) {
      if (stitch !== undefined) stitch.id = decodeTagValue(statement.tag.value)
      continue
    }
    if (
      statement.kind === 'tag' &&
      statement.tag.name === 'conversation' &&
      statement.tag.value !== undefined &&
      stitch === undefined
    ) {
      knot.id = decodeTagValue(statement.tag.value)
      continue
    }
    if (stitch === undefined) knot.preamble.push(statement)
    else stitch.body.push(statement)
  }
  return knots
}

class Builder {
  private readonly importer: Importer
  private readonly knots: KnotData[]

  constructor(importer: Importer, knots: KnotData[]) {
    this.importer = importer
    this.knots = knots
  }

  build(): Conversation[] {
    const conversations: Conversation[] = []
    for (const knot of this.knots) {
      const conversation = this.buildKnot(knot)
      if (conversation !== undefined) conversations.push(conversation)
    }
    return conversations
  }

  private resolve(knot: KnotData, target: string, line: number): string | undefined {
    if (target === 'END' || target === 'DONE' || target === '') return undefined
    const parts = target.split('.')
    const stitches = knot.stitches.map((item) => item.name)
    const idOf = (name: string): string => {
      return knot.stitches.find((item) => item.name === name)?.id ?? name
    }
    if (parts.length === 2) {
      if (parts[0] === knot.name && stitches.includes(parts[1])) return idOf(parts[1])
      this.importer.warn(
        line,
        'cross-knot-divert',
        `divert "-> ${target}" leaves the knot "${knot.name}" and was dropped`,
      )
      return undefined
    }
    if (stitches.includes(target)) return idOf(target)
    if (this.knots.some((item) => item.name === target)) {
      this.importer.warn(
        line,
        'cross-knot-divert',
        `divert "-> ${target}" leaves the knot "${knot.name}" and was dropped`,
      )
      return undefined
    }
    this.importer.warn(line, 'divert', `divert "-> ${target}" points at nothing and was dropped`)
    return undefined
  }

  private buildKnot(knot: KnotData): Conversation | undefined {
    const nodes: DialogueNode[] = []
    const taken = new Set(knot.stitches.map((item) => item.id))
    const conversation: Conversation = { id: knot.id, start: '', nodes }
    const flow = (base: string | undefined, body: Statement[]): string | undefined => {
      return new Flow(this.importer, this, knot, conversation, nodes, taken, base).run(body)
    }
    const start = flow(undefined, knot.preamble)
    for (const stitch of knot.stitches) flow(stitch.id, stitch.body)
    if (nodes.length === 0) {
      this.importer.warn(
        knot.line,
        'empty-knot',
        `knot "${knot.name}" has no content and was skipped`,
      )
      return undefined
    }
    conversation.start = start ?? nodes[0].id
    return conversation
  }

  resolveFor(knot: KnotData, target: string, line: number): string | undefined {
    return this.resolve(knot, target, line)
  }
}

class Flow {
  private readonly importer: Importer
  private readonly builder: Builder
  private readonly knot: KnotData
  private readonly conversation: Conversation
  private readonly nodes: DialogueNode[]
  private readonly taken: Set<string>
  private readonly base: string | undefined
  private usedBase = false
  private counter = 0
  private pending = emptyPending()
  private current: DialogueNode | undefined
  private chainOpen = false
  private entry: string | undefined
  private dangling: Choice[] = []
  private gatherPending: Choice[] | undefined

  constructor(
    importer: Importer,
    builder: Builder,
    knot: KnotData,
    conversation: Conversation,
    nodes: DialogueNode[],
    taken: Set<string>,
    base: string | undefined,
  ) {
    this.importer = importer
    this.builder = builder
    this.knot = knot
    this.conversation = conversation
    this.nodes = nodes
    this.taken = taken
    this.base = base
  }

  private freshId(): string {
    if (this.base !== undefined && !this.usedBase) {
      this.usedBase = true
      return this.base
    }
    const prefix = this.base ?? 'start'
    for (;;) {
      this.counter += 1
      const candidate = `${prefix}__${this.counter}`
      if (!this.taken.has(candidate)) {
        this.taken.add(candidate)
        return candidate
      }
    }
  }

  private openNode(text: string): DialogueNode {
    const node: DialogueNode = { id: this.freshId(), text }
    if (this.current !== undefined && this.chainOpen && (this.current.choices ?? []).length === 0) {
      this.current.next = node.id
    }
    if (this.gatherPending !== undefined) {
      for (const choice of this.gatherPending) choice.next = node.id
      this.gatherPending = undefined
    }
    this.nodes.push(node)
    if (this.entry === undefined) this.entry = node.id
    this.current = node
    this.chainOpen = true
    this.flush(node)
    return node
  }

  private flush(node: DialogueNode): void {
    for (const tag of this.pending.tags) this.applyNodeTag(node, tag)
    if (this.pending.set.length > 0) node.set = [...(node.set ?? []), ...this.pending.set]
    if (this.pending.emit.length > 0) node.emit = [...(node.emit ?? []), ...this.pending.emit]
    this.pending = emptyPending()
  }

  private applyNodeTag(node: DialogueNode, tag: RawTag): void {
    if (tag.name === 'speaker' && tag.value !== undefined) {
      node.speaker = decodeTagValue(tag.value)
      return
    }
    if (tag.name === 'lore') {
      node.lore = true
      return
    }
    if (tag.name === 'node' || tag.name === 'conversation') return
    if (tag.name === 'ext' && tag.value !== undefined) {
      node.ext = decodeExt(decodeTagValue(tag.value))
      return
    }
    this.importer.warn(tag.line, 'tag', `tag "# ${tag.name}" has no OQF equivalent and was skipped`)
  }

  private applyKnotTag(tag: RawTag): boolean {
    if (tag.name === 'actor' && tag.value !== undefined) {
      this.conversation.actor = decodeTagValue(tag.value)
      return true
    }
    if (tag.name === 'title' && tag.value !== undefined) {
      this.conversation.title = decodeTagValue(tag.value)
      return true
    }
    if (tag.name === 'ext' && tag.value !== undefined) {
      this.conversation.ext = decodeExt(decodeTagValue(tag.value))
      return true
    }
    return false
  }

  private target(divert: DivertRef): string | undefined {
    return this.builder.resolveFor(this.knot, divert.target, divert.line)
  }

  run(body: Statement[]): string | undefined {
    let index = 0
    while (index < body.length) {
      const statement = body[index]
      if (statement.kind === 'tag') {
        if (
          this.base === undefined &&
          this.current === undefined &&
          this.applyKnotTag(statement.tag)
        ) {
          index += 1
          continue
        }
        this.pending.tags.push(statement.tag)
        index += 1
        continue
      }
      if (statement.kind === 'logic') {
        readLogic(this.importer, statement.text, statement.line, this.pending)
        index += 1
        continue
      }
      if (statement.kind === 'text') {
        const node = this.openNode(unescapeInk(statement.text))
        for (const tag of statement.tags) this.applyNodeTag(node, tag)
        if (statement.divert !== undefined) {
          const next = this.target(statement.divert)
          if (next !== undefined) node.next = next
          this.chainOpen = false
        }
        index += 1
        continue
      }
      if (statement.kind === 'divert') {
        this.applyDivert(statement.divert)
        index += 1
        continue
      }
      if (statement.kind === 'gather') {
        if (statement.depth > 1) {
          this.importer.warn(
            statement.line,
            'nested-gather',
            'a nested gather has no OQF equivalent and was skipped',
          )
          index += 1
          continue
        }
        this.gatherPending = this.dangling
        this.dangling = []
        this.current = undefined
        this.chainOpen = false
        index += 1
        continue
      }
      if (statement.kind !== 'choice') {
        index += 1
        continue
      }
      if (statement.depth > 1) {
        this.importer.warn(
          statement.line,
          'nested-choice',
          'a nested choice has no OQF equivalent and was skipped',
        )
        index += 1
        continue
      }
      const end = this.bodyEnd(body, index + 1)
      this.addChoice(statement, body.slice(index + 1, end))
      index = end
    }
    if (this.pending.tags.length + this.pending.set.length + this.pending.emit.length > 0) {
      if (this.current === undefined) this.openNode('')
      else this.flush(this.current)
    }
    return this.entry
  }

  private bodyEnd(body: Statement[], from: number): number {
    for (let index = from; index < body.length; index += 1) {
      const statement = body[index]
      if (statement.kind === 'choice' && statement.depth <= 1) return index
      if (statement.kind === 'gather' && statement.depth <= 1) return index
    }
    return body.length
  }

  private applyDivert(divert: DivertRef): void {
    if (this.current === undefined && this.gatherPending !== undefined) {
      const next = this.target(divert)
      for (const choice of this.gatherPending) if (next !== undefined) choice.next = next
      this.gatherPending = undefined
      return
    }
    if (this.current === undefined) {
      if (this.base === undefined && this.entry === undefined && this.nodes.length === 0) {
        this.entry = this.target(divert)
        return
      }
      if (this.base === undefined && this.entry === undefined) {
        this.entry = this.target(divert)
        return
      }
      this.openNode('')
    }
    const node = this.current as DialogueNode
    if ((node.choices ?? []).length > 0) {
      this.importer.warn(
        divert.line,
        'divert',
        'a divert after choices is unreachable and was dropped',
      )
      return
    }
    const next = this.target(divert)
    if (next !== undefined) node.next = next
    this.chainOpen = false
  }

  private addChoice(statement: Statement & { kind: 'choice' }, body: Statement[]): void {
    if (this.current === undefined || (this.chainOpen && this.current.next !== undefined)) {
      this.openNode('')
    }
    const owner = this.current as DialogueNode
    const text = unescapeInk(bracketText(statement.text))
    const choice: Choice = { text }
    if (!statement.sticky) choice.once = true
    if (statement.guard !== undefined) {
      const condition = this.importer.condition(statement.guard, statement.line)
      if (condition !== undefined) choice.condition = condition
    }
    for (const tag of statement.tags) this.applyChoiceTag(choice, tag)
    let resolved = false
    if (statement.divert !== undefined) {
      const next = this.target(statement.divert)
      if (next !== undefined) choice.next = next
      resolved = true
    }
    resolved = this.addChoiceBody(choice, body, resolved)
    owner.choices = [...(owner.choices ?? []), choice]
    this.chainOpen = false
    if (!resolved) this.dangling.push(choice)
  }

  private applyChoiceTag(choice: Choice, tag: RawTag): void {
    if (tag.name === 'disabled') {
      choice.show = 'disabled'
      return
    }
    if (tag.name === 'ext' && tag.value !== undefined) {
      choice.ext = decodeExt(decodeTagValue(tag.value))
      return
    }
    this.importer.warn(tag.line, 'tag', `tag "# ${tag.name}" has no OQF equivalent and was skipped`)
  }

  private addChoiceBody(choice: Choice, body: Statement[], already: boolean): boolean {
    let resolved = already
    let tail: DialogueNode | undefined
    const pending = emptyPending()
    for (const statement of body) {
      if (statement.kind === 'tag') {
        if (tail === undefined) this.applyChoiceTag(choice, statement.tag)
        else pending.tags.push(statement.tag)
        continue
      }
      if (statement.kind === 'logic') {
        readLogic(this.importer, statement.text, statement.line, pending)
        if (tail === undefined) {
          if (pending.set.length > 0) choice.set = [...(choice.set ?? []), ...pending.set]
          if (pending.emit.length > 0) choice.emit = [...(choice.emit ?? []), ...pending.emit]
          pending.set = []
          pending.emit = []
        }
        continue
      }
      if (statement.kind === 'text') {
        const node: DialogueNode = { id: this.freshId(), text: unescapeInk(statement.text) }
        for (const tag of pending.tags) this.applyNodeTag(node, tag)
        if (pending.set.length > 0) node.set = pending.set
        if (pending.emit.length > 0) node.emit = pending.emit
        pending.tags = []
        pending.set = []
        pending.emit = []
        for (const tag of statement.tags) this.applyNodeTag(node, tag)
        this.nodes.push(node)
        if (tail === undefined) choice.next = node.id
        else tail.next = node.id
        tail = node
        resolved = true
        if (statement.divert !== undefined) {
          const next = this.target(statement.divert)
          if (next !== undefined) node.next = next
        }
        continue
      }
      if (statement.kind === 'divert') {
        const next = this.target(statement.divert)
        if (tail === undefined) {
          if (next !== undefined) choice.next = next
          resolved = true
        } else if (next !== undefined) {
          tail.next = next
        }
        continue
      }
      if (statement.kind === 'choice') {
        this.importer.warn(
          statement.line,
          'nested-choice',
          'a nested choice has no OQF equivalent and was skipped',
        )
        continue
      }
      if (statement.kind === 'gather') {
        this.importer.warn(
          statement.line,
          'nested-gather',
          'a nested gather has no OQF equivalent and was skipped',
        )
      }
    }
    if (tail !== undefined) {
      for (const tag of pending.tags) this.applyNodeTag(tail, tag)
      if (pending.set.length > 0) tail.set = [...(tail.set ?? []), ...pending.set]
      if (pending.emit.length > 0) tail.emit = [...(tail.emit ?? []), ...pending.emit]
    }
    return resolved
  }
}

/** Ink choice text before the `[ ]` bracket, when there is one. */
function bracketText(text: string): string {
  const open = findUnescaped(text, '[', 0)
  if (open === -1) return text
  const close = findUnescaped(text, ']', open + 1)
  const before = trimInk(text.slice(0, open))
  if (before !== '') return before
  return close === -1 ? trimInk(text.slice(open + 1)) : trimInk(text.slice(open + 1, close))
}

/** Collect the speakers a document mentions when the file declares none. */
function derivedSpeakers(conversations: Conversation[]): Ref[] {
  const ids: string[] = []
  for (const conversation of conversations) {
    if (conversation.actor !== undefined && !ids.includes(conversation.actor)) {
      ids.push(conversation.actor)
    }
    for (const node of conversation.nodes) {
      if (node.speaker !== undefined && !ids.includes(node.speaker)) ids.push(node.speaker)
    }
  }
  return ids.map((id) => ({ id }))
}

/** Read Ink source text into a dialogue document plus the constructs it dropped. */
export function fromInk(source: string): InkImportResult {
  const importer = new Importer()
  const { statements, speakers, declared } = importer.lex(source)
  const conversations = new Builder(importer, group(statements)).build()
  const document: DialogueDocument = {
    speakers: declared ? speakers : derivedSpeakers(conversations),
    conversations,
  }
  return { document, warnings: importer.warnings }
}
