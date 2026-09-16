/** The document store: state shape, actions, reducer, selectors, findings. */
export type { Action, DictionaryKind, FieldPatch } from './actions'
export { isMutating } from './actions'
export { StoreProvider, useDispatch, useEditorState } from './context'
export type { EditorFinding, FindingOptions } from './findings'
export { STRICT_ONLY_CODES, computeFindings, countFindings, countStrictOnly } from './findings'
export {
  createState,
  initialState,
  newConversation,
  newNode,
  newQuest,
  newReward,
  newStep,
  reducer,
  uniqueId,
} from './reducer'
export * from './patch'
export * from './selectors'
export type { EditorDocument, EditorState, Selection } from './types'
export { HISTORY_LIMIT, NO_SELECTION } from './types'
