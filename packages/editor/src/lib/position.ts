/**
 * Graph positions stored on the entity itself.
 *
 * A node's canvas position is written to the extension bag under
 * `x-editor.pos` as a flat map, which both formats already round-trip: the
 * compact writer renders it as `x=120;y=40` and the JSON writer as an object.
 * Nothing outside the editor reads it.
 */
import type { Ext } from '@oqf/core'

export const POSITION_KEY = 'x-editor.pos'

export interface Position {
  x: number
  y: number
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string') return undefined
  const parsed = Number(value.trim())
  return value.trim() === '' || Number.isNaN(parsed) ? undefined : parsed
}

/** Parse the `x=120;y=40` spelling a hand-written file may carry. */
function fromText(text: string): Position | undefined {
  let x: number | undefined
  let y: number | undefined
  for (const part of text.split(';')) {
    const equals = part.indexOf('=')
    if (equals === -1) continue
    const key = part.slice(0, equals).trim()
    const value = toNumber(part.slice(equals + 1))
    if (key === 'x') x = value
    if (key === 'y') y = value
  }
  return x === undefined || y === undefined ? undefined : { x, y }
}

/** The stored position, or undefined when the entity has never been placed. */
export function readPosition(ext: Ext | undefined): Position | undefined {
  const value = ext?.[POSITION_KEY]
  if (value === undefined) return undefined
  if (typeof value === 'string') return fromText(value)
  if (typeof value !== 'object') return undefined
  const x = toNumber(value.x)
  const y = toNumber(value.y)
  return x === undefined || y === undefined ? undefined : { x, y }
}

/** The extension bag with the position replaced. Coordinates are rounded. */
export function writePosition(ext: Ext | undefined, position: Position): Ext {
  return {
    ...(ext ?? {}),
    [POSITION_KEY]: { x: Math.round(position.x), y: Math.round(position.y) },
  }
}

/** The extension bag without a position, dropped entirely when it held nothing else. */
export function clearPosition(ext: Ext | undefined): Ext | undefined {
  if (ext === undefined) return undefined
  const next = { ...ext }
  delete next[POSITION_KEY]
  return Object.keys(next).length === 0 ? undefined : next
}

/** The `x=120;y=40` spelling, for tests and for showing the value in the inspector. */
export function formatPosition(position: Position): string {
  return `x=${Math.round(position.x)};y=${Math.round(position.y)}`
}
