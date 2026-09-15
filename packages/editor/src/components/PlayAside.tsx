/**
 * Play mode's right pane. The Quests view plays the quest through the
 * runtime, the Dialogue view plays the open conversation through the built-in
 * provider.
 */
import { useEditorState } from '../store/context'
import { activeConversationId } from '../store/selectors'
import { PlayPanel } from './PlayPanel'
import { QuestPlayPanel } from './QuestPlayPanel'
import type { Tab } from './Toolbar'

export function PlayAside({ tab }: { tab: Tab }) {
  const state = useEditorState()
  if (tab === 'quests') return <QuestPlayPanel />
  if (tab === 'dialogue') return <PlayPanel conversation={activeConversationId(state)} />
  return null
}
