/**
 * Moves literal `text` values out of documents and into a string table.
 *
 * Extraction is a pure transformation: the input is never mutated, and every
 * part of the tree that holds no literal is returned by reference, so an
 * already extracted document comes back identical.
 */
import type { OqfDocument, Outcome, Quest, Step, Text } from '@oqf/core'
import type { Choice, Conversation, DialogueDocument, DialogueNode } from '@oqf/dialogue'
import { I18nError } from './errors.js'
import {
  choiceTextKey,
  conversationTitleKey,
  isKey,
  nodeTextKey,
  outcomeTitleKey,
  questSummaryKey,
  questTitleKey,
  stepJournalKey,
  stepTitleKey,
  toKeyRef,
} from './keys.js'

/** Key to source string, in the order the keys were first seen. */
export type StringTable = Record<string, string>

export interface ExtractedDocument {
  document: OqfDocument
  table: StringTable
}

export interface ExtractedDialogue {
  document: DialogueDocument
  table: StringTable
}

export interface ExtractInput {
  quests?: OqfDocument[]
  dialogues?: DialogueDocument[]
}

export interface ExtractedAll {
  quests: OqfDocument[]
  dialogues: DialogueDocument[]
  table: StringTable
}

/** Records literals under generated keys and rewrites fields to key references. */
type Collect = (key: string, text: Text) => Text

function collector(table: StringTable): Collect {
  return (key, text) => {
    if (isKey(text)) return text
    const seen = table[key]
    if (seen !== undefined && seen !== text) {
      throw new I18nError(`key collision on ${key}: ${seen} and ${text}`, key)
    }
    table[key] = text
    return toKeyRef(key)
  }
}

/** Maps a list, returning the original list when every item is unchanged. */
function mapShared<T>(items: T[], map: (item: T, index: number) => T): T[] {
  let changed = false
  const next = items.map((item, index) => {
    const mapped = map(item, index)
    if (mapped !== item) changed = true
    return mapped
  })
  return changed ? next : items
}

function extractOutcome(
  questId: string,
  stepId: string,
  outcome: Outcome,
  collect: Collect,
): Outcome {
  if (outcome.title === undefined) return outcome
  const title = collect(outcomeTitleKey(questId, stepId), outcome.title)
  if (title === outcome.title) return outcome
  return { ...outcome, title }
}

function extractStep(questId: string, step: Step, collect: Collect): Step {
  const title = collect(stepTitleKey(questId, step.id), step.title)
  const journal =
    step.journal === undefined ? undefined : collect(stepJournalKey(questId, step.id), step.journal)
  const outcome =
    step.outcome === undefined ? undefined : extractOutcome(questId, step.id, step.outcome, collect)
  if (title === step.title && journal === step.journal && outcome === step.outcome) return step
  const next: Step = { ...step, title }
  if (journal !== undefined) next.journal = journal
  if (outcome !== undefined) next.outcome = outcome
  return next
}

function extractQuest(quest: Quest, collect: Collect): Quest {
  const title = collect(questTitleKey(quest.id), quest.title)
  const summary =
    quest.summary === undefined ? undefined : collect(questSummaryKey(quest.id), quest.summary)
  const steps = mapShared(quest.steps, (step) => extractStep(quest.id, step, collect))
  if (title === quest.title && summary === quest.summary && steps === quest.steps) return quest
  const next: Quest = { ...quest, title, steps }
  if (summary !== undefined) next.summary = summary
  return next
}

function extractInto(doc: OqfDocument, collect: Collect): OqfDocument {
  const quests = mapShared(doc.quests, (quest) => extractQuest(quest, collect))
  return quests === doc.quests ? doc : { ...doc, quests }
}

function extractChoice(
  conversationId: string,
  nodeId: string,
  choice: Choice,
  index: number,
  collect: Collect,
): Choice {
  const text = collect(choiceTextKey(conversationId, nodeId, index), choice.text)
  return text === choice.text ? choice : { ...choice, text }
}

function extractNode(conversationId: string, node: DialogueNode, collect: Collect): DialogueNode {
  const text = collect(nodeTextKey(conversationId, node.id), node.text)
  const choices =
    node.choices === undefined
      ? undefined
      : mapShared(node.choices, (choice, index) =>
          extractChoice(conversationId, node.id, choice, index, collect),
        )
  if (text === node.text && choices === node.choices) return node
  const next: DialogueNode = { ...node, text }
  if (choices !== undefined) next.choices = choices
  return next
}

function extractConversation(conversation: Conversation, collect: Collect): Conversation {
  const title =
    conversation.title === undefined
      ? undefined
      : collect(conversationTitleKey(conversation.id), conversation.title)
  const nodes = mapShared(conversation.nodes, (node) => extractNode(conversation.id, node, collect))
  if (title === conversation.title && nodes === conversation.nodes) return conversation
  const next: Conversation = { ...conversation, nodes }
  if (title !== undefined) next.title = title
  return next
}

function extractDialogueInto(doc: DialogueDocument, collect: Collect): DialogueDocument {
  const conversations = mapShared(doc.conversations, (conversation) =>
    extractConversation(conversation, collect),
  )
  return conversations === doc.conversations ? doc : { ...doc, conversations }
}

/** Extracts every literal in a quest document into a fresh table. */
export function extractDocument(doc: OqfDocument): ExtractedDocument {
  const table: StringTable = {}
  return { document: extractInto(doc, collector(table)), table }
}

/** Extracts every literal in a dialogue document into a fresh table. */
export function extractDialogue(doc: DialogueDocument): ExtractedDialogue {
  const table: StringTable = {}
  return { document: extractDialogueInto(doc, collector(table)), table }
}

/** Extracts quest and dialogue documents into one shared table. */
export function extractAll(input: ExtractInput): ExtractedAll {
  const table: StringTable = {}
  const collect = collector(table)
  const quests = (input.quests ?? []).map((doc) => extractInto(doc, collect))
  const dialogues = (input.dialogues ?? []).map((doc) => extractDialogueInto(doc, collect))
  return { quests, dialogues, table }
}
