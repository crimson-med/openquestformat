import { describe, expect, it } from 'vitest'
import type { KeyValueStore } from './persist'
import { STRICT_KEY, readStrict, writeStrict } from './strict'

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

describe('strict validation preference', () => {
  it('defaults to off', () => {
    expect(readStrict(memory())).toBe(false)
    expect(readStrict(undefined)).toBe(false)
  })

  it('round trips on and back off', () => {
    const store = memory()
    writeStrict(store, true)
    expect(store.data.get(STRICT_KEY)).toBe('on')
    expect(readStrict(store)).toBe(true)
    writeStrict(store, false)
    expect(store.data.get(STRICT_KEY)).toBe('off')
    expect(readStrict(store)).toBe(false)
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
    expect(readStrict(broken)).toBe(false)
    expect(() => writeStrict(broken, true)).not.toThrow()
  })
})
