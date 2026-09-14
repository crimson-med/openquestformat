/** Small documents the store tests build on. */
import type { OqfDocument } from '@oqf/core'
import type { DialogueDocument } from '@oqf/dialogue'

export function sampleQuests(): OqfDocument {
  return {
    dictionaries: {
      actors: [{ id: 'harbormaster', name: 'Harbormaster Ines' }],
      locations: [{ id: 'harbor', name: 'Harbor pier' }],
      items: [{ id: 'ledger', name: 'Harbor ledger' }],
      tags: [{ id: 'main' }],
    },
    quests: [
      {
        id: 'ledger',
        version: 1,
        title: 'The ledger',
        tags: ['main'],
        steps: [
          {
            id: 'talk_ines',
            title: 'Speak with Ines',
            start: true,
            objective: { kind: 'talk', actor: 'harbormaster' },
            rewards: [],
            actors: ['harbormaster'],
          },
          {
            id: 'find_it',
            title: 'Find the ledger',
            unlock: { '==': [{ var: 'step.talk_ines' }, 'done'] },
            objective: { kind: 'collect', item: 'ledger' },
            outcome: { name: 'returned' },
            rewards: ['coins'],
            actors: [],
          },
        ],
        rewards: [{ id: 'coins', kind: 'currency', ref: 'coins', amount: 10 }],
      },
    ],
  }
}

export function sampleDialogues(): DialogueDocument {
  return {
    speakers: [{ id: 'harbormaster', name: 'Harbormaster Ines' }],
    conversations: [
      {
        id: 'ines_intro',
        actor: 'harbormaster',
        start: 'greet',
        nodes: [
          {
            id: 'greet',
            text: 'The ledger is gone. Will you help?',
            choices: [
              { text: 'I will find it.', next: 'thanks', set: [{ flag: 'met_ines' }] },
              { text: 'Not today.' },
            ],
          },
          { id: 'thanks', text: 'Thank you. Ask around the pier.' },
        ],
      },
    ],
  }
}
