/**
 * Hand built documents for the validator tests.
 *
 * `referenceDocument` is the quest from docs/11-reference-quest.md written out
 * in the model: two routes to the same step, an optional hint, three outcomes
 * including a failure, quest-level rewards per outcome, and a custom event. It
 * must validate clean, warnings included.
 */
import {
  type Condition,
  type Dictionaries,
  type OqfDocument,
  type Quest,
  type Step,
  emptyDictionaries,
} from '../model.js'

/** A step with the required fields filled in. */
export function step(id: string, patch: Partial<Step> = {}): Step {
  return { id, title: id, rewards: [], actors: [], ...patch }
}

/** A quest with the required fields filled in. */
export function quest(id: string, steps: Step[], patch: Partial<Quest> = {}): Quest {
  return { id, version: 1, title: id, tags: [], steps, rewards: [], ...patch }
}

export function doc(
  quests: Quest[],
  dictionaries: Dictionaries = emptyDictionaries(),
): OqfDocument {
  return { dictionaries, quests }
}

/** The tree a bare `step.<id>` in boolean position parses to. */
export function done(id: string): Condition {
  return { '==': [{ var: `step.${id}` }, 'done'] }
}

/** `step.<id> == "<state>"`. */
export function inState(id: string, state: string): Condition {
  return { '==': [{ var: `step.${id}` }, state] }
}

/** One start step, one ending that depends on it. Nothing to report. */
export function cleanDocument(): OqfDocument {
  return doc([
    quest('q', [
      step('begin', { start: true }),
      step('finish', { unlock: done('begin'), outcome: { name: 'done' } }),
    ]),
  ])
}

/** The Harbormaster's Ledger, written out from docs/11-reference-quest.md. */
export function referenceDocument(): OqfDocument {
  return {
    dictionaries: {
      actors: [
        { id: 'harbormaster', name: 'Harbormaster Ines' },
        { id: 'otter', name: 'Old Salt Otter' },
        { id: 'gull_feeder', name: 'The Gull Feeder' },
        { id: 'smuggler', name: 'Cove Smuggler' },
      ],
      locations: [
        { id: 'harbor', name: 'Harbor pier' },
        { id: 'otter_den', name: "Otter's den under the boardwalk" },
        { id: 'smuggler_cove', name: "Smuggler's cove" },
      ],
      items: [
        { id: 'fish.rare', name: 'Silver koi' },
        { id: 'ledger', name: 'Harbor ledger' },
        { id: 'lure.golden', name: 'Golden lure' },
      ],
      tags: [
        { id: 'main', name: 'Main story' },
        { id: 'harbor', name: 'Harbor' },
      ],
    },
    quests: [
      {
        id: 'harbormasters_ledger',
        version: 1,
        title: "The Harbormaster's Ledger",
        summary: 'Ines has lost the harbor ledger. Find it, then decide what it is worth.',
        tags: ['main', 'harbor'],
        steps: [
          {
            id: 'talk_ines',
            title: 'Speak with Harbormaster Ines',
            journal: 'Ines is waiting at the end of the pier.',
            start: true,
            objective: { kind: 'talk', actor: 'harbormaster', dialogue: 'ines_intro' },
            rewards: [],
            dialogue: { provider: 'oqf', ref: 'ines_intro' },
            location: 'harbor',
            actors: ['harbormaster'],
          },
          {
            id: 'ask_gulls',
            title: 'Ask around the pier',
            unlock: done('talk_ines'),
            objective: { kind: 'talk', actor: 'gull_feeder', dialogue: 'gulls_hint' },
            optional: true,
            rewards: ['gull_tip'],
            dialogue: { provider: 'oqf', ref: 'gulls_hint' },
            location: 'harbor',
            actors: ['gull_feeder'],
          },
          {
            id: 'find_otter',
            title: 'Find who has the ledger',
            unlock: done('talk_ines'),
            objective: { kind: 'reach', location: 'otter_den' },
            rewards: [],
            location: 'otter_den',
            actors: [],
          },
          {
            id: 'trade',
            title: 'Trade five silver koi for the ledger',
            unlock: done('find_otter'),
            objective: { kind: 'collect', item: 'fish.rare', count: 5 },
            rewards: ['trade_xp'],
            dialogue: { provider: 'oqf', ref: 'otter_trade' },
            location: 'otter_den',
            actors: ['otter'],
          },
          {
            id: 'steal',
            title: 'Take the ledger from the den at night',
            unlock: done('find_otter'),
            objective: { kind: 'interact', object: 'ledger_chest' },
            complete: { var: 'var.time.isNight' },
            failObjective: { kind: 'event', event: 'guard.caught' },
            rewards: [],
            location: 'otter_den',
            actors: [],
          },
          {
            id: 'have_ledger',
            title: 'Decide what to do with the ledger',
            unlock: { or: [done('trade'), done('steal')] },
            rewards: [],
            actors: [],
          },
          {
            id: 'return_ledger',
            title: 'Return the ledger to Ines',
            unlock: done('have_ledger'),
            objective: { kind: 'talk', actor: 'harbormaster', dialogue: 'ines_return' },
            outcome: { name: 'returned', title: 'The ledger is back where it belongs' },
            rewards: [],
            dialogue: { provider: 'oqf', ref: 'ines_return' },
            location: 'harbor',
            actors: ['harbormaster'],
          },
          {
            id: 'sell_ledger',
            title: 'Sell the ledger to the smuggler',
            unlock: done('have_ledger'),
            objective: { kind: 'talk', actor: 'smuggler', dialogue: 'smuggler_deal' },
            outcome: { name: 'sold', title: 'The ledger is gone' },
            rewards: [],
            dialogue: { provider: 'oqf', ref: 'smuggler_deal' },
            location: 'smuggler_cove',
            actors: ['smuggler'],
          },
          {
            id: 'caught',
            title: 'Caught in the den',
            unlock: inState('steal', 'failed'),
            outcome: { name: 'confiscated', failed: true, title: 'The ledger is confiscated' },
            rewards: [],
            location: 'otter_den',
            actors: [],
          },
        ],
        rewards: [
          { id: 'gull_tip', kind: 'currency', ref: 'coins', amount: 10 },
          { id: 'trade_xp', kind: 'xp', ref: 'xp', amount: 50 },
          {
            id: 'returned_rep',
            kind: 'reputation',
            ref: 'harbor',
            amount: 10,
            outcome: 'returned',
          },
          { id: 'returned_lure', kind: 'item', ref: 'lure.golden', outcome: 'returned' },
          {
            id: 'returned_event',
            kind: 'event',
            ref: 'cozycoast.ledger.restored',
            outcome: 'returned',
          },
          { id: 'sold_coins', kind: 'currency', ref: 'coins', amount: 200, outcome: 'sold' },
          { id: 'sold_rep', kind: 'reputation', ref: 'harbor', amount: -10, outcome: 'sold' },
          { id: 'sold_vendor', kind: 'flag', ref: 'smuggler_vendor_open', outcome: 'sold' },
          {
            id: 'confiscated_rep',
            kind: 'reputation',
            ref: 'harbor',
            amount: -5,
            outcome: 'confiscated',
          },
        ],
      },
    ],
  }
}
