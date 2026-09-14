# Runtime state

Where a player is in a quest is a document. The runtime reads and writes it; the game persists it. Nothing about how the game saves is specified.

## Shape

```
questState:
  quest:        quest id
  questVersion: content version the state was last reconciled against
  stateVersion: schema version of this document
  status:       unseen | offered | open | closed
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

One document per quest instance. A `repeat` quest that is retaken gets a fresh document; the previous one is kept by the game if it wants history.

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
