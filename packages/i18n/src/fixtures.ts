/** Hand built documents and tables used by the i18n tests. */
import type { DialogueDocument } from '@oqf/dialogue'
import type { StringTable } from './extract.js'

/** One conversation with a title, two nodes and two choices on the first node. */
export function conversationDocument(): DialogueDocument {
  return {
    speakers: [{ id: 'harbormaster', name: 'Harbormaster Ines' }],
    conversations: [
      {
        id: 'ines_intro',
        actor: 'harbormaster',
        title: 'Ines at the pier',
        start: 'greet',
        nodes: [
          {
            id: 'greet',
            text: 'The ledger is gone and the season is half logged.',
            choices: [{ text: 'I will find it.', next: 'thanks' }, { text: 'Not my problem.' }],
          },
          { id: 'thanks', text: 'You have my thanks.' },
        ],
      },
    ],
  }
}

/** Values that stress every adapter: separators, quotes, breaks, markup, non-ASCII. */
export function awkwardTable(): StringTable {
  return {
    'ledger.title': "The Harbormaster's Ledger",
    'ledger.comma': 'Find it, then decide, quickly',
    'ledger.quote': 'She said "take it" and walked off',
    'ledger.newline': 'Line one\nLine two',
    'ledger.crlf': 'Before\r\nAfter',
    'ledger.tab': 'name\tvalue',
    'ledger.markup': 'Fish & chips <b>with</b> vinegar',
    'ledger.backslash': 'C:\\harbor\\ledger',
    'ledger.unicode': 'Ötter über den Fjord, 港の記録, 🐟',
    'ledger.empty': '',
  }
}
