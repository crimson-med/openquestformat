# Runtime state

Where a player is in a quest is a document. The runtime reads and writes it; the game persists it. Nothing about how the game saves is specified.

## Shape

```
questState:
  quest:        quest id
  questVersion: content version the state was last reconciled against
  stateVersion: schema version of this document
  status:       unseen | offered | open | closed
  instance:     1 based ordinal of this instance for the quest
  startedAt:    clock value when the instance became open, or null
  outcomeAt:    clock value when the outcome was reached, or null
  params:       map parameter name -> bound value (empty when the quest has none)
  steps:
    <stepId>:
      state:    locked | available | active | done | failed | skipped
      count:    number, objective counter
      failCount: number, fail objective counter
      enteredAt: optional, engine-supplied clock value
  flags:        map flag -> value (quest-scoped flags only)
  outcome:      name or null
  rewards:      list of reward ids already granted
  log:          ordered list of { step, from, to, at }
  ext:          extension bag
```

One document per quest instance. A `repeat` quest that is retaken gets a fresh document; the previous one is kept by the game if it wants history. The fresh document's `instance` is the quest record's `runs` plus one: every earlier instance ended in an outcome (D24), so no separate counter is needed. `params` is filled by the bind hook when the instance is offered and never changes afterwards, so a reload restores the same fish and the same count.

## Clock

`enteredAt`, `startedAt`, `outcomeAt`, `lastOutcomeAt` and `log.at` hold the runtime clock's value. The runtime reads the clock once per input (an event, an offer, an accept, a tick, a load), so everything one input does carries the same instant. The default clock is a counter, which is enough for ordering. When any loaded quest uses `cooldown`, `expire`, `deadline` or `time.*`, the clock must return milliseconds since the epoch, so these fields survive a reload and compare across sessions; the runtime refuses to construct with such a quest on the default clock.

## Quest record

One record per quest id, outliving instances. It is the persistable summary that `runs.*` and `streak.*` read, so a game does not have to keep every past instance to answer "how many times" or "how many days in a row".

```
questRecord:
  quest:         quest id
  runs:          number, outcomes reached across every instance
  outcomes:      map outcome name -> count
  lastOutcome:   name or null
  lastOutcomeAt: clock value or null
  streak:        number
```

The runtime updates it on every outcome, `expired` included: `runs` and the outcome's count go up by one, `lastOutcome` and `lastOutcomeAt` are set. For a quest with a calendar `cooldown`, `streak` is also updated: the period of this outcome is compared with the period of the previous `lastOutcomeAt`; the period right after it adds one, the same period leaves it alone, anything else restarts it at one, and an `expired` outcome sets it to zero. Reading `streak.<questId>` returns the stored value when `lastOutcomeAt` falls in the current or the previous period and zero otherwise, so a missed period breaks a streak without the record having to be touched. The runtime saves and restores records alongside instance documents. The in-memory instance history stays as it is; games may cap or drop it.

World-level state (global flags, outcomes of other quests, `var.*`) is not in this document. The runtime holds a world view it builds from the documents it has loaded plus a resolver the engine provides for `var.*`.

## Deduplication

`rewards` records every reward id granted. A grant whose id is already listed is skipped, unless the step is `repeat`, in which case the runtime clears that step's reward ids on re-entry.

## Trace

`log` is append-only for the life of the document. It is what makes an outcome explainable: walk it backwards and you have the route the player took. Tooling uses it for debugging and for analytics export. Games that do not want the memory cost can set a cap; the runtime then keeps the first entry and the last N.

## ID stability

Step IDs and reward IDs are part of the save contract. Once a quest has shipped:

- Do not rename a step or reward ID. Add a new one and deprecate the old.
- Removing a step is allowed. On load, the runtime marks state for unknown steps as `orphaned` inside `ext` and continues.
- Adding a step is allowed. On load it starts `locked` and its unlock condition is evaluated against current state.
- Changing a condition is allowed. The runtime re-evaluates on load.

When `questVersion` in the document is behind the loaded quest, the runtime runs the reconciliation above and updates the field. A game may register a migration hook per quest to do anything smarter.

## Flexibility

The document is deliberately loose: `ext` on the document and on each step lets a game attach anything (Cozy Coast will put its own timestamps and lobby ids there). The validator checks only the fields above.
