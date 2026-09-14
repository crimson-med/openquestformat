# Validation

The validator is the reason logic lives in data. It runs on a pack and produces errors (the file is not valid OQF) and warnings (the file is valid but probably wrong).

## Errors

- Parse errors: bad magic, unknown record type, wrong cell count, bad escape, dictionary index out of range.
- Schema errors (JSON form): anything the JSON Schema rejects.
- Duplicate IDs: quest, step, reward, outcome, conversation, node.
- Unknown references: step, reward, quest, outcome, dictionary entry, dialogue node (when the provider is `oqf`).
- Conditions: operator not on the whitelist, malformed expression, variable namespace unknown.
- Cycle without `repeat`: a step can reach itself and is not marked `repeat`.
- Outcome on a step that has outgoing dependencies: an ending must be terminal.
- `lore` node with an effect: a node marked `lore` has `set` or `emit` somewhere in its subtree.
- Extension key not namespaced.

## Warnings

- Unreachable step: no path from any start step reaches it.
- Dead end: a non-ending step that nothing depends on and that has no rewards. Probably missing an outcome or a link.
- No ending reachable: no path from start reaches any outcome. Reported as an error in strict mode.
- Ending reachable only through `var.*`: the validator cannot prove completability because a game-provided variable is on every path. Reported so the author knows the guarantee is weaker.
- Condition always false or always true given the namespaces the validator owns.
- Custom event emitted by two quests without a `shared` mark.
- Unknown extension namespace (strict mode only).
- Mixed literal and keyed text in one pack (strict mode only).
- Reward id reused across steps: allowed, but usually a copy-paste mistake.

## Reachability

Reachability is computed over the step graph, treating each condition as a set of dependencies: the steps, flags and outcomes it reads. `var.*` reads are opaque. A step is reachable if there exists an assignment of the owned namespaces that unlocks it, ignoring `var.*`. This is a conservative analysis: it can say "definitely unreachable" and "reachable unless a game variable blocks it", never "definitely reachable" when `var.*` is involved.

## Output

Human-readable by default, JSON with `--json`, and a non-zero exit code on any error so it runs in CI. The CLI wraps it as `oqf validate <path>`.
