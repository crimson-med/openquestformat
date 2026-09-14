/**
 * OQF dialogue documents to Yarn Spinner source text.
 *
 * Yarn has no knots, so a conversation is a group of nodes held together by a
 * tag rather than by nesting. The mapping, expanding docs/04-dialogue.md:
 *
 * | OQF | Yarn |
 * |-----|------|
 * | node | a node, `title:` ... `---` ... `===` |
 * | node id | the part of the title after `<conversation>_` |
 * | conversation | the tag `oqf_conversation=<id>` on every node of the group |
 * | conversation `start` | the tag `oqf_start` |
 * | conversation `actor` / `title` | headers `oqf_actor:` / `oqf_title:` on the start node |
 * | speakers dictionary | a `// oqf-speakers:` comment at the top of the file |
 * | node `speaker` | the tag `speaker=<id>` and the `Speaker:` line prefix |
 * | node `text` | the line |
 * | node `lore` | the tag `lore` |
 * | node `next` | `<<jump <conversation>_<node>>>` |
 * | node with no `next` and no choices | `<<stop>>` |
 * | choices | `->` options, the body indented under them |
 * | choice `condition` | `<<if cond>>` on the option line |
 * | choice `once` | the option wrapped in `<<once>>` ... `<<endonce>>` |
 * | choice `show: disabled` | the hashtag `#oqf_disabled` on the option line |
 * | `set` | `<<set $flag__name to value>>` |
 * | `emit` | `<<oqf_emit "event" "k=v,k=v">>` |
 * | `ext` | header `oqf_ext:`, or `<<oqf_ext "...">>` under a choice |
 *
 * Variables carry the `$` sigil and the identifier translation from
 * ink/naming.ts, so `flag.met_ines` is `$flag__met_ines`. Only `flag.*` is
 * written by the dialogue. Every other namespace is owned by the quest runtime
 * and the host has to push it into Yarn's variable storage before a node reads
 * it. See README.md next to this file.
 *
 * `value: true` on a `set`, `show: 'hidden'`, `once: false`, `lore: false` and
 * empty arrays are the documented defaults, and come back from `fromYarn` as
 * absent, because Yarn cannot tell them from the spelled out form.
 */
import type { Ext, Scalar } from '@oqf/core'
import { renderExpression } from '../ink/expression.js'
import { encodeExt, encodePayload, encodeSpeakerList, toIdentifier } from '../ink/naming.js'
import type {
  Choice,
  Conversation,
  DialogueDocument,
  DialogueNode,
  EmitSpec,
  FlagSet,
} from '../model.js'

const INDENT = '    '

/** Ids that survive a Yarn title and a Yarn tag without help. */
const SAFE = /^[A-Za-z0-9_.]+$/

const LEADING = '-><#/\\=*+'

/** Key into the title table. */
function key(conversation: string, node: string): string {
  return JSON.stringify([conversation, node])
}

/** Escape a player facing string so Yarn reads it back as plain text. */
export function escapeYarnText(text: string, speaker: boolean): string {
  let out = text
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/#/g, '\\#')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/</g, '\\<')
    .replace(/\/\//g, '/\\/')
  if (!speaker) out = out.replace(':', '\\:')
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

/** A header value runs to the end of the line, so only line breaks need escaping. */
export function escapeYarnHeader(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r')
}

function yarnValue(value: Scalar): string {
  if (typeof value === 'string') return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  return String(value)
}

function commands(
  set: FlagSet[] | undefined,
  emit: EmitSpec[] | undefined,
  indent: string,
): string[] {
  const lines: string[] = []
  for (const entry of set ?? []) {
    const name = toIdentifier(`flag.${entry.flag}`)
    lines.push(`${indent}<<set $${name} to ${yarnValue(entry.value ?? true)}>>`)
  }
  for (const entry of emit ?? []) {
    const payload = encodePayload(entry.payload ?? {})
    lines.push(`${indent}<<oqf_emit ${yarnValue(entry.event)} ${yarnValue(payload)}>>`)
  }
  return lines
}

/** The Yarn node title for one OQF node. */
export function yarnTitle(conversation: string, node: string, index: number): string {
  if (SAFE.test(conversation) && SAFE.test(node)) return `${conversation}_${node}`
  return `oqf_node_${index}`
}

function flow(conversation: string, next: string | undefined, titles: Map<string, string>): string {
  if (next === undefined) return '<<stop>>'
  return `<<jump ${titles.get(key(conversation, next)) ?? next}>>`
}

function extLine(name: string, ext: Ext | undefined): string[] {
  if (ext === undefined || Object.keys(ext).length === 0) return []
  return [`${name}: ${escapeYarnHeader(encodeExt(ext))}`]
}

function renderChoice(choice: Choice, conversation: string, titles: Map<string, string>): string[] {
  const guard =
    choice.condition === undefined ? '' : ` <<if ${renderExpression(choice.condition, 'yarn')}>>`
  const mark = choice.show === 'disabled' ? ' #oqf_disabled' : ''
  const lines: string[] = []
  if (choice.once === true) lines.push('<<once>>')
  lines.push(`-> ${escapeYarnText(choice.text, false)}${guard}${mark}`)
  if (choice.ext !== undefined && Object.keys(choice.ext).length > 0) {
    lines.push(`${INDENT}<<oqf_ext ${yarnValue(encodeExt(choice.ext))}>>`)
  }
  lines.push(...commands(choice.set, choice.emit, INDENT))
  lines.push(`${INDENT}${flow(conversation, choice.next, titles)}`)
  if (choice.once === true) lines.push('<<endonce>>')
  return lines
}

function renderNode(
  node: DialogueNode,
  conversation: Conversation,
  titles: Map<string, string>,
): string[] {
  const title = titles.get(key(conversation.id, node.id)) ?? node.id
  const tags: string[] = []
  if (node.speaker !== undefined && SAFE.test(node.speaker)) tags.push(`speaker=${node.speaker}`)
  if (node.lore === true) tags.push('lore')
  if (SAFE.test(conversation.id)) tags.push(`oqf_conversation=${conversation.id}`)
  if (node.id === conversation.start) tags.push('oqf_start')
  const lines = [`title: ${title}`]
  if (tags.length > 0) lines.push(`tags: ${tags.join(' ')}`)
  if (!SAFE.test(conversation.id)) lines.push(`oqf_conversation: ${conversation.id}`)
  if (title !== `${conversation.id}_${node.id}`) lines.push(`oqf_node: ${node.id}`)
  if (node.speaker !== undefined && !SAFE.test(node.speaker)) {
    lines.push(`oqf_speaker: ${node.speaker}`)
  }
  if (node.id === conversation.start) {
    if (conversation.actor !== undefined) lines.push(`oqf_actor: ${conversation.actor}`)
    if (conversation.title !== undefined) {
      lines.push(`oqf_title: ${escapeYarnHeader(conversation.title)}`)
    }
    lines.push(...extLine('oqf_conversation_ext', conversation.ext))
  }
  lines.push(...extLine('oqf_ext', node.ext))
  lines.push('---')
  if (node.text !== '' || node.speaker !== undefined) {
    const body = escapeYarnText(node.text, node.speaker !== undefined)
    lines.push(node.speaker === undefined ? body : `${node.speaker}: ${body}`)
  }
  lines.push(...commands(node.set, node.emit, ''))
  const choices = node.choices ?? []
  if (choices.length > 0) {
    for (const choice of choices) lines.push(...renderChoice(choice, conversation.id, titles))
  } else {
    lines.push(flow(conversation.id, node.next, titles))
  }
  lines.push('===')
  return lines
}

/** The Yarn title of every node, keyed by conversation and node id. */
export function yarnTitles(doc: DialogueDocument): Map<string, string> {
  const titles = new Map<string, string>()
  let index = 0
  for (const conversation of doc.conversations) {
    for (const node of conversation.nodes) {
      index += 1
      titles.set(key(conversation.id, node.id), yarnTitle(conversation.id, node.id, index))
    }
  }
  return titles
}

/** Render a dialogue document as Yarn Spinner source text. */
export function toYarn(doc: DialogueDocument): string {
  const titles = yarnTitles(doc)
  const speakers = encodeSpeakerList(doc.speakers)
  const lines: string[] = [
    '// Yarn Spinner export of an OQF dialogue document, written by @oqf/dialogue toYarn.',
    '// Variables are OQF paths with "." written as "__", "-" as "_h_" and "#" as "_s_".',
    '// The dialogue only writes flag.* variables. Mirror every other variable from the',
    '// quest runtime, and route oqf_emit into the dialogue bridge. See README.md.',
    `// oqf-speakers: ${speakers}`,
  ]
  for (const conversation of doc.conversations) {
    for (const node of conversation.nodes) {
      lines.push('')
      lines.push(...renderNode(node, conversation, titles))
    }
  }
  return `${lines.join('\n')}\n`
}
