/**
 * Writes table values back into documents, turning key references into
 * literals again. The inverse of extract, and pure in the same way: nothing is
 * mutated and unchanged subtrees are returned by reference.
 */
import type { OqfDocument, Outcome, Quest, Step, Text } from '@oqf/core'
import type { Choice, Conversation, DialogueDocument, DialogueNode } from '@oqf/dialogue'
import { I18nError } from './errors.js'
import type { StringTable } from './extract.js'
import { isKey, keyOf } from './keys.js'

/** What to do with a key reference the table has no value for. */
export type MissingStrategy = 'keep' | 'throw' | 'empty'

export interface InjectOptions {
  /** Defaults to `keep`, which leaves the key reference in place. */
  missing?: MissingStrategy
}

export interface InjectInput {
  quests?: OqfDocument[]
  dialogues?: DialogueDocument[]
}

export interface InjectedAll {
  quests: OqfDocument[]
  dialogues: DialogueDocument[]
}

/** Replaces one key reference with its table value. */
type Resolve = (text: Text) => Text

function resolver(table: StringTable, options: InjectOptions): Resolve {
  const missing = options.missing ?? 'keep'
  return (text) => {
    if (!isKey(text)) return text
    const key = keyOf(text)
    const value = table[key]
    if (value !== undefined) return value
    if (missing === 'throw') throw new I18nError(`no value for key ${key}`, key)
    return missing === 'empty' ? '' : text
  }
}

function mapShared<T>(items: T[], map: (item: T, index: number) => T): T[] {
  let changed = false
  const next = items.map((item, index) => {
    const mapped = map(item, index)
    if (mapped !== item) changed = true
    return mapped
  })
  return changed ? next : items
}

function injectOutcome(outcome: Outcome, resolve: Resolve): Outcome {
  if (outcome.title === undefined) return outcome
  const title = resolve(outcome.title)
  return title === outcome.title ? outcome : { ...outcome, title }
}

function injectStep(step: Step, resolve: Resolve): Step {
  const title = resolve(step.title)
  const journal = step.journal === undefined ? undefined : resolve(step.journal)
  const outcome = step.outcome === undefined ? undefined : injectOutcome(step.outcome, resolve)
  if (title === step.title && journal === step.journal && outcome === step.outcome) return step
  const next: Step = { ...step, title }
  if (journal !== undefined) next.journal = journal
  if (outcome !== undefined) next.outcome = outcome
  return next
}

function injectQuest(quest: Quest, resolve: Resolve): Quest {
  const title = resolve(quest.title)
  const summary = quest.summary === undefined ? undefined : resolve(quest.summary)
  const steps = mapShared(quest.steps, (step) => injectStep(step, resolve))
  if (title === quest.title && summary === quest.summary && steps === quest.steps) return quest
  const next: Quest = { ...quest, title, steps }
  if (summary !== undefined) next.summary = summary
  return next
}

function injectInto(doc: OqfDocument, resolve: Resolve): OqfDocument {
  const quests = mapShared(doc.quests, (quest) => injectQuest(quest, resolve))
  return quests === doc.quests ? doc : { ...doc, quests }
}

function injectChoice(choice: Choice, resolve: Resolve): Choice {
  const text = resolve(choice.text)
  return text === choice.text ? choice : { ...choice, text }
}

function injectNode(node: DialogueNode, resolve: Resolve): DialogueNode {
  const text = resolve(node.text)
  const choices =
    node.choices === undefined
      ? undefined
      : mapShared(node.choices, (choice) => injectChoice(choice, resolve))
  if (text === node.text && choices === node.choices) return node
  const next: DialogueNode = { ...node, text }
  if (choices !== undefined) next.choices = choices
  return next
}

function injectConversation(conversation: Conversation, resolve: Resolve): Conversation {
  const title = conversation.title === undefined ? undefined : resolve(conversation.title)
  const nodes = mapShared(conversation.nodes, (node) => injectNode(node, resolve))
  if (title === conversation.title && nodes === conversation.nodes) return conversation
  const next: Conversation = { ...conversation, nodes }
  if (title !== undefined) next.title = title
  return next
}

function injectDialogueInto(doc: DialogueDocument, resolve: Resolve): DialogueDocument {
  const conversations = mapShared(doc.conversations, (conversation) =>
    injectConversation(conversation, resolve),
  )
  return conversations === doc.conversations ? doc : { ...doc, conversations }
}

/** Writes table values into a quest document. */
export function injectDocument(
  doc: OqfDocument,
  table: StringTable,
  options: InjectOptions = {},
): OqfDocument {
  return injectInto(doc, resolver(table, options))
}

/** Writes table values into a dialogue document. */
export function injectDialogue(
  doc: DialogueDocument,
  table: StringTable,
  options: InjectOptions = {},
): DialogueDocument {
  return injectDialogueInto(doc, resolver(table, options))
}

/** Writes table values into quest and dialogue documents at once. */
export function injectAll(
  input: InjectInput,
  table: StringTable,
  options: InjectOptions = {},
): InjectedAll {
  const resolve = resolver(table, options)
  return {
    quests: (input.quests ?? []).map((doc) => injectInto(doc, resolve)),
    dialogues: (input.dialogues ?? []).map((doc) => injectDialogueInto(doc, resolve)),
  }
}
