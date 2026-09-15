/**
 * What the editor says when nothing is loaded: the onboarding screen on the
 * Quests view, and a shorter prompt for a view that has nothing to show.
 */
import { type ReactNode, useState } from 'react'
import { HELP_VIEWS } from '../lib/help'
import { type QuestTemplate, TEMPLATES } from '../lib/templates'

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

const CARDS = HELP_VIEWS.filter((view) => ['quests', 'dialogue', 'play'].includes(view.id))

export function Onboarding({
  onTemplate,
  onOpen,
  onBlank,
}: {
  onTemplate: (template: QuestTemplate) => void
  onOpen: () => void
  onBlank: () => void
}) {
  const [showTemplates, setShowTemplates] = useState(false)

  return (
    <div className="empty onboarding">
      <h2>Open Quest Format editor</h2>
      <p>
        A quest is a graph of steps, the dependencies between them, the outcomes that close it and
        the dialogue that moves it along.
      </p>
      <div className="empty-actions">
        <button
          type="button"
          className="primary"
          aria-expanded={showTemplates}
          onClick={() => setShowTemplates((open) => !open)}
        >
          Start from a template
        </button>
        <button type="button" onClick={onOpen}>
          Open a file
        </button>
        <button type="button" onClick={onBlank}>
          Blank quest
        </button>
      </div>
      {showTemplates ? (
        <ul className="onboarding-templates">
          {TEMPLATES.map((template) => (
            <li key={template.id}>
              <button type="button" onClick={() => onTemplate(template)}>
                <strong>{template.title}</strong>
                <span className="muted">{template.description}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <ul className="onboarding-cards">
        {CARDS.map((card) => (
          <li key={card.id}>
            <strong>{card.id === 'play' ? 'Play' : `${card.title} view`}</strong>
            <span className="muted">{card.text}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
