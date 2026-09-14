/**
 * Typed builders for the field actions.
 *
 * `FieldPatch` pairs a key with the value that key allows, which is exactly
 * what these builders promise their callers. TypeScript cannot see that a
 * generic `{ field: K, value: T[K] }` inhabits the distributed union, so the
 * assertion is made once here rather than at every call site.
 */
import type { Outcome, Quest, Reward, Step } from '@oqf/core'
import type { Choice, Conversation, DialogueNode } from '@oqf/dialogue'
import type { Action } from './actions'

export function questPatch<K extends keyof Quest>(
  quest: string,
  field: K,
  value: Quest[K],
): Action {
  return { type: 'quest/set', quest, field, value } as Action
}

export function stepPatch<K extends keyof Step>(
  quest: string,
  step: string,
  field: K,
  value: Step[K],
): Action {
  return { type: 'step/set', quest, step, field, value } as Action
}

export function outcomePatch<K extends keyof Outcome>(
  quest: string,
  step: string,
  field: K,
  value: Outcome[K],
): Action {
  return { type: 'outcome/set', quest, step, field, value } as Action
}

export function rewardPatch<K extends keyof Reward>(
  quest: string,
  reward: string,
  field: K,
  value: Reward[K],
): Action {
  return { type: 'reward/set', quest, reward, field, value } as Action
}

export function conversationPatch<K extends keyof Conversation>(
  conversation: string,
  field: K,
  value: Conversation[K],
): Action {
  return { type: 'conversation/set', conversation, field, value } as Action
}

export function nodePatch<K extends keyof DialogueNode>(
  conversation: string,
  node: string,
  field: K,
  value: DialogueNode[K],
): Action {
  return { type: 'node/set', conversation, node, field, value } as Action
}

export function choicePatch<K extends keyof Choice>(
  conversation: string,
  node: string,
  choice: number,
  field: K,
  value: Choice[K],
): Action {
  return { type: 'choice/set', conversation, node, choice, field, value } as Action
}
