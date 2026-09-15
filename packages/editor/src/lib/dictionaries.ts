/**
 * The dictionary manager's model: the five lists of refs a pack declares
 * (actors, locations, items, tags and dialogue speakers), where each entry is
 * used, and edits that keep every usage pointing at the entry it named.
 *
 * No React here. The reducer calls `renameUsages` so a rename never breaks a
 * reference, and the panel calls `usagesOf` to say what a remove would break.
 */
import type { Objective, OqfDocument, Quest, Ref, Reward, Step } from '@oqf/core'
import type { Conversation, DialogueDocument, DialogueNode } from '@oqf/dialogue'

export type EntryKind = 'actors' | 'locations' | 'items' | 'tags' | 'speakers'

export const ENTRY_KINDS: readonly EntryKind[] = [
  'actors',
  'locations',
  'items',
  'tags',
  'speakers',
]

/** The singular noun for a kind, for labels. */
export const ENTRY_NOUN: Record<EntryKind, string> = {
  actors: 'actor',
  locations: 'location',
  items: 'item',
  tags: 'tag',
  speakers: 'speaker',
}

/** The two documents an entry can be used in. */
export interface Documents {
  quests: OqfDocument
  dialogues: DialogueDocument
}

/** One place an entry is referenced. Exactly one entity is named, plus its field. */
export interface Usage {
  quest?: string
  step?: string
  reward?: string
  conversation?: string
  node?: string
  field: string
}

export function entriesOf(docs: Documents, kind: EntryKind): Ref[] {
  return kind === 'speakers' ? docs.dialogues.speakers : docs.quests.dictionaries[kind]
}

/** Why `id` cannot be an entry id among `refs`, or undefined when it can. */
export function entryIdError(
  refs: readonly Ref[],
  id: string,
  current?: string,
): string | undefined {
  if (id === '') return 'An id is required.'
  if (/\s/.test(id)) return 'An id cannot contain whitespace.'
  if (id !== current && refs.some((ref) => ref.id === id)) return `${id} already exists.`
  return undefined
}

/** `refs` plus a new entry, or `refs` itself when the id is empty, spaced or taken. */
export function addEntry(refs: Ref[], id: string, name?: string): Ref[] {
  if (entryIdError(refs, id) !== undefined) return refs
  return [...refs, name === undefined || name === '' ? { id } : { id, name }]
}

/**
 * The entry `id` renamed to `nextId`. A `name` replaces the display name, an
 * empty name clears it, and no name keeps what was there. Returns `refs` itself
 * when the entry is missing or the new id is empty, spaced or taken.
 */
export function renameEntry(refs: Ref[], id: string, nextId: string, name?: string): Ref[] {
  if (!refs.some((ref) => ref.id === id)) return refs
  if (entryIdError(refs, nextId, id) !== undefined) return refs
  return refs.map((ref) => {
    if (ref.id !== id) return ref
    const nextName = name === undefined ? ref.name : name === '' ? undefined : name
    return nextName === undefined ? { id: nextId } : { id: nextId, name: nextName }
  })
}

export function removeEntry(refs: Ref[], id: string): Ref[] {
  return refs.filter((ref) => ref.id !== id)
}

function objectiveRef(objective: Objective | undefined, kind: EntryKind): string | undefined {
  if (objective === undefined) return undefined
  switch (kind) {
    case 'actors':
      return objective.kind === 'talk' || objective.kind === 'kill' ? objective.actor : undefined
    case 'locations':
      return objective.kind === 'reach' ? objective.location : undefined
    case 'items':
      return objective.kind === 'collect' ? objective.item : undefined
    default:
      return undefined
  }
}

function stepUsages(quest: Quest, step: Step, kind: EntryKind, id: string): Usage[] {
  const found: Usage[] = []
  const at = { quest: quest.id, step: step.id }
  if (kind === 'actors' && step.actors.includes(id)) found.push({ ...at, field: 'actors' })
  if (kind === 'locations' && step.location === id) found.push({ ...at, field: 'location' })
  if (objectiveRef(step.objective, kind) === id) found.push({ ...at, field: 'objective' })
  if (objectiveRef(step.failObjective, kind) === id) {
    found.push({ ...at, field: 'failObjective' })
  }
  return found
}

/** Every place `id` of `kind` is referenced, in document order. */
export function usagesOf(docs: Documents, kind: EntryKind, id: string): Usage[] {
  const found: Usage[] = []
  if (kind === 'speakers') {
    for (const conversation of docs.dialogues.conversations) {
      if (conversation.actor === id) found.push({ conversation: conversation.id, field: 'actor' })
      for (const node of conversation.nodes) {
        if (node.speaker === id) {
          found.push({ conversation: conversation.id, node: node.id, field: 'speaker' })
        }
      }
    }
    return found
  }
  for (const quest of docs.quests.quests) {
    if (kind === 'tags' && quest.tags.includes(id)) found.push({ quest: quest.id, field: 'tags' })
    for (const step of quest.steps) found.push(...stepUsages(quest, step, kind, id))
    if (kind === 'items') {
      for (const reward of quest.rewards) {
        if (reward.kind === 'item' && reward.ref === id) {
          found.push({ quest: quest.id, reward: reward.id, field: 'ref' })
        }
      }
    }
  }
  return found
}

/** Entries of `kind` that nothing references. */
export function unusedEntries(docs: Documents, kind: EntryKind): Ref[] {
  return entriesOf(docs, kind).filter((ref) => usagesOf(docs, kind, ref.id).length === 0)
}

function renameObjective(
  objective: Objective | undefined,
  kind: EntryKind,
  id: string,
  nextId: string,
): Objective | undefined {
  if (objective === undefined || objectiveRef(objective, kind) !== id) return objective
  switch (objective.kind) {
    case 'talk':
    case 'kill':
      return { ...objective, actor: nextId }
    case 'reach':
      return { ...objective, location: nextId }
    case 'collect':
      return { ...objective, item: nextId }
    default:
      return objective
  }
}

function renameList(list: string[], id: string, nextId: string): string[] {
  return list.includes(id) ? list.map((entry) => (entry === id ? nextId : entry)) : list
}

function renameStep(step: Step, kind: EntryKind, id: string, nextId: string): Step {
  let next = step
  if (kind === 'actors') {
    const actors = renameList(step.actors, id, nextId)
    if (actors !== step.actors) next = { ...next, actors }
  }
  if (kind === 'locations' && step.location === id) next = { ...next, location: nextId }
  const objective = renameObjective(step.objective, kind, id, nextId)
  if (objective !== step.objective) next = { ...next, objective }
  const failObjective = renameObjective(step.failObjective, kind, id, nextId)
  if (failObjective !== step.failObjective) next = { ...next, failObjective }
  return next
}

function renameReward(reward: Reward, id: string, nextId: string): Reward {
  return reward.kind === 'item' && reward.ref === id ? { ...reward, ref: nextId } : reward
}

function renameQuest(quest: Quest, kind: EntryKind, id: string, nextId: string): Quest {
  let next = quest
  if (kind === 'tags') {
    const tags = renameList(quest.tags, id, nextId)
    if (tags !== quest.tags) next = { ...next, tags }
  }
  const steps = quest.steps.map((step) => renameStep(step, kind, id, nextId))
  if (steps.some((step, index) => step !== quest.steps[index])) next = { ...next, steps }
  if (kind === 'items') {
    const rewards = quest.rewards.map((reward) => renameReward(reward, id, nextId))
    if (rewards.some((reward, index) => reward !== quest.rewards[index])) {
      next = { ...next, rewards }
    }
  }
  return next
}

function renameNode(node: DialogueNode, id: string, nextId: string): DialogueNode {
  return node.speaker === id ? { ...node, speaker: nextId } : node
}

function renameConversation(conversation: Conversation, id: string, nextId: string): Conversation {
  let next = conversation
  if (conversation.actor === id) next = { ...next, actor: nextId }
  const nodes = conversation.nodes.map((node) => renameNode(node, id, nextId))
  if (nodes.some((node, index) => node !== conversation.nodes[index])) next = { ...next, nodes }
  return next
}

/**
 * Both documents with every usage of `id` rewritten to `nextId`, the same
 * places `usagesOf` reports. The dictionaries themselves are left alone; see
 * `renameEntry`. Untouched entities keep their identity.
 */
export function renameUsages(
  docs: Documents,
  kind: EntryKind,
  id: string,
  nextId: string,
): Documents {
  if (id === nextId) return docs
  if (kind === 'speakers') {
    const conversations = docs.dialogues.conversations.map((conversation) =>
      renameConversation(conversation, id, nextId),
    )
    if (conversations.every((entry, index) => entry === docs.dialogues.conversations[index])) {
      return docs
    }
    return { ...docs, dialogues: { ...docs.dialogues, conversations } }
  }
  const quests = docs.quests.quests.map((quest) => renameQuest(quest, kind, id, nextId))
  if (quests.every((entry, index) => entry === docs.quests.quests[index])) return docs
  return { ...docs, quests: { ...docs.quests, quests } }
}
