/**
 * The header: what is loaded, what is wrong with it, and every way in and out
 * of a file.
 */
import { useRef, useState } from 'react'
import { downloadText } from '../lib/download'
import {
  type DialogueFormat,
  MIME_TYPES,
  type QuestFormat,
  downloadName,
  openFile,
  serializeDialogues,
  serializeQuests,
} from '../lib/files'
import { loadReference } from '../lib/reference'
import { type QuestTemplate, TEMPLATES, loadTemplate } from '../lib/templates'
import { useDispatch, useEditorState } from '../store/context'
import { countFindings } from '../store/findings'

export type Tab = 'quests' | 'dialogue'

export function Toolbar({
  tab,
  onTab,
  onNotice,
}: {
  tab: Tab
  onTab: (tab: Tab) => void
  onNotice: (message: string | undefined) => void
}) {
  const state = useEditorState()
  const dispatch = useDispatch()
  const fileInput = useRef<HTMLInputElement>(null)
  const templateMenu = useRef<HTMLDetailsElement>(null)
  const moreMenu = useRef<HTMLDetailsElement>(null)
  const [busy, setBusy] = useState(false)
  const counts = countFindings(state.findings)
  const questCount = state.quests.quests.length
  const conversationCount = state.dialogues.conversations.length
  const base = state.quests.quests[0]?.id ?? 'quests'

  const open = async (files: FileList | null) => {
    if (files === null || files.length === 0) return
    setBusy(true)
    try {
      let quests = state.quests
      let dialogues = state.dialogues
      const names: string[] = []
      for (const file of Array.from(files)) {
        const opened = openFile(file.name, await file.text())
        if (opened.quests !== undefined) quests = opened.quests
        if (opened.dialogues !== undefined) dialogues = opened.dialogues
        names.push(file.name)
      }
      dispatch({ type: 'doc/load', quests, dialogues })
      onNotice(`Opened ${names.join(', ')}`)
    } catch (failure) {
      onNotice(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
      if (fileInput.current !== null) fileInput.current.value = ''
    }
  }

  const fromTemplate = (template: QuestTemplate) => {
    if (templateMenu.current !== null) templateMenu.current.open = false
    try {
      const loaded = loadTemplate(template)
      dispatch({
        type: 'doc/load',
        quests: loaded.quests,
        dialogues: loaded.dialogues,
        selection: { kind: 'quest', quest: loaded.quests.quests[0]?.id ?? '' },
      })
      onNotice(`Created from the template ${template.title}.`)
    } catch (failure) {
      onNotice(failure instanceof Error ? failure.message : String(failure))
    }
  }

  const exportQuests = (format: QuestFormat) => {
    try {
      downloadText(
        downloadName(base, format),
        serializeQuests(state.quests, format),
        MIME_TYPES[format],
      )
      dispatch({ type: 'doc/markSaved' })
      onNotice(`Exported ${downloadName(base, format)}`)
    } catch (failure) {
      onNotice(failure instanceof Error ? failure.message : String(failure))
    }
  }

  const exportDialogues = (format: DialogueFormat) => {
    try {
      downloadText(
        downloadName(base, format),
        serializeDialogues(state.dialogues, format),
        MIME_TYPES[format],
      )
      onNotice(`Exported ${downloadName(base, format)}`)
    } catch (failure) {
      onNotice(failure instanceof Error ? failure.message : String(failure))
    }
  }

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
        <button
          type="button"
          className={tab === 'quests' ? 'tab on' : 'tab'}
          onClick={() => onTab('quests')}
        >
          Quests
        </button>
        <button
          type="button"
          className={tab === 'dialogue' ? 'tab on' : 'tab'}
          onClick={() => onTab('dialogue')}
        >
          Dialogue
        </button>
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
        </div>

        <div className="group">
          <details className="menu primary" ref={templateMenu}>
            <summary title="New from template">New</summary>
            <div className="menu-body templates">
              <span className="menu-label">New from template</span>
              {TEMPLATES.map((template) => (
                <button key={template.id} type="button" onClick={() => fromTemplate(template)}>
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
              void open(event.target.files)
            }}
          />
          <details className="menu">
            <summary>Export</summary>
            <div className="menu-body">
              <button type="button" onClick={() => exportQuests('oqf')}>
                Quests as .oqf
              </button>
              <button type="button" onClick={() => exportQuests('json')}>
                Quests as .json
              </button>
              <button type="button" onClick={() => exportQuests('md')}>
                Quests as .md
              </button>
              <button type="button" onClick={() => exportDialogues('oqd')}>
                Dialogue as .oqd
              </button>
              <button type="button" onClick={() => exportDialogues('json')}>
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
                  try {
                    const reference = loadReference()
                    dispatch({
                      type: 'doc/load',
                      quests: reference.quests,
                      dialogues: reference.dialogues,
                      selection: {
                        kind: 'quest',
                        quest: reference.quests.quests[0]?.id ?? '',
                      },
                    })
                    onNotice('Loaded the reference quest, The Harbormaster’s Ledger.')
                  } catch (failure) {
                    onNotice(failure instanceof Error ? failure.message : String(failure))
                  }
                }}
              >
                Load reference quest
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  if (moreMenu.current !== null) moreMenu.current.open = false
                  dispatch({ type: 'doc/reset' })
                  onNotice('Cleared. Nothing is loaded.')
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
