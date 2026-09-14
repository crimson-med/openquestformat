/**
 * Yarn Spinner source text to an OQF dialogue document, best effort.
 *
 * It reads everything `toYarn` writes plus the plain hand written shape of a
 * Yarn file: a `title:` header block, `---`, lines with an optional `Speaker:`
 * prefix, `->` options with indented bodies, `<<set>>`, `<<jump>>`, `<<stop>>`,
 * `<<if>>` guards on options, `<<once>>` blocks, `//` comments and `===`.
 *
 * Everything else is named in a warning and skipped: unknown commands,
 * `<<declare>>`, `<<detour>>`, body level `<<if>>` blocks, functions inside a
 * condition, `{$interpolation}`, `[markup]`, line hashtags, unknown headers,
 * `shadow:` nodes, options nested inside an option body, jumps that point
 * nowhere or leave the conversation, and `<<set>>` on a variable that is not a
 * `flag.*` one. The importer never throws on an unknown construct. It throws
 * only when the structure is unbalanced: a header block with no `---`, a node
 * with no `===`, or a `<<once>>` with no `<<endonce>>`.
 *
 * Grouping: nodes carrying `oqf_conversation` join that conversation; nodes
 * without one join a single conversation named after the first such node. A
 * Yarn node holds several lines where an OQF node holds one, so lines after the
 * first become implicit nodes named `<node>__1`, `<node>__2` and so on.
 */
import type { Condition, Ref, Scalar } from '@oqf/core'
import { ExpressionError, parseExpression } from '../ink/expression.js'
import {
  type ImportWarning,
  decodeExt,
  decodePayload,
  decodeSpeakerList,
  fromIdentifier,
} from '../ink/naming.js'
import type { Choice, Conversation, DialogueDocument, DialogueNode, EmitSpec } from '../model.js'

export interface YarnImportResult {
  document: DialogueDocument
  warnings: ImportWarning[]
}

const HEADERS = [
  'title',
  'tags',
  'oqf_conversation',
  'oqf_node',
  'oqf_speaker',
  'oqf_actor',
  'oqf_title',
  'oqf_ext',
  'oqf_conversation_ext',
]

interface RawLine {
  text: string
  indent: number
  line: number
}

interface RawNode {
  title: string
  line: number
  headers: Map<string, string>
  tags: string[]
  body: RawLine[]
}

/** Drop one level of Yarn escaping. */
export function unescapeYarn(text: string): string {
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

function findUnescaped(text: string, char: string, from: number): number {
  for (let index = from; index < text.length; index += 1) {
    if (text[index] === char && !isEscaped(text, index)) return index
  }
  return -1
}

function trimYarn(line: string): string {
  const left = line.replace(/^\s+/, '')
  let end = left.length
  while (end > 0 && /\s/.test(left[end - 1]) && !isEscaped(left, end - 1)) end -= 1
  return left.slice(0, end)
}

/** Pull `<< >>` commands out of a line, ignoring `>>` inside a quoted argument. */
function extractCommands(text: string): { text: string; commands: string[] } {
  const commands: string[] = []
  let out = ''
  let index = 0
  while (index < text.length) {
    if (text[index] === '\\') {
      out += text.slice(index, index + 2)
      index += 2
      continue
    }
    if (text.startsWith('<<', index)) {
      let cursor = index + 2
      let quoted = false
      let end = -1
      while (cursor < text.length) {
        const char = text[cursor]
        if (char === '\\') {
          cursor += 2
          continue
        }
        if (char === '"') {
          quoted = !quoted
          cursor += 1
          continue
        }
        if (!quoted && text.startsWith('>>', cursor)) {
          end = cursor
          break
        }
        cursor += 1
      }
      if (end === -1) {
        out += text.slice(index)
        break
      }
      commands.push(text.slice(index + 2, end).trim())
      index = end + 2
      continue
    }
    out += text[index]
    index += 1
  }
  return { text: out, commands }
}

/** Split `"a" "b"` or `a, b` into unquoted command arguments. */
function readArguments(text: string): string[] {
  const args: string[] = []
  let current = ''
  let quoted = false
  let escaped = false
  let started = false
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
      quoted = !quoted
      started = true
      continue
    }
    if (!quoted && (char === ' ' || char === '\t' || char === ',')) {
      if (started || current !== '') args.push(current)
      current = ''
      started = false
      continue
    }
    current += char
  }
  if (started || current !== '') args.push(current)
  return args
}

function readValue(text: string): Scalar {
  const trimmed = text.trim()
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed.startsWith('"')) {
    return trimmed.slice(1, trimmed.endsWith('"') ? -1 : undefined).replace(/\\(.)/g, '$1')
  }
  const number = Number(trimmed)
  return Number.isNaN(number) ? trimmed : number
}

class Importer {
  readonly warnings: ImportWarning[] = []

  warn(line: number, construct: string, message: string): void {
    this.warnings.push({ line, construct, message })
  }

  condition(text: string, line: number): Condition | undefined {
    try {
      return parseExpression(text, 'yarn')
    } catch (error) {
      const reason = error instanceof ExpressionError ? error.message : String(error)
      const construct = reason.includes('function call') ? 'function' : 'condition'
      this.warn(line, construct, `"<<if ${text}>>" could not be read (${reason}) and was dropped`)
      return undefined
    }
  }
}

/** Strip comments, capture the speakers directive, and cut the file into nodes. */
function lex(
  source: string,
  importer: Importer,
): { nodes: RawNode[]; speakers: Ref[]; declared: boolean } {
  const speakers: Ref[] = []
  let declared = false
  const nodes: RawNode[] = []
  let phase: 'idle' | 'headers' | 'body' = 'idle'
  let current: RawNode | undefined
  const lines = source.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const number = index + 1
    const raw = lines[index]
    const comment = findComment(raw)
    if (comment !== -1) {
      const directive = /^\s*oqf-speakers\s*:(.*)$/.exec(raw.slice(comment + 2))
      if (directive !== null) {
        declared = true
        for (const speaker of decodeSpeakerList(directive[1])) {
          speakers.push(speaker.name === undefined ? { id: speaker.id } : speaker)
        }
      }
    }
    const body = comment === -1 ? raw : raw.slice(0, comment)
    const text = trimYarn(body)
    const indent = body.length - body.replace(/^[ \t]+/, '').length
    if (phase === 'body') {
      if (text === '===') {
        phase = 'idle'
        current = undefined
        continue
      }
      if (text !== '' && current !== undefined) {
        current.body.push({ text, indent, line: number })
      }
      continue
    }
    if (text === '') continue
    if (phase === 'headers') {
      if (text === '---') {
        phase = 'body'
        continue
      }
      const colon = text.indexOf(':')
      if (colon === -1) {
        importer.warn(number, 'header', `header line "${text}" has no colon and was skipped`)
        continue
      }
      const name = text.slice(0, colon).trim().toLowerCase()
      const value = text.slice(colon + 1).trim()
      if (name === 'tags') {
        for (const tag of value.split(/\s+/)) if (tag !== '') (current as RawNode).tags.push(tag)
        continue
      }
      if (!HEADERS.includes(name)) {
        const construct = name === 'shadow' ? 'shadow' : 'header'
        importer.warn(number, construct, `header "${name}:" has no OQF equivalent and was skipped`)
        continue
      }
      ;(current as RawNode).headers.set(name, value)
      continue
    }
    const colon = text.indexOf(':')
    if (colon === -1) {
      importer.warn(number, 'stray-content', `"${text}" sits outside a node and was skipped`)
      continue
    }
    const name = text.slice(0, colon).trim().toLowerCase()
    const value = text.slice(colon + 1).trim()
    current = {
      title: name === 'title' ? value : '',
      line: number,
      headers: new Map(),
      tags: [],
      body: [],
    }
    nodes.push(current)
    phase = 'headers'
    if (name === 'title') current.headers.set('title', value)
    else if (name === 'tags')
      for (const tag of value.split(/\s+/))
        if (tag !== '') current.tags.push(tag)
        else if (HEADERS.includes(name)) current.headers.set(name, value)
        else
          importer.warn(number, 'header', `header "${name}:" has no OQF equivalent and was skipped`)
  }
  if (phase === 'headers') {
    throw new Error(
      `unbalanced yarn source: the node starting on line ${current?.line ?? 0} has no "---" separator`,
    )
  }
  if (phase === 'body') {
    throw new Error(
      `unbalanced yarn source: the node starting on line ${current?.line ?? 0} is never closed by "==="`,
    )
  }
  return { nodes, speakers, declared }
}

function findComment(text: string): number {
  for (let index = 0; index + 1 < text.length; index += 1) {
    if (text[index] === '/' && text[index + 1] === '/' && !isEscaped(text, index)) return index
  }
  return -1
}

interface NodeInfo {
  raw: RawNode
  conversation: string
  node: string
  start: boolean
  speaker?: string
  lore: boolean
}

function classify(nodes: RawNode[], importer: Importer): NodeInfo[] {
  return nodes.map((raw) => {
    const title = raw.headers.get('title') ?? raw.title
    let conversation = raw.headers.get('oqf_conversation') ?? ''
    let start = false
    let speaker = raw.headers.get('oqf_speaker')
    let lore = false
    for (const tag of raw.tags) {
      if (tag === 'lore') lore = true
      else if (tag === 'oqf_start') start = true
      else if (tag.startsWith('speaker=')) speaker = tag.slice(8)
      else if (tag.startsWith('oqf_conversation=')) conversation = tag.slice(17)
      else importer.warn(raw.line, 'tag', `tag "${tag}" has no OQF equivalent and was skipped`)
    }
    let node = raw.headers.get('oqf_node')
    if (node === undefined) {
      node =
        conversation !== '' && title.startsWith(`${conversation}_`)
          ? title.slice(conversation.length + 1)
          : title
    }
    return { raw, conversation, node, start, speaker, lore }
  })
}

class Builder {
  private readonly importer: Importer
  private readonly infos: NodeInfo[]
  private readonly titles = new Map<string, NodeInfo>()
  private readonly taken = new Map<string, Set<string>>()

  constructor(importer: Importer, infos: NodeInfo[]) {
    this.importer = importer
    this.infos = infos
    for (const info of infos) {
      const title = info.raw.headers.get('title') ?? info.raw.title
      if (title !== '') this.titles.set(title, info)
      const ids = this.taken.get(info.conversation) ?? new Set<string>()
      ids.add(info.node)
      this.taken.set(info.conversation, ids)
    }
  }

  build(): Conversation[] {
    const order: string[] = []
    for (const info of this.infos)
      if (!order.includes(info.conversation)) order.push(info.conversation)
    const conversations: Conversation[] = []
    for (const group of order) {
      const members = this.infos.filter((info) => info.conversation === group)
      const id = group !== '' ? group : members[0].node
      const conversation: Conversation = { id, start: '', nodes: [] }
      for (const info of members) this.buildNode(info, conversation, group)
      const started = members.find((info) => info.start)
      conversation.start = started?.node ?? members[0].node
      conversations.push(conversation)
    }
    return conversations
  }

  private freshId(group: string, base: string): string {
    const ids = this.taken.get(group) as Set<string>
    let counter = 0
    for (;;) {
      counter += 1
      const candidate = `${base}__${counter}`
      if (!ids.has(candidate)) {
        ids.add(candidate)
        return candidate
      }
    }
  }

  private jump(target: string, group: string, line: number): string | undefined {
    const info = this.titles.get(target)
    if (info === undefined) {
      this.importer.warn(line, 'jump', `jump to "${target}" points at no node and was dropped`)
      return undefined
    }
    if (info.conversation !== group) {
      this.importer.warn(
        line,
        'cross-node-jump',
        `jump to "${target}" leaves the conversation and was dropped`,
      )
      return undefined
    }
    return info.node
  }

  private buildNode(info: NodeInfo, conversation: Conversation, group: string): void {
    const node: DialogueNode = { id: info.node, text: '' }
    if (info.speaker !== undefined) node.speaker = info.speaker
    if (info.lore) node.lore = true
    const ext = info.raw.headers.get('oqf_ext')
    if (ext !== undefined) node.ext = decodeExt(unescapeYarn(ext))
    if (info.start) {
      const actor = info.raw.headers.get('oqf_actor')
      if (actor !== undefined) conversation.actor = actor
      const title = info.raw.headers.get('oqf_title')
      if (title !== undefined) conversation.title = unescapeYarn(title)
      const bag = info.raw.headers.get('oqf_conversation_ext')
      if (bag !== undefined) conversation.ext = decodeExt(unescapeYarn(bag))
    }
    conversation.nodes.push(node)
    new Body(this.importer, this, node, conversation, group, info).run()
  }

  jumpFor(target: string, group: string, line: number): string | undefined {
    return this.jump(target, group, line)
  }

  idFor(group: string, base: string): string {
    return this.freshId(group, base)
  }
}

class Body {
  private readonly importer: Importer
  private readonly builder: Builder
  private readonly conversation: Conversation
  private readonly group: string
  private readonly info: NodeInfo
  private readonly head: DialogueNode
  private current: DialogueNode
  private seenText = false
  private option: Choice | undefined
  private optionTail: DialogueNode | undefined
  private once = false
  private onceLine = 0
  private pendingDisabled: string[] | undefined

  constructor(
    importer: Importer,
    builder: Builder,
    node: DialogueNode,
    conversation: Conversation,
    group: string,
    info: NodeInfo,
  ) {
    this.importer = importer
    this.builder = builder
    this.head = node
    this.current = node
    this.conversation = conversation
    this.group = group
    this.info = info
  }

  run(): void {
    for (const line of this.info.raw.body) {
      if (line.indent === 0) this.closeOption()
      const { text, commands } = extractCommands(line.text)
      const bare = trimYarn(text)
      if (bare.startsWith('->')) {
        this.addOption(trimYarn(bare.slice(2)), commands, line)
        continue
      }
      const stripped = this.strip(bare, line.line)
      for (const command of commands) this.command(command, line.line)
      if (stripped === '') continue
      if (line.indent > 0 && this.option !== undefined) this.optionLine(stripped)
      else this.textLine(stripped)
    }
    if (this.once) {
      throw new Error(
        `unbalanced yarn source: "<<once>>" on line ${this.onceLine} has no "<<endonce>>"`,
      )
    }
  }

  /** Warn on and remove hashtags, interpolation and markup. */
  private strip(text: string, line: number): string {
    let out = text
    const hash = findUnescaped(out, '#', 0)
    if (hash !== -1) {
      const tail = out.slice(hash + 1).trim()
      out = out.slice(0, hash)
      for (const tag of tail.split(/\s+#?/)) {
        if (tag === '') continue
        if (tag === 'oqf_disabled') {
          if (this.pendingDisabled !== undefined) this.pendingDisabled.push(tag)
          continue
        }
        this.importer.warn(
          line,
          'line-tag',
          `line tag "#${tag}" has no OQF equivalent and was dropped`,
        )
      }
    }
    for (;;) {
      const open = findUnescaped(out, '{', 0)
      if (open === -1) break
      const close = findUnescaped(out, '}', open + 1)
      if (close === -1) break
      this.importer.warn(
        line,
        'interpolation',
        `"${out.slice(open, close + 1)}" interpolates a value and was dropped`,
      )
      out = out.slice(0, open) + out.slice(close + 1)
    }
    for (;;) {
      const open = findUnescaped(out, '[', 0)
      if (open === -1) break
      const close = findUnescaped(out, ']', open + 1)
      if (close === -1) break
      this.importer.warn(line, 'markup', `markup "${out.slice(open, close + 1)}" was dropped`)
      out = out.slice(0, open) + out.slice(close + 1)
    }
    return trimYarn(out)
  }

  private textLine(text: string): void {
    let body = text
    let speaker: string | undefined
    const colon = findUnescaped(body, ':', 0)
    if (colon > 0) {
      const prefix = body.slice(0, colon).trim()
      if (prefix !== '' && !/[<>]/.test(prefix)) {
        speaker = unescapeYarn(prefix)
        body = trimYarn(body.slice(colon + 1))
      }
    }
    if (!this.seenText) {
      this.seenText = true
      this.head.text = unescapeYarn(body)
      if (this.head.speaker === undefined && speaker !== undefined) this.head.speaker = speaker
      return
    }
    const node: DialogueNode = {
      id: this.builder.idFor(this.group, this.info.node),
      text: unescapeYarn(body),
    }
    if (speaker !== undefined) node.speaker = speaker
    this.current.next = node.id
    this.conversation.nodes.push(node)
    this.current = node
  }

  private optionLine(text: string): void {
    const choice = this.option as Choice
    let body = text
    let speaker: string | undefined
    const colon = findUnescaped(body, ':', 0)
    if (colon > 0) {
      const prefix = body.slice(0, colon).trim()
      if (prefix !== '' && !/[<>]/.test(prefix)) {
        speaker = unescapeYarn(prefix)
        body = trimYarn(body.slice(colon + 1))
      }
    }
    const node: DialogueNode = {
      id: this.builder.idFor(this.group, this.info.node),
      text: unescapeYarn(body),
    }
    if (speaker !== undefined) node.speaker = speaker
    this.conversation.nodes.push(node)
    if (this.optionTail === undefined) choice.next = node.id
    else this.optionTail.next = node.id
    this.optionTail = node
  }

  private addOption(rest: string, commands: string[], line: RawLine): void {
    if (line.indent > 0) {
      this.importer.warn(line.line, 'nested-option', 'an option inside an option body was skipped')
      return
    }
    const disabled: string[] = []
    this.pendingDisabled = disabled
    const text = this.strip(rest, line.line)
    this.pendingDisabled = undefined
    const choice: Choice = { text: unescapeYarn(text) }
    if (this.once) choice.once = true
    if (disabled.length > 0) choice.show = 'disabled'
    for (const command of commands) {
      const guard = /^if\s+(.+)$/i.exec(command)
      if (guard !== null) {
        const condition = this.importer.condition(guard[1].trim(), line.line)
        if (condition !== undefined) choice.condition = condition
        continue
      }
      this.command(command, line.line, choice)
    }
    this.current.choices = [...(this.current.choices ?? []), choice]
    this.option = choice
    this.optionTail = undefined
  }

  private closeOption(): void {
    this.option = undefined
    this.optionTail = undefined
  }

  private command(text: string, line: number, choice?: Choice): void {
    const holder = choice ?? this.optionTail ?? this.option ?? this.current
    if (/^once$/i.test(text)) {
      this.once = true
      this.onceLine = line
      return
    }
    if (/^endonce$/i.test(text)) {
      this.once = false
      return
    }
    if (/^stop$/i.test(text)) return
    const set = /^set\s+\$?([A-Za-z_][A-Za-z0-9_]*)\s*(?:to|=)\s*(.+)$/i.exec(text)
    if (set !== null) {
      const path = fromIdentifier(set[1])
      let flag = path
      if (path.startsWith('flag.')) {
        flag = path.slice(5)
      } else {
        this.importer.warn(
          line,
          'variable',
          `"$${set[1]}" is not a flag.* variable, it was read as the flag "${path}"`,
        )
      }
      const value = readValue(set[2])
      holder.set = [...(holder.set ?? []), value === true ? { flag } : { flag, value }]
      return
    }
    const jump = /^(jump|detour)\s+(.+)$/i.exec(text)
    if (jump !== null) {
      if (jump[1].toLowerCase() === 'detour') {
        this.importer.warn(
          line,
          'command',
          '"<<detour>>" returns to the caller and was read as a jump',
        )
      }
      const next = this.builder.jumpFor(jump[2].trim(), this.group, line)
      if (next === undefined) return
      if (choice !== undefined) choice.next = next
      else if (this.option !== undefined) {
        if (this.optionTail !== undefined) this.optionTail.next = next
        else this.option.next = next
      } else if ((this.current.choices ?? []).length > 0) {
        this.importer.warn(line, 'jump', 'a jump after options is unreachable and was dropped')
      } else {
        this.current.next = next
      }
      return
    }
    const emit = /^oqf_emit\s+(.*)$/i.exec(text)
    if (emit !== null) {
      const args = readArguments(emit[1])
      if (args.length === 0) {
        this.importer.warn(line, 'command', '"<<oqf_emit>>" needs an event name and was skipped')
        return
      }
      const payload = decodePayload(args[1] ?? '')
      const entry: EmitSpec =
        Object.keys(payload).length === 0 ? { event: args[0] } : { event: args[0], payload }
      holder.emit = [...(holder.emit ?? []), entry]
      return
    }
    const bag = /^oqf_ext\s+(.*)$/i.exec(text)
    if (bag !== null) {
      const args = readArguments(bag[1])
      holder.ext = decodeExt(args[0] ?? '')
      return
    }
    if (/^declare\b/i.test(text)) {
      this.importer.warn(line, 'declare', '"<<declare>>" has no OQF equivalent and was skipped')
      return
    }
    if (/^(if|else|elseif|endif)\b/i.test(text)) {
      this.importer.warn(
        line,
        'if-block',
        `"<<${text}>>" is a body level conditional and has no OQF equivalent, skipped`,
      )
      return
    }
    this.importer.warn(
      line,
      'command',
      `command "<<${text}>>" has no OQF equivalent and was skipped`,
    )
  }
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

/** Read Yarn Spinner source text into a dialogue document plus what it dropped. */
export function fromYarn(source: string): YarnImportResult {
  const importer = new Importer()
  const { nodes, speakers, declared } = lex(source, importer)
  const conversations = new Builder(importer, classify(nodes, importer)).build()
  const document: DialogueDocument = {
    speakers: declared ? speakers : derivedSpeakers(conversations),
    conversations,
  }
  return { document, warnings: importer.warnings }
}
