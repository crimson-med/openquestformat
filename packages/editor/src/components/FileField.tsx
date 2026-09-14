/**
 * The file a quest or conversation is written to when the pack is exported as
 * files. Free text, with the names already in use offered as suggestions.
 */
import { useId } from 'react'
import { Field } from './fields'

export function FileField({
  what,
  value,
  files,
  onChange,
}: {
  what: 'quest' | 'conversation'
  value: string | undefined
  files: string[]
  onChange: (value: string | undefined) => void
}) {
  const listId = useId()
  return (
    <Field label="File" hint={`Which file this ${what} is written to by Export pack as files.`}>
      <input
        className="input mono"
        list={listId}
        value={value ?? ''}
        placeholder={what === 'quest' ? 'quests.oqf' : 'dialogue.oqd'}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value === '' ? undefined : event.target.value)}
      />
      <datalist id={listId}>
        {files.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
    </Field>
  )
}
