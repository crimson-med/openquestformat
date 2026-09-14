/**
 * `@oqf/runtime`: the engine agnostic Open Quest Format state machine.
 *
 * Construct with the documents the game shipped, wire `emit` to the engine's
 * event bus and `on` back to it, and persist what `save` returns.
 */
export type { EventHandler, OqfEvent } from './events.js'
export {
  EVENT_ACTOR_KILLED,
  EVENT_DIALOGUE_ENDED,
  EVENT_FLAG_SET,
  EVENT_ITEM_COLLECTED,
  EVENT_LOCATION_ENTERED,
  EVENT_OBJECT_INTERACTED,
  EVENT_REWARD_GRANTED,
  OBJECTIVE_EVENTS,
  customObjectiveEvent,
  oqfEvent,
  questOfferedEvent,
  questOutcomeEvent,
  stepEvent,
  toEvent,
} from './events.js'
export type { QuestRuntimeOptions } from './runtime.js'
export { MAX_PASSES, QuestRuntime } from './runtime.js'
export type { LogEntry, QuestState, QuestStatus, StepRuntime } from './state.js'
export {
  ORPHANED_KEY,
  QUEST_STATUSES,
  STATE_VERSION,
  cloneQuestState,
  newQuestState,
  newStepRuntime,
} from './state.js'
