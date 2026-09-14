/**
 * Hand built dialogue documents used by the JSON tests.
 *
 * `fullDialogue` touches every field in model.ts at least once: a lore node, a
 * linear node, a node with choices, every choice field, flag sets with and
 * without a value, emits with and without a payload, and extension bags on the
 * conversation, the node and the choice.
 */
import type { DialogueDocument } from '../model.js'

/** One conversation, one node, nothing optional. */
export function minimalDialogue(): DialogueDocument {
  return {
    speakers: [],
    conversations: [{ id: 'hello', start: 'only', nodes: [{ id: 'only', text: 'Hello.' }] }],
  }
}

/** Every field in the dialogue model, used at least once. */
export function fullDialogue(): DialogueDocument {
  return {
    speakers: [{ id: 'harbormaster', name: 'Harbormaster Ines' }, { id: 'otter' }],
    conversations: [
      {
        id: 'ines_intro',
        actor: 'harbormaster',
        title: 'Ines asks for help',
        start: 'greet',
        nodes: [
          {
            id: 'greet',
            text: 'The ledger is gone. Will you help me find it?',
            choices: [
              {
                text: 'Here are the five koi.',
                next: 'thanks',
                condition: { '>=': [{ var: 'count.trade' }, 5] },
                show: 'disabled',
                set: [{ flag: 'otter_agreed' }, { flag: 'paid', value: 5 }],
                emit: [{ event: 'cozycoast.ledger.handed', payload: { from: 'otter' } }],
                once: true,
                ext: { 'x-cozycoast.sfx': 'coins' },
              },
              { text: 'Tell me about the lighthouse.', next: 'lighthouse' },
              { text: 'Never mind.' },
            ],
            ext: { 'x-cozycoast.camera': 'pier_wide' },
          },
          {
            id: 'lighthouse',
            speaker: 'otter',
            text: 'Dark since the storm.',
            next: 'greet',
            lore: true,
          },
          {
            id: 'thanks',
            text: 'Thank you.',
            set: [{ flag: 'met_ines', value: true }],
            emit: [{ event: 'ping' }],
          },
        ],
        ext: { 'x-editor.pos': { x: 40, y: 40 }, 'x-cozycoast.chapter': 1 },
      },
    ],
  }
}
