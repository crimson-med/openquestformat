/**
 * The Dictionaries view: the actors, locations, items, tags and speakers a
 * pack declares, with where each one is used. Renames go through the store so
 * every usage follows; removes are refused while anything still points at the
 * entry.
 */
import type { Ref } from '@oqf/core'
import { type FormEvent, useEffect, useState } from 'react'
import {
  ENTRY_KINDS,
  ENTRY_NOUN,
  type EntryKind,
  type Usage,
  entriesOf,
  entryIdError,
  usagesOf,
} from '../lib/dictionaries'
import { useDispatch, useEditorState } from '../store/context'
import type { Selection } from '../store/types'
import type { Tab } from './Toolbar'
import '../styles/dictionaries.css'

const KIND_TITLES: Record<EntryKind, string> = {
  actors: 'Actors',
  locations: 'Locations',
  items: 'Items',
  tags: 'Tags',
  speakers: 'Speakers',
}

/** Where a usage lives and what to select to get there. */
function usageTarget(usage: Usage): { tab: Tab; selection: Selection; label: string } {
  if (usage.conversation !== undefined) {
    const selection: Selection =
      usage.node === undefined
        ? { kind: 'conversation', conversation: usage.conversation }
        : { kind: 'node', conversation: usage.conversation, node: usage.node }
    const where =
      usage.node === undefined ? usage.conversation : `${usage.conversation} / ${usage.node}`
    return { tab: 'dialogue', selection, label: where }
  }
  const quest = usage.quest ?? ''
  if (usage.step !== undefined) {
    return {
      tab: 'quests',
      selection: { kind: 'step', quest, step: usage.step },
      label: `${quest} / ${usage.step}`,
    }
  }
  if (usage.reward !== undefined) {
    return {
      tab: 'quests',
      selection: { kind: 'reward', quest, reward: usage.reward },
      label: `${quest} / reward ${usage.reward}`,
    }
  }
  return { tab: 'quests', selection: { kind: 'quest', quest }, label: quest }
}

/** A cell edited in place: drafts locally, commits on blur or Enter, reverts on Escape. */
function EditableCell({
  value,
  mono,
  placeholder,
  ariaLabel,
  validate,
  onCommit,
}: {
  value: string
  mono?: boolean
  placeholder?: string
  ariaLabel: string
  validate?: (draft: string) => string | undefined
  onCommit: (draft: string) => void
}) {
  const [draft, setDraft] = useState(value)
  const [error, setError] = useState<string | undefined>(undefined)

  useEffect(() => {
    setDraft(value)
    setError(undefined)
  }, [value])

  const commit = () => {
    const next = draft.trim()
    if (next === value) {
      setDraft(value)
      setError(undefined)
      return
    }
    const problem = validate?.(next)
    if (problem !== undefined) {
      setError(problem)
      return
    }
    setError(undefined)
    onCommit(next)
  }

  return (
    <div className="dict-cell">
      <input
        className={mono === true ? 'input mono' : 'input'}
        value={draft}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-invalid={error !== undefined}
        spellCheck={false}
        onChange={(event) => {
          setDraft(event.target.value)
          setError(validate?.(event.target.value.trim()))
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            setDraft(value)
            setError(undefined)
            event.currentTarget.blur()
          }
        }}
      />
      {error === undefined ? null : <span className="field-error">{error}</span>}
    </div>
  )
}

function EntryRow({
  kind,
  entry,
  refs,
  usages,
  expanded,
  onToggle,
  onShow,
}: {
  kind: EntryKind
  entry: Ref
  refs: Ref[]
  usages: Usage[]
  expanded: boolean
  onToggle: () => void
  onShow: (tab: Tab) => void
}) {
  const dispatch = useDispatch()
  const count = usages.length
  const places = `${count} place${count === 1 ? '' : 's'}`

  return (
    <>
      <tr className={count === 0 ? 'unused' : ''}>
        <td className="id">
          <EditableCell
            value={entry.id}
            mono
            ariaLabel={`Id of ${entry.id}`}
            validate={(draft) => entryIdError(refs, draft, entry.id)}
            onCommit={(to) => dispatch({ type: 'dict/rename', kind, id: entry.id, to })}
          />
        </td>
        <td className="name">
          <EditableCell
            value={entry.name ?? ''}
            placeholder="Display name"
            ariaLabel={`Display name of ${entry.id}`}
            onCommit={(name) =>
              dispatch({ type: 'dict/rename', kind, id: entry.id, to: entry.id, name })
            }
          />
        </td>
        <td className="usage">
          {count === 0 ? (
            <span className="pill">unused</span>
          ) : (
            <button
              type="button"
              className="ghost dict-usage-toggle"
              aria-expanded={expanded}
              onClick={onToggle}
            >
              {expanded ? 'Hide' : 'Used by'} {places}
            </button>
          )}
        </td>
        <td className="actions">
          <button
            type="button"
            className="icon danger"
            disabled={count > 0}
            title={count > 0 ? `Used by ${places}` : `Remove ${ENTRY_NOUN[kind]} ${entry.id}`}
            onClick={() => dispatch({ type: 'dict/remove', kind, id: entry.id })}
          >
            remove
          </button>
        </td>
      </tr>
      {expanded && count > 0 ? (
        <tr className="dict-usages">
          <td colSpan={4}>
            <ul className="row-list">
              {usages.map((usage, index) => {
                const target = usageTarget(usage)
                return (
                  <li key={`${target.label}:${usage.field}:${index}`}>
                    <button
                      type="button"
                      className="row-main"
                      onClick={() => {
                        dispatch({ type: 'select', selection: target.selection })
                        onShow(target.tab)
                      }}
                    >
                      <span className="row-title">{target.label}</span>
                      <span className="row-id mono">{usage.field}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </td>
        </tr>
      ) : null}
    </>
  )
}

export function DictionariesPanel({ onShow }: { onShow: (tab: Tab) => void }) {
  const state = useEditorState()
  const dispatch = useDispatch()
  const [kind, setKind] = useState<EntryKind>('actors')
  const [newId, setNewId] = useState('')
  const [newName, setNewName] = useState('')
  const [addError, setAddError] = useState<string | undefined>(undefined)
  const [expanded, setExpanded] = useState<string | undefined>(undefined)

  const refs = entriesOf(state, kind)
  const actors = state.quests.dictionaries.actors
  const speakers = state.dialogues.speakers
  const missingSpeakers = actors.filter((ref) => !speakers.some((other) => other.id === ref.id))
  const missingActors = speakers.filter((ref) => !actors.some((other) => other.id === ref.id))

  const add = (event: FormEvent) => {
    event.preventDefault()
    const id = newId.trim()
    const problem = entryIdError(refs, id)
    if (problem !== undefined) {
      setAddError(problem)
      return
    }
    dispatch({ type: 'dict/add', kind, id, name: newName.trim() })
    setNewId('')
    setNewName('')
    setAddError(undefined)
  }

  return (
    <div className="dictionaries">
      <header className="view-head">
        <h2>Dictionaries</h2>
        <p>
          The actors, locations, items, tags and speakers the pack declares, with where each one is
          used. A rename follows every usage.
        </p>
      </header>
      <div className="dict-bar">
        <div className="segmented dict-kinds" role="tablist" aria-label="Dictionary">
          {ENTRY_KINDS.map((entry) => (
            <button
              key={entry}
              type="button"
              role="tab"
              aria-selected={kind === entry}
              className={kind === entry ? 'on' : ''}
              onClick={() => {
                setKind(entry)
                setExpanded(undefined)
                setAddError(undefined)
              }}
            >
              {KIND_TITLES[entry]}
              <span className="pill">{entriesOf(state, entry).length}</span>
            </button>
          ))}
        </div>
        <span className="dict-spacer" />
        <button
          type="button"
          disabled={missingSpeakers.length === 0}
          title={
            missingSpeakers.length === 0
              ? 'Every actor is already a speaker'
              : `Add ${missingSpeakers.map((ref) => ref.id).join(', ')} to the speakers`
          }
          onClick={() =>
            dispatch({ type: 'speakers/set', speakers: [...speakers, ...missingSpeakers] })
          }
        >
          Copy actors to speakers
        </button>
        <button
          type="button"
          disabled={missingActors.length === 0}
          title={
            missingActors.length === 0
              ? 'Every speaker is already an actor'
              : `Add ${missingActors.map((ref) => ref.id).join(', ')} to the actors`
          }
          onClick={() =>
            dispatch({ type: 'dict/set', kind: 'actors', refs: [...actors, ...missingActors] })
          }
        >
          Copy speakers to actors
        </button>
      </div>

      <form className="dict-add" onSubmit={add}>
        <input
          className="input mono"
          value={newId}
          placeholder={`New ${ENTRY_NOUN[kind]} id`}
          aria-label={`New ${ENTRY_NOUN[kind]} id`}
          spellCheck={false}
          onChange={(event) => {
            setNewId(event.target.value)
            setAddError(undefined)
          }}
        />
        <input
          className="input"
          value={newName}
          placeholder="Display name (optional)"
          aria-label="Display name"
          onChange={(event) => setNewName(event.target.value)}
        />
        <button type="submit" className="primary">
          Add {ENTRY_NOUN[kind]}
        </button>
        {addError === undefined ? null : <span className="field-error">{addError}</span>}
      </form>

      {refs.length === 0 ? (
        <p className="dict-empty muted">
          No {kind} declared yet. Add one above
          {kind === 'actors' || kind === 'items' || kind === 'locations'
            ? ', or type a new id in a step objective and pick "Create".'
            : '.'}
        </p>
      ) : (
        <div className="dict-table-wrap">
          <table className="dict-table">
            <colgroup>
              <col className="id" />
              <col className="name" />
              <col className="usage" />
              <col className="actions" />
            </colgroup>
            <thead>
              <tr>
                <th>Id</th>
                <th>Display name</th>
                <th>Usage</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {refs.map((entry) => (
                <EntryRow
                  key={entry.id}
                  kind={kind}
                  entry={entry}
                  refs={refs}
                  usages={usagesOf(state, kind, entry.id)}
                  expanded={expanded === entry.id}
                  onToggle={() => setExpanded(expanded === entry.id ? undefined : entry.id)}
                  onShow={onShow}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
