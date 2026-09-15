/**
 * The three panes: graph, inspector, drawer. Everything else is a child of one
 * of them. The Strings and Dictionaries views replace the graph and inspector
 * with one full-width pane; the drawer stays. Play mode, on the Quests and
 * Dialogue views, replaces the inspector with the play aside and keeps the graph.
 */
import { ReactFlowProvider } from '@xyflow/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Command } from '../lib/commands'
import { type Direction, browserStore, readDirection, writeDirection } from '../lib/direction'
import { downloadText } from '../lib/download'
import { MIME_TYPES, downloadName, serializeQuests } from '../lib/files'
import { DIALOGUE_LEGEND, QUEST_LEGEND } from '../lib/help'
import { layoutConversation, layoutQuest } from '../lib/layout'
import { TEMPLATES } from '../lib/templates'
import { useDispatch, useEditorState } from '../store/context'
import {
  activeConversationId,
  activeQuestId,
  findConversation,
  findQuest,
} from '../store/selectors'
import { CanvasHead } from './CanvasHead'
import { CommandPalette } from './CommandPalette'
import { ConfirmDialog } from './ConfirmDialog'
import { DialogueGraph } from './DialogueGraph'
import { DictionariesPanel } from './DictionariesPanel'
import { Drawer, type DrawerTab } from './Drawer'
import { EmptyState, Onboarding } from './EmptyState'
import { HelpDialog } from './HelpDialog'
import { Inspector } from './Inspector'
import { PlayAside } from './PlayAside'
import { PlaytestProvider, usePlaytest } from './PlaytestContext'
import { QuestGraph } from './QuestGraph'
import { StringsProvider } from './StringsContext'
import { StringsPanel } from './StringsPanel'
import { type Tab, Toolbar } from './Toolbar'
import { ViewContext } from './ViewContext'
import { useFileActions } from './useFileActions'

const DRAWER_TABS: { tab: DrawerTab; title: string }[] = [
  { tab: 'validation', title: 'Validation' },
  { tab: 'source', title: 'Source' },
]

const VIEWS: { tab: Tab; title: string; keywords: string[] }[] = [
  { tab: 'quests', title: 'Switch to Quests', keywords: ['tab', 'graph'] },
  { tab: 'dialogue', title: 'Switch to Dialogue', keywords: ['tab', 'conversation'] },
  { tab: 'strings', title: 'Switch to Strings', keywords: ['tab', 'translation', 'i18n'] },
  {
    tab: 'dictionaries',
    title: 'Switch to Dictionaries',
    keywords: ['tab', 'actors', 'locations', 'items', 'tags', 'speakers'],
  },
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
  const playtest = usePlaytest()
  const [tab, setTab] = useState<Tab>('quests')
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('validation')
  const [drawerOpen, setDrawerOpen] = useState(true)
  const [playing, setPlaying] = useState(false)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [resetAsked, setResetAsked] = useState(false)
  const [direction, setDirection] = useState<Direction>(() => readDirection(browserStore()))
  const changeDirection = (next: Direction) => {
    setDirection(next)
    writeDirection(browserStore(), next)
  }

  const questId = activeQuestId(state)
  const quest = findQuest(state, questId)
  const conversationId = activeConversationId(state)
  const conversation = findConversation(state, conversationId)

  /** Play mode shows on the Quests view with a quest, on the Dialogue view with a conversation. */
  const canPlay =
    (tab === 'quests' && quest !== undefined) || (tab === 'dialogue' && conversation !== undefined)
  const stopPlaying = playtest.stop
  const leavePlay = () => {
    setPlaying(false)
    stopPlaying()
  }
  /** Entering collapses the drawer; leaving stops the session and leaves the drawer alone. */
  const togglePlay = () => {
    if (playing) {
      leavePlay()
      return
    }
    if (!canPlay) return
    setPlaying(true)
    setDrawerOpen(false)
  }
  // The keydown listener is attached once per document; the ref hands it the current toggle.
  const togglePlayRef = useRef(togglePlay)
  togglePlayRef.current = togglePlay
  const files = useFileActions(setNotice, leavePlay)

  useEffect(() => {
    if (playing && !canPlay) {
      setPlaying(false)
      stopPlaying()
    }
  }, [playing, canPlay, stopPlaying])

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
      if (meta && event.key.toLowerCase() === 'p') {
        event.preventDefault()
        togglePlayRef.current()
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

  /** Lays the open graph out in `next` and remembers the direction. */
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

  const questPicker =
    state.quests.quests.length > 1 ? (
      <select
        className="picker-select canvas-picker"
        aria-label="Quest"
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
    state.dialogues.conversations.length > 1 ? (
      <select
        className="picker-select canvas-picker"
        aria-label="Conversation"
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

  /**
   * Switching to a graph moves the inspector to that graph, so the two never
   * disagree. The Strings and Dictionaries views leave the selection alone and
   * end play mode; the two graph views keep it.
   */
  const switchTab = (next: Tab) => {
    setTab(next)
    if (next === 'strings' || next === 'dictionaries') {
      if (playing) leavePlay()
      return
    }
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

  // The file actions, the layout and the tab switch close over the state, so it stands in for them.
  // biome-ignore lint/correctness/useExhaustiveDependencies: state covers files, layout and switchTab
  const commands = useMemo<Command[]>(() => {
    const list: Command[] = []
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
      ...VIEWS.map(
        (entry): Command => ({
          id: `view/${entry.tab}`,
          title: entry.title,
          group: 'View',
          keywords: entry.keywords,
          run: () => switchTab(entry.tab),
        }),
      ),
    )
    if (playing || canPlay) {
      list.push({
        id: 'view/play',
        title: playing ? 'Stop playing' : tab === 'dialogue' ? 'Play conversation' : 'Play quest',
        group: 'View',
        keywords: ['playtest', 'run', 'runtime'],
        shortcut: '⌘P',
        run: togglePlay,
      })
    }
    list.push(
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
      {
        id: 'view/help',
        title: 'Help',
        group: 'View',
        keywords: ['shortcuts', 'legend', 'views', 'keys'],
        run: () => setHelpOpen(true),
      },
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
        id: 'file/reset',
        title: 'Reset (clears everything)',
        group: 'File',
        keywords: ['clear', 'new', 'empty'],
        run: () => setResetAsked(true),
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
  }, [state, tab, drawerOpen, direction, quest, conversation, dispatch, playing, canPlay])

  const graph =
    tab === 'quests' ? (
      quest === undefined ? (
        <Onboarding
          onTemplate={files.fromTemplate}
          onOpen={() => files.fileInput.current?.click()}
          onBlank={() => dispatch({ type: 'quest/add' })}
        />
      ) : (
        <>
          <CanvasHead
            addLabel="Add step"
            onAdd={() => dispatch({ type: 'step/add', quest: quest.id })}
            onLayout={() => layout(direction)}
            direction={direction}
            onDirection={layout}
            picker={questPicker}
            legend={QUEST_LEGEND}
          />
          <ReactFlowProvider>
            <QuestGraph key={`${quest.id}-${direction}`} quest={quest} direction={direction} />
          </ReactFlowProvider>
        </>
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
      <>
        <CanvasHead
          addLabel="Add node"
          onAdd={() => dispatch({ type: 'node/add', conversation: conversation.id })}
          onLayout={() => layout(direction)}
          direction={direction}
          onDirection={layout}
          picker={conversationPicker}
          legend={DIALOGUE_LEGEND}
        />
        <ReactFlowProvider>
          <DialogueGraph
            key={`${conversation.id}-${direction}`}
            conversation={conversation}
            direction={direction}
          />
        </ReactFlowProvider>
      </>
    )

  return (
    <ViewContext.Provider value={{ tab, setTab: switchTab }}>
      <div className="app">
        <Toolbar
          tab={tab}
          onTab={switchTab}
          files={files}
          onCommands={() => setPaletteOpen(true)}
          onHelp={() => setHelpOpen(true)}
          onReset={() => setResetAsked(true)}
          canPlay={canPlay}
          playing={playing}
          onPlay={togglePlay}
        />
        <CommandPalette
          open={paletteOpen}
          commands={commands}
          onClose={() => setPaletteOpen(false)}
        />
        <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
        <ConfirmDialog
          open={resetAsked}
          title="Clear everything?"
          body="This removes the loaded quests and dialogue. Undo cannot bring them back."
          action="Clear"
          onConfirm={files.reset}
          onClose={() => setResetAsked(false)}
        />
        {notice === undefined ? null : (
          <output className="notice">
            {notice}
            <button type="button" className="ghost" onClick={() => setNotice(undefined)}>
              Dismiss
            </button>
          </output>
        )}
        {tab === 'strings' || tab === 'dictionaries' ? (
          <section className="view">
            {tab === 'strings' ? <StringsPanel /> : <DictionariesPanel onShow={setTab} />}
          </section>
        ) : (
          <main className={playing && canPlay ? 'panes panes-playing' : 'panes'}>
            <section className="canvas">{graph}</section>
            {playing && canPlay ? (
              <aside className="inspector play-aside">
                <PlayAside tab={tab} />
              </aside>
            ) : (
              <aside className="inspector">
                <Inspector />
              </aside>
            )}
          </main>
        )}
        <Drawer tab={drawerTab} onTab={setDrawerTab} open={drawerOpen} onOpen={setDrawerOpen} />
      </div>
    </ViewContext.Provider>
  )
}

/**
 * The panes, inside the language tables the Strings tab and the graphs share
 * and the playtest session play mode, the dialogue play tab and the quest
 * graph share.
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
