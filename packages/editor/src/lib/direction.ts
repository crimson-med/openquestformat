/**
 * Which way auto layout runs, top to bottom or left to right.
 *
 * A viewer preference kept in local storage beside the autosave. The positions
 * a layout produces are written to the file as usual; only the choice of
 * direction stays in the browser.
 */
import type { KeyValueStore } from './persist'

export type Direction = 'TB' | 'LR'

export const DIRECTION_KEY = 'oqf-editor.direction'

/** Local storage when the browser allows it. Private windows can throw on access. */
export function browserStore(): KeyValueStore | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    return undefined
  }
}

export function readDirection(store: KeyValueStore | undefined): Direction {
  try {
    return store?.getItem(DIRECTION_KEY) === 'LR' ? 'LR' : 'TB'
  } catch {
    return 'TB'
  }
}

export function writeDirection(store: KeyValueStore | undefined, direction: Direction): void {
  try {
    store?.setItem(DIRECTION_KEY, direction)
  } catch {
    // Storage is optional: the toggle still works for this session.
  }
}
