/**
 * Multi-file packs.
 *
 * The store holds one merged quest document and one merged dialogue document.
 * To get a folder of files back out, every quest and conversation remembers
 * the file it came from under `x-editor.file` (the file name, no directory).
 * Merging tags and joins; splitting groups by tag, gives each file only the
 * dictionary entries it references, and strips the tag before serializing so
 * it never lands in a file. Positions under `x-editor.pos` stay.
 */
import {
  type Dictionaries,
  type Ext,
  type Objective,
  type OqfDocument,
  type Quest,
  type Ref,
  emptyDocument,
  toCompact,
  toJson,
} from '@oqf/core'
import {
  type Conversation,
  type DialogueDocument,
  emptyDialogueDocument,
  toDialogueJson,
  toOqd,
} from '@oqf/dialogue'
import { MIME_TYPES, downloadName, openFile } from './files'

export const FILE_KEY = 'x-editor.file'

export interface PackFile {
  name: string
  text: string
}

export interface MergedPack {
  quests: OqfDocument
  dialogues: DialogueDocument
  notices: string[]
}

/** The file tag, or undefined when the entity has none. */
export function readFile(ext: Ext | undefined): string | undefined {
  const value = ext?.[FILE_KEY]
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** The extension bag with the file tag replaced. */
export function writeFile(ext: Ext | undefined, name: string): Ext {
  return { ...(ext ?? {}), [FILE_KEY]: name }
}

/** The extension bag without a file tag, dropped entirely when it held nothing else. */
export function clearFile(ext: Ext | undefined): Ext | undefined {
  if (ext === undefined) return undefined
  const next = { ...ext }
  delete next[FILE_KEY]
  return Object.keys(next).length === 0 ? undefined : next
}

const PACK_EXTENSION = /\.(oqf|oqd|json)$/i

/**
 * The tag a path is filed under: its last segment. Undefined when the path is
 * not a pack file, or when it sits under a `broken/` directory.
 */
export function packFileName(path: string): string | undefined {
  const segments = path.split(/[\\/]/)
  const name = segments[segments.length - 1] ?? ''
  if (!PACK_EXTENSION.test(name)) return undefined
  if (segments.slice(0, -1).includes('broken')) return undefined
  return name
}

/** The MIME type a pack file downloads with, from its extension. */
export function packMime(name: string): string {
  if (/\.json$/i.test(name)) return MIME_TYPES.json
  if (/\.oqd$/i.test(name)) return MIME_TYPES.oqd
  return MIME_TYPES.oqf
}

const DICTIONARY_KINDS = ['actors', 'locations', 'items', 'tags'] as const
type DictionaryKind = (typeof DICTIONARY_KINDS)[number]

/** Adds refs to a dictionary by id, keeping the first display name. */
function mergeRefs(into: Ref[], refs: Ref[], what: string, tag: string, notices: string[]): void {
  for (const ref of refs) {
    const known = into.find((entry) => entry.id === ref.id)
    if (known === undefined) {
      into.push({ ...ref })
      continue
    }
    if (ref.name === undefined || known.name === ref.name) continue
    if (known.name === undefined) {
      known.name = ref.name
      continue
    }
    notices.push(`${tag} names ${what} "${ref.id}" "${ref.name}", keeping "${known.name}".`)
  }
}

function conflict(id: string, what: string, tag: string, seen: Map<string, string>): string {
  const first = seen.get(id)
  return `${tag} repeats ${what} "${id}" from ${first ?? 'another file'}.`
}

/**
 * Parse every file, tag each quest and conversation with its file name, and
 * join them into one document of each kind. Files that are not pack files,
 * or that fail to parse, are skipped; the latter leave a notice.
 */
export function mergePack(files: PackFile[]): MergedPack {
  const quests = emptyDocument()
  const dialogues = emptyDialogueDocument()
  const notices: string[] = []
  const questFiles = new Map<string, string>()
  const conversationFiles = new Map<string, string>()

  for (const file of files) {
    const tag = packFileName(file.name)
    if (tag === undefined) continue
    let opened: ReturnType<typeof openFile>
    try {
      opened = openFile(tag, file.text)
    } catch (failure) {
      notices.push(
        `Skipped ${tag}: ${failure instanceof Error ? failure.message : String(failure)}`,
      )
      continue
    }
    if (opened.quests !== undefined) {
      for (const kind of DICTIONARY_KINDS) {
        mergeRefs(
          quests.dictionaries[kind],
          opened.quests.dictionaries[kind],
          kind.slice(0, -1),
          tag,
          notices,
        )
      }
      for (const quest of opened.quests.quests) {
        if (questFiles.has(quest.id)) notices.push(conflict(quest.id, 'quest', tag, questFiles))
        else questFiles.set(quest.id, tag)
        quests.quests.push({ ...quest, ext: writeFile(quest.ext, tag) })
      }
    }
    if (opened.dialogues !== undefined) {
      mergeRefs(dialogues.speakers, opened.dialogues.speakers, 'speaker', tag, notices)
      for (const conversation of opened.dialogues.conversations) {
        if (conversationFiles.has(conversation.id)) {
          notices.push(conflict(conversation.id, 'conversation', tag, conversationFiles))
        } else conversationFiles.set(conversation.id, tag)
        dialogues.conversations.push({
          ...conversation,
          ext: writeFile(conversation.ext, tag),
        })
      }
    }
  }

  return { quests, dialogues, notices }
}

function objectiveRefs(
  objective: Objective | undefined,
  used: Record<DictionaryKind, Set<string>>,
) {
  if (objective === undefined) return
  if (objective.kind === 'kill' || objective.kind === 'talk') used.actors.add(objective.actor)
  if (objective.kind === 'collect') used.items.add(objective.item)
  if (objective.kind === 'reach') used.locations.add(objective.location)
}

type UsedIds = Record<DictionaryKind, Set<string>>

/** The dictionary ids a set of quests references: tags, actors, locations and items. */
export function referencedIds(quests: Quest[]): UsedIds {
  const used: UsedIds = {
    actors: new Set(),
    locations: new Set(),
    items: new Set(),
    tags: new Set(),
  }
  for (const quest of quests) {
    for (const tag of quest.tags) used.tags.add(tag)
    for (const reward of quest.rewards) {
      if (reward.kind === 'item') used.items.add(reward.ref)
    }
    for (const step of quest.steps) {
      for (const actor of step.actors) used.actors.add(actor)
      if (step.location !== undefined) used.locations.add(step.location)
      objectiveRefs(step.objective, used)
      objectiveRefs(step.failObjective, used)
    }
  }
  return used
}

function pickDictionaries(dictionaries: Dictionaries, ids: UsedIds): Dictionaries {
  return {
    actors: dictionaries.actors.filter((ref) => ids.actors.has(ref.id)),
    locations: dictionaries.locations.filter((ref) => ids.locations.has(ref.id)),
    items: dictionaries.items.filter((ref) => ids.items.has(ref.id)),
    tags: dictionaries.tags.filter((ref) => ids.tags.has(ref.id)),
  }
}

/** The speaker ids a set of conversations references. */
export function referencedSpeakerIds(conversations: Conversation[]): Set<string> {
  const used = new Set<string>()
  for (const conversation of conversations) {
    if (conversation.actor !== undefined) used.add(conversation.actor)
    for (const node of conversation.nodes) {
      if (node.speaker !== undefined) used.add(node.speaker)
    }
  }
  return used
}

function groupByFile<T extends { id: string; ext?: Ext }>(
  items: T[],
  fallback: (first: T) => string,
): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  let untagged: string | undefined
  for (const item of items) {
    let name = readFile(item.ext)
    if (name === undefined) {
      untagged ??= fallback(item)
      name = untagged
    }
    const group = groups.get(name)
    if (group === undefined) groups.set(name, [item])
    else group.push(item)
  }
  return groups
}

function untag<T extends { ext?: Ext }>(item: T): T {
  const ext = clearFile(item.ext)
  const { ext: _dropped, ...rest } = item
  return (ext === undefined ? rest : { ...rest, ext }) as T
}

/**
 * The inverse of `mergePack`: one file per tag, quests first, then dialogue.
 * Untagged quests go to `<firstQuestId>.oqf` and untagged conversations to
 * `<firstConversationId>.oqd`. A `.json` tag writes the JSON form. Each file
 * gets the dictionary entries its quests reference; entries no file references
 * ride along in the first file so an export never loses them.
 */
export function splitPack(quests: OqfDocument, dialogues: DialogueDocument): PackFile[] {
  const files: PackFile[] = []

  const questGroups = [...groupByFile(quests.quests, (first) => downloadName(first.id, 'oqf'))].map(
    ([name, group]) => ({ name, group, ids: referencedIds(group) }),
  )
  const first = questGroups[0]
  if (first !== undefined) {
    for (const kind of DICTIONARY_KINDS) {
      for (const ref of quests.dictionaries[kind]) {
        if (!questGroups.some((entry) => entry.ids[kind].has(ref.id))) first.ids[kind].add(ref.id)
      }
    }
  }
  for (const { name, group, ids } of questGroups) {
    const document: OqfDocument = {
      dictionaries: pickDictionaries(quests.dictionaries, ids),
      quests: group.map(untag),
    }
    const text = /\.json$/i.test(name) ? toJson(document) : toCompact(document)
    files.push({ name, text })
  }

  const dialogueGroups = [
    ...groupByFile(dialogues.conversations, (first) => downloadName(first.id, 'oqd')),
  ].map(([name, group]) => ({ name, group, ids: referencedSpeakerIds(group) }))
  const firstDialogue = dialogueGroups[0]
  if (firstDialogue !== undefined) {
    for (const ref of dialogues.speakers) {
      if (!dialogueGroups.some((entry) => entry.ids.has(ref.id))) firstDialogue.ids.add(ref.id)
    }
  }
  for (const { name, group, ids } of dialogueGroups) {
    const document: DialogueDocument = {
      speakers: dialogues.speakers.filter((ref) => ids.has(ref.id)),
      conversations: group.map(untag),
    }
    const text = /\.json$/i.test(name) ? toDialogueJson(document) : toOqd(document)
    files.push({ name, text })
  }

  return files
}
