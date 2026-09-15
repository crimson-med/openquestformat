/** A question with a Cancel and a danger button. */
import { Modal } from './Modal'

export function ConfirmDialog({
  open,
  title,
  body,
  action,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  body: string
  /** The danger button's label. */
  action: string
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Modal open={open} title={title} onClose={onClose}>
      <div className="modal-body">
        <p>{body}</p>
      </div>
      <footer className="modal-actions">
        <button type="button" onClick={onClose} data-autofocus>
          Cancel
        </button>
        <button
          type="button"
          className="danger"
          onClick={() => {
            onClose()
            onConfirm()
          }}
        >
          {action}
        </button>
      </footer>
    </Modal>
  )
}
