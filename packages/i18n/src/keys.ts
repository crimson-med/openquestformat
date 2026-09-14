/**
 * Stable key generation for player-facing text.
 *
 * Keys are derived from structure, never from content, so a second extraction
 * of the same document produces the same keys. A key is stored in a `text`
 * field as a key reference: the key with a leading `@`.
 */
import type { Text } from '@oqf/core'
import { I18nError } from './errors.js'

/** Marks a `text` field as a key rather than a literal. */
export const KEY_PREFIX = '@'

/** True when a `text` value is a key reference rather than a literal. */
export function isKey(text: Text): boolean {
  return text.startsWith(KEY_PREFIX)
}

/** The key inside a key reference. Throws when the value is a literal. */
export function keyOf(text: Text): string {
  if (!isKey(text)) throw new I18nError(`not a key reference: ${text}`)
  return text.slice(KEY_PREFIX.length)
}

/** The key reference that stores `key` in a `text` field. */
export function toKeyRef(key: string): Text {
  return `${KEY_PREFIX}${key}`
}

/** `<questId>.title` */
export function questTitleKey(questId: string): string {
  return `${questId}.title`
}

/** `<questId>.summary` */
export function questSummaryKey(questId: string): string {
  return `${questId}.summary`
}

/** `<questId>.<stepId>.title` */
export function stepTitleKey(questId: string, stepId: string): string {
  return `${questId}.${stepId}.title`
}

/** `<questId>.<stepId>.journal` */
export function stepJournalKey(questId: string, stepId: string): string {
  return `${questId}.${stepId}.journal`
}

/** `<questId>.<stepId>.outcome.title` */
export function outcomeTitleKey(questId: string, stepId: string): string {
  return `${questId}.${stepId}.outcome.title`
}

/** `<conversationId>.title` */
export function conversationTitleKey(conversationId: string): string {
  return `${conversationId}.title`
}

/** `<conversationId>.<nodeId>.text` */
export function nodeTextKey(conversationId: string, nodeId: string): string {
  return `${conversationId}.${nodeId}.text`
}

/** `<conversationId>.<nodeId>.<choiceIndex>.text` */
export function choiceTextKey(conversationId: string, nodeId: string, choiceIndex: number): string {
  return `${conversationId}.${nodeId}.${choiceIndex}.text`
}
