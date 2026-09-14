/**
 * Event names and shapes. docs/03-events.md is the authority for every name here.
 *
 * An event is a dotted lowercase name plus a flat payload. The runtime accepts
 * any name on the way in and only ever emits the names built by the helpers
 * below, all of which are prefixed by the quest id so two quests never collide.
 */
import type { Payload } from '@oqf/core'

export interface OqfEvent {
  name: string
  payload: Payload
}

export type EventHandler = (event: OqfEvent) => void

/** Consumed: the default names the objective sugar listens to. */
export const EVENT_ACTOR_KILLED = 'actor.killed'
export const EVENT_ITEM_COLLECTED = 'item.collected'
export const EVENT_LOCATION_ENTERED = 'location.entered'
export const EVENT_DIALOGUE_ENDED = 'dialogue.ended'
export const EVENT_OBJECT_INTERACTED = 'object.interacted'

/** Consumed and emitted: a flag changed, so every condition reading it re-runs. */
export const EVENT_FLAG_SET = 'flag.set'

/** Emitted whenever a reward is granted, whatever its kind. */
export const EVENT_REWARD_GRANTED = 'reward.granted'

/** The consumed names the objective sugar knows about, in docs/03-events.md order. */
export const OBJECTIVE_EVENTS = [
  EVENT_ACTOR_KILLED,
  EVENT_ITEM_COLLECTED,
  EVENT_LOCATION_ENTERED,
  EVENT_DIALOGUE_ENDED,
  EVENT_OBJECT_INTERACTED,
  EVENT_FLAG_SET,
] as const

/** `quest.<questId>.offered`, emitted when the quest becomes offerable. */
export function questOfferedEvent(questId: string): string {
  return `quest.${questId}.offered`
}

/** `quest.<questId>.outcome`, emitted when an ending step is reached. */
export function questOutcomeEvent(questId: string): string {
  return `quest.${questId}.outcome`
}

/** `quest.<questId>.step.<stepId>.<state>`, emitted on any step transition. */
export function stepEvent(questId: string, stepId: string, state: string): string {
  return `quest.${questId}.step.${stepId}.${state}`
}

/**
 * `quest.<questId>.step.<stepId>.custom`, the name a `custom` objective listens
 * to. A custom objective never completes on its own: the engine decides and
 * reports with `{ done: true }`.
 */
export function customObjectiveEvent(questId: string, stepId: string): string {
  return `quest.${questId}.step.${stepId}.custom`
}

/** Build an event from a name and an optional payload. */
export function oqfEvent(name: string, payload?: Payload): OqfEvent {
  return { name, payload: payload ?? {} }
}

/** Accept either an event object or a name plus payload, the two `emit` forms. */
export function toEvent(event: OqfEvent | string, payload?: Payload): OqfEvent {
  if (typeof event === 'string') return oqfEvent(event, payload)
  return { name: event.name, payload: event.payload ?? {} }
}
