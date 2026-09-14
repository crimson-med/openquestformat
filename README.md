# Open Quest Format

**An open standard for quests. No engine owns your content.**

Define a quest once. Take it anywhere.

> Status: early. The core model, compact and JSON formats, validator, runtime and CLI exist and pass their tests. Dialogue, i18n, the editor and engine exporters are not started. Plan and decisions live in [docs/](docs/README.md).

## You don't own your quest data

Pick a quest plugin and you've picked a wall. The Unity asset works in Unity. The Unreal data table works in Unreal. Switch engines, switch plugins, or watch the one you bought go unmaintained, and your quests are trapped in someone else's format with no way out.

This is worse for indies than anyone. You're the one most likely to change engines mid-project, prototype in one thing and ship in another, or lose a year of content because a $40 asset got abandoned.

There is no neutral ground to stand on. Every option is somebody's product.

## What an open standard actually buys you

OQF is a published spec, not a plugin. Apache-licensed, versioned, with a reference parser, validator and runtime. Anyone can implement it. Nobody can deprecate it out from under you.

Your quests become plain files in your repo. Diffable in git. Readable without opening an editor. Portable to any engine that has a loader, and the loader is a few hundred lines because the format is simple on purpose.

If this project disappeared tomorrow, your content would still work. That's the whole point.

## What a quest is

OQF models the things every quest system from Skyrim to Baldur's Gate 3 has in common, and leaves the rest to the engine.

- **Steps in a graph.** A quest is a flat list of steps linked by ID. Each step has three data-driven transitions: what unlocks it, what completes it, what fails it. Several steps can be active at once. Two routes can reach the same step (kill the guard or pick the lock, either way you have the key). Steps nothing depends on are optional.
- **Objectives as events.** A step completes when the world reports something: an enemy killed, an item collected, a place reached, a dialogue choice made. Common objective kinds are shorthand for event counters. Anything the engine can emit can drive a step.
- **Conditions as data.** Unlock, complete and fail rules are written in a small, non-Turing-complete condition language with existing parsers in every major language. No embedded scripts. Tooling can prove a quest is completable, find the step nothing leads to, and diff two versions.
- **Rewards, per step and per ending.** Items, currency, experience, reputation, unlocks, flags, or a custom event. Every grant emits an event, so an engine can credit it, log it, or turn it into an achievement with one listener.
- **Multiple endings.** A terminal step carries a named outcome. Outcomes become world flags other quests can gate on. Failures are outcomes too.
- **Events in and out.** Quests consume world events to advance and emit their own as they move. Rewards, step completion and outcomes all go out through the same channel.
- **Dialogue as a sibling.** Lore conversations, branching choices and quest-affecting lines live in a separate dialogue model. A quest only binds to a dialogue node by reference and listens for the flags and events it sets. Bring your own dialogue system (Ink, Yarn Spinner) or use the one OQF ships; conversion between them is part of the toolset.
- **Runtime state as a document.** Where a player is in a quest is a small, versioned state document. Save it however your game saves things.

The full model is in [docs/01-model.md](docs/01-model.md).

## One model, many formats

Every parser produces the same canonical quest model. Every serializer consumes it. Emit compact OQF, JSON, Markdown, or an engine-specific bundle. Export dialogue to Ink or Yarn Spinner, or import from them.

Import works the same way in reverse. Bring existing quest data in, take something else out. Adopting OQF doesn't mean abandoning your current pipeline, it means putting a neutral layer in the middle of it.

## Compact on purpose

The native serialization is line-oriented and interned. Repeated actors, locations, items and tags are declared once and referenced by index. One leading character per line carries the structure. No closing braces, no repeated keys, no quoting tax. Conditions are one cell of infix text, so nothing nests.

It streams in one pass, reads cleanly in a diff, and costs a fraction of the tokens the equivalent JSON would when you hand a questline to a model. If you're using AI to help write or check content, that's the difference between fitting one quest in context and fitting the whole act.

JSON is a first-class output with a published schema and a shipped validator. Use the compact form or don't.

## What ships

- The spec, the JSON Schema, and a reference quest that exercises every feature.
- `@oqf/core`: model, parsers, serializers, validator.
- `@oqf/runtime`: a TypeScript state machine that takes world events in and gives quest state and events out. Engine-agnostic.
- `@oqf/dialogue`: the dialogue model, the bridge interface any dialogue system implements, and Ink and Yarn Spinner exporters.
- `@oqf/cli`: validate, convert, graph, diff, extract strings.
- `@oqf/i18n`: pull inline strings into a translation table and push them back.
- An open source editor that authors OQF natively. The editor should be worth opening even if you never export OQF. That's the bar.

The first game shipping on it is Cozy Coast, a Phaser 4 and Electron title. The TypeScript runtime is the day-one loader; Godot, Unity and Unreal exporters follow.

Package layout is in [docs/09-packages.md](docs/09-packages.md). Phasing is in [docs/10-roadmap.md](docs/10-roadmap.md).

## Not in v1

Timers and time-of-day conditions, faction systems, radiant or templated quests, and tabletop or VTT export are planned for v2. The model is designed so they slot in without breaking v1 files. See the roadmap for details.

## Beyond games

A quest with prerequisites, objectives and rewards is the same object whether an engine runs it or a person does. Tabletop and VTT export is a natural fit and on the roadmap, though games come first.

## License

Apache 2.0.
