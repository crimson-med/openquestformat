# @oqf/cli

The `oqf` command line for Open Quest Format. A thin wrapper over `@oqf/core`,
`@oqf/dialogue` and `@oqf/i18n`.

## Files it reads

`.oqf` is the compact quest format, `.oqd` the compact dialogue format, and
`.json` is the JSON form of either, told apart by its top level key, `oqf` or
`oqd`. A directory is a pack: every `.oqf`, `.oqd` and `.json` file directly
inside it, sorted by name, never walked deeper.

## Commands

`oqf validate <paths...> [--strict] [--json]` parses every path into one pack
and reports what the validators find, errors before warnings, then a summary.
Quests go to the core validator and dialogue to the dialogue validator, which
cross checks the conversations a step binds when the pack holds both. Exits 1
on any error.

The same document given twice, once compact and once as JSON, is read once, so
a directory that holds both forms of a pack does not report colliding ids.

```
oqf validate packages/examples/quests
```

`oqf convert <path> --to oqf|json|md|oqd|ink|yarn [--out <file>]` writes one
file in another form, to stdout or to `--out`. Quests take `oqf`, `json` and
`md`, dialogue takes `oqd`, `json`, `ink` and `yarn`. Asking for a target the
file does not have is a usage error that names the ones it does. Markdown, Ink
and Yarn Spinner are export only here.

```
oqf convert quests/harbormasters-ledger.oqf --to json --out harbor.json
oqf convert quests/harbormasters-ledger.oqd --to ink --out harbor.ink
```

`oqf import <path.ink|path.yarn> --to oqd|json [--out <file>]` reads an Ink or
Yarn Spinner file back into a dialogue document. Ink and Yarn say more than the
dialogue model holds, so every construct the importer had to drop is printed on
stderr as `<file>:<line>: <construct>: <message>`. The document is still
written: an import is a starting point to review, not a failure.

```
oqf import story.ink --to oqd --out story.oqd
```

`oqf graph <path> [--quest <id>]` prints the step graph as a mermaid flowchart.
Ending steps take the double bracket shape, optional steps a dashed border.

```
oqf graph quests/harbormasters-ledger.oqf --quest harbormasters_ledger
```

`oqf extract <paths...> --out <table> [--write]` pulls every literal string of a
pack, quests and dialogue together, into one table. The table extension picks
the form: `.json`, `.csv`, `.po` or `.xliff`. Without `--write` the sources are
left alone and only the table is written. With `--write` every source file is
rewritten in place with key references in it, each in the form it was read in.

Write the table outside the pack directory, or the next run reads it back in as
a source.

```
oqf extract packages/examples/quests --out strings.json
oqf extract quests/harbormasters-ledger.oqf --out strings.po --write
```

`oqf inject <paths...> --table <file> [--missing keep|throw|empty]` writes the
values of a translated table back into the sources, in place, each in the form
it was read in. `--missing` says what to do with a key the table has no value
for: keep the reference, which is the default, throw, or write an empty string.

```
oqf inject packages/examples/quests --table strings.fr.json
```

`oqf schema [--dialogue]` prints the JSON Schema for the JSON form, of quests
by default and of dialogue with the flag.

```
oqf schema > oqf.schema.json
oqf schema --dialogue > oqd.schema.json
```

Exit codes: `0` success, `1` a validation error or an unusable file, `2` an
unknown command or a bad flag.
