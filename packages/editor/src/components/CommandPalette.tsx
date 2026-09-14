/**
 * The command palette: type, pick, done. Arrow keys move the highlight, Enter
 * runs it, Escape leaves. Focus goes back to wherever it came from.
 */
import { useEffect, useId, useRef, useState } from 'react'
import { type Command, filterCommands } from '../lib/commands'

export function CommandPalette({
  open,
  commands,
  onClose,
}: {
  open: boolean
  commands: readonly Command[]
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const listId = useId()
  const results = filterCommands(commands, query)
  const active = Math.min(highlight, Math.max(results.length - 1, 0))

  // Focus the input on open and hand focus back on close.
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement
    setQuery('')
    setHighlight(0)
    input.current?.focus()
    return () => {
      if (previous instanceof HTMLElement) previous.focus()
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [open, active, listId])

  if (!open) return null

  const run = (command: Command) => {
    onClose()
    command.run()
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlight(results.length === 0 ? 0 : (active + 1) % results.length)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlight(results.length === 0 ? 0 : (active - 1 + results.length) % results.length)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const command = results[active]
      if (command !== undefined) run(command)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  const rows: React.ReactNode[] = []
  let lastGroup: string | undefined
  results.forEach((command, index) => {
    if (command.group !== lastGroup) {
      lastGroup = command.group
      rows.push(
        <div key={`group:${command.group}`} className="palette-group">
          {command.group}
        </div>,
      )
    }
    rows.push(
      <div
        key={command.id}
        id={`${listId}-${index}`}
        className="palette-row"
        // biome-ignore lint/a11y/useSemanticElements: an option of the typed palette above
        role="option"
        aria-selected={index === active}
        tabIndex={-1}
        onMouseEnter={() => setHighlight(index)}
        onMouseDown={(event) => {
          // Keep focus on the input; the click is the pick.
          event.preventDefault()
          run(command)
        }}
      >
        <span className="palette-title">{command.title}</span>
        {command.shortcut === undefined ? null : (
          <span className="palette-key">{command.shortcut}</span>
        )}
      </div>,
    )
  })

  return (
    <div
      className="palette-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      {/* biome-ignore lint/a11y/useSemanticElements: a native dialog would own focus and the backdrop */}
      <div className="palette" role="dialog" aria-modal="true" aria-label="Commands">
        <input
          ref={input}
          className="palette-input"
          type="text"
          placeholder="Type a command"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setHighlight(0)
          }}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={results.length === 0 ? undefined : `${listId}-${active}`}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
        />
        {/* biome-ignore lint/a11y/useSemanticElements: a select cannot follow a typed input */}
        <div className="palette-list" role="listbox" id={listId} tabIndex={-1}>
          {results.length === 0 ? <div className="palette-empty">No matching command.</div> : rows}
        </div>
      </div>
    </div>
  )
}
