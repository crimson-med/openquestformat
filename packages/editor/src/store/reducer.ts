/**
 * The document reducer.
 *
 * Everything the editor can change goes through here: one pure function over
 * two documents, the selection and a bounded undo stack. Findings are derived
 * on every change rather than stored as an edit, so they can never drift from
 * the documents they describe.
 */
import { type Quest, type Reward, type Step, emptyDocument } from '@oqf/core'
import { type Conversation, type DialogueNode, emptyDialogueDocument } from '@oqf/dialogue'
import { linkSteps, unlinkSteps } from '../lib/connections'
import { type Position, writePosition } from '../lib/position'
import type { Action, DictionaryKind } from './actions'
import { isMutating } from './actions'
import { computeFindings } from './findings'
import {
  type EditorDocument,
  type EditorState,
  HISTORY_LIMIT,
  NO_SELECTION,
  type Selection,
} from './types'

type Documents = Pick<EditorDocument, 'quests' | 'dialogues' | 'selection'>

/** Writes one field, removing the key when the value is undefined. */
function setField<T extends object>(target: T, field: string | number | symbol, value: unknown): T {
  const next = { ...target } as Record<string | number | symbol, unknown>
  if (value === undefined) delete next[field]
  else next[field] = value
  return next as T
}

function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from < 0 || from >= items.length) return items
  const target = Math.max(0, Math.min(items.length - 1, to))
  if (target === from) return items
  const next = [...items]
  const [moved] = next.splice(from, 1)
  next.splice(target, 0, moved)
  return next
}

/** `base`, then `base_2`, `base_3` and so on until nothing collides. */
export function uniqueId(taken: readonly string[], base: string): string {
  if (!taken.includes(base)) return base
  let counter = 2
  while (taken.includes(`${base}_${counter}`)) counter += 1
  return `${base}_${counter}`
}

export function newQuest(id: string, title = 'New quest'): Quest {
  return { id, version: 1, title, tags: [], steps: [], rewards: [] }
}

export function newStep(id: string, title = 'New step'): Step {
  return { id, title, rewards: [], actors: [] }
}

export function newReward(id: string): Reward {
  return { id, kind: 'item', ref: '' }
}

export function newNode(id: string): DialogueNode {
  return { id, text: '' }
}

export function newConversation(id: string): Conversation {
  return { id, start: 'start', nodes: [newNode('start')] }
}

function mapQuest(docs: Documents, id: string, change: (quest: Quest) => Quest): Documents {
  return {
    ...docs,
    quests: {
      ...docs.quests,
      quests: docs.quests.quests.map((quest) => (quest.id === id ? change(quest) : quest)),
    },
  }
}

function mapStep(quest: Quest, id: string, change: (step: Step) => Step): Quest {
  return { ...quest, steps: quest.steps.map((step) => (step.id === id ? change(step) : step)) }
}

function mapConversation(
  docs: Documents,
  id: string,
  change: (conversation: Conversation) => Conversation,
): Documents {
  return {
    ...docs,
    dialogues: {
      ...docs.dialogues,
      conversations: docs.dialogues.conversations.map((conversation) =>
        conversation.id === id ? change(conversation) : conversation,
      ),
    },
  }
}

function mapNode(
  conversation: Conversation,
  id: string,
  change: (node: DialogueNode) => DialogueNode,
): Conversation {
  return {
    ...conversation,
    nodes: conversation.nodes.map((node) => (node.id === id ? change(node) : node)),
  }
}

/** Keeps the selection pointed at an entity that was just renamed. */
function renameSelection(
  selection: Selection,
  kind: Selection['kind'],
  from: string,
  to: string,
): Selection {
  if (kind === 'quest' && 'quest' in selection && selection.quest === from) {
    return { ...selection, quest: to }
  }
  if (kind === 'step' && selection.kind === 'step' && selection.step === from) {
    return { ...selection, step: to }
  }
  if (kind === 'reward' && selection.kind === 'reward' && selection.reward === from) {
    return { ...selection, reward: to }
  }
  if (kind === 'conversation' && 'conversation' in selection && selection.conversation === from) {
    return { ...selection, conversation: to }
  }
  if (
    kind === 'node' &&
    (selection.kind === 'node' || selection.kind === 'choice') &&
    selection.node === from
  ) {
    return { ...selection, node: to }
  }
  return selection
}

function indexOfId<T extends { id: string }>(items: T[], id: string): number {
  return items.findIndex((item) => item.id === id)
}

function applyEdit(state: EditorState, action: Action): Documents {
  const docs: Documents = {
    quests: state.quests,
    dialogues: state.dialogues,
    selection: state.selection,
  }
  switch (action.type) {
    case 'doc/replace':
      return {
        ...docs,
        quests: action.quests ?? docs.quests,
        dialogues: action.dialogues ?? docs.dialogues,
      }
    case 'dict/set': {
      const kind: DictionaryKind = action.kind
      return {
        ...docs,
        quests: {
          ...docs.quests,
          dictionaries: { ...docs.quests.dictionaries, [kind]: action.refs },
        },
      }
    }
    case 'speakers/set':
      return { ...docs, dialogues: { ...docs.dialogues, speakers: action.speakers } }

    case 'quest/add': {
      const id = uniqueId(
        docs.quests.quests.map((quest) => quest.id),
        action.id ?? 'new_quest',
      )
      const quest = newQuest(id, action.title)
      return {
        ...docs,
        quests: { ...docs.quests, quests: [...docs.quests.quests, quest] },
        selection: { kind: 'quest', quest: id },
      }
    }
    case 'quest/remove': {
      const quests = docs.quests.quests.filter((quest) => quest.id !== action.quest)
      const selection =
        'quest' in docs.selection && docs.selection.quest === action.quest
          ? NO_SELECTION
          : docs.selection
      return { ...docs, quests: { ...docs.quests, quests }, selection }
    }
    case 'quest/move': {
      const from = indexOfId(docs.quests.quests, action.quest)
      return {
        ...docs,
        quests: { ...docs.quests, quests: moveItem(docs.quests.quests, from, action.to) },
      }
    }
    case 'quest/set': {
      const next = mapQuest(docs, action.quest, (quest) =>
        setField(quest, action.field, action.value),
      )
      if (action.field !== 'id' || typeof action.value !== 'string') return next
      return {
        ...next,
        selection: renameSelection(next.selection, 'quest', action.quest, action.value),
      }
    }

    case 'step/add': {
      const quest = docs.quests.quests.find((entry) => entry.id === action.quest)
      if (quest === undefined) return docs
      const id = uniqueId(
        quest.steps.map((step) => step.id),
        action.id ?? 'new_step',
      )
      const at = action.after === undefined ? -1 : indexOfId(quest.steps, action.after)
      const steps = [...quest.steps]
      if (at === -1) steps.push(newStep(id))
      else steps.splice(at + 1, 0, newStep(id))
      return {
        ...mapQuest(docs, action.quest, (entry) => ({ ...entry, steps })),
        selection: { kind: 'step', quest: action.quest, step: id },
      }
    }
    case 'step/remove': {
      const next = mapQuest(docs, action.quest, (quest) => ({
        ...quest,
        steps: quest.steps.filter((step) => step.id !== action.step),
      }))
      const selection =
        docs.selection.kind === 'step' && docs.selection.step === action.step
          ? { kind: 'quest' as const, quest: action.quest }
          : docs.selection
      return { ...next, selection }
    }
    case 'step/move':
      return mapQuest(docs, action.quest, (quest) => ({
        ...quest,
        steps: moveItem(quest.steps, indexOfId(quest.steps, action.step), action.to),
      }))
    case 'step/set': {
      const next = mapQuest(docs, action.quest, (quest) =>
        mapStep(quest, action.step, (step) => setField(step, action.field, action.value)),
      )
      if (action.field !== 'id' || typeof action.value !== 'string') return next
      return {
        ...next,
        selection: renameSelection(next.selection, 'step', action.step, action.value),
      }
    }
    case 'step/position':
      return mapQuest(docs, action.quest, (quest) =>
        mapStep(quest, action.step, (step) => ({
          ...step,
          ext: writePosition(step.ext, action.position),
        })),
      )
    case 'step/positions':
      return mapQuest(docs, action.quest, (quest) => ({
        ...quest,
        steps: quest.steps.map((step) => {
          const position: Position | undefined = action.positions[step.id]
          return position === undefined ? step : { ...step, ext: writePosition(step.ext, position) }
        }),
      }))
    case 'step/link':
    case 'step/unlink': {
      if (action.from === action.to) return docs
      const quest = docs.quests.quests.find((entry) => entry.id === action.quest)
      if (quest === undefined) return docs
      const ids = quest.steps.map((step) => step.id)
      if (!ids.includes(action.from) || !ids.includes(action.to)) return docs
      const change = action.type === 'step/link' ? linkSteps : unlinkSteps
      return mapQuest(docs, action.quest, (entry) =>
        mapStep(entry, action.to, (step) => change(step, action.from)),
      )
    }
    case 'outcome/set':
      return mapQuest(docs, action.quest, (quest) =>
        mapStep(quest, action.step, (step) => ({
          ...step,
          outcome: setField(step.outcome ?? { name: '' }, action.field, action.value),
        })),
      )

    case 'reward/add': {
      const quest = docs.quests.quests.find((entry) => entry.id === action.quest)
      if (quest === undefined) return docs
      const id = uniqueId(
        quest.rewards.map((reward) => reward.id),
        action.id ?? 'new_reward',
      )
      return {
        ...mapQuest(docs, action.quest, (entry) => ({
          ...entry,
          rewards: [...entry.rewards, newReward(id)],
        })),
        selection: { kind: 'reward', quest: action.quest, reward: id },
      }
    }
    case 'reward/remove': {
      const next = mapQuest(docs, action.quest, (quest) => ({
        ...quest,
        rewards: quest.rewards.filter((reward) => reward.id !== action.reward),
        steps: quest.steps.map((step) =>
          step.rewards.includes(action.reward)
            ? { ...step, rewards: step.rewards.filter((id) => id !== action.reward) }
            : step,
        ),
      }))
      const selection =
        docs.selection.kind === 'reward' && docs.selection.reward === action.reward
          ? { kind: 'quest' as const, quest: action.quest }
          : docs.selection
      return { ...next, selection }
    }
    case 'reward/move':
      return mapQuest(docs, action.quest, (quest) => ({
        ...quest,
        rewards: moveItem(quest.rewards, indexOfId(quest.rewards, action.reward), action.to),
      }))
    case 'reward/set': {
      const next = mapQuest(docs, action.quest, (quest) => ({
        ...quest,
        rewards: quest.rewards.map((reward) =>
          reward.id === action.reward ? setField(reward, action.field, action.value) : reward,
        ),
        steps:
          action.field === 'id' && typeof action.value === 'string'
            ? quest.steps.map((step) => ({
                ...step,
                rewards: step.rewards.map((id) => (id === action.reward ? action.value : id)),
              }))
            : quest.steps,
      }))
      if (action.field !== 'id' || typeof action.value !== 'string') return next
      return {
        ...next,
        selection: renameSelection(next.selection, 'reward', action.reward, action.value),
      }
    }

    case 'conversation/add': {
      const id = uniqueId(
        docs.dialogues.conversations.map((conversation) => conversation.id),
        action.id ?? 'new_conversation',
      )
      return {
        ...docs,
        dialogues: {
          ...docs.dialogues,
          conversations: [...docs.dialogues.conversations, newConversation(id)],
        },
        selection: { kind: 'conversation', conversation: id },
      }
    }
    case 'conversation/remove': {
      const conversations = docs.dialogues.conversations.filter(
        (conversation) => conversation.id !== action.conversation,
      )
      const selection =
        'conversation' in docs.selection && docs.selection.conversation === action.conversation
          ? NO_SELECTION
          : docs.selection
      return { ...docs, dialogues: { ...docs.dialogues, conversations }, selection }
    }
    case 'conversation/move':
      return {
        ...docs,
        dialogues: {
          ...docs.dialogues,
          conversations: moveItem(
            docs.dialogues.conversations,
            indexOfId(docs.dialogues.conversations, action.conversation),
            action.to,
          ),
        },
      }
    case 'conversation/set': {
      const next = mapConversation(docs, action.conversation, (conversation) =>
        setField(conversation, action.field, action.value),
      )
      if (action.field !== 'id' || typeof action.value !== 'string') return next
      return {
        ...next,
        selection: renameSelection(
          next.selection,
          'conversation',
          action.conversation,
          action.value,
        ),
      }
    }

    case 'node/add': {
      const conversation = docs.dialogues.conversations.find(
        (entry) => entry.id === action.conversation,
      )
      if (conversation === undefined) return docs
      const id = uniqueId(
        conversation.nodes.map((node) => node.id),
        action.id ?? 'new_node',
      )
      const at = action.after === undefined ? -1 : indexOfId(conversation.nodes, action.after)
      const nodes = [...conversation.nodes]
      if (at === -1) nodes.push(newNode(id))
      else nodes.splice(at + 1, 0, newNode(id))
      return {
        ...mapConversation(docs, action.conversation, (entry) => ({ ...entry, nodes })),
        selection: { kind: 'node', conversation: action.conversation, node: id },
      }
    }
    case 'node/remove': {
      const next = mapConversation(docs, action.conversation, (conversation) => ({
        ...conversation,
        nodes: conversation.nodes.filter((node) => node.id !== action.node),
      }))
      const selection =
        (docs.selection.kind === 'node' || docs.selection.kind === 'choice') &&
        docs.selection.node === action.node
          ? { kind: 'conversation' as const, conversation: action.conversation }
          : docs.selection
      return { ...next, selection }
    }
    case 'node/move':
      return mapConversation(docs, action.conversation, (conversation) => ({
        ...conversation,
        nodes: moveItem(conversation.nodes, indexOfId(conversation.nodes, action.node), action.to),
      }))
    case 'node/set': {
      const next = mapConversation(docs, action.conversation, (conversation) =>
        mapNode(conversation, action.node, (node) => setField(node, action.field, action.value)),
      )
      if (action.field !== 'id' || typeof action.value !== 'string') return next
      return {
        ...next,
        selection: renameSelection(next.selection, 'node', action.node, action.value),
      }
    }
    case 'node/position':
      return mapConversation(docs, action.conversation, (conversation) =>
        mapNode(conversation, action.node, (node) => ({
          ...node,
          ext: writePosition(node.ext, action.position),
        })),
      )
    case 'node/positions':
      return mapConversation(docs, action.conversation, (conversation) => ({
        ...conversation,
        nodes: conversation.nodes.map((node) => {
          const position: Position | undefined = action.positions[node.id]
          return position === undefined ? node : { ...node, ext: writePosition(node.ext, position) }
        }),
      }))

    case 'choice/add': {
      let index = 0
      const next = mapConversation(docs, action.conversation, (conversation) =>
        mapNode(conversation, action.node, (node) => {
          const choices = [...(node.choices ?? []), { text: 'New choice' }]
          index = choices.length - 1
          return { ...node, choices }
        }),
      )
      return {
        ...next,
        selection: {
          kind: 'choice',
          conversation: action.conversation,
          node: action.node,
          choice: index,
        },
      }
    }
    case 'choice/remove': {
      const next = mapConversation(docs, action.conversation, (conversation) =>
        mapNode(conversation, action.node, (node) => {
          const choices = (node.choices ?? []).filter((_, at) => at !== action.choice)
          return choices.length === 0 ? setField(node, 'choices', undefined) : { ...node, choices }
        }),
      )
      const selection =
        docs.selection.kind === 'choice' && docs.selection.choice === action.choice
          ? { kind: 'node' as const, conversation: action.conversation, node: action.node }
          : docs.selection
      return { ...next, selection }
    }
    case 'choice/move':
      return mapConversation(docs, action.conversation, (conversation) =>
        mapNode(conversation, action.node, (node) => ({
          ...node,
          choices: moveItem(node.choices ?? [], action.choice, action.to),
        })),
      )
    case 'choice/set':
      return mapConversation(docs, action.conversation, (conversation) =>
        mapNode(conversation, action.node, (node) => ({
          ...node,
          choices: (node.choices ?? []).map((choice, at) =>
            at === action.choice ? setField(choice, action.field, action.value) : choice,
          ),
        })),
      )
    default:
      return docs
  }
}

function commit(state: EditorState, docs: Documents): EditorState {
  const before: EditorDocument = {
    quests: state.quests,
    dialogues: state.dialogues,
    selection: state.selection,
    dirty: state.dirty,
  }
  const past = [...state.past, before]
  return {
    ...docs,
    dirty: true,
    findings:
      docs.quests === state.quests && docs.dialogues === state.dialogues
        ? state.findings
        : computeFindings(docs.quests, docs.dialogues),
    past: past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past,
    future: [],
  }
}

export function createState(
  quests = emptyDocument(),
  dialogues = emptyDialogueDocument(),
  selection: Selection = NO_SELECTION,
): EditorState {
  return {
    quests,
    dialogues,
    selection,
    dirty: false,
    findings: computeFindings(quests, dialogues),
    past: [],
    future: [],
  }
}

export function initialState(): EditorState {
  return createState()
}

export function reducer(state: EditorState, action: Action): EditorState {
  switch (action.type) {
    case 'select':
      return { ...state, selection: action.selection }
    case 'doc/reset':
      return initialState()
    case 'doc/markSaved':
      return { ...state, dirty: false }
    case 'doc/load': {
      const quests = action.quests ?? state.quests
      const dialogues = action.dialogues ?? state.dialogues
      return {
        quests,
        dialogues,
        selection: action.selection ?? NO_SELECTION,
        dirty: false,
        findings: computeFindings(quests, dialogues),
        past: [],
        future: [],
      }
    }
    case 'undo': {
      const previous = state.past[state.past.length - 1]
      if (previous === undefined) return state
      const current: EditorDocument = {
        quests: state.quests,
        dialogues: state.dialogues,
        selection: state.selection,
        dirty: state.dirty,
      }
      return {
        ...previous,
        findings: computeFindings(previous.quests, previous.dialogues),
        past: state.past.slice(0, -1),
        future: [current, ...state.future].slice(0, HISTORY_LIMIT),
      }
    }
    case 'redo': {
      const next = state.future[0]
      if (next === undefined) return state
      const current: EditorDocument = {
        quests: state.quests,
        dialogues: state.dialogues,
        selection: state.selection,
        dirty: state.dirty,
      }
      return {
        ...next,
        findings: computeFindings(next.quests, next.dialogues),
        past: [...state.past, current].slice(-HISTORY_LIMIT),
        future: state.future.slice(1),
      }
    }
    default:
      return isMutating(action) ? commit(state, applyEdit(state, action)) : state
  }
}
