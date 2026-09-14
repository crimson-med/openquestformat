/**
 * The dialogue validator. Errors mean the file is not valid OQD, warnings mean
 * it is valid but probably wrong. It reuses the Finding and ValidationResult
 * vocabulary of `@oqf/core` so a tool can merge quest and dialogue findings into
 * one list.
 *
 * The unit of validation is the set of documents handed in: conversation ids are
 * unique across all of them. Pass the quests alongside to check the bindings in
 * both directions.
 */
import {
  EXT_KEY_PATTERN,
  type Ext,
  type Finding,
  type OqfDocument,
  type ValidationResult,
  checkCondition,
} from '@oqf/core'
import type { Choice, Conversation, DialogueDocument, DialogueNode } from '../model.js'

/** Every code the dialogue validator can produce. */
export const DIALOGUE_VALIDATION_CODES = [
  'duplicate-conversation-id',
  'duplicate-node-id',
  'unknown-start',
  'unknown-next',
  'condition-invalid',
  'ext-key-invalid',
  'lore-node-effect',
  'unreachable-node',
  'next-ignored',
  'no-exit',
  'unknown-dialogue-ref',
  'unbound-conversation',
] as const

export type DialogueValidationCode = (typeof DIALOGUE_VALIDATION_CODES)[number]

export interface DialogueValidateOptions {
  /** Turns the `unbound-conversation` check on. Needs `quests` to do anything. */
  strict?: boolean
  /** Quests to cross check the dialogue bindings against. */
  quests?: OqfDocument[]
}

/** The provider name a quest uses to bind to a conversation in this model. */
const OQF_PROVIDER = 'oqf'

interface Entry {
  conversation: Conversation
  path: string
  /** First node per id. Duplicates are reported and then ignored for lookups. */
  nodes: Map<string, DialogueNode>
  nodePaths: Map<string, string>
}

interface Context {
  conversations: Map<string, Entry>
  order: Entry[]
  strict: boolean
  findings: Finding[]
}

function report(
  context: Context,
  level: 'error' | 'warning',
  code: DialogueValidationCode,
  message: string,
  path?: string,
  where: { quest?: string; step?: string } = {},
): void {
  const finding: Finding = { level, code, message }
  if (where.quest !== undefined) finding.quest = where.quest
  if (where.step !== undefined) finding.step = where.step
  if (path !== undefined) finding.path = path
  context.findings.push(finding)
}

function quote(value: string): string {
  return `"${value}"`
}

/** Where a node leads. `undefined` in the list means the conversation ends there. */
function exits(node: DialogueNode): (string | undefined)[] {
  const choices = node.choices ?? []
  if (choices.length > 0) return choices.map((choice) => choice.next)
  return [node.next]
}

function hasEffect(node: DialogueNode): boolean {
  if ((node.set?.length ?? 0) > 0 || (node.emit?.length ?? 0) > 0) return true
  return (node.choices ?? []).some(
    (choice) => (choice.set?.length ?? 0) > 0 || (choice.emit?.length ?? 0) > 0,
  )
}

function buildContext(docs: DialogueDocument[], options: DialogueValidateOptions): Context {
  const context: Context = {
    conversations: new Map(),
    order: [],
    strict: options.strict === true,
    findings: [],
  }
  docs.forEach((document, documentIndex) => {
    const prefix = docs.length > 1 ? `documents[${documentIndex}].` : ''
    document.conversations.forEach((conversation, conversationIndex) => {
      const path = `${prefix}conversations[${conversationIndex}]`
      const entry: Entry = {
        conversation,
        path,
        nodes: new Map(),
        nodePaths: new Map(),
      }
      conversation.nodes.forEach((node, nodeIndex) => {
        const nodePath = `${path}.nodes[${nodeIndex}]`
        if (entry.nodes.has(node.id)) {
          report(
            context,
            'error',
            'duplicate-node-id',
            `node id ${quote(node.id)} is already used in conversation ${quote(conversation.id)} at ${entry.nodePaths.get(node.id)}`,
            nodePath,
          )
          return
        }
        entry.nodes.set(node.id, node)
        entry.nodePaths.set(node.id, nodePath)
      })
      context.order.push(entry)
      const existing = context.conversations.get(conversation.id)
      if (existing === undefined) {
        context.conversations.set(conversation.id, entry)
        return
      }
      report(
        context,
        'error',
        'duplicate-conversation-id',
        `conversation id ${quote(conversation.id)} is already used at ${existing.path}`,
        path,
      )
    })
  })
  return context
}

function checkExtKeys(context: Context, ext: Ext | undefined, path: string): void {
  if (ext === undefined) return
  for (const name of Object.keys(ext)) {
    if (EXT_KEY_PATTERN.test(name)) continue
    report(
      context,
      'error',
      'ext-key-invalid',
      `extension key ${quote(name)} is not of the form x-<namespace>.<key>`,
      `${path}.ext`,
    )
  }
}

function checkChoice(context: Context, entry: Entry, choice: Choice, path: string): void {
  checkExtKeys(context, choice.ext, path)
  if (choice.condition !== undefined) {
    for (const error of checkCondition(choice.condition)) {
      report(
        context,
        'error',
        'condition-invalid',
        `invalid choice condition: ${error.message}`,
        `${path}.condition`,
      )
    }
  }
  if (choice.next !== undefined && !entry.nodes.has(choice.next)) {
    report(
      context,
      'error',
      'unknown-next',
      `choice continues at unknown node ${quote(choice.next)} in conversation ${quote(entry.conversation.id)}`,
      `${path}.next`,
    )
  }
}

function checkNode(context: Context, entry: Entry, node: DialogueNode, path: string): void {
  checkExtKeys(context, node.ext, path)
  const choices = node.choices ?? []
  if (node.next !== undefined && !entry.nodes.has(node.next)) {
    report(
      context,
      'error',
      'unknown-next',
      `node ${quote(node.id)} continues at unknown node ${quote(node.next)} in conversation ${quote(entry.conversation.id)}`,
      `${path}.next`,
    )
  }
  if (node.next !== undefined && choices.length > 0) {
    report(
      context,
      'warning',
      'next-ignored',
      `node ${quote(node.id)} has choices, so its next ${quote(node.next)} is ignored`,
      `${path}.next`,
    )
  }
  choices.forEach((choice, choiceIndex) => {
    checkChoice(context, entry, choice, `${path}.choices[${choiceIndex}]`)
  })
}

/** The nodes a walk from `from` can reach, following next and choices. */
function reachable(entry: Entry, from: string): Set<string> {
  const seen = new Set<string>()
  const pending = [from]
  while (pending.length > 0) {
    const id = pending.pop() as string
    if (seen.has(id)) continue
    const node = entry.nodes.get(id)
    if (node === undefined) continue
    seen.add(id)
    for (const next of exits(node)) {
      if (next !== undefined && !seen.has(next)) pending.push(next)
    }
  }
  return seen
}

/** A node marked lore promises that nothing in its subtree sets a flag or emits. */
function checkLore(context: Context, entry: Entry): void {
  entry.conversation.nodes.forEach((node, nodeIndex) => {
    if (node.lore !== true) return
    const path = `${entry.path}.nodes[${nodeIndex}]`
    const offenders: string[] = []
    for (const id of reachable(entry, node.id)) {
      const visited = entry.nodes.get(id)
      if (visited !== undefined && hasEffect(visited)) offenders.push(id)
    }
    if (offenders.length === 0) return
    offenders.sort()
    report(
      context,
      'error',
      'lore-node-effect',
      `node ${quote(node.id)} is marked lore but its subtree sets a flag or emits an event at ${offenders.map(quote).join(', ')}`,
      path,
    )
  })
}

/** True for every node from which some path ends the conversation. */
function endingNodes(entry: Entry): Set<string> {
  const ending = new Set<string>()
  let changed = true
  while (changed) {
    changed = false
    for (const [id, node] of entry.nodes) {
      if (ending.has(id)) continue
      const ends = exits(node).some((next) => next === undefined || ending.has(next))
      if (!ends) continue
      ending.add(id)
      changed = true
    }
  }
  return ending
}

function checkConversation(context: Context, entry: Entry): void {
  const conversation = entry.conversation
  checkExtKeys(context, conversation.ext, entry.path)

  conversation.nodes.forEach((node, nodeIndex) => {
    checkNode(context, entry, node, `${entry.path}.nodes[${nodeIndex}]`)
  })

  if (!entry.nodes.has(conversation.start)) {
    report(
      context,
      'error',
      'unknown-start',
      `conversation ${quote(conversation.id)} starts at unknown node ${quote(conversation.start)}`,
      `${entry.path}.start`,
    )
    return
  }

  checkLore(context, entry)

  const seen = reachable(entry, conversation.start)
  conversation.nodes.forEach((node, nodeIndex) => {
    if (seen.has(node.id)) return
    report(
      context,
      'warning',
      'unreachable-node',
      `node ${quote(node.id)} is not reachable from the start of conversation ${quote(conversation.id)}`,
      `${entry.path}.nodes[${nodeIndex}]`,
    )
  })

  if (!endingNodes(entry).has(conversation.start)) {
    report(
      context,
      'warning',
      'no-exit',
      `conversation ${quote(conversation.id)} never ends, every path from ${quote(conversation.start)} cycles`,
      `${entry.path}.start`,
    )
  }
}

/** A dialogue ref is `conversationId` or `conversationId#nodeId`. */
function splitRef(ref: string): { conversation: string; node?: string } {
  const hash = ref.indexOf('#')
  if (hash === -1) return { conversation: ref }
  return { conversation: ref.slice(0, hash), node: ref.slice(hash + 1) }
}

/** Reports a ref that names no conversation, or no such node inside one. */
function checkRef(
  context: Context,
  ref: string,
  path: string,
  where: { quest: string; step: string },
): void {
  const { conversation, node } = splitRef(ref)
  const entry = context.conversations.get(conversation)
  if (entry === undefined) {
    report(
      context,
      'warning',
      'unknown-dialogue-ref',
      `step ${quote(where.step)} binds the unknown conversation ${quote(conversation)}`,
      path,
      where,
    )
    return
  }
  if (node === undefined || entry.nodes.has(node)) return
  report(
    context,
    'warning',
    'unknown-dialogue-ref',
    `step ${quote(where.step)} binds the unknown node ${quote(node)} of conversation ${quote(conversation)}`,
    path,
    where,
  )
}

function checkQuestBindings(context: Context, quests: OqfDocument[]): void {
  const bound = new Set<string>()
  quests.forEach((document, documentIndex) => {
    const prefix = quests.length > 1 ? `documents[${documentIndex}].` : ''
    document.quests.forEach((quest, questIndex) => {
      quest.steps.forEach((step, stepIndex) => {
        const stepPath = `${prefix}quests[${questIndex}].steps[${stepIndex}]`
        const where = { quest: quest.id, step: step.id }
        const binding = step.dialogue
        if (binding !== undefined && binding.provider === OQF_PROVIDER) {
          // Only an explicit binding counts a conversation as bound.
          bound.add(splitRef(binding.ref).conversation)
          checkRef(context, binding.ref, `${stepPath}.dialogue.ref`, where)
        }
        // A `talk` objective names the same conversation, so its ref is checked too.
        for (const [name, objective] of [
          ['objective', step.objective],
          ['failObjective', step.failObjective],
        ] as const) {
          if (objective?.kind !== 'talk' || objective.dialogue === undefined) continue
          if (binding !== undefined && binding.ref === objective.dialogue) continue
          checkRef(context, objective.dialogue, `${stepPath}.${name}.dialogue`, where)
        }
      })
    })
  })

  if (!context.strict) return
  for (const entry of context.order) {
    if (bound.has(entry.conversation.id)) continue
    report(
      context,
      'warning',
      'unbound-conversation',
      `conversation ${quote(entry.conversation.id)} is not bound from any step`,
      entry.path,
    )
  }
}

/** Validate one or more dialogue documents, optionally against the quests that bind them. */
export function validateDialogue(
  docs: DialogueDocument[],
  options: DialogueValidateOptions = {},
): ValidationResult {
  const context = buildContext(docs, options)
  for (const entry of context.order) checkConversation(context, entry)
  if (options.quests !== undefined) checkQuestBindings(context, options.quests)
  return {
    findings: context.findings,
    ok: !context.findings.some((finding) => finding.level === 'error'),
  }
}
