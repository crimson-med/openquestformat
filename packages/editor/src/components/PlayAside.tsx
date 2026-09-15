/**
 * What play mode shows in the inspector's place: the quest playtest on the
 * Quests view, the conversation player on the Dialogue view.
 */
import { DialoguePlayPanel } from './DialoguePlayPanel'
import { QuestPlayPanel } from './QuestPlayPanel'
import '../styles/playtest.css'

export function PlayAside({ tab }: { tab: 'quests' | 'dialogue' | 'strings' | 'dictionaries' }) {
  if (tab === 'quests') return <QuestPlayPanel />
  if (tab === 'dialogue') return <DialoguePlayPanel />
  return (
    <div className="quest-play">
      <p className="note">Nothing to play on this view.</p>
    </div>
  )
}
