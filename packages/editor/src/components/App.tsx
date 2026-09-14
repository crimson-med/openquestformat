/**
 * The three panes: graph, inspector, drawer. Everything else is a child of one
 * of them.
 */
import { ReactFlowProvider } from '@xyflow/react'
import { useEffect, useMemo, useState } from 'react'
import type { Command } from '../lib/commands'
import { type Direction, browserStore, readDirection, writeDirection } from '../lib/direction'
import { downloadText } from '../lib/download'
import { MIME_TYPES, downloadName, serializeQuests } from '../lib/files'
import { layoutConversation, layoutQuest } from '../lib/layout'
import { loadReference } from '../lib/reference'
import { TEMPLATES } from '../lib/templates'
import { useDispatch, useEditorState } from '../store/context'
import {
  activeConversationId,
  activeQuestId,
  findConversation,
  findQuest,
} from '../store/selectors'
import { CommandPalette } from './CommandPalette'
import { DialogueGraph } from './DialogueGraph'
import { Drawer, type DrawerTab } from './Drawer'
import { EmptyState } from './EmptyState'
import { Inspector } from './Inspector'
import { PlaytestProvider } from './PlaytestContext'
import { QuestGraph } from './QuestGraph'
import { StringsProvider } from './StringsContext'
import { type Tab, Toolbar } from './Toolbar'
import { useFileActions } from './useFileActions'

const DRAWER_TABS: { tab: DrawerTab; title: string }[] = [
  { tab: 'validation', title: 'Validation' },
  { tab: 'source', title: 'Source' },
  { tab: 'play', title: 'Play' },
  { tab: 'strings', title: 'Strings' },
]

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
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [direction, setDirection] = useState<Direction>(() => readDirection(browserStore()))
  const changeDirection = (next: Direction) => {
    setDirection(next)
    writeDirection(browserStore(), next)
  }
  const files = useFileActions(setNotice)

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
      if (meta && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
        return
      }
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
      if (event.key === 'n' && !meta && !event.altKey && !event.shiftKey) {
        if (tab === 'quests' && questId !== undefined) {
          event.preventDefault()
          dispatch({ type: 'step/add', quest: questId })
        } else if (tab === 'dialogue' && conversationId !== undefined) {
          event.preventDefault()
          dispatch({ type: 'node/add', conversation: conversationId })
        }
        return
      }
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
  }, [dispatch, state.selection, state.quests, tab, questId, conversationId])

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

  // The file actions and the tab switch close over the state, so it stands in for them.
  // biome-ignore lint/correctness/useExhaustiveDependencies: state covers files and switchTab
  const commands = useMemo<Command[]>(() => {
    const list: Command[] = []
    const layout = (next: Direction) => {
      if (tab === 'quests' && quest !== undefined) {
        dispatch({
          type: 'step/positions',
          quest: quest.id,
          positions: layoutQuest(quest, { direction: next }),
        })
      } else if (tab === 'dialogue' && conversation !== undefined) {
        dispatch({
          type: 'node/positions',
          conversation: conversation.id,
          positions: layoutConversation(conversation, { direction: next }),
        })
      }
      if (next !== direction) changeDirection(next)
    }
    const showDrawer = (next: DrawerTab) => {
      setDrawerTab(next)
      setDrawerOpen(true)
    }

    if (quest !== undefined) {
      list.push({
        id: 'step/add',
        title: 'Add step',
        group: 'Edit',
        shortcut: 'N',
        run: () => {
          setTab('quests')
          dispatch({ type: 'step/add', quest: quest.id })
        },
      })
    }
    if (conversation !== undefined) {
      list.push({
        id: 'node/add',
        title: 'Add node',
        group: 'Edit',
        shortcut: 'N',
        run: () => {
          setTab('dialogue')
          dispatch({ type: 'node/add', conversation: conversation.id })
        },
      })
    }
    list.push(
      {
        id: 'undo',
        title: 'Undo',
        group: 'Edit',
        shortcut: '⌘Z',
        run: () => dispatch({ type: 'undo' }),
      },
      {
        id: 'redo',
        title: 'Redo',
        group: 'Edit',
        shortcut: '⇧⌘Z',
        run: () => dispatch({ type: 'redo' }),
      },
    )
    const selection = state.selection
    if (selection.kind === 'step') {
      list.push({
        id: 'delete',
        title: 'Delete selected step',
        group: 'Edit',
        keywords: ['remove'],
        shortcut: '⌫',
        run: () => dispatch({ type: 'step/remove', quest: selection.quest, step: selection.step }),
      })
    } else if (selection.kind === 'node') {
      list.push({
        id: 'delete',
        title: 'Delete selected node',
        group: 'Edit',
        keywords: ['remove'],
        shortcut: '⌫',
        run: () =>
          dispatch({
            type: 'node/remove',
            conversation: selection.conversation,
            node: selection.node,
          }),
      })
    }

    const canLayout =
      (tab === 'quests' && quest !== undefined) ||
      (tab === 'dialogue' && conversation !== undefined)
    if (canLayout) {
      list.push(
        {
          id: 'layout/auto',
          title: 'Auto layout',
          group: 'Layout',
          keywords: ['relayout', 'arrange'],
          run: () => layout(direction),
        },
        {
          id: 'layout/tb',
          title: 'Lay out top to bottom',
          group: 'Layout',
          keywords: ['vertical', 'direction'],
          run: () => layout('TB'),
        },
        {
          id: 'layout/lr',
          title: 'Lay out left to right',
          group: 'Layout',
          keywords: ['horizontal', 'direction'],
          run: () => layout('LR'),
        },
      )
    }

    list.push(
      {
        id: 'view/quests',
        title: 'Switch to Quests',
        group: 'View',
        keywords: ['tab', 'graph'],
        run: () => switchTab('quests'),
      },
      {
        id: 'view/dialogue',
        title: 'Switch to Dialogue',
        group: 'View',
        keywords: ['tab', 'conversation'],
        run: () => switchTab('dialogue'),
      },
      {
        id: 'view/drawer',
        title: drawerOpen ? 'Hide drawer' : 'Show drawer',
        group: 'View',
        keywords: ['toggle', 'drawer', 'panel'],
        run: () => setDrawerOpen((open) => !open),
      },
      ...DRAWER_TABS.map(
        (entry): Command => ({
          id: `view/drawer/${entry.tab}`,
          title: `Drawer: ${entry.title}`,
          group: 'View',
          keywords: ['tab', 'panel'],
          run: () => showDrawer(entry.tab),
        }),
      ),
    )

    list.push(
      {
        id: 'file/open',
        title: 'Open',
        group: 'File',
        keywords: ['file', 'import', 'load'],
        run: () => files.fileInput.current?.click(),
      },
      {
        id: 'file/export/oqf',
        title: 'Export quests as .oqf',
        group: 'File',
        keywords: ['save', 'download', 'compact'],
        shortcut: '⌘S',
        run: () => files.exportQuests('oqf'),
      },
      {
        id: 'file/export/json',
        title: 'Export quests as .json',
        group: 'File',
        keywords: ['save', 'download'],
        run: () => files.exportQuests('json'),
      },
      {
        id: 'file/export/md',
        title: 'Export quests as .md',
        group: 'File',
        keywords: ['save', 'download', 'markdown'],
        run: () => files.exportQuests('md'),
      },
      {
        id: 'file/export/oqd',
        title: 'Export dialogue as .oqd',
        group: 'File',
        keywords: ['save', 'download'],
        run: () => files.exportDialogues('oqd'),
      },
      {
        id: 'file/export/dialogue-json',
        title: 'Export dialogue as .json',
        group: 'File',
        keywords: ['save', 'download'],
        run: () => files.exportDialogues('json'),
      },
      {
        id: 'file/export/pack',
        title: 'Export pack as files',
        group: 'File',
        keywords: ['save', 'download', 'folder'],
        run: files.exportPack,
      },
      {
        id: 'file/reference',
        title: 'Load reference quest',
        group: 'File',
        keywords: ['harbormaster', 'ledger', 'example'],
        run: files.loadReferenceQuest,
      },
      {
        id: 'file/reset',
        title: 'Reset (clears everything)',
        group: 'File',
        keywords: ['clear', 'new', 'empty'],
        run: files.reset,
      },
    )

    for (const template of TEMPLATES) {
      list.push({
        id: `template/${template.id}`,
        title: template.title,
        group: 'New from template',
        keywords: [template.id, template.description],
        run: () => files.fromTemplate(template),
      })
    }

    if (quest !== undefined) {
      for (const step of quest.steps) {
        list.push({
          id: `step/${step.id}`,
          title: String(step.title),
          group: 'Go to step',
          keywords: [step.id],
          run: () => {
            setTab('quests')
            dispatch({
              type: 'select',
              selection: { kind: 'step', quest: quest.id, step: step.id },
            })
          },
        })
      }
    }
    for (const entry of state.dialogues.conversations) {
      list.push({
        id: `conversation/${entry.id}`,
        title: entry.id,
        group: 'Go to conversation',
        keywords: [entry.id],
        run: () => {
          setTab('dialogue')
          dispatch({ type: 'select', selection: { kind: 'conversation', conversation: entry.id } })
        },
      })
    }
    return list
  }, [state, tab, drawerOpen, direction, quest, conversation, dispatch])

  return (
    <div className="app">
      <Toolbar tab={tab} onTab={switchTab} files={files} onCommands={() => setPaletteOpen(true)} />
      <CommandPalette
        open={paletteOpen}
        commands={commands}
        onClose={() => setPaletteOpen(false)}
      />
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
