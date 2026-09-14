# Roadmap

Phases are sequential. Each one ends with something usable. No code is written before phase 1 is signed off.

## Phase 0: brief and plan (this document set). Done.

- Agree the model, the condition language, events, dialogue split, state, formats, packages.
- Write the reference quest in prose.

Done when every doc in this folder is agreed and the decisions log has no open items.

## Phase 1: spec v0.1. Done for the quest model; dialogue forms pending.

- Freeze field names and compact column order.
- Write the spec document: model, condition grammar, event vocabulary, compact format, JSON Schema.
- Write the reference quest in compact and JSON by hand and check it reads well in a diff.
- Write the dialogue for the reference quest in oqf-dialogue and by hand in Ink and Yarn to confirm the mapping table holds.

Done when the reference quest exists in all forms and two people agree it is readable.

## Phase 2: core and CLI. Done.

- `@oqf/core`: model, parsers, serializers, condition parser, validator, schema.
- `@oqf/cli`: validate, convert, graph, diff.
- `@oqf/examples`: fixtures.

Done when the reference quest round-trips through every format byte-stable and the validator catches every error in a set of deliberately broken fixtures.

## Phase 3: runtime, shipped in Cozy Coast. Runtime done, Cozy Coast integration pending.

- `@oqf/runtime`: state machine, events, rewards, state documents, reconciliation.
- Integrate into Cozy Coast: event mapping, reward crediting, save integration.
- Ship the reference quest in a Cozy Coast build.

Done when a player can complete the reference quest in Cozy Coast by every route and every outcome, and the state survives a save and load.

## Phase 4: dialogue. Done.

- `@oqf/dialogue`: model, bridge, oqf-dialogue provider, Ink and Yarn export and import, `inkjs` and Yarn adapters.
- Cozy Coast switches the reference quest's conversations to the oqf-dialogue provider.

Done when the reference dialogue exports to Ink and Yarn, both re-import with no warnings, and Cozy Coast runs it.

## Phase 5: i18n and editor. Packages done; public spec release pending.

- `@oqf/i18n`: extract, inject, adapters.
- `@oqf/editor`: graph and form views, dialogue editor, live validation, import and export.
- Public spec release: v1.0.

Done when a quest can be written from nothing in the editor, exported, validated, and run in Cozy Coast without touching a text file.

## v1.5

- Engine exporters: Godot first, then Unity, then Unreal. Each with a loader on the engine side and one sample project.
- `@oqf/mcp` and the Claude Code plugin.
- Before and after showcase: the reference quest as an engine-locked asset next to the OQF file.

## v2

Planned for now so v1 files stay valid when they land.

- **Timers.** A `deadline` on steps and `var.time.*` in conditions. Slots in as a new transition and a new variable namespace.
- **Factions and reputation tracks.** Currently reputation is a reward kind with an opaque `ref`. v2 adds a faction registry and standing thresholds as variables.
- **Radiant and templated quests.** A quest with parameters (`$target`, `$location`) instantiated at runtime. Slots in as a template header and a substitution pass before load.
- **Tabletop and VTT.** Printable quest sheets and a Foundry export.

## Non-goals

Things OQF will not do, at any version.

- Define actors, items, locations, or an inventory. They are references.
- Embed a scripting language.
- Run dialogue. The bridge runs dialogue; OQF observes it.
- Own the save file. State is a document the game stores.
- Replace an engine's quest UI. OQF gives the data; the tracker, journal and markers are the game's.
