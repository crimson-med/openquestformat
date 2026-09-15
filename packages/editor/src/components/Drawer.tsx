/**
 * The bottom drawer: what is wrong, what the file looks like, and a place to
 * play a conversation. Collapsible, because the canvas wants the room. The
 * quest playtest is not here: it is a mode of the panes that replaces the
 * inspector.
 */
import type { ReactNode } from 'react'
import { useEditorState } from '../store/context'
import { countFindings } from '../store/findings'
import { FindingList } from './FindingList'
import { PlayPanel } from './PlayPanel'
import { SourcePanel } from './SourcePanel'

export type DrawerTab = 'validation' | 'source' | 'play'

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
  const total = counts.errors + counts.warnings

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
        {!open && counts.errors > 0 ? (
          <span
            className="drawer-dot"
            title={`${counts.errors} error${counts.errors === 1 ? '' : 's'}`}
          />
        ) : null}
        <nav className="tabs" aria-label="Drawer panels">
          {tabButton(
            'validation',
            <>
              Validation
              <span
                className={
                  counts.errors > 0 ? 'pill error' : counts.warnings > 0 ? 'pill warning' : 'pill'
                }
                title={`${counts.errors} error${counts.errors === 1 ? '' : 's'}, ${counts.warnings} warning${counts.warnings === 1 ? '' : 's'}`}
              >
                {total}
              </span>
            </>,
          )}
          {tabButton('source', 'Source')}
          {tabButton('play', 'Dialogue play')}
        </nav>
        <button
          type="button"
          className="ghost"
          onClick={() => onOpen(!open)}
          title={open ? 'Hide the drawer' : 'Show the drawer'}
        >
          {open ? 'Hide' : 'Show'}
        </button>
      </header>
      {open ? (
        <div className="drawer-body">
          {tab === 'validation' ? <FindingList findings={state.findings} /> : null}
          {tab === 'source' ? <SourcePanel /> : null}
          {tab === 'play' ? <PlayPanel conversation={conversation} /> : null}
        </div>
      ) : null}
    </section>
  )
}
