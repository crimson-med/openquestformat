import { describe, expect, it } from 'vitest'
import { sampleDialogues, sampleQuests } from '../store/fixtures'
import {
  type KeyValueStore,
  STORAGE_KEY,
  clearState,
  loadState,
  restoreState,
  saveState,
  serializeState,
} from './persist'

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
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

const state = {
  quests: sampleQuests(),
  dialogues: sampleDialogues(),
  selection: { kind: 'quest', quest: 'ledger' } as const,
}

describe('persistence', () => {
  it('saves and restores the documents and the selection', () => {
    const store = memoryStore()
    expect(saveState(store, state)).toBe(true)
    expect(store.data.has(STORAGE_KEY)).toBe(true)
    const restored = loadState(store)
    expect(restored?.quests.quests[0].id).toBe('ledger')
    expect(restored?.dialogues.conversations[0].id).toBe('ines_intro')
    expect(restored?.selection).toEqual({ kind: 'quest', quest: 'ledger' })
  })

  it('treats anything unrecognizable as no save', () => {
    expect(restoreState(null)).toBeUndefined()
    expect(restoreState('')).toBeUndefined()
    expect(restoreState('{ not json')).toBeUndefined()
    expect(restoreState('{"version":1}')).toBeUndefined()
    expect(
      restoreState(JSON.stringify({ quests: { quests: [], dictionaries: {} } })),
    ).toBeUndefined()
  })

  it('defaults a missing selection to nothing selected', () => {
    const text = serializeState({ ...state, selection: undefined as never })
    expect(restoreState(text)?.selection).toEqual({ kind: 'none' })
  })

  it('survives a storage that refuses to write', () => {
    const broken: KeyValueStore = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('full')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    }
    expect(saveState(broken, state)).toBe(false)
    expect(loadState(broken)).toBeUndefined()
    expect(() => clearState(broken)).not.toThrow()
  })

  it('clears the save', () => {
    const store = memoryStore()
    saveState(store, state)
    clearState(store)
    expect(loadState(store)).toBeUndefined()
  })
})
