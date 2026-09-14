/** What the editor says when nothing is loaded. */
import type { ReactNode } from 'react'

export function EmptyState({
  title,
  body,
  actions,
}: {
  title: string
  body: string
  actions: ReactNode
}) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      <p>{body}</p>
      <div className="empty-actions">{actions}</div>
    </div>
  )
}
