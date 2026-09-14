/**
 * Hand built documents used by the JSON and Markdown tests.
 *
 * `fullDocument` touches every field in model.ts at least once: every objective
 * kind, every reward kind, a failed outcome, a dialogue binding, extension bags,
 * quest-level rewards keyed by outcome, and a nested condition tree.
 */
import { type OqfDocument, emptyDictionaries } from '../model.js'

/** One quest, one step, nothing optional. */
export function minimalDocument(): OqfDocument {
  return {
    dictionaries: emptyDictionaries(),
    quests: [
      {
        id: 'first_light',
        version: 1,
        title: 'First Light',
        tags: [],
        steps: [
          {
            id: 'wake_up',
            title: 'Wake up',
            rewards: [],
            actors: [],
          },
        ],
        rewards: [],
      },
    ],
  }
}

/** Every field in the model, used at least once. */
export function fullDocument(): OqfDocument {
  return {
    dictionaries: {
      actors: [
        { id: 'harbormaster', name: 'Harbormaster Ines' },
        { id: 'otter', name: 'Old Salt Otter' },
        { id: 'gull' },
      ],
      locations: [
        { id: 'harbor', name: 'Harbor pier' },
        { id: 'otter_den', name: "Otter's den" },
      ],
      items: [{ id: 'fish.rare', name: 'Silver koi' }, { id: 'ledger' }],
      tags: [{ id: 'main', name: 'Main story' }, { id: 'harbor' }],
    },
    quests: [
      {
        id: 'harbormasters_ledger',
        version: 3,
        title: "The Harbormaster's Ledger",
        summary: 'Ines has lost the harbor ledger. Find it, then decide what it is worth.',
        tags: ['main', 'harbor'],
        repeat: true,
        unlock: {
          and: [
            { var: 'flag.pier_open' },
            {
              or: [
                { '!': [{ var: 'flag.banned_from_harbor' }] },
                { in: [{ var: 'var.season' }, ['spring', 'summer']] },
              ],
            },
            { '>=': [{ var: 'count.catch_rare' }, 5] },
          ],
        },
        steps: [
          {
            id: 'talk_ines',
            title: 'Speak with Harbormaster Ines',
            journal: 'Ines is waiting at the end of the pier.',
            start: true,
            objective: { kind: 'talk', actor: 'harbormaster', dialogue: 'ines_intro' },
            rewards: ['coins_tip'],
            dialogue: { provider: 'oqf', ref: 'ines_intro' },
            location: 'harbor',
            actors: ['harbormaster'],
            ext: {
              'x-editor.position': { x: 120, y: 40 },
              'x-cozycoast.icon': 'ledger',
            },
          },
          {
            id: 'find_otter',
            title: 'Find who has the ledger',
            unlock: { '==': [{ var: 'step.talk_ines' }, 'done'] },
            activate: { var: 'flag.knows_otter' },
            objective: { kind: 'reach', location: 'otter_den' },
            actors: ['otter'],
            rewards: [],
          },
          {
            id: 'trade',
            title: 'Trade five silver koi for the ledger',
            unlock: { '==': [{ var: 'step.find_otter' }, 'done'] },
            objective: { kind: 'collect', item: 'fish.rare', count: 5 },
            complete: { var: 'flag.otter_agreed' },
            repeat: true,
            rewards: ['fish_xp'],
            actors: ['otter'],
          },
          {
            id: 'thin_the_gulls',
            title: 'Thin the gulls circling the pier',
            unlock: { '==': [{ var: 'step.talk_ines' }, 'done'] },
            objective: { kind: 'kill', actor: 'gull', count: 3 },
            optional: true,
            rewards: [],
            actors: ['gull'],
          },
          {
            id: 'steal',
            title: 'Take the ledger from the den at night',
            unlock: { '==': [{ var: 'step.find_otter' }, 'done'] },
            objective: { kind: 'interact', object: 'ledger_chest' },
            failObjective: { kind: 'event', event: 'guard.caught' },
            fail: { var: 'flag.guard_alerted' },
            rewards: [],
            actors: [],
          },
          {
            id: 'watch_tide',
            title: 'Watch the tide turn twice',
            objective: { kind: 'event', event: 'tide.turned', count: 2 },
            optional: true,
            rewards: [],
            actors: [],
          },
          {
            id: 'dawn_rite',
            title: 'Perform the dawn rite',
            objective: { kind: 'custom', custom: 'cozycoast.ritual', args: ['dawn', 'pier'] },
            rewards: [],
            actors: [],
          },
          {
            id: 'return_ledger',
            title: 'Return the ledger to Ines',
            unlock: {
              or: [
                { '==': [{ var: 'step.trade' }, 'done'] },
                { '==': [{ var: 'step.steal' }, 'done'] },
              ],
            },
            outcome: { name: 'returned', title: 'The ledger is home' },
            rewards: [],
            actors: ['harbormaster'],
          },
          {
            id: 'sell_ledger',
            title: 'Sell the ledger to the smuggler',
            unlock: { '==': [{ var: 'step.steal' }, 'done'] },
            outcome: { name: 'sold' },
            rewards: [],
            actors: [],
          },
          {
            id: 'caught',
            title: 'Caught in the den',
            unlock: { '==': [{ var: 'step.steal' }, 'failed'] },
            outcome: { name: 'confiscated', failed: true, title: 'The ledger is confiscated' },
            rewards: [],
            actors: [],
            ext: { 'x-unity.prefab': 'FailBanner' },
          },
        ],
        rewards: [
          { id: 'coins_tip', kind: 'currency', ref: 'coins', amount: 10 },
          { id: 'fish_xp', kind: 'xp', ref: 'xp.fishing', amount: 50 },
          { id: 'rep_up', kind: 'reputation', ref: 'harbor', amount: 10, outcome: 'returned' },
          {
            id: 'golden_lure',
            kind: 'item',
            ref: 'lure.golden',
            outcome: 'returned',
            ext: { 'x-cozycoast.rarity': 'rare' },
          },
          {
            id: 'catch_log',
            kind: 'unlock',
            ref: 'feature.catch_log',
            outcome: 'returned',
          },
          {
            id: 'ledger_restored',
            kind: 'event',
            ref: 'cozycoast.ledger.restored',
            outcome: 'returned',
            payload: { source: 'quest', silent: false, weight: 2 },
          },
          {
            id: 'smuggler_vendor',
            kind: 'flag',
            ref: 'smuggler_vendor_open',
            outcome: 'sold',
          },
          {
            id: 'guard_report',
            kind: 'custom',
            ref: 'cozycoast.guard_report',
            amount: -5,
            outcome: 'confiscated',
            payload: { severity: 'minor' },
            ext: { 'x-godot.scene': 'res://ui/report.tscn', 'x-editor.pinned': true },
          },
        ],
        ext: {
          'x-editor.position': { x: 0, y: 0 },
          'x-cozycoast.chapter': 1,
          'x-unity.enabled': true,
        },
      },
    ],
  }
}
