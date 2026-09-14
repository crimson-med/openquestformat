/**
 * Quests the runtime tests drive. The main one is the reference quest from
 * docs/11-reference-quest.md, written here in the canonical model.
 *
 * Two details differ from the prose table, both forced by the model as it
 * stands. A step holds one objective (decision D24), so `trade` counts the koi
 * and reads a flag the otter's dialogue sets instead of carrying a second
 * `talk` objective. And `steal` keeps the guard as a `failObjective`, which is
 * the model field the prose `fail` column desugars to.
 */
import {
  type OqfDocument,
  type Quest,
  type Step,
  emptyDictionaries,
  parseCondition,
  parseObjective,
} from '@oqf/core'

export const REFERENCE_QUEST = 'harbormasters_ledger'

function step(fields: Partial<Step> & { id: string; title: string }): Step {
  return { rewards: [], actors: [], ...fields }
}

function document(quests: Quest[]): OqfDocument {
  return { dictionaries: emptyDictionaries(), quests }
}

/** The Harbormaster's Ledger, every v1 feature at least once. */
export function referenceQuest(): Quest {
  return {
    id: REFERENCE_QUEST,
    version: 1,
    title: "The Harbormaster's Ledger",
    summary: 'Ines has lost the harbor ledger.',
    tags: ['harbor'],
    steps: [
      step({
        id: 'talk_ines',
        title: 'Speak with Harbormaster Ines',
        start: true,
        objective: parseObjective('talk harbormaster ines_intro'),
        actors: ['harbormaster'],
        dialogue: { provider: 'oqf', ref: 'ines_intro' },
      }),
      step({
        id: 'ask_gulls',
        title: 'Ask around the pier',
        unlock: parseCondition('step.talk_ines'),
        objective: parseObjective('talk gull_feeder gulls_hint'),
        optional: true,
        rewards: ['gulls_coins'],
        actors: ['gull_feeder'],
        dialogue: { provider: 'oqf', ref: 'gulls_hint' },
      }),
      step({
        id: 'find_otter',
        title: 'Find who has the ledger',
        unlock: parseCondition('step.talk_ines'),
        objective: parseObjective('reach otter_den'),
        location: 'otter_den',
      }),
      step({
        id: 'trade',
        title: 'Trade five silver koi for the ledger',
        unlock: parseCondition('step.find_otter'),
        objective: parseObjective('collect fish.rare 5'),
        complete: parseCondition('flag.otter_traded'),
        rewards: ['trade_xp'],
        actors: ['otter'],
        dialogue: { provider: 'oqf', ref: 'otter_trade' },
      }),
      step({
        id: 'steal',
        title: 'Take the ledger from the den at night',
        unlock: parseCondition('step.find_otter'),
        objective: parseObjective('interact ledger_chest'),
        complete: parseCondition('var.time.isNight'),
        failObjective: parseObjective('event guard.caught'),
      }),
      step({
        id: 'have_ledger',
        title: 'Decide what to do with the ledger',
        unlock: parseCondition('step.trade or step.steal'),
      }),
      step({
        id: 'return_ledger',
        title: 'Return the ledger to Ines',
        unlock: parseCondition('step.have_ledger'),
        objective: parseObjective('talk harbormaster ines_return'),
        outcome: { name: 'returned' },
        actors: ['harbormaster'],
        dialogue: { provider: 'oqf', ref: 'ines_return' },
      }),
      step({
        id: 'sell_ledger',
        title: 'Sell the ledger to the smuggler',
        unlock: parseCondition('step.have_ledger'),
        objective: parseObjective('talk smuggler smuggler_deal'),
        outcome: { name: 'sold' },
        actors: ['smuggler'],
        dialogue: { provider: 'oqf', ref: 'smuggler_deal' },
      }),
      step({
        id: 'caught',
        title: 'Caught in the den',
        unlock: parseCondition('step.steal == "failed"'),
        outcome: { name: 'confiscated', failed: true },
      }),
    ],
    rewards: [
      { id: 'gulls_coins', kind: 'currency', ref: 'coins', amount: 10 },
      { id: 'trade_xp', kind: 'xp', ref: 'xp', amount: 50 },
      { id: 'returned_rep', kind: 'reputation', ref: 'harbor', amount: 10, outcome: 'returned' },
      { id: 'returned_lure', kind: 'item', ref: 'lure.golden', outcome: 'returned' },
      {
        id: 'returned_event',
        kind: 'event',
        ref: 'cozycoast.ledger.restored',
        outcome: 'returned',
        payload: { feature: 'catch_log' },
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
  }
}

export function referenceDocument(): OqfDocument {
  return document([referenceQuest()])
}

/** Version 2 of the reference quest with the optional hint step dropped. */
export function questWithoutGulls(): OqfDocument {
  const quest = referenceQuest()
  quest.version = 2
  quest.steps = quest.steps.filter((entry) => entry.id !== 'ask_gulls')
  return document([quest])
}

/** Version 2 of the reference quest with one step the saved document never had. */
export function questWithExtraStep(): OqfDocument {
  const quest = referenceQuest()
  quest.version = 2
  quest.steps.push(
    step({
      id: 'log_catch',
      title: 'Write the catch into the ledger',
      unlock: parseCondition('step.have_ledger'),
      objective: parseObjective('event catch.logged'),
    }),
  )
  return document([quest])
}

/** Two quests: B is offered automatically when A reaches its outcome. */
export function chainDocument(): OqfDocument {
  return document([
    {
      id: 'a',
      version: 1,
      title: 'The first errand',
      tags: [],
      steps: [
        step({
          id: 'finish',
          title: 'Finish the errand',
          start: true,
          objective: parseObjective('event a.finished'),
          outcome: { name: 'done' },
        }),
      ],
      rewards: [],
    },
    {
      id: 'b',
      version: 1,
      title: 'The second errand',
      tags: [],
      unlock: parseCondition('outcome.a.done'),
      steps: [
        step({
          id: 'go',
          title: 'Go',
          start: true,
          objective: parseObjective('event b.finished'),
        }),
      ],
      rewards: [],
    },
  ])
}

/** A quest that may be taken again after its outcome. */
export function repeatDocument(): OqfDocument {
  return document([
    {
      id: 'daily_catch',
      version: 1,
      title: 'The daily catch',
      tags: [],
      repeat: true,
      steps: [
        step({
          id: 'catch',
          title: 'Catch one silver koi',
          start: true,
          objective: parseObjective('collect fish.rare'),
          outcome: { name: 'done' },
        }),
      ],
      rewards: [{ id: 'daily_coins', kind: 'currency', ref: 'coins', amount: 5, outcome: 'done' }],
    },
  ])
}

/** A quest whose single step is re-entered every time the bell flag goes false. */
export function repeatStepDocument(): OqfDocument {
  return document([
    {
      id: 'patrol',
      version: 1,
      title: 'Watch the pier',
      tags: [],
      steps: [
        step({
          id: 'watch',
          title: 'Stand watch',
          repeat: true,
          unlock: parseCondition('flag.bell'),
          objective: parseObjective('event watch.tick'),
          rewards: ['tick_pay'],
        }),
      ],
      rewards: [{ id: 'tick_pay', kind: 'currency', ref: 'coins', amount: 1 }],
    },
  ])
}

/** Two repeat steps that unlock each other forever. Used to prove the pass cap. */
export function loopDocument(): OqfDocument {
  return document([
    {
      id: 'loop',
      version: 1,
      title: 'A quest that never settles',
      tags: [],
      steps: [
        step({
          id: 'a',
          title: 'A',
          repeat: true,
          unlock: parseCondition('step.b != "done"'),
        }),
        step({
          id: 'b',
          title: 'B',
          repeat: true,
          unlock: parseCondition('step.a == "done"'),
        }),
      ],
      rewards: [],
    },
  ])
}

/** A quest with a custom objective, which only the engine can satisfy. */
export function customDocument(): OqfDocument {
  return document([
    {
      id: 'custom_quest',
      version: 1,
      title: 'The ritual',
      tags: [],
      steps: [
        step({
          id: 'ritual',
          title: 'Perform the ritual',
          start: true,
          objective: { kind: 'custom', custom: 'ritual', args: ['three'] },
        }),
      ],
      rewards: [],
    },
  ])
}
