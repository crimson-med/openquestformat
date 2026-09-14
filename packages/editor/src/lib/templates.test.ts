import { validateDocument } from '@oqf/core'
import { validateDialogue } from '@oqf/dialogue'
import { describe, expect, it } from 'vitest'
import { TEMPLATES, findTemplate, loadTemplate } from './templates'

describe('TEMPLATES', () => {
  it('has unique ids', () => {
    const ids = TEMPLATES.map((template) => template.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it.each(TEMPLATES.map((template) => [template.id, template] as const))(
    '%s loads without validation findings',
    (_id, template) => {
      const { quests, dialogues } = loadTemplate(template)
      expect(quests.quests.length).toBeGreaterThan(0)
      expect(validateDocument(quests).findings).toEqual([])
      expect(validateDialogue([dialogues], { quests: [quests] }).findings).toEqual([])
    },
  )

  it('attaches dialogue only where the template has it', () => {
    const branching = findTemplate('branching')
    const linear = findTemplate('linear')
    expect(branching && loadTemplate(branching).dialogues.conversations.length).toBe(2)
    expect(linear && loadTemplate(linear).dialogues.conversations.length).toBe(0)
  })
})
