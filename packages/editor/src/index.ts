/**
 * `@oqf/editor` as a library.
 *
 * The app entry point mounts `QuestEditor` full screen; anything else can mount
 * the same component and keep the documents itself.
 */
import './styles.css'

export { QuestEditor } from './components/QuestEditor'
export type { QuestEditorProps } from './components/QuestEditor'
export { detectFormat, openFile, serializeDialogues, serializeQuests } from './lib/files'
export type { DialogueFormat, FileKind, OpenedFile, QuestFormat } from './lib/files'
export {
  conversationPositions,
  layoutConversation,
  layoutQuest,
  questPositions,
} from './lib/layout'
export { POSITION_KEY, readPosition, writePosition } from './lib/position'
export { loadReference } from './lib/reference'
export { dialogueSource, questSource } from './lib/source'
export * from './store'
