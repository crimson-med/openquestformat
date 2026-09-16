/**
 * The bottom drawer: what is wrong and what the file looks like. Collapsible,
 * because the canvas wants the room. Play is not here: it is a mode of the
 * panes that replaces the inspector.
 */
import type { ReactNode } from 'react'
import { browserStore } from '../lib/direction'
import { writeStrict } from '../lib/strict'
import { useDispatch, useEditorState } from '../store/context'
import { countFindings, countStrictOnly } from '../store/findings'
import { FindingList } from './FindingList'
import { SourcePanel } from './SourcePanel'

export type DrawerTab = 'validation' | 'source'

const STRICT_TITLE =
  'Strict adds warnings that need the whole pack to be loaded: flags no reward sets, unknown extension namespaces, mixed keyed and literal text, unbound conversations.'

export function Drawer({
  tab,
  onTab,
  open,
  onOpen,
}: {
  tab: DrawerTab
  onTab: (tab: DrawerTab) => void
  open: boolean
  onOpen: (open: boolean) => void
}) {
  const state = useEditorState()
  const dispatch = useDispatch()
  const counts = countFindings(state.findings)
  const total = counts.errors + counts.warnings
  const strictOnly = state.strict ? countStrictOnly(state.findings) : 0

  const setStrict = (strict: boolean) => {
    dispatch({ type: 'validation/strict', strict })
    writeStrict(browserStore(), strict)
  }

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
        </nav>
        {open && tab === 'validation' ? (
          <label className="strict-toggle" title={STRICT_TITLE}>
            <input
              type="checkbox"
              checked={state.strict}
              onChange={(event) => setStrict(event.target.checked)}
            />
            Strict
          </label>
        ) : null}
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
          {tab === 'validation' ? (
            <>
              {strictOnly > 0 ? (
                <p className="strict-note" title={STRICT_TITLE}>
                  {strictOnly} of {total} {strictOnly === 1 ? 'finding comes' : 'findings come'}{' '}
                  from strict mode.
                </p>
              ) : null}
              <FindingList findings={state.findings} />
            </>
          ) : null}
          {tab === 'source' ? <SourcePanel /> : null}
        </div>
      ) : null}
    </section>
  )
}
