# Packages

A pnpm workspace with one canonical model in `core` and thin packages around it, the same shape as Neurowire. Every package is TypeScript, published under `@oqf/*`, Apache 2.0.

| Package | Responsibility | Depends on |
|---------|----------------|------------|
| `@oqf/core` | The model types. Compact and JSON parsers and serializers. Markdown serializer. Condition parser (infix to JSON Logic) and whitelist. The validator. The published JSON Schema. Zero runtime dependencies beyond `json-logic-js`. | nothing |
| `@oqf/dialogue` | The dialogue model and its compact and JSON forms. The bridge interface. The built-in oqf-dialogue provider. Ink and Yarn Spinner export and import. Adapters that wrap `inkjs` and a Yarn runtime as providers, behind optional peer dependencies. | core |
| `@oqf/runtime` | The state machine. Loads a pack, accepts events, evaluates conditions, transitions steps, grants rewards, emits events, reads and writes state documents, reconciles state against a newer quest version. Engine-agnostic: no DOM, no Node APIs, works in a browser, Electron renderer, Node, or Deno. | core, dialogue (bridge only) |
| `@oqf/i18n` | `extract` and `inject` over a pack. Table adapters: JSON, CSV, PO, XLIFF. A minimal runtime resolver. | core |
| `@oqf/cli` | `oqf validate`, `oqf convert` (oqf, json, md, oqd, ink, yarn), `oqf import` (ink, yarn), `oqf graph`, `oqf schema`, `oqf extract`, `oqf inject`. Thin wrapper over the packages above. | all |
| `@oqf/editor` | Web editor. Graph view of steps, form view of fields, dialogue editor, live validation, import and export in every format. Authors compact natively. Ships as a static site and as a component others can embed. | core, dialogue, i18n |
| `@oqf/examples` | Reference quests in compact and JSON, including the Cozy Coast quest from [11-reference-quest.md](11-reference-quest.md). Used by tests in every other package. | none |

## Later

| Package | When | Responsibility |
|---------|------|----------------|
| `@oqf/export-godot` | v1.5 | Godot resource files and a GDScript loader. |
| `@oqf/export-unity` | v1.5 | ScriptableObject JSON and a C# loader. |
| `@oqf/export-unreal` | v1.5 | Data table CSV or JSON and a Blueprint-friendly loader. |
| `@oqf/mcp` | v1.5 | MCP server so an agent can read, validate and write quests. Also a Claude Code plugin. |
| `@oqf/tabletop` | v2 | Printable quest cards and a Foundry VTT export. |

## Conventions carried over from Neurowire

- One canonical model in `core`; every other package converts to or from it, never around it.
- `core` has no I/O. File reading lives in `cli` and `examples`.
- Every format round-trips through the model and has a fixture in `examples` that every serializer must reproduce.
- Vitest, Biome, pnpm workspace, `tsconfig.base.json`, per-package `README.md`.
- The compact format's magic line carries the major version (`OQF1`). Minor versions add columns at the end of records and never remove or reorder.

## Consumer: Cozy Coast

Cozy Coast depends on `@oqf/core` and `@oqf/runtime` only. It maps its own events onto the consumed vocabulary when it constructs the runtime, listens to `reward.granted` to credit items and Steam achievements, and stores the state documents in its existing save file under a `quests` key. It is the integration test for the runtime and the source of the first reference quest.
