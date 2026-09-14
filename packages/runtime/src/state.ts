/**
 * The runtime state document: where a player stands in one quest instance.
 *
 * The shape is specified in docs/05-state.md. The runtime reads and writes it,
 * the game persists it, and nothing here performs I/O. World level state (global
 * flags, other quests' outcomes, `var.*`) deliberately lives outside the
 * document; the runtime rebuilds its world view from the documents it loads.
 */
import type { Ext, Quest, Scalar, StepState } from '@oqf/core'

/** Schema version of the state document. Bumped when the shape changes. */
export const STATE_VERSION = 1

/** Lifecycle of the quest itself, as opposed to its steps. */
export type QuestStatus = 'unseen' | 'offered' | 'open' | 'closed'

export const QUEST_STATUSES = ['unseen', 'offered', 'open', 'closed'] as const

/**
 * The ext key reconciliation parks unknown steps under. The value maps the step
 * id to the state it was in when the quest stopped declaring it.
 */
export const ORPHANED_KEY = 'x-oqf.orphaned'

/** Per step record. `count` drives the objective, `failCount` the fail objective. */
export interface StepRuntime {
  state: StepState
  count: number
  failCount: number
  /** Clock value at the last transition into the current state. */
  enteredAt?: number
}

/** One line of the append only transition trace. */
export interface LogEntry {
  step: string
  from: StepState
  to: StepState
  at: number
}

export interface QuestState {
  /** Quest id. Part of the save contract, never renamed once shipped. */
  quest: string
  /** Content version this document was last reconciled against. */
  questVersion: number
  /** Schema version of this document. */
  stateVersion: number
  status: QuestStatus
  steps: Record<string, StepRuntime>
  /** Quest scoped flags, set by `flag` rewards. */
  flags: Record<string, Scalar>
  outcome: string | null
  /** Ids of every reward already granted, used for deduplication. */
  rewards: string[]
  log: LogEntry[]
  ext: Ext
}

/** A fresh step record: locked, counters at zero. */
export function newStepRuntime(): StepRuntime {
  return { state: 'locked', count: 0, failCount: 0 }
}

/** A fresh state document for a quest the player has not seen yet. */
export function newQuestState(quest: Quest): QuestState {
  const steps: Record<string, StepRuntime> = {}
  for (const step of quest.steps) steps[step.id] = newStepRuntime()
  return {
    quest: quest.id,
    questVersion: quest.version,
    stateVersion: STATE_VERSION,
    status: 'unseen',
    steps,
    flags: {},
    outcome: null,
    rewards: [],
    log: [],
    ext: {},
  }
}

function cloneExt(ext: Ext): Ext {
  const copy: Ext = {}
  for (const [key, value] of Object.entries(ext)) {
    copy[key] = value !== null && typeof value === 'object' ? { ...value } : value
  }
  return copy
}

/** A deep copy, so callers can hold a document without aliasing runtime memory. */
export function cloneQuestState(state: QuestState): QuestState {
  const steps: Record<string, StepRuntime> = {}
  for (const [id, step] of Object.entries(state.steps)) steps[id] = { ...step }
  return {
    quest: state.quest,
    questVersion: state.questVersion,
    stateVersion: state.stateVersion,
    status: state.status,
    steps,
    flags: { ...state.flags },
    outcome: state.outcome,
    rewards: [...state.rewards],
    log: state.log.map((entry) => ({ ...entry })),
    ext: cloneExt(state.ext),
  }
}
