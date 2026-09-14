/**
 * The three panes: graph, inspector, drawer. Everything else is a child of one
 * of them.
 */
import { ReactFlowProvider } from '@xyflow/react'
import { useEffect, useState } from 'react'
import { type Direction, browserStore, readDirection, writeDirection } from '../lib/direction'
import { downloadText } from '../lib/download'
import { MIME_TYPES, downloadName, serializeQuests } from '../lib/files'
import { loadReference } from '../lib/reference'
import { useDispatch, useEditorState } from '../store/context'
import {
  activeConversationId,
  activeQuestId,
  findConversation,
  findQuest,
} from '../store/selectors'
import { DialogueGraph } from './DialogueGraph'
import { Drawer, type DrawerTab } from './Drawer'
import { EmptyState } from './EmptyState'
import { Inspector } from './Inspector'
import { PlaytestProvider } from './PlaytestContext'
import { QuestGraph } from './QuestGraph'
import { StringsProvider } from './StringsContext'
import { type Tab, Toolbar } from './Toolbar'

/** True when a keystroke belongs to a field rather than to the canvas. */
function editingText(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable
}

function AppContent() {
  const state = useEditorState()
  const dispatch = useDispatch()
  const [tab, setTab] = useState<Tab>('quests')
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('validation')
  const [drawerOpen, setDrawerOpen] = useState(true)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [direction, setDirection] = useState<Direction>(() => readDirection(browserStore()))
  const changeDirection = (next: Direction) => {
    setDirection(next)
    writeDirection(browserStore(), next)
  }

  const questId = activeQuestId(state)
  const quest = findQuest(state, questId)
  const conversationId = activeConversationId(state)
  const conversation = findConversation(state, conversationId)

  useEffect(() => {
    if (notice === undefined) return
    const timer = window.setTimeout(() => setNotice(undefined), 6000)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey
      if (meta && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        dispatch({ type: event.shiftKey ? 'redo' : 'undo' })
        return
      }
      if (meta && event.key.toLowerCase() === 's') {
        event.preventDefault()
        const base = state.quests.quests[0]?.id ?? 'quests'
        try {
          downloadText(
            downloadName(base, 'oqf'),
            serializeQuests(state.quests, 'oqf'),
            MIME_TYPES.oqf,
          )
          dispatch({ type: 'doc/markSaved' })
          setNotice(`Exported ${downloadName(base, 'oqf')}`)
        } catch (failure) {
          setNotice(failure instanceof Error ? failure.message : String(failure))
        }
        return
      }
      if (editingText(event.target)) return
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      const selection = state.selection
      if (selection.kind === 'step') {
        event.preventDefault()
        dispatch({ type: 'step/remove', quest: selection.quest, step: selection.step })
        return
      }
      if (selection.kind === 'node') {
        event.preventDefault()
        dispatch({
          type: 'node/remove',
          conversation: selection.conversation,
          node: selection.node,
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dispatch, state.selection, state.quests])

  const questPicker =
    state.quests.quests.length > 1 && tab === 'quests' ? (
      <select
        className="picker-select"
        value={questId ?? ''}
        onChange={(event) =>
          dispatch({ type: 'select', selection: { kind: 'quest', quest: event.target.value } })
        }
      >
        {state.quests.quests.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {String(entry.title)}
          </option>
        ))}
      </select>
    ) : null

  const conversationPicker =
    state.dialogues.conversations.length > 1 && tab === 'dialogue' ? (
      <select
        className="picker-select"
        value={conversationId ?? ''}
        onChange={(event) =>
          dispatch({
            type: 'select',
            selection: { kind: 'conversation', conversation: event.target.value },
          })
        }
      >
        {state.dialogues.conversations.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.id}
          </option>
        ))}
      </select>
    ) : null

  const canvasPicker = questPicker ?? conversationPicker

  /** Switching view moves the inspector to that view, so the two never disagree. */
  const switchTab = (next: Tab) => {
    setTab(next)
    const kind = state.selection.kind
    if (next === 'quests' && (kind === 'conversation' || kind === 'node' || kind === 'choice')) {
      if (questId !== undefined) {
        dispatch({ type: 'select', selection: { kind: 'quest', quest: questId } })
      }
      return
    }
    if (next === 'dialogue' && (kind === 'quest' || kind === 'step' || kind === 'reward')) {
      if (conversationId !== undefined) {
        dispatch({
          type: 'select',
          selection: { kind: 'conversation', conversation: conversationId },
        })
      }
    }
  }

  return (
    <div className="app">
      <Toolbar tab={tab} onTab={switchTab} onNotice={setNotice} />
      {notice === undefined ? null : (
        <output className="notice">
          {notice}
          <button type="button" className="ghost" onClick={() => setNotice(undefined)}>
            Dismiss
          </button>
        </output>
      )}
      <main className="panes">
        <section className="canvas">
          {canvasPicker === null ? null : <div className="canvas-head">{canvasPicker}</div>}
          {tab === 'quests' ? (
            quest === undefined ? (
              <EmptyState
                title="Nothing open"
                body="Open a file or load the reference quest."
                actions={
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        const reference = loadReference()
                        dispatch({
                          type: 'doc/load',
                          quests: reference.quests,
                          dialogues: reference.dialogues,
                        })
                      }}
                    >
                      Load reference quest
                    </button>
                    <button type="button" onClick={() => dispatch({ type: 'quest/add' })}>
                      Start an empty quest
                    </button>
                  </>
                }
              />
            ) : (
              <ReactFlowProvider>
                <QuestGraph
                  key={`${quest.id}-${direction}`}
                  quest={quest}
                  direction={direction}
                  onDirection={changeDirection}
                />
              </ReactFlowProvider>
            )
          ) : conversation === undefined ? (
            <EmptyState
              title="No conversations"
              body="Open an .oqd file or add a conversation to start writing dialogue."
              actions={
                <button type="button" onClick={() => dispatch({ type: 'conversation/add' })}>
                  Add a conversation
                </button>
              }
            />
          ) : (
            <ReactFlowProvider>
              <DialogueGraph
                key={`${conversation.id}-${direction}`}
                conversation={conversation}
                direction={direction}
                onDirection={changeDirection}
              />
            </ReactFlowProvider>
          )}
        </section>
        <aside className="inspector">
          <Inspector />
        </aside>
      </main>
      <Drawer
        tab={drawerTab}
        onTab={setDrawerTab}
        open={drawerOpen}
        onOpen={setDrawerOpen}
        conversation={conversationId}
      />
    </div>
  )
}

/**
 * The panes, inside the language tables the Strings tab and the graphs share
 * and the playtest session the Play tab and the quest graph share.
 */
export function App() {
  return (
    <StringsProvider>
      <PlaytestProvider>
        <AppContent />
      </PlaytestProvider>
    </StringsProvider>
  )
}
