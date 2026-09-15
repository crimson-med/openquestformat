/**
 * The header: what is loaded, what is wrong with it, and every way in and out
 * of a file.
 */
import { useRef } from 'react'
import { TEMPLATES } from '../lib/templates'
import { useDispatch, useEditorState } from '../store/context'
import { countFindings } from '../store/findings'
import type { FileActions } from './useFileActions'

export type Tab = 'quests' | 'dialogue' | 'strings' | 'dictionaries'

const TABS: { tab: Tab; title: string }[] = [
  { tab: 'quests', title: 'Quests' },
  { tab: 'dialogue', title: 'Dialogue' },
  { tab: 'strings', title: 'Strings' },
  { tab: 'dictionaries', title: 'Dictionaries' },
]

export function Toolbar({
  tab,
  onTab,
  files,
  onCommands,
}: {
  tab: Tab
  onTab: (tab: Tab) => void
  files: FileActions
  onCommands: () => void
}) {
  const state = useEditorState()
  const dispatch = useDispatch()
  const templateMenu = useRef<HTMLDetailsElement>(null)
  const moreMenu = useRef<HTMLDetailsElement>(null)
  const counts = countFindings(state.findings)
  const questCount = state.quests.quests.length
  const conversationCount = state.dialogues.conversations.length
  const { fileInput, folderInput, busy } = files

  return (
    <header className="toolbar">
      <div className="brand">
        <span className="mark">OQF</span>
        <span className="brand-text">
          <strong>Quest editor</strong>
          <span className="muted">
            {questCount} quest{questCount === 1 ? '' : 's'}, {conversationCount} conversation
            {conversationCount === 1 ? '' : 's'}
            {state.dirty ? ', unsaved' : ''}
          </span>
        </span>
      </div>

      <nav className="tabs" aria-label="Editor views">
        {TABS.map((entry) => (
          <button
            key={entry.tab}
            type="button"
            className={tab === entry.tab ? 'tab on' : 'tab'}
            onClick={() => onTab(entry.tab)}
          >
            {entry.title}
          </button>
        ))}
      </nav>

      <div className="counts">
        <span className={counts.errors > 0 ? 'count error' : 'count'}>
          {counts.errors} error{counts.errors === 1 ? '' : 's'}
        </span>
        <span className={counts.warnings > 0 ? 'count warning' : 'count'}>
          {counts.warnings} warning{counts.warnings === 1 ? '' : 's'}
        </span>
      </div>

      <div className="actions">
        <div className="group">
          <button
            type="button"
            className="icon-button"
            onClick={() => dispatch({ type: 'undo' })}
            disabled={state.past.length === 0}
            title="Undo, cmd or ctrl Z"
            aria-label="Undo"
          >
            ↶
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => dispatch({ type: 'redo' })}
            disabled={state.future.length === 0}
            title="Redo, shift cmd or ctrl Z"
            aria-label="Redo"
          >
            ↷
          </button>
          <button
            type="button"
            className="ghost"
            onClick={onCommands}
            title="Commands, cmd or ctrl K"
            aria-label="Commands"
          >
            ⌘K
          </button>
        </div>

        <div className="group">
          <details className="menu primary" ref={templateMenu}>
            <summary title="New from template">New</summary>
            <div className="menu-body templates">
              <span className="menu-label">New from template</span>
              {TEMPLATES.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => {
                    if (templateMenu.current !== null) templateMenu.current.open = false
                    files.fromTemplate(template)
                  }}
                >
                  <strong>{template.title}</strong>
                  <span className="muted">{template.description}</span>
                </button>
              ))}
            </div>
          </details>
          <button type="button" onClick={() => fileInput.current?.click()} disabled={busy}>
            Open
          </button>
          <input
            ref={fileInput}
            className="file-input"
            type="file"
            accept=".oqf,.oqd,.json,text/plain,application/json"
            multiple
            onChange={(event) => {
              void files.open(event.target.files)
            }}
          />
          <button type="button" onClick={() => folderInput.current?.click()} disabled={busy}>
            Open folder
          </button>
          <input
            ref={(node) => {
              folderInput.current = node
              // The React types do not know the attribute; the browser does.
              node?.setAttribute('webkitdirectory', '')
            }}
            className="file-input"
            type="file"
            multiple
            onChange={(event) => {
              void files.open(event.target.files)
            }}
          />
          <details className="menu">
            <summary>Export</summary>
            <div className="menu-body">
              <button type="button" onClick={files.exportPack}>
                Pack as files
              </button>
              <button type="button" onClick={() => files.exportQuests('oqf')}>
                Quests as .oqf
              </button>
              <button type="button" onClick={() => files.exportQuests('json')}>
                Quests as .json
              </button>
              <button type="button" onClick={() => files.exportQuests('md')}>
                Quests as .md
              </button>
              <button type="button" onClick={() => files.exportDialogues('oqd')}>
                Dialogue as .oqd
              </button>
              <button type="button" onClick={() => files.exportDialogues('json')}>
                Dialogue as .json
              </button>
            </div>
          </details>
          <details className="menu" ref={moreMenu}>
            <summary title="More" aria-label="More">
              ⋯
            </summary>
            <div className="menu-body">
              <button
                type="button"
                onClick={() => {
                  if (moreMenu.current !== null) moreMenu.current.open = false
                  files.loadReferenceQuest()
                }}
              >
                Load reference quest
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  if (moreMenu.current !== null) moreMenu.current.open = false
                  files.reset()
                }}
              >
                Reset
              </button>
            </div>
          </details>
        </div>
      </div>
    </header>
  )
}
