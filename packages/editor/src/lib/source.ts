/**
 * The live source view.
 *
 * The Source tab re-serializes the document on every keystroke, so a document
 * the serializer refuses has to read as an error message rather than throw. The
 * message is the one the serializer gave, which is usually specific enough to
 * fix the field it names.
 */
import type { OqfDocument } from '@oqf/core'
import type { DialogueDocument } from '@oqf/dialogue'
import { type DialogueFormat, type QuestFormat, serializeDialogues, serializeQuests } from './files'

export interface SourceView {
  text: string
  /** Set when the document cannot be written in this format right now. */
  error?: string
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function questSource(document: OqfDocument, format: QuestFormat): SourceView {
  try {
    return { text: serializeQuests(document, format) }
  } catch (error) {
    return { text: '', error: message(error) }
  }
}

export function dialogueSource(document: DialogueDocument, format: DialogueFormat): SourceView {
  try {
    return { text: serializeDialogues(document, format) }
  } catch (error) {
    return { text: '', error: message(error) }
  }
}

/** Line count, for the source tab footer. */
export function lineCount(text: string): number {
  if (text === '') return 0
  const lines = text.split('\n')
  return lines[lines.length - 1] === '' ? lines.length - 1 : lines.length
}
