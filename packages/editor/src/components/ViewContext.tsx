/**
 * Which top-level view is showing, for components deep in the inspector that
 * want to send the user somewhere else (a "Manage" link to the dictionaries).
 * Provided by App; outside a provider `setTab` is a no-op.
 */
import { createContext, useContext } from 'react'
import type { Tab } from './Toolbar'

export interface ViewValue {
  tab: Tab
  setTab: (tab: Tab) => void
}

export const ViewContext = createContext<ViewValue>({ tab: 'quests', setTab: () => undefined })

export function useView(): ViewValue {
  return useContext(ViewContext)
}
