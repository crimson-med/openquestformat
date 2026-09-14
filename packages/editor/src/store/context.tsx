/**
 * The store as React context. One reducer, one dispatch, no state library.
 */
import { type Dispatch, type ReactNode, createContext, useContext, useReducer } from 'react'
import type { Action } from './actions'
import { reducer } from './reducer'
import type { EditorState } from './types'

const StateContext = createContext<EditorState | null>(null)
const DispatchContext = createContext<Dispatch<Action> | null>(null)

export function StoreProvider({
  initial,
  children,
}: {
  initial: EditorState
  children: ReactNode
}) {
  const [state, dispatch] = useReducer(reducer, initial)
  return (
    <StateContext.Provider value={state}>
      <DispatchContext.Provider value={dispatch}>{children}</DispatchContext.Provider>
    </StateContext.Provider>
  )
}

export function useEditorState(): EditorState {
  const state = useContext(StateContext)
  if (state === null) throw new Error('useEditorState must be used inside a StoreProvider')
  return state
}

export function useDispatch(): Dispatch<Action> {
  const dispatch = useContext(DispatchContext)
  if (dispatch === null) throw new Error('useDispatch must be used inside a StoreProvider')
  return dispatch
}
