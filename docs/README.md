# OQF planning docs

These documents describe what Open Quest Format is, how it is modelled, and how the project is phased. They are the plan, not the spec. The spec is written once the model here is agreed.

| Doc | What it covers |
|-----|----------------|
| [00-decisions.md](00-decisions.md) | Decisions taken so far and why. Read first when picking the project back up. |
| [01-model.md](01-model.md) | The canonical quest model: quests, steps, transitions, objectives, rewards, endings, references, extensions. |
| [02-conditions.md](02-conditions.md) | The condition language: JSON Logic subset as the AST, infix text as the authoring form. |
| [03-events.md](03-events.md) | Events consumed and emitted, naming, payloads. |
| [04-dialogue.md](04-dialogue.md) | The dialogue model, the bridge any dialogue system implements, Ink and Yarn Spinner mapping. |
| [05-state.md](05-state.md) | The runtime state document and ID stability rules. |
| [06-formats.md](06-formats.md) | The compact line format and the JSON form. |
| [07-i18n.md](07-i18n.md) | Inline strings, keys, extraction and injection. |
| [08-validation.md](08-validation.md) | What the validator proves and what it warns about. |
| [09-packages.md](09-packages.md) | Package layout and responsibilities. |
| [10-roadmap.md](10-roadmap.md) | Phases, v1 scope, v1.5 and v2, non-goals. |
| [11-reference-quest.md](11-reference-quest.md) | The reference quest in prose. Every feature of v1 appears in it once. |
| [12-compact-spec.md](12-compact-spec.md) | The compact format, column order frozen for v0.1. |
