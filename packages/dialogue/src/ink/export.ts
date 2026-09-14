/**
 * OQF dialogue documents to Ink source text.
 *
 * The mapping is the one in docs/04-dialogue.md, spelled out:
 *
 * | OQF | Ink |
 * |-----|-----|
 * | conversation | knot, `=== id ===`, plus a `# conversation:` tag when ink cannot take the id |
 * | conversation `actor` / `title` | knot tags `# actor:` / `# title:` |
 * | conversation `start` | a divert in the knot body, `-> knot.start` |
 * | node | stitch, `= id`, plus a `# node:` tag so a running story can name itself |
 * | node `text` | the line |
 * | node `speaker` | tag `# speaker: id` |
 * | node `lore` | tag `# lore` |
 * | node `next` | divert `-> knot.stitch` |
 * | node with no `next` and no choices | `-> END` |
 * | choice `once` | `*` when true, `+` when false or absent |
 * | choice `condition` | `{ cond }` guard before the choice text |
 * | choice `text` | `[ bracket ]` text, so ink does not echo it as a line |
 * | choice `show: disabled` | tag `# disabled` on the choice |
 * | `set` | `~ flag__name = value` |
 * | `emit` | `~ oqf_emit("event", "k=v,k=v")` |
 * | `ext` | tag `# ext: key=value;key=value` |
 * | speakers dictionary | a file level tag `# oqf_speakers: id|name, id` |
 *
 * The file opens with `EXTERNAL oqf_emit(event, payload)` and a `VAR` for every
 * variable the document touches, whether it is written by a `set` or only read
 * by a condition. Identifiers are OQF paths with the translation documented in
 * naming.ts, so `flag.met_ines` is `flag__met_ines` and `count.trade` is
 * `count__trade`. Only `flag.*` is written by the dialogue itself. Every other
 * namespace (`count.*`, `step.*`, `outcome.*`, `quest.*`, `var.*`) is owned by
 * the quest runtime, so the host has to mirror the runtime value into the Ink
 * variable of the same name before the story reads it. The `VAR` line is there
 * to declare the name and a neutral default, not to hold the truth.
 *
 * Two spellings the model allows are canonicalized on the way out, because
 * neither Ink nor Yarn can tell them apart: `value: true` on a `set` is the
 * documented default and comes back as an omitted value, and `show: 'hidden'`,
 * `once: false`, `lore: false` and empty arrays come back as absent.
 */
import type { Ext, Scalar } from '@oqf/core'
import { conditionVariables } from '@oqf/core'
import type {
  Choice,
  Conversation,
  DialogueDocument,
  DialogueNode,
  EmitSpec,
  FlagSet,
} from '../model.js'
import { renderExpression } from './expression.js'
import {
  encodeExt,
  encodePayload,
  encodeSpeakerList,
  encodeTagValue,
  toIdentifier,
} from './naming.js'

const INDENT = '    '

/** Characters that would start a different construct when a line begins with them. */
const LEADING = '*+-~=>#<|{}\\'

/** Escape a player facing string so Ink reads it back as plain text. */
export function escapeInkText(text: string, brackets: boolean): string {
  let out = text
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/#/g, '\\#')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/->/g, '-\\>')
    .replace(/<>/g, '<\\>')
    .replace(/<-/g, '<\\-')
    .replace(/\/\//g, '/\\/')
    .replace(/\/\*/g, '/\\*')
  if (brackets) out = out.replace(/\[/g, '\\[').replace(/\]/g, '\\]')
  const first = text[0]
  if (
    first !== undefined &&
    (LEADING.includes(first) || /\s/.test(first)) &&
    !out.startsWith('\\')
  ) {
    out = `\\${out}`
  }
  if (out.length > 0 && /\s/.test(out[out.length - 1])) {
    out = `${out.slice(0, -1)}\\${out[out.length - 1]}`
  }
  return out
}

function inkValue(value: Scalar): string {
  if (typeof value === 'string') return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  return String(value)
}

function flagPath(entry: FlagSet): string {
  return `flag.${entry.flag}`
}

function defaultFor(path: string): string {
  const namespace = path.split('.')[0]
  if (namespace === 'count') return '0'
  if (namespace === 'flag' || namespace === 'outcome') return 'false'
  return '""'
}

function extTag(ext: Ext | undefined): string[] {
  if (ext === undefined || Object.keys(ext).length === 0) return []
  return [`# ext: ${encodeTagValue(encodeExt(ext))}`]
}

function statements(
  set: FlagSet[] | undefined,
  emit: EmitSpec[] | undefined,
  indent: string,
): string[] {
  const lines: string[] = []
  for (const entry of set ?? []) {
    lines.push(`${indent}~ ${toIdentifier(flagPath(entry))} = ${inkValue(entry.value ?? true)}`)
  }
  for (const entry of emit ?? []) {
    const payload = encodePayload(entry.payload ?? {})
    lines.push(`${indent}~ oqf_emit(${inkValue(entry.event)}, ${inkValue(payload)})`)
  }
  return lines
}

/** The ink names a conversation and its nodes are written under. */
interface InkNames {
  knot: string
  stitches: Map<string, string>
}

/** Ink knot and stitch names are plain identifiers, and a stitch may not shadow its knot. */
const INK_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Pick the ink names for one conversation.
 *
 * A node id that is already a legal stitch name is used as it stands, which
 * covers nearly every document. An id ink would reject, or one that collides
 * with the knot or with an earlier stitch, gets a generated name instead. The
 * real id still travels in the `# node:` tag, and the same holds for a knot
 * through `# conversation:`, so nothing is lost.
 */
function inkNames(conversation: Conversation, offset: number): InkNames {
  const knot = INK_NAME.test(conversation.id) ? conversation.id : `oqf_conversation_${offset}`
  const stitches = new Map<string, string>()
  const taken = new Set<string>([knot])
  let counter = 0
  for (const node of conversation.nodes) {
    let name = node.id
    if (!INK_NAME.test(name) || taken.has(name)) {
      do {
        counter += 1
        name = `oqf_node_${offset}_${counter}`
      } while (taken.has(name))
    }
    taken.add(name)
    stitches.set(node.id, name)
  }
  return { knot, stitches }
}

function divert(names: InkNames, next: string | undefined): string {
  if (next === undefined) return '-> END'
  return `-> ${names.knot}.${names.stitches.get(next) ?? next}`
}

function renderChoice(choice: Choice, names: InkNames, indent: string): string[] {
  const marker = choice.once === true ? '*' : '+'
  const guard =
    choice.condition === undefined ? '' : `{${renderExpression(choice.condition, 'ink')}} `
  const tags = choice.show === 'disabled' ? ' # disabled' : ''
  const head = `${indent}${marker} ${guard}[${escapeInkText(choice.text, true)}]${tags}`
  const lines = [head]
  for (const tag of extTag(choice.ext)) lines.push(`${indent}${INDENT}${tag}`)
  lines.push(...statements(choice.set, choice.emit, `${indent}${INDENT}`))
  lines.push(`${indent}${INDENT}${divert(names, choice.next)}`)
  return lines
}

function renderNode(node: DialogueNode, names: InkNames): string[] {
  const lines = [
    `= ${names.stitches.get(node.id) ?? node.id}`,
    `# node: ${encodeTagValue(node.id)}`,
  ]
  if (node.speaker !== undefined) lines.push(`# speaker: ${encodeTagValue(node.speaker)}`)
  if (node.lore === true) lines.push('# lore')
  lines.push(...extTag(node.ext))
  lines.push(...statements(node.set, node.emit, ''))
  if (node.text !== '') lines.push(escapeInkText(node.text, false))
  const choices = node.choices ?? []
  if (choices.length > 0) {
    for (const choice of choices) lines.push(...renderChoice(choice, names, ''))
    return lines
  }
  lines.push(divert(names, node.next))
  return lines
}

function renderConversation(conversation: Conversation, offset: number): string[] {
  const names = inkNames(conversation, offset)
  const lines = [`=== ${names.knot} ===`]
  if (names.knot !== conversation.id) {
    lines.push(`# conversation: ${encodeTagValue(conversation.id)}`)
  }
  if (conversation.actor !== undefined) {
    lines.push(`# actor: ${encodeTagValue(conversation.actor)}`)
  }
  if (conversation.title !== undefined) {
    lines.push(`# title: ${encodeTagValue(conversation.title)}`)
  }
  lines.push(...extTag(conversation.ext))
  lines.push(divert(names, conversation.start))
  for (const node of conversation.nodes) {
    lines.push('')
    lines.push(...renderNode(node, names))
  }
  return lines
}

/** Every variable path the document writes or reads, deduplicated. */
export function inkVariables(doc: DialogueDocument): string[] {
  const paths: string[] = []
  const add = (path: string): void => {
    if (!paths.includes(path)) paths.push(path)
  }
  for (const conversation of doc.conversations) {
    for (const node of conversation.nodes) {
      for (const entry of node.set ?? []) add(flagPath(entry))
      for (const choice of node.choices ?? []) {
        for (const entry of choice.set ?? []) add(flagPath(entry))
        if (choice.condition !== undefined) {
          for (const path of conditionVariables(choice.condition)) add(path)
        }
      }
    }
  }
  return paths.sort((left, right) => (toIdentifier(left) < toIdentifier(right) ? -1 : 1))
}

/** Render a dialogue document as Ink source text. */
export function toInk(doc: DialogueDocument): string {
  const lines: string[] = [
    '// Ink export of an OQF dialogue document, written by @oqf/dialogue toInk.',
    '// Variable names are OQF paths with "." written as "__", "-" as "_h_" and "#" as "_s_".',
    '// The dialogue only writes flag.* variables. Mirror every other VAR from the quest',
    '// runtime before the story reads it, and bind oqf_emit to the dialogue bridge.',
  ]
  lines.push(`# oqf_speakers: ${encodeTagValue(encodeSpeakerList(doc.speakers))}`)
  lines.push('')
  lines.push('EXTERNAL oqf_emit(event, payload)')
  const variables = inkVariables(doc)
  if (variables.length > 0) {
    lines.push('')
    for (const path of variables) lines.push(`VAR ${toIdentifier(path)} = ${defaultFor(path)}`)
  }
  let offset = 0
  for (const conversation of doc.conversations) {
    offset += 1
    lines.push('')
    lines.push(...renderConversation(conversation, offset))
  }
  return `${lines.join('\n')}\n`
}
