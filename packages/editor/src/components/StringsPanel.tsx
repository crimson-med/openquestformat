/**
 * The Strings view: every player-facing text in the pack beside its
 * translation in the chosen language, with extraction, injection, import,
 * export and a preview switch for the graphs. Fills the main pane.
 */
import { useMemo, useRef, useState } from 'react'
import { downloadText } from '../lib/download'
import {
  TABLE_FORMATS,
  TABLE_MIME_TYPES,
  type TableFormat,
  extractStrings,
  injectStrings,
  isLanguageCode,
  listStrings,
  missingKeys,
  orphanKeys,
  parseTable,
  serializeTable,
  tableDownloadName,
  tableFormatOf,
} from '../lib/strings'
import { useDispatch, useEditorState } from '../store/context'
import { useStrings } from './StringsContext'
import '../styles/strings.css'

const DEFAULT_LANGUAGE = 'en'

function message(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure)
}

export function StringsPanel() {
  const state = useEditorState()
  const dispatch = useDispatch()
  const { tables, preview, setTables, setPreview } = useStrings()
  const [language, setLanguage] = useState(DEFAULT_LANGUAGE)
  const [source, setSource] = useState(DEFAULT_LANGUAGE)
  const [code, setCode] = useState('')
  const [format, setFormat] = useState<TableFormat>('json')
  const [onlyMissing, setOnlyMissing] = useState(false)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const fileInput = useRef<HTMLInputElement>(null)

  const entries = useMemo(
    () => listStrings(state.quests, state.dialogues),
    [state.quests, state.dialogues],
  )
  const languages = useMemo(
    () => [...new Set([...Object.keys(tables), source, language])].sort(),
    [tables, source, language],
  )
  const table = tables[language] ?? {}
  const sourceTable = tables[source] ?? {}
  const missing = missingKeys(entries, table)
  const orphans = orphanKeys(entries, table)
  const literals = entries.filter((item) => !item.isKey).length
  const base = state.quests.quests[0]?.id ?? 'strings'

  const report = (text: string) => {
    setNotice(text)
    setError(undefined)
  }
  const fail = (failure: unknown) => {
    setError(message(failure))
    setNotice(undefined)
  }

  const extract = () => {
    try {
      const result = extractStrings({ quests: state.quests, dialogues: state.dialogues })
      const count = Object.keys(result.table).length
      if (count === 0) {
        report('Nothing to extract: every text is already a key.')
        return
      }
      setTables((current) => ({
        ...current,
        [source]: { ...current[source], ...result.table },
      }))
      dispatch({ type: 'doc/replace', quests: result.quests, dialogues: result.dialogues })
      report(`Extracted ${count} string${count === 1 ? '' : 's'} into ${source}.`)
    } catch (failure) {
      fail(failure)
    }
  }

  const inject = () => {
    try {
      const result = injectStrings({ quests: state.quests, dialogues: state.dialogues }, table)
      dispatch({ type: 'doc/replace', quests: result.quests, dialogues: result.dialogues })
      const kept = missing.length
      report(
        kept === 0
          ? `Injected ${language} texts into the documents.`
          : `Injected ${language} texts. ${kept} key${kept === 1 ? '' : 's'} had no entry and stayed as keys.`,
      )
    } catch (failure) {
      fail(failure)
    }
  }

  const importFile = async (files: FileList | null) => {
    const file = files?.[0]
    if (file === undefined) return
    try {
      const kind = tableFormatOf(file.name)
      if (kind === undefined) {
        throw new Error(`${file.name} is not a table. Expected .json, .csv, .po, .xliff or .xlf.`)
      }
      const parsed = parseTable(await file.text(), kind)
      const count = Object.keys(parsed).length
      setTables((current) => ({ ...current, [language]: { ...current[language], ...parsed } }))
      report(`Imported ${count} entr${count === 1 ? 'y' : 'ies'} into ${language}.`)
    } catch (failure) {
      fail(failure)
    } finally {
      if (fileInput.current !== null) fileInput.current.value = ''
    }
  }

  const exportTable = () => {
    try {
      const name = tableDownloadName(base, language, format)
      downloadText(name, serializeTable(table, format, { language }), TABLE_MIME_TYPES[format])
      report(`Exported ${name}`)
    } catch (failure) {
      fail(failure)
    }
  }

  const addLanguage = () => {
    const next = code.trim()
    if (!isLanguageCode(next)) {
      fail(new Error('Use a language code like fr or pt-BR.'))
      return
    }
    setTables((current) => (current[next] === undefined ? { ...current, [next]: {} } : current))
    setLanguage(next)
    setCode('')
    setError(undefined)
  }

  const setText = (key: string, value: string) => {
    setTables((current) => {
      const next = { ...current[language] }
      if (value === '') delete next[key]
      else next[key] = value
      return { ...current, [language]: next }
    })
  }

  const rows = onlyMissing
    ? entries.filter((item) => item.isKey && table[item.key] === undefined)
    : entries

  return (
    <div className="strings">
      <header className="view-head">
        <h2>Strings</h2>
        <p>
          Every player-facing text in the pack beside its translation. Extract literals to keys,
          fill a language in, and inject it back or export the table.
        </p>
      </header>
      <div className="strings-bar">
        <div className="strings-group">
          <label htmlFor="strings-source">Source</label>
          <select
            id="strings-source"
            className="picker-select"
            value={source}
            onChange={(event) => setSource(event.target.value)}
          >
            {languages.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>
        <div className="strings-group">
          <label htmlFor="strings-language">Language</label>
          <select
            id="strings-language"
            className="picker-select"
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
          >
            {languages.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <input
            className="input code"
            value={code}
            placeholder="fr"
            aria-label="New language code"
            onChange={(event) => setCode(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') addLanguage()
            }}
          />
          <button type="button" className="ghost" onClick={addLanguage}>
            Add
          </button>
        </div>
        <div className="strings-group">
          <button
            type="button"
            onClick={extract}
            disabled={literals === 0}
            title={`Move every literal into the ${source} table and leave keys behind`}
          >
            Extract
          </button>
          <button
            type="button"
            onClick={inject}
            disabled={entries.every((item) => !item.isKey)}
            title={`Write the ${language} texts back over the keys`}
          >
            Inject
          </button>
          <button type="button" onClick={() => fileInput.current?.click()}>
            Import
          </button>
          <input
            ref={fileInput}
            className="file-input"
            type="file"
            accept=".json,.csv,.po,.xliff,.xlf"
            onChange={(event) => {
              void importFile(event.target.files)
            }}
          />
          <div className="segmented">
            {TABLE_FORMATS.map((item) => (
              <button
                key={item}
                type="button"
                className={format === item ? 'on' : ''}
                onClick={() => setFormat(item)}
              >
                {item}
              </button>
            ))}
          </div>
          <button type="button" onClick={exportTable}>
            Export
          </button>
        </div>
        <span className="strings-spacer" />
        <label className="strings-preview">
          <input
            type="checkbox"
            checked={preview === language}
            onChange={(event) => setPreview(event.target.checked ? language : undefined)}
          />
          Preview in {language}
        </label>
      </div>

      {notice === undefined ? null : <p className="note">{notice}</p>}
      {error === undefined ? null : <p className="field-error">{error}</p>}

      <div className={missing.length > 0 ? 'strings-warn has-missing' : 'strings-warn'}>
        <span>
          <span className={missing.length > 0 ? 'pill warning' : 'pill'}>{missing.length}</span>{' '}
          missing in {language}
        </span>
        <span>
          <span className={orphans.length > 0 ? 'pill error' : 'pill'}>{orphans.length}</span>{' '}
          orphan{orphans.length === 1 ? '' : 's'}
        </span>
        <span className="muted">
          {entries.length} text{entries.length === 1 ? '' : 's'}, {literals} literal
          {literals === 1 ? '' : 's'}
        </span>
        <span className="strings-spacer" />
        <label className="strings-filter">
          <input
            type="checkbox"
            checked={onlyMissing}
            onChange={(event) => setOnlyMissing(event.target.checked)}
          />
          Only missing
        </label>
      </div>

      {entries.length === 0 ? (
        <p className="strings-empty muted">Nothing to translate. Open a quest first.</p>
      ) : (
        <div className="strings-table-wrap">
          <table className="strings-table">
            <colgroup>
              <col className="path" />
              <col className="key" />
              <col />
              <col />
            </colgroup>
            <thead>
              <tr>
                <th>Path</th>
                <th>Key</th>
                <th>Source ({source})</th>
                <th>{language}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => {
                const value = table[item.key]
                const sourceText = item.isKey ? sourceTable[item.key] : item.text
                const isMissing = item.isKey && value === undefined
                return (
                  <tr key={item.path} className={isMissing ? 'missing' : ''}>
                    <td className="path">{item.path}</td>
                    <td className="key">{item.key}</td>
                    <td className="text">
                      {sourceText === undefined ? (
                        <span className="muted">no {source} entry</span>
                      ) : (
                        sourceText
                      )}
                    </td>
                    <td>
                      <input
                        className="input"
                        value={value ?? ''}
                        disabled={!item.isKey}
                        placeholder={item.isKey ? '' : 'extract first'}
                        aria-label={`${item.key} in ${language}`}
                        onChange={(event) => setText(item.key, event.target.value)}
                      />
                    </td>
                  </tr>
                )
              })}
              {onlyMissing
                ? null
                : orphans.map((key) => (
                    <tr key={`orphan:${key}`} className="orphan">
                      <td className="path">Not in the pack</td>
                      <td className="key">{key}</td>
                      <td className="text">
                        {sourceTable[key] === undefined ? (
                          <span className="muted">no {source} entry</span>
                        ) : (
                          sourceTable[key]
                        )}
                      </td>
                      <td>
                        <input
                          className="input"
                          value={table[key] ?? ''}
                          aria-label={`${key} in ${language}`}
                          onChange={(event) => setText(key, event.target.value)}
                        />
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
