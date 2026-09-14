/**
 * Language tables and the preview language, as React context.
 *
 * Tables are editor state, not document state: they never enter the reducer
 * or the undo stack, and they are kept in local storage beside the autosave so
 * a translation in progress survives a reload.
 */
import type { Resolver } from '@oqf/i18n'
import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { browserStore } from '../lib/direction'
import type { KeyValueStore } from '../lib/persist'
import {
  type LanguageTables,
  STRINGS_KEY,
  type StringsState,
  previewResolver,
  restoreStrings,
  serializeStrings,
} from '../lib/strings'

export interface StringsValue extends StringsState {
  setTables: Dispatch<SetStateAction<LanguageTables>>
  setPreview: (language: string | undefined) => void
}

const StringsContext = createContext<StringsValue | null>(null)

function readStrings(store: KeyValueStore | undefined): StringsState {
  try {
    return restoreStrings(store?.getItem(STRINGS_KEY) ?? null) ?? { tables: {}, preview: undefined }
  } catch {
    return { tables: {}, preview: undefined }
  }
}

function writeStrings(store: KeyValueStore | undefined, state: StringsState): void {
  try {
    store?.setItem(STRINGS_KEY, serializeStrings(state))
  } catch {
    // Storage is optional: the tables still work for this session.
  }
}

export function StringsProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(() => readStrings(browserStore()))
  const [tables, setTables] = useState<LanguageTables>(initial.tables)
  const [preview, setPreview] = useState<string | undefined>(initial.preview)

  useEffect(() => {
    writeStrings(browserStore(), { tables, preview })
  }, [tables, preview])

  const value = useMemo<StringsValue>(
    () => ({ tables, preview, setTables, setPreview }),
    [tables, preview],
  )
  return <StringsContext.Provider value={value}>{children}</StringsContext.Provider>
}

export function useStrings(): StringsValue {
  const value = useContext(StringsContext)
  if (value === null) throw new Error('useStrings must be used inside a StringsProvider')
  return value
}

const identity: Resolver = (text) => text

/**
 * A resolver for the preview language. Outside a provider, or with no preview
 * set, every text comes back as it is.
 */
export function useStringResolver(): Resolver {
  const value = useContext(StringsContext)
  const tables = value?.tables
  const preview = value?.preview
  return useMemo(
    () => (tables === undefined ? identity : previewResolver(tables, preview)),
    [tables, preview],
  )
}
