/**
 * The bottom drawer: what is wrong, what the file looks like, and a place to
 * play a conversation. Collapsible, because the canvas wants the room.
 */
import type { ReactNode } from 'react'
import { useEditorState } from '../store/context'
import { countFindings } from '../store/findings'
import { FindingList } from './FindingList'
import { PlayPanel } from './PlayPanel'
import { SourcePanel } from './SourcePanel'
import { StringsPanel } from './StringsPanel'

export type DrawerTab = 'validation' | 'source' | 'play' | 'strings'

export function Drawer({
  tab,
  onTab,
  open,
  onOpen,
  conversation,
}: {
  tab: DrawerTab
  onTab: (tab: DrawerTab) => void
  open: boolean
  onOpen: (open: boolean) => void
  conversation: string | undefined
}) {
  const state = useEditorState()
  const counts = countFindings(state.findings)

  const tabButton = (value: DrawerTab, label: ReactNode) => (
    <button
      type="button"
      className={tab === value && open ? 'tab on' : 'tab'}
      onClick={() => {
        onTab(value)
        onOpen(true)
      }}
    >
      {label}
    </button>
  )

  return (
    <section className={open ? 'drawer open' : 'drawer'}>
      <header className="drawer-head">
        <nav className="tabs">
          {tabButton(
            'validation',
            <>
              Validation
              <span
                className={
                  counts.errors > 0 ? 'pill error' : counts.warnings > 0 ? 'pill warning' : 'pill'
                }
              >
                {counts.errors + counts.warnings}
              </span>
            </>,
          )}
          {tabButton('source', 'Source')}
          {tabButton('play', 'Play')}
          {tabButton('strings', 'Strings')}
        </nav>
        <button type="button" className="ghost" onClick={() => onOpen(!open)}>
          {open ? 'Hide' : 'Show'}
        </button>
      </header>
      {open ? (
        <div className="drawer-body">
          {tab === 'validation' ? <FindingList findings={state.findings} /> : null}
          {tab === 'source' ? <SourcePanel /> : null}
          {tab === 'play' ? <PlayPanel conversation={conversation} /> : null}
          {tab === 'strings' ? <StringsPanel /> : null}
        </div>
      ) : null}
    </section>
  )
}
