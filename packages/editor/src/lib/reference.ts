/**
 * The reference quest, compiled into the bundle.
 *
 * Both files come straight from `packages/examples`, so "Load reference quest"
 * always shows the fixture every other package tests against, not a copy that
 * can drift.
 */
import type { OqfDocument } from '@oqf/core'
import { parseCompact } from '@oqf/core'
import type { DialogueDocument } from '@oqf/dialogue'
import { parseOqd } from '@oqf/dialogue'
import dialogueText from '../../../examples/quests/harbormasters-ledger.oqd?raw'
import questText from '../../../examples/quests/harbormasters-ledger.oqf?raw'

export const REFERENCE_QUEST_SOURCE = questText
export const REFERENCE_DIALOGUE_SOURCE = dialogueText

export function loadReference(): { quests: OqfDocument; dialogues: DialogueDocument } {
  return { quests: parseCompact(questText), dialogues: parseOqd(dialogueText) }
}
