# Events

Events are the only way the world talks to a quest and the only way a quest talks back. An event is a name plus a flat payload.

```
name:    dotted string, lowercase, e.g. item.collected
payload: map of string -> string | number | boolean
```

## Consumed events

The runtime accepts any event. A step reacts only if its objective or a condition references it. The objective sugar listens to these names by default:

| Event | Expected payload | Used by |
|-------|------------------|---------|
| `actor.killed` | `actor` | `kill` |
| `item.collected` | `item`, `amount` (default 1) | `collect` |
| `location.entered` | `location` | `reach` |
| `dialogue.ended` | `actor`, `node` | `talk` |
| `object.interacted` | `object` | `interact` |
| `flag.set` | `flag`, `value` | any condition reading `flag.*` |

Engines with their own vocabulary map names once when they construct the runtime. Cozy Coast, for example, maps its `fish.caught` to `item.collected` with `item` set to the species id.

`event <name> [n]` objectives listen to any name literally. This is the escape hatch: if the game emits `boss.phase2.started`, a step can complete on it without OQF knowing what it means.

## Emitted events

| Event | Payload | When |
|-------|---------|------|
| `quest.<questId>.offered` | | Quest unlock condition became true. |
| `quest.<questId>.step.<stepId>.<state>` | `from` | Any step transition. `<state>` is the new state. |
| `quest.<questId>.outcome` | `name`, `failed` | An ending step was reached. |
| `reward.granted` | `quest`, `step`, `reward`, `kind`, `ref`, `amount`, plus the reward payload | A reward was granted. |
| `flag.set` | `flag`, `value`, `quest` | A `flag` reward fired. Also consumed, so other quests see it. |
| `<custom>` | reward payload | A reward of kind `event` fired. |

Emitted names are prefixed by the quest ID so two quests never collide. Custom events are the author's responsibility; the validator warns if two quests emit the same custom name unless it is marked shared.

## Delivery

The runtime exposes a single `emit(event)` input and a single `on(handler)` output. Order is preserved. Events emitted while processing an input are delivered after that input finishes, so a quest never observes its own half-applied transition.

Engines wire this to whatever they have: a Phaser event emitter, a Godot signal bus, a Unity ScriptableObject event channel. The runtime does not care.
