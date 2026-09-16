# Open Quest Format

**An open standard for quests. No engine owns your content.**

Define a quest once. Take it anywhere.

> **Status: 0.1.0, first release.** The format is frozen at `OQF1`. The model, the compact and JSON
> formats, the condition language, the validator, the runtime, dialogue with Ink and Yarn Spinner
> interop, i18n, the CLI and the web editor are built and pass their tests. There are **no engine
> exporters yet** (Godot, Unity and Unreal are v1.5) and OQF is **not yet integrated into a shipping
> game**, so "runs in a real engine" is still unproven. Plan and decisions live in
> [docs/](docs/README.md).

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

## Install

```
pnpm add @oqf/core        # the model, the formats, the validator
pnpm add @oqf/runtime     # the state machine, if your game runs TypeScript
pnpm add @oqf/dialogue    # conversations, Ink and Yarn Spinner interop
pnpm add @oqf/i18n        # string extraction and injection
```

The command line needs no install:

```
npx @oqf/cli validate quests/
```

Node 24 or newer, ESM only.

## Quick start

A quest is a file. This one has two steps and one ending. Cells are TAB separated, and the column
order is frozen in [docs/12-compact-spec.md](docs/12-compact-spec.md).

```
OQF1
L	dock|North dock
I	net|Fishing net
Q	lost_net	1				The Lost Net	Maren lost her net on the reef.
R	xp_done	xp	xp	25	returned
S	find_net	s			collect net							Find the net
S	return_net		step.find_net		reach dock		returned|Net returned	0				Bring it back to Maren
```

Check it:

```
$ npx @oqf/cli validate lost-net.oqf
0 errors, 0 warnings
```

Then run it. The runtime takes world events in and gives quest state and events out. It knows
nothing about your engine.

```ts
import { readFileSync } from 'node:fs'
import { parseCompact, validateDocument } from '@oqf/core'
import { QuestRuntime } from '@oqf/runtime'

const doc = parseCompact(readFileSync('lost-net.oqf', 'utf8'))
if (!validateDocument(doc).ok) throw new Error('fix the quest first')

const runtime = new QuestRuntime({ documents: [doc] })
runtime.on((event) => console.log(event.name, event.payload))

runtime.offer('lost_net')
runtime.accept('lost_net')
runtime.emit('item.collected', { item: 'net', amount: 1 })
runtime.emit('location.entered', { location: 'dock' })

saveGame.quests = runtime.save()
```

That prints the step transitions, the granted reward and the outcome:

```
quest.lost_net.offered {}
quest.lost_net.step.find_net.active { from: 'available' }
quest.lost_net.step.find_net.done { from: 'active' }
quest.lost_net.step.return_net.done { from: 'active' }
reward.granted { quest: 'lost_net', step: 'return_net', reward: 'xp_done', kind: 'xp', ref: 'xp', amount: 25 }
quest.lost_net.outcome { name: 'returned', failed: false }
```

## Packages

The spec, the JSON Schema and a reference quest that exercises every feature, plus the packages that
read and write them. Everything converts to or from the model in `@oqf/core`, never around it.

| Package | What it is |
|---------|-----------|
| [`@oqf/core`](packages/core/README.md) | The canonical model, the compact and JSON formats, the condition language, Markdown export, the JSON Schema and the validator. No I/O, no dependencies. |
| [`@oqf/runtime`](packages/runtime/README.md) | An engine-agnostic quest state machine: events in, quest state and events out. Browsers and Node. |
| [`@oqf/dialogue`](packages/dialogue/README.md) | The dialogue model, the bridge any dialogue system implements, a built-in provider, and Ink and Yarn Spinner export and import. |
| [`@oqf/i18n`](packages/i18n/README.md) | Pull inline strings into a translation table and push them back. JSON, CSV, PO and XLIFF. |
| [`@oqf/cli`](packages/cli/README.md) | `oqf validate`, `convert`, `import`, `graph`, `schema`, `extract`, `inject`. |
| [`@oqf/examples`](packages/examples/README.md) | The reference quest, the minimal quest, deliberately broken fixtures and nine single-pattern templates. |
| [`@oqf/editor`](packages/editor/README.md) | The web editor. Part of this repository, not published to npm. |

Package responsibilities are in [docs/09-packages.md](docs/09-packages.md). Phasing is in
[docs/10-roadmap.md](docs/10-roadmap.md).

## The editor

An open source editor that authors OQF natively. The editor should be worth opening even if you
never export OQF. That's the bar.

```
pnpm install
pnpm editor
```

Start from a template or from nothing, manage actors, locations, items and tags, draw steps and
dependencies on the graph, edit every field with suggestions and live parse errors, see validation
on every change with one-click fixes, play the quest through `@oqf/runtime`, localize it in the
Strings view, and export a single file or a multi-file pack. See
[packages/editor/README.md](packages/editor/README.md).

## Versioning and stability

Two version numbers, and they are not the same thing.

- **The format** is `OQF1`, the magic on line 1 of every compact file. It changes only when a file
  written today would stop parsing, which is the thing this project exists to avoid. Compact columns
  are **append only**: new columns go at the end of a record, and existing ones are never reordered
  or removed. The frozen column orders are [docs/12-compact-spec.md](docs/12-compact-spec.md) and
  [docs/13-dialogue-spec.md](docs/13-dialogue-spec.md).
- **The packages** are `0.x` and share one version. The TypeScript API may change between minor
  versions while it settles. Pin a minor range if that matters to you.

Timers, factions, radiant quests and tabletop export are designed to slot into `OQF1` without
breaking v1 files. See the roadmap.

Changes are recorded in [CHANGELOG.md](CHANGELOG.md).

## Not in v1

Timers and time-of-day conditions, faction systems, radiant or templated quests, and tabletop or VTT export are planned for v2. The model is designed so they slot in without breaking v1 files. See the roadmap for details.

Engine exporters come first, in v1.5: Godot, then Unity, then Unreal, each with a loader on the
engine side and one sample project. The first game shipping on OQF will be Cozy Coast, a Phaser 4
and Electron title, with the TypeScript runtime as the day-one loader. That integration has not
happened yet.

## Beyond games

A quest with prerequisites, objectives and rewards is the same object whether an engine runs it or a person does. Tabletop and VTT export is a natural fit and on the roadmap, though games come first.

## Contributing

Bug reports, fixtures that break something, and engine loaders are all welcome. Read
[CONTRIBUTING.md](CONTRIBUTING.md) for how to run the repo, the commit convention, and the one rule
that is not negotiable: every serializer reproduces the fixtures byte for byte.

## License

Apache 2.0. See [LICENSE](LICENSE).
