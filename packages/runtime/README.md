# @oqf/runtime

The Open Quest Format runtime: an engine agnostic quest state machine driven by events. One
`emit` in, one `on` out. Runs in the browser and in Node, depends only on `@oqf/core`.

## Usage

```ts
import { QuestRuntime } from '@oqf/runtime'

const runtime = new QuestRuntime({
  documents: [document],                            // parsed with @oqf/core
  resolveVar: (path) => world.read(path),           // serves var.*
  eventMap: { 'fish.caught': 'item.collected' },    // engine names to OQF names
})

const unsubscribe = runtime.on((event) => bus.emit(event.name, event.payload))

runtime.load(savegame.quests)                       // reconciles against the loaded quests
runtime.offer('harbormasters_ledger')               // unseen to offered
runtime.accept('harbormasters_ledger')              // offered to open, steps start
runtime.emit('item.collected', { item: 'fish.rare', amount: 5 })
runtime.emit({ name: 'guard.caught', payload: {} })

savegame.quests = runtime.save()                    // copies, safe to persist
unsubscribe()
```

## Notes

- Register handlers before the first `emit`, `offer`, `accept` or `load`. The constructor
  evaluates nothing, so no event is emitted before the game is listening.
- A quest with an `unlock` condition is offered automatically when it becomes true. A quest
  without one waits for `offer`. Games with no accept step call `accept` immediately.
- A `custom` objective never completes on its own. The engine reports it by emitting
  `quest.<questId>.step.<stepId>.custom` with `{ done: true }`.
- World level state is not in the state documents. Flags the game set through `flag.set`
  events are replayed by the game, not restored by `load`.
- When a `repeat` quest reaches an outcome its document moves to `runtime.history` and a
  fresh one takes its place.
