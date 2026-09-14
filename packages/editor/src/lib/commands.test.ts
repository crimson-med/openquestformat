import { describe, expect, it } from 'vitest'
import { type Command, MAX_RESULTS, filterCommands } from './commands'

function command(id: string, title: string, keywords?: string[]): Command {
  return { id, title, group: 'Test', keywords, run: () => {} }
}

const COMMANDS: Command[] = [
  command('add-step', 'Add step'),
  command('add-node', 'Add node'),
  command('undo', 'Undo'),
  command('export-oqf', 'Export quests as .oqf', ['save', 'download']),
  command('goto-dock', 'Meet the harbormaster', ['dock_meeting']),
]

describe('filterCommands', () => {
  it('returns everything, in order, for an empty query', () => {
    expect(filterCommands(COMMANDS, '').map((entry) => entry.id)).toEqual([
      'add-step',
      'add-node',
      'undo',
      'export-oqf',
      'goto-dock',
    ])
    expect(filterCommands(COMMANDS, '   ')).toHaveLength(COMMANDS.length)
  })

  it('matches substrings of the title regardless of case', () => {
    expect(filterCommands(COMMANDS, 'ADD').map((entry) => entry.id)).toEqual([
      'add-step',
      'add-node',
    ])
  })

  it('matches keywords', () => {
    expect(filterCommands(COMMANDS, 'download').map((entry) => entry.id)).toEqual(['export-oqf'])
    expect(filterCommands(COMMANDS, 'dock_m').map((entry) => entry.id)).toEqual(['goto-dock'])
  })

  it('matches subsequences when no substring does', () => {
    expect(filterCommands(COMMANDS, 'astp').map((entry) => entry.id)).toEqual(['add-step'])
  })

  it('ranks substring hits before subsequence hits and keeps order otherwise', () => {
    // "de" is a substring of "Add node" and only a subsequence of "Add step",
    // which comes first in the list, and of the keyword "dock_meeting".
    expect(filterCommands(COMMANDS, 'de').map((entry) => entry.id)).toEqual([
      'add-node',
      'add-step',
      'goto-dock',
    ])
  })

  it('drops commands that match neither way', () => {
    expect(filterCommands(COMMANDS, 'zzz')).toEqual([])
    expect(filterCommands(COMMANDS, 'step add')).toEqual([])
  })

  it('caps the result', () => {
    const many = Array.from({ length: 100 }, (_, index) => command(`c${index}`, `Command ${index}`))
    expect(filterCommands(many, '')).toHaveLength(MAX_RESULTS)
    expect(filterCommands(many, 'command')).toHaveLength(MAX_RESULTS)
  })
})
