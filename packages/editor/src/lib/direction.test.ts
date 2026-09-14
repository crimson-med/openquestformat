import { describe, expect, it } from 'vitest'
import { DIRECTION_KEY, readDirection, writeDirection } from './direction'
import type { KeyValueStore } from './persist'

function memory(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value)
    },
    removeItem: (key) => {
      data.delete(key)
    },
  }
}

describe('layout direction preference', () => {
  it('defaults to top to bottom', () => {
    expect(readDirection(memory())).toBe('TB')
    expect(readDirection(undefined)).toBe('TB')
  })

  it('round trips left to right', () => {
    const store = memory()
    writeDirection(store, 'LR')
    expect(store.data.get(DIRECTION_KEY)).toBe('LR')
    expect(readDirection(store)).toBe('LR')
  })

  it('survives a store that throws', () => {
    const broken: KeyValueStore = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {},
    }
    expect(readDirection(broken)).toBe('TB')
    expect(() => writeDirection(broken, 'LR')).not.toThrow()
  })
})
