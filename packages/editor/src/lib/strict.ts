/**
 * Whether the validators run in strict mode.
 *
 * A viewer preference kept in local storage beside the layout direction and the
 * autosave. It changes no document, only which advisory findings the panel
 * shows, so it is never part of the undo stack.
 */
import type { KeyValueStore } from './persist'

export const STRICT_KEY = 'oqf-editor.strict'

export function readStrict(store: KeyValueStore | undefined): boolean {
  try {
    return store?.getItem(STRICT_KEY) === 'on'
  } catch {
    return false
  }
}

export function writeStrict(store: KeyValueStore | undefined, strict: boolean): void {
  try {
    store?.setItem(STRICT_KEY, strict ? 'on' : 'off')
  } catch {
    // Storage is optional: the toggle still works for this session.
  }
}
