/**
 * The header: what is loaded, the views, play, and every way in and out of a
 * file. Validation counts live on the drawer's tab, not here.
 */
import { useRef } from 'react'
import { TEMPLATES } from '../lib/templates'
import { useDispatch, useEditorState } from '../store/context'
import { useCloseMenus } from './useCloseMenus'
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
  onHelp,
  onReset,
  canPlay,
  playing,
  onPlay,
}: {
  tab: Tab
  onTab: (tab: Tab) => void
  files: FileActions
  onCommands: () => void
  onHelp: () => void
  /** Asks before clearing; the confirm dialog calls `files.reset`. */
  onReset: () => void
  /** True on a graph view with something to play. */
  canPlay: boolean
  playing: boolean
  onPlay: () => void
}) {
  const state = useEditorState()
  const dispatch = useDispatch()
  const root = useRef<HTMLElement>(null)
  useCloseMenus(root)
  const questCount = state.quests.quests.length
  const conversationCount = state.dialogues.conversations.length
  const { fileInput, busy } = files

  return (
    <header className="toolbar" ref={root}>
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

      {canPlay ? (
        <button
          type="button"
          className={playing ? 'play-toggle on' : 'play-toggle'}
          onClick={onPlay}
          title={playing ? 'Stop playing, cmd or ctrl P' : 'Play, cmd or ctrl P'}
        >
          {playing ? '■ Stop' : '▶ Play'}
        </button>
      ) : null}

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
        </div>

        <div className="group">
          <details className="menu primary">
            <summary title="New from template">New</summary>
            <div className="menu-body templates">
              <span className="menu-label">New from template</span>
              {TEMPLATES.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => files.fromTemplate(template)}
                >
                  <strong>{template.title}</strong>
                  <span className="muted">{template.description}</span>
                </button>
              ))}
            </div>
          </details>
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={busy}
            title="Open one or more .oqf, .oqd or .json files"
          >
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
          <details className="menu">
            <summary title="Export the quests, the dialogue or the whole pack">Export</summary>
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
          <details className="menu icon">
            <summary title="More" aria-label="More">
              ⋯
            </summary>
            <div className="menu-body">
              <button type="button" onClick={onHelp}>
                Help
              </button>
              <button type="button" className="danger" onClick={onReset}>
                Reset
              </button>
            </div>
          </details>
        </div>

        <div className="group">
          <button
            type="button"
            className="ghost"
            onClick={onCommands}
            title="Commands, cmd or ctrl K"
            aria-label="Commands"
          >
            ⌘K
          </button>
          <button
            type="button"
            className="ghost icon-button"
            onClick={onHelp}
            title="Help"
            aria-label="Help"
          >
            ?
          </button>
        </div>
      </div>
    </header>
  )
}
