# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Every package in the workspace shares one version number, the editor included: it publishes as
both a command (`npx @oqf/editor`) and an embeddable React component.

The file format carries its own major version, `OQF1`, which is independent of these package
versions. Compact columns are append only, so a file written against `OQF1` keeps parsing.

## [Unreleased]

## [0.2.0] - 2026-10-15

Recurrence. The format is still `OQF1`: the new compact columns are appended and the `P` record
is new, so every 0.1.0 file parses, validates and round-trips unchanged. Runtime state documents
move to version 2 and version 1 documents still load.

### Added

**The project**

- The v0.2 recurrence spec: `cooldown` and `expire` on quests, `deadline` on steps, templated
  quests with parameters bound by the engine, text arguments, a calendar-aware clock, the quest
  record, and the `param`, `time`, `runs` and `streak` condition namespaces. Proposed in
  `docs/14-recurrence.md`, decided as D24 to D30 and folded into the model, condition, state,
  i18n, validation and compact format docs. Every v0.1 file stays valid; compact columns are
  appended only.

**`@oqf/core`**

- `cooldown`, `expire` and `params` on quests, `deadline` on steps, the reserved `expired`
  outcome, `$name` parameter references in objectives and conditions, the `param`, `time`, `runs`
  and `streak` namespaces, duration parsing and the canonical duration spelling, the `P` record
  and the appended compact columns, the JSON fields and schema entries, the markdown export, and
  eleven validation rules with a broken fixture each.

**`@oqf/runtime`**

- A calendar (`timeZone`, `weekStart`, `dayStartsAt`), `tick()`, cooldown gating with the
  clock-jump guard, expiry to the `expired` outcome, step deadlines, a `bind` hook for templated
  quests, `textArgs()`, quest records with `saveRecords()` and `load(states, records)`, and state
  document version 2 (`instance`, `startedAt`, `outcomeAt`, `params`). The clock is read once per
  input, and a quest that uses any timing feature refuses the default counter clock.

**`@oqf/i18n`**

- Resolvers take text arguments and fill `{name}` placeholders; `formatText` and
  `textPlaceholders` are exported. Placeholders pass through extraction and injection untouched.

**`@oqf/editor`**

- Inspector fields for cooldown, expire, deadline and parameters; the playtest runs on the wall
  clock and binds parameters from the dictionaries.

**`@oqf/examples`**

- Four templates: `daily`, `weekly`, `deadline` and `templated`, each with dialogue.

## [0.1.0] - 2026-09-16

First release. The format is frozen at `OQF1`, the packages are 0.x while the API settles.

### Added

**`@oqf/core`**

- The canonical quest model: quests, steps, the `unlock`, `activate`, `complete` and `fail`
  transitions, objectives, rewards, outcomes, dictionaries of actors, locations, items and tags, and
  `x-<namespace>.<key>` extension keys that are preserved and never read.
- The condition language: a non-Turing-complete infix authoring form over a fixed operator
  whitelist, stored as a JSON Logic subset, with a parser, a canonical printer and an evaluator that
  takes a resolver for the `flag`, `count`, `step`, `outcome`, `quest` and `var` namespaces.
- The compact `.oqf` format, line oriented and interned, with the column order frozen in
  `docs/12-compact-spec.md`, and the JSON format, both parsing to the identical model and both
  reproducing their input byte for byte after normalization.
- Markdown export, read only.
- A JSON Schema (draft 2020-12) for the JSON form, exported as a value and as text.
- The validator: structural and reference checks, the step graph, cycle detection and reachability,
  with findings carrying a level, a code and a path, over one document or a pack of several.

**`@oqf/dialogue`**

- The dialogue model: conversations, nodes, choices, flag sets, emitted events and lore nodes, with
  the `.oqd` compact and JSON forms frozen in `docs/13-dialogue-spec.md` and their own JSON Schema.
- The bridge interface any dialogue system implements, and `OqfDialogueProvider`, a built-in
  provider that runs the model and drives quest steps through the event channel.
- Ink and Yarn Spinner export, and import back from both. Constructs the model cannot hold are
  reported per line rather than silently dropped.
- A dialogue validator that shares the core finding type, including the lore node check and the
  binding checks against the quests that name a conversation.

**`@oqf/runtime`**

- An engine-agnostic quest state machine: world events in, quest state and events out. Runs in
  browsers and in Node, and depends only on `@oqf/core`.
- Offer, accept, per step progress, rewards, multiple outcomes including failures, repeat quests and
  repeat steps, parallel active steps, and `custom` objectives the engine reports itself.
- Versioned state documents that save, load and reconcile against the quests the game shipped.
- An event map so an engine keeps its own event vocabulary.

**`@oqf/i18n`**

- Extraction of inline strings into a table and injection back into the document, for quests and
  dialogue, with keys derived from structure so they are stable across runs.
- Table adapters as symmetric pairs: JSON, CSV, PO and XLIFF 1.2.
- A resolver for reading a localized document at runtime, with a fallback locale.

**`@oqf/cli`**

- `oqf validate`, `convert`, `import`, `graph`, `schema`, `extract` and `inject`, over single files
  or a directory read as one pack.
- Conversion between `.oqf`, JSON, Markdown, `.oqd`, Ink and Yarn Spinner, and import from Ink and
  Yarn Spinner.
- Mermaid flowchart output for a quest's step graph.

**`@oqf/examples`**

- The Harbormaster's Ledger reference quest in every form: `.oqf`, JSON, `.oqd` and dialogue JSON.
- `minimal.oqf` and its JSON, the smallest valid document.
- `broken/`, one deliberate defect per file, each naming the finding it expects.
- `templates/`, nine small quests that each isolate one pattern: linear, branching, repeatable,
  loop, recurring-step, parallel, failure, chain and engine-hooks, valid and warning free, with
  dialogue for every template that has a talk step.

**`@oqf/editor`**

- A web editor built on Vite and React with four views, Quests, Dialogue, Strings and Dictionaries,
  a step graph with per-edge field and state, an inspector with suggestions and live parse errors,
  validation on every change with one-click fixes, a playtest mode running `@oqf/runtime`, a
  conversation player, and import and export of single files or multi-file packs.
- `npx @oqf/editor` serves the built editor and prints the URL, with `--port` (default 4600,
  falling through to the next ten when busy), `--host` (default 127.0.0.1), `--open`, `--help` and
  `--version`.
- A library entry: `import { QuestEditor } from '@oqf/editor'` with `import '@oqf/editor/styles.css'`
  mounts the editor inside another React app. `react` and `react-dom` are peer dependencies at
  `>=18`, and every `@oqf/*` package is external, so the host keeps one React and one copy of the
  model.
- The static site builds under a relative base, so `dist/app` serves from any path.

**The project**

- The planning and specification documents in `docs/`, including the frozen compact and dialogue
  specs, the condition grammar, the event vocabulary, the state document and the validation rules.
- Apache 2.0 license.

### Not in this release

- Engine exporters. Godot, Unity and Unreal are v1.5.
- An MCP server and a Claude Code plugin.
- Timers, factions, radiant quests and tabletop export, all planned for v2 and designed so v1 files
  stay valid when they land.
- A shipping game. Cozy Coast is the first target and the integration is not done, so "runs in a
  real game" is still unproven.

[Unreleased]: https://github.com/crimson-med/openquestformat/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/crimson-med/openquestformat/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/crimson-med/openquestformat/releases/tag/v0.1.0
