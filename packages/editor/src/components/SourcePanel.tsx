/**
 * The live source view. Read only on purpose: the point is to see the file the
 * editor is writing, in the format that makes OQF worth using.
 */
import { useState } from 'react'
import type { DialogueFormat, QuestFormat } from '../lib/files'
import { dialogueSource, lineCount, questSource } from '../lib/source'
import { useEditorState } from '../store/context'

type Choice = 'oqf' | 'json' | 'md' | 'oqd' | 'oqd-json'

const CHOICES: Array<{ value: Choice; label: string }> = [
  { value: 'oqf', label: 'quests.oqf' },
  { value: 'json', label: 'quests.json' },
  { value: 'md', label: 'quests.md' },
  { value: 'oqd', label: 'dialogue.oqd' },
  { value: 'oqd-json', label: 'dialogue.json' },
]

export function SourcePanel() {
  const state = useEditorState()
  const [choice, setChoice] = useState<Choice>('oqf')
  const view =
    choice === 'oqd' || choice === 'oqd-json'
      ? dialogueSource(state.dialogues, (choice === 'oqd' ? 'oqd' : 'json') as DialogueFormat)
      : questSource(state.quests, choice as QuestFormat)

  return (
    <div className="source">
      <div className="source-head">
        <div className="segmented">
          {CHOICES.map((option) => (
            <button
              key={option.value}
              type="button"
              className={choice === option.value ? 'on' : ''}
              onClick={() => setChoice(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <span className="muted">
          {view.error === undefined ? `${lineCount(view.text)} lines` : 'cannot be written yet'}
        </span>
      </div>
      {view.error === undefined ? (
        <pre className="source-body mono">{view.text}</pre>
      ) : (
        <p className="field-error">{view.error}</p>
      )}
    </div>
  )
}
