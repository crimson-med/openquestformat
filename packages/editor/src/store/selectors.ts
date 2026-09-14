/**
 * Read-only views over the state. Components ask these questions instead of
 * walking the documents themselves, so a selection that points at something
 * deleted degrades to undefined in one place.
 */
import type { Quest, Reward, Step } from '@oqf/core'
import type { Choice, Conversation, DialogueNode } from '@oqf/dialogue'
import { readFile } from '../lib/pack'
import type { EditorFinding } from './findings'
import type { EditorState } from './types'

export function findQuest(state: EditorState, id: string | undefined): Quest | undefined {
  if (id === undefined) return undefined
  return state.quests.quests.find((quest) => quest.id === id)
}

export function findStep(
  state: EditorState,
  quest: string | undefined,
  step: string | undefined,
): Step | undefined {
  if (step === undefined) return undefined
  return findQuest(state, quest)?.steps.find((entry) => entry.id === step)
}

export function findReward(
  state: EditorState,
  quest: string | undefined,
  reward: string | undefined,
): Reward | undefined {
  if (reward === undefined) return undefined
  return findQuest(state, quest)?.rewards.find((entry) => entry.id === reward)
}

export function findConversation(
  state: EditorState,
  id: string | undefined,
): Conversation | undefined {
  if (id === undefined) return undefined
  return state.dialogues.conversations.find((conversation) => conversation.id === id)
}

export function findNode(
  state: EditorState,
  conversation: string | undefined,
  node: string | undefined,
): DialogueNode | undefined {
  if (node === undefined) return undefined
  return findConversation(state, conversation)?.nodes.find((entry) => entry.id === node)
}

export function findChoice(
  state: EditorState,
  conversation: string | undefined,
  node: string | undefined,
  choice: number | undefined,
): Choice | undefined {
  if (choice === undefined) return undefined
  return findNode(state, conversation, node)?.choices?.[choice]
}

/** The quest id the selection implies, falling back to the first quest. */
export function activeQuestId(state: EditorState): string | undefined {
  const selection = state.selection
  if ('quest' in selection) return selection.quest
  return state.quests.quests[0]?.id
}

/** The conversation id the selection implies, falling back to the first one. */
export function activeConversationId(state: EditorState): string | undefined {
  const selection = state.selection
  if ('conversation' in selection) return selection.conversation
  return state.dialogues.conversations[0]?.id
}

export function selectedQuest(state: EditorState): Quest | undefined {
  return state.selection.kind === 'quest' ? findQuest(state, state.selection.quest) : undefined
}

export function selectedStep(state: EditorState): Step | undefined {
  return state.selection.kind === 'step'
    ? findStep(state, state.selection.quest, state.selection.step)
    : undefined
}

export function selectedReward(state: EditorState): Reward | undefined {
  return state.selection.kind === 'reward'
    ? findReward(state, state.selection.quest, state.selection.reward)
    : undefined
}

/** Findings attached to one step, including the quest-wide ones when asked. */
export function findingsForStep(
  findings: EditorFinding[],
  quest: string,
  step: string,
): EditorFinding[] {
  return findings.filter((finding) => finding.quest === quest && finding.step === step)
}

export function findingsForNode(
  findings: EditorFinding[],
  conversation: string,
  node: string,
): EditorFinding[] {
  return findings.filter(
    (finding) => finding.conversation === conversation && finding.node === node,
  )
}

/** The worst level among a set of findings, for badges. */
export function worstLevel(findings: EditorFinding[]): 'error' | 'warning' | undefined {
  if (findings.some((finding) => finding.level === 'error')) return 'error'
  return findings.length > 0 ? 'warning' : undefined
}

/** Outcome names a quest can reach, for the reward outcome picker. */
export function outcomeNames(quest: Quest | undefined): string[] {
  if (quest === undefined) return []
  const names: string[] = []
  for (const step of quest.steps) {
    const name = step.outcome?.name
    if (name !== undefined && name !== '' && !names.includes(name)) names.push(name)
  }
  return names
}

/** Conversation ids a dialogue binding may point at. */
export function conversationIds(state: EditorState): string[] {
  return state.dialogues.conversations.map((conversation) => conversation.id)
}

/** True when the step ends the quest. */
export function isEndingStep(step: Step): boolean {
  return step.outcome !== undefined
}

/** The file names in use across quests and conversations, distinct and sorted. */
export function packFiles(state: EditorState): string[] {
  const names = new Set<string>()
  for (const quest of state.quests.quests) {
    const name = readFile(quest.ext)
    if (name !== undefined) names.add(name)
  }
  for (const conversation of state.dialogues.conversations) {
    const name = readFile(conversation.ext)
    if (name !== undefined) names.add(name)
  }
  return [...names].sort()
}
