/**
 * One-click fixes for validation findings.
 *
 * A fix is a list of existing store actions, so the reducer stays the only
 * place that edits documents and a fix undoes as one step when dispatched as a
 * batch. Ids are read out of the validator messages, matched against the exact
 * strings the validators write, so a message that changes stops offering a fix
 * instead of applying the wrong one.
 */
import {
  type Quest,
  STEP_CONDITION_FIELDS,
  type Step,
  type StepConditionField,
  reachableSteps,
  stepGraph,
} from '@oqf/core'
import type { Action, DictionaryKind } from '../store/actions'
import type { EditorFinding } from '../store/findings'
import {
  choicePatch,
  conversationPatch,
  nodePatch,
  outcomePatch,
  questPatch,
  rewardPatch,
  stepPatch,
} from '../store/patch'
import { uniqueId } from '../store/reducer'
import { findConversation, findQuest, findStep } from '../store/selectors'
import type { EditorState } from '../store/types'
import { unlinkSteps } from './connections'

export interface Fix {
  id: string
  title: string
  actions: Action[]
}

/** How many steps an unbound conversation offers to bind to. */
const BIND_LIMIT = 3

const DICTIONARY_REF = /^(tag|actor|location) "([^"]*)" is not in the \1 dictionary$/
const REWARD_REF = /^reward "([^"]*)" is not in the quest reward catalog$/
const COUNTER_REF = /^counter "[^"]*" names "([^"]*)", which is not a step of this quest$/
const LOCAL_STEP_REF = /^step "([^"]*)" is not a step of this quest$/
const FOREIGN_STEP_REF = /^step "([^"]*)" is not a step of quest "([^"]*)"$/
const REWARD_OUTCOME = /^reward "([^"]*)" is keyed to outcome "([^"]*)", which no step reaches$/
const DUPLICATE_STEP = /^step id "([^"]*)" is used twice$/
const UNKNOWN_FLAG = /^flag "([^"]*)" is never set by a reward in this pack$/
const UNBOUND = /^conversation "([^"]*)" is not bound from any step$/
const UNKNOWN_NEXT =
  /^(?:node "[^"]*"|choice) continues at unknown node "[^"]*" in conversation "[^"]*"$/
const UNKNOWN_START = /^conversation "([^"]*)" starts at unknown node "[^"]*"$/

const STEP_INDEX = /\.steps\[(\d+)\]$/
const CONDITION_FIELD = /\.(unlock|activate|complete|fail)$/
const NEXT_PATH = /\.nodes\[(\d+)\](?:\.choices\[(\d+)\])?\.next$/

const DICTIONARIES: Record<string, DictionaryKind> = {
  tag: 'tags',
  actor: 'actors',
  location: 'locations',
}

function isConditionField(field: string): field is StepConditionField {
  return (STEP_CONDITION_FIELDS as readonly string[]).includes(field)
}

function outcomeNameFor(quest: Quest, step: Step): string {
  const taken: string[] = []
  for (const entry of quest.steps) {
    if (entry.outcome !== undefined) taken.push(entry.outcome.name)
  }
  return uniqueId(taken, step.id)
}

function addOutcome(quest: Quest, step: Step, title: string): Fix {
  return {
    id: 'add-outcome',
    title,
    actions: [outcomePatch(quest.id, step.id, 'name', outcomeNameFor(quest, step))],
  }
}

/** The `step/set` actions that turn `step` into `next`, one per condition field that differs. */
function conditionChanges(quest: string, step: Step, next: Step): Action[] {
  const actions: Action[] = []
  for (const field of STEP_CONDITION_FIELDS) {
    if (step[field] === next[field]) continue
    actions.push(stepPatch(quest, step.id, field, next[field]))
  }
  return actions
}

function unknownStepId(message: string): string | undefined {
  const counter = COUNTER_REF.exec(message)
  if (counter !== null) return counter[1]
  const local = LOCAL_STEP_REF.exec(message)
  if (local !== null) return local[1]
  const foreign = FOREIGN_STEP_REF.exec(message)
  if (foreign !== null) return `${foreign[2]}#${foreign[1]}`
  return undefined
}

function questFixes(finding: EditorFinding, state: EditorState): Fix[] {
  const quest = findQuest(state, finding.quest)
  if (quest === undefined) return []
  const step = findStep(state, finding.quest, finding.step)
  const path = finding.path ?? ''

  switch (finding.code) {
    case 'cycle-without-repeat': {
      if (step === undefined) return []
      return [
        {
          id: 'mark-repeat',
          title: `Mark ${step.id} repeat`,
          actions: [stepPatch(quest.id, step.id, 'repeat', true)],
        },
      ]
    }
    case 'dead-end': {
      if (step === undefined) return []
      return [addOutcome(quest, step, 'Add outcome')]
    }
    case 'no-ending-reachable': {
      const graph = stepGraph(quest)
      const reachable = reachableSteps(quest)
      const blocking = new Set(graph.edges.map(([from]) => from))
      const sinks = quest.steps.filter(
        (entry) =>
          entry.outcome === undefined && !blocking.has(entry.id) && reachable.has(entry.id),
      )
      if (sinks.length !== 1) return []
      return [addOutcome(quest, sinks[0], `Add outcome to ${sinks[0].id}`)]
    }
    case 'unreachable-step': {
      if (step === undefined) return []
      return [
        {
          id: 'mark-start',
          title: 'Mark start',
          actions: [stepPatch(quest.id, step.id, 'start', true)],
        },
        {
          id: 'remove-step',
          title: 'Remove step',
          actions: [{ type: 'step/remove', quest: quest.id, step: step.id }],
        },
      ]
    }
    case 'unknown-dictionary-ref': {
      const match = DICTIONARY_REF.exec(finding.message)
      if (match === null) return []
      const kind = DICTIONARIES[match[1]]
      const id = match[2]
      const refs = state.quests.dictionaries[kind]
      if (refs.some((ref) => ref.id === id)) return []
      return [
        {
          id: 'add-dictionary-entry',
          title: `Add ${id} to ${kind}`,
          actions: [{ type: 'dict/set', kind, refs: [...refs, { id }] }],
        },
      ]
    }
    case 'unknown-reward-ref': {
      const match = REWARD_REF.exec(finding.message)
      if (match === null || step === undefined) return []
      const id = match[1]
      return [
        {
          id: 'add-reward',
          title: `Add reward ${id}`,
          actions: [{ type: 'reward/add', quest: quest.id, id }],
        },
        {
          id: 'drop-reward-ref',
          title: 'Drop the reference',
          actions: [
            stepPatch(
              quest.id,
              step.id,
              'rewards',
              step.rewards.filter((reward) => reward !== id),
            ),
          ],
        },
      ]
    }
    case 'unknown-step-ref': {
      const id = unknownStepId(finding.message)
      if (id === undefined) return []
      if (step !== undefined) {
        const actions = conditionChanges(quest.id, step, unlinkSteps(step, id))
        if (actions.length === 0) return []
        return [{ id: 'remove-step-ref', title: 'Remove the reference', actions }]
      }
      // The quest unlock is the only condition outside a step.
      if (quest.unlock === undefined || !path.endsWith('.unlock')) return []
      const carrier: Step = { id: '', title: '', rewards: [], actors: [], unlock: quest.unlock }
      const { unlock } = unlinkSteps(carrier, id)
      if (unlock === quest.unlock) return []
      return [
        {
          id: 'remove-step-ref',
          title: 'Remove the reference',
          actions: [questPatch(quest.id, 'unlock', unlock)],
        },
      ]
    }
    case 'unknown-outcome-ref': {
      const match = REWARD_OUTCOME.exec(finding.message)
      if (match === null) return []
      const reward = quest.rewards.find((entry) => entry.id === match[1])
      if (reward === undefined) return []
      return [
        {
          id: 'clear-outcome',
          title: 'Clear the outcome',
          actions: [rewardPatch(quest.id, reward.id, 'outcome', undefined)],
        },
      ]
    }
    case 'outcome-with-dependents': {
      if (step === undefined) return []
      return [
        {
          id: 'remove-outcome',
          title: 'Remove the outcome',
          actions: [stepPatch(quest.id, step.id, 'outcome', undefined)],
        },
      ]
    }
    case 'duplicate-step-id': {
      const match = DUPLICATE_STEP.exec(finding.message)
      const index = STEP_INDEX.exec(path)
      if (match === null || index === null) return []
      const at = Number(index[1])
      const target = quest.steps[at]
      if (target === undefined || target.id !== match[1]) return []
      const renamed = uniqueId(
        quest.steps.map((entry) => entry.id),
        target.id,
      )
      const steps = quest.steps.map((entry, position) =>
        position === at ? { ...entry, id: renamed } : entry,
      )
      return [
        {
          id: 'rename-step',
          title: `Rename to ${renamed}`,
          actions: [questPatch(quest.id, 'steps', steps)],
        },
      ]
    }
    case 'condition-constant': {
      const match = CONDITION_FIELD.exec(path)
      if (match === null || !isConditionField(match[1])) return []
      const field = match[1]
      if (step !== undefined) {
        if (step[field] === undefined) return []
        return [
          {
            id: 'clear-condition',
            title: 'Clear the condition',
            actions: [stepPatch(quest.id, step.id, field, undefined)],
          },
        ]
      }
      if (field !== 'unlock' || quest.unlock === undefined) return []
      return [
        {
          id: 'clear-condition',
          title: 'Clear the condition',
          actions: [questPatch(quest.id, 'unlock', undefined)],
        },
      ]
    }
    case 'unknown-flag': {
      const match = UNKNOWN_FLAG.exec(finding.message)
      if (match === null) return []
      const name = match[1]
      const id = uniqueId(
        quest.rewards.map((reward) => reward.id),
        name,
      )
      return [
        {
          id: 'add-flag-reward',
          title: `Add a flag reward ${name}`,
          actions: [
            { type: 'reward/add', quest: quest.id, id },
            rewardPatch(quest.id, id, 'kind', 'flag'),
            rewardPatch(quest.id, id, 'ref', name),
          ],
        },
      ]
    }
    default:
      return []
  }
}

function talksWithoutDialogue(state: EditorState): Array<{ quest: Quest; step: Step }> {
  const found: Array<{ quest: Quest; step: Step }> = []
  for (const quest of state.quests.quests) {
    for (const step of quest.steps) {
      if (step.dialogue !== undefined) continue
      if (step.objective?.kind !== 'talk' && step.failObjective?.kind !== 'talk') continue
      found.push({ quest, step })
    }
  }
  return found
}

function dialogueFixes(finding: EditorFinding, state: EditorState): Fix[] {
  const path = finding.path ?? ''

  switch (finding.code) {
    case 'unbound-conversation': {
      const match = UNBOUND.exec(finding.message)
      if (match === null) return []
      const ref = match[1]
      return talksWithoutDialogue(state)
        .slice(0, BIND_LIMIT)
        .map(({ quest, step }) => ({
          id: `bind-step:${quest.id}#${step.id}`,
          title: `Bind to ${step.id}`,
          actions: [stepPatch(quest.id, step.id, 'dialogue', { provider: 'oqf', ref })],
        }))
    }
    case 'unknown-next': {
      const where = NEXT_PATH.exec(path)
      const conversation = findConversation(state, finding.conversation)
      if (!UNKNOWN_NEXT.test(finding.message) || where === null || conversation === undefined) {
        return []
      }
      const node = conversation.nodes[Number(where[1])]
      if (node === undefined) return []
      const action =
        where[2] === undefined
          ? nodePatch(conversation.id, node.id, 'next', undefined)
          : choicePatch(conversation.id, node.id, Number(where[2]), 'next', undefined)
      return [{ id: 'clear-next', title: 'Clear next', actions: [action] }]
    }
    case 'unknown-start': {
      const match = UNKNOWN_START.exec(finding.message)
      if (match === null) return []
      const conversation = findConversation(state, match[1])
      const first = conversation?.nodes[0]
      if (conversation === undefined || first === undefined) return []
      return [
        {
          id: 'point-start',
          title: `Point start at ${first.id}`,
          actions: [conversationPatch(conversation.id, 'start', first.id)],
        },
      ]
    }
    default:
      return []
  }
}

/** The fixes the editor can offer for one finding. Empty when there is nothing safe to do. */
export function fixesFor(finding: EditorFinding, state: EditorState): Fix[] {
  return finding.source === 'dialogue' ? dialogueFixes(finding, state) : questFixes(finding, state)
}

/** One action that applies the whole fix as a single undoable edit. */
export function fixAction(fix: Fix): Action {
  return fix.actions.length === 1 ? fix.actions[0] : { type: 'batch', actions: fix.actions }
}
