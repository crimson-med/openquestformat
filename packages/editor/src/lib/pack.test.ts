import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { type OqfDocument, type Quest, parseCompact } from '@oqf/core'
import { type Conversation, emptyDialogueDocument } from '@oqf/dialogue'
import { describe, expect, it } from 'vitest'
import {
  FILE_KEY,
  clearFile,
  mergePack,
  packFileName,
  packMime,
  readFile,
  splitPack,
  writeFile,
} from './pack'
import { POSITION_KEY } from './position'

function fixture(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../../examples/quests/${name}`, import.meta.url)),
    'utf8',
  )
}

const chain = fixture('templates/chain.oqf')
const branching = fixture('templates/branching.oqf')
const branchingDialogue = fixture('templates/branching.oqd')
const ledger = fixture('harbormasters-ledger.oqf')

const pack = [
  { name: 'templates/chain.oqf', text: chain },
  { name: 'templates/branching.oqf', text: branching },
  { name: 'templates/branching.oqd', text: branchingDialogue },
]

function untagQuests(quests: Quest[]): Quest[] {
  return quests.map((quest) => {
    const ext = clearFile(quest.ext)
    const { ext: _dropped, ...rest } = quest
    return ext === undefined ? rest : { ...rest, ext }
  })
}

function untagConversations(conversations: Conversation[]): Conversation[] {
  return conversations.map((conversation) => {
    const ext = clearFile(conversation.ext)
    const { ext: _dropped, ...rest } = conversation
    return ext === undefined ? rest : { ...rest, ext }
  })
}

describe('file tags', () => {
  it('reads, writes and clears the tag like a position', () => {
    expect(FILE_KEY).toBe('x-editor.file')
    expect(readFile(undefined)).toBeUndefined()
    expect(readFile({ [FILE_KEY]: '' })).toBeUndefined()
    expect(readFile({ [FILE_KEY]: 3 })).toBeUndefined()
    const tagged = writeFile({ [POSITION_KEY]: { x: 1, y: 2 } }, 'chain.oqf')
    expect(readFile(tagged)).toBe('chain.oqf')
    expect(clearFile(tagged)).toEqual({ [POSITION_KEY]: { x: 1, y: 2 } })
    expect(clearFile(writeFile(undefined, 'a.oqf'))).toBeUndefined()
    expect(clearFile(undefined)).toBeUndefined()
  })

  it('keeps only the last path segment and skips broken and foreign files', () => {
    expect(packFileName('pack/quests/chain.oqf')).toBe('chain.oqf')
    expect(packFileName('pack\\quests\\chain.json')).toBe('chain.json')
    expect(packFileName('chain.oqd')).toBe('chain.oqd')
    expect(packFileName('pack/broken/dup.oqf')).toBeUndefined()
    expect(packFileName('pack/README.md')).toBeUndefined()
    expect(packFileName('pack/notes.txt')).toBeUndefined()
    expect(packFileName('broken.oqf')).toBe('broken.oqf')
  })

  it('picks a mime type by extension', () => {
    expect(packMime('a.json')).toContain('json')
    expect(packMime('a.oqd')).toContain('text/plain')
    expect(packMime('a.oqf')).toContain('text/plain')
  })
})

describe('mergePack', () => {
  it('tags every quest and conversation with its file name', () => {
    const merged = mergePack(pack)
    expect(merged.notices).toEqual([])
    expect(merged.quests.quests.map((quest) => [quest.id, readFile(quest.ext)])).toEqual([
      ['repair_boat', 'chain.oqf'],
      ['first_voyage', 'chain.oqf'],
      ['captains_log', 'chain.oqf'],
      ['washed_crate', 'branching.oqf'],
    ])
    expect(
      merged.dialogues.conversations.map((conversation) => [
        conversation.id,
        readFile(conversation.ext),
      ]),
    ).toEqual([
      ['crate_found', 'branching.oqd'],
      ['contraband_offer', 'branching.oqd'],
    ])
  })

  it('merges dictionaries by id, keeping the first display name', () => {
    const merged = mergePack(pack)
    const captains = merged.quests.dictionaries.actors.filter((ref) => ref.id === 'captain')
    expect(captains).toEqual([{ id: 'captain', name: 'Captain Rosa' }])
    expect(merged.quests.dictionaries.tags.map((ref) => ref.id)).toEqual(['chain', 'branching'])
    expect(merged.dialogues.speakers.map((ref) => ref.id)).toEqual(['keeper', 'smuggler'])
  })

  it('notes a second display name for the same id and fills in a missing one', () => {
    const merged = mergePack([
      {
        name: 'a.oqf',
        text: 'OQF1\nA\tcaptain|Captain Rosa\nQ\ta\t1\t\t\t\tA\nS\ts\ts\t\t\t\t\t\t\t\t\t0\tS\n',
      },
      {
        name: 'b.oqf',
        text: 'OQF1\nA\tcaptain|Rosa\nQ\tb\t1\t\t\t\tB\nS\ts\ts\t\t\t\t\t\t\t\t\t0\tS\n',
      },
      { name: 'c.oqf', text: 'OQF1\nA\tmate\nQ\tc\t1\t\t\t\tC\nS\ts\ts\t\t\t\t\t\t\t\t\t0\tS\n' },
      {
        name: 'd.oqf',
        text: 'OQF1\nA\tmate|First mate\nQ\td\t1\t\t\t\tD\nS\ts\ts\t\t\t\t\t\t\t\t\t0\tS\n',
      },
    ])
    expect(merged.quests.dictionaries.actors).toEqual([
      { id: 'captain', name: 'Captain Rosa' },
      { id: 'mate', name: 'First mate' },
    ])
    expect(merged.notices).toEqual(['b.oqf names actor "captain" "Rosa", keeping "Captain Rosa".'])
  })

  it('keeps duplicate ids across files and says so', () => {
    const merged = mergePack([
      { name: 'one/chain.oqf', text: chain },
      { name: 'two/chain-copy.oqf', text: chain },
      { name: 'x/branching.oqd', text: branchingDialogue },
      { name: 'y/again.oqd', text: branchingDialogue },
    ])
    expect(merged.quests.quests).toHaveLength(6)
    expect(merged.dialogues.conversations).toHaveLength(4)
    expect(merged.notices).toContain('chain-copy.oqf repeats quest "repair_boat" from chain.oqf.')
    expect(merged.notices).toContain(
      'again.oqd repeats conversation "crate_found" from branching.oqd.',
    )
  })

  it('skips files that do not parse, files under broken and foreign names', () => {
    const merged = mergePack([
      { name: 'pack/chain.oqf', text: chain },
      { name: 'pack/bad.oqf', text: 'OQF1\nZ\twhat\n' },
      { name: 'pack/broken/chain.oqf', text: chain },
      { name: 'pack/notes.txt', text: chain },
      { name: 'pack/package.json', text: '{"name":"x"}' },
    ])
    expect(merged.quests.quests).toHaveLength(3)
    expect(merged.notices).toHaveLength(2)
    expect(merged.notices[0]).toMatch(/^Skipped bad\.oqf: /)
    expect(merged.notices[1]).toMatch(/^Skipped package\.json: /)
  })

  it('reads the JSON forms too', () => {
    const merged = mergePack([
      { name: 'chain.json', text: fixture('templates/chain.json') },
      { name: 'branching.dialogue.json', text: fixture('templates/branching.dialogue.json') },
    ])
    expect(merged.notices).toEqual([])
    expect(readFile(merged.quests.quests[0]?.ext)).toBe('chain.json')
    expect(readFile(merged.dialogues.conversations[0]?.ext)).toBe('branching.dialogue.json')
  })
})

describe('splitPack', () => {
  it('writes one file per tag and reproduces the fixtures', () => {
    const merged = mergePack(pack)
    const files = splitPack(merged.quests, merged.dialogues)
    expect(files.map((file) => file.name)).toEqual(['chain.oqf', 'branching.oqf', 'branching.oqd'])
    expect(files[0]?.text).toBe(chain)
    expect(files[1]?.text).toBe(branching)
    expect(files[2]?.text).toBe(branchingDialogue)
    for (const file of files) expect(file.text).not.toContain('x-editor')
  })

  it('round-trips through merge again', () => {
    const merged = mergePack(pack)
    const again = mergePack(splitPack(merged.quests, merged.dialogues))
    expect(again.notices).toEqual([])
    expect(untagQuests(again.quests.quests)).toEqual(untagQuests(merged.quests.quests))
    expect(again.quests.dictionaries).toEqual(merged.quests.dictionaries)
    expect(untagConversations(again.dialogues.conversations)).toEqual(
      untagConversations(merged.dialogues.conversations),
    )
    expect(again.dialogues.speakers).toEqual(merged.dialogues.speakers)
  })

  it('writes a single untagged document to one file with the original bytes', () => {
    const files = splitPack(parseCompact(ledger), emptyDialogueDocument())
    expect(files).toEqual([{ name: 'harbormasters_ledger.oqf', text: ledger }])
  })

  it('keeps positions and drops only the file tag', () => {
    const document: OqfDocument = parseCompact(chain)
    const first = document.quests[0]
    if (first === undefined) throw new Error('fixture has a quest')
    first.ext = writeFile({ [POSITION_KEY]: { x: 10, y: 20 } }, 'placed.json')
    const files = splitPack(document, emptyDialogueDocument())
    expect(files.map((file) => file.name).sort()).toEqual(['first_voyage.oqf', 'placed.json'])
    const placed = files.find((file) => file.name === 'placed.json')
    expect(placed?.text).toContain('"x-editor.pos"')
    expect(placed?.text).not.toContain('x-editor.file')
  })

  it('gives each file only the dictionary entries it references', () => {
    const merged = mergePack(pack)
    const files = splitPack(merged.quests, merged.dialogues)
    const chainFile = files.find((file) => file.name === 'chain.oqf')
    expect(chainFile?.text).not.toContain('keeper')
    expect(chainFile?.text).toContain('captain|Captain Rosa')
    const dialogueFile = files.find((file) => file.name === 'branching.oqd')
    expect(dialogueFile?.text).toContain('keeper|Keeper Aldo')
  })

  it('sends entries no file references to the first file', () => {
    const merged = mergePack(pack)
    merged.quests.dictionaries.actors.push({ id: 'nobody', name: 'Nobody' })
    merged.dialogues.speakers.push({ id: 'silent' })
    const files = splitPack(merged.quests, merged.dialogues)
    expect(files[0]?.text).toContain('nobody|Nobody')
    expect(files[1]?.text).not.toContain('nobody')
    expect(files[2]?.text).toContain('silent')
    const again = mergePack(files)
    const ids = (refs: Array<{ id: string }>) => refs.map((ref) => ref.id).sort()
    expect(ids(again.quests.dictionaries.actors)).toEqual(ids(merged.quests.dictionaries.actors))
    expect(ids(again.dialogues.speakers)).toEqual(ids(merged.dialogues.speakers))
  })
})
