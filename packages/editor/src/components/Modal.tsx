/**
 * A small in-app dialog on the command palette's overlay. Escape and a click on
 * the backdrop close it; focus goes to the first control and back on close.
 */
import { type ReactNode, useEffect, useRef } from 'react'

export function Modal({
  open,
  title,
  onClose,
  wide,
  children,
}: {
  open: boolean
  title: string
  onClose: () => void
  /** A wider box, for reading rather than for a question. */
  wide?: boolean
  children: ReactNode
}) {
  const box = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement
    const first = box.current?.querySelector<HTMLElement>('[data-autofocus], button, input')
    first?.focus()
    return () => {
      if (previous instanceof HTMLElement) previous.focus()
    }
  }, [open])

  if (!open) return null

  return (
    <div
      className="palette-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          onClose()
        }
      }}
    >
      {/* Open but not showModal(): the backdrop above owns the overlay and the close. */}
      <dialog
        ref={box}
        open
        className={wide === true ? 'palette modal wide' : 'palette modal'}
        aria-modal="true"
        aria-label={title}
      >
        <header className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="ghost icon-button" title="Close" onClick={onClose}>
            ×
          </button>
        </header>
        {children}
      </dialog>
    </div>
  )
}
