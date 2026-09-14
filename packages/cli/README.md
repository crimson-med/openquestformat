# @oqf/cli

The `oqf` command line for Open Quest Format. A thin wrapper over `@oqf/core`.

## Commands

`oqf validate <paths...> [--strict] [--json]` parses every path into one pack
and reports what the validator finds, errors before warnings, then a summary.
A path may be a file or a directory of `.oqf` and `.json` files. Exits 1 on any
error.

```
oqf validate packages/examples/quests/harbormasters-ledger.oqf
```

`oqf convert <path> --to oqf|json|md [--out <file>]` writes one file in another
form, to stdout or to `--out`. Markdown is export only.

```
oqf convert quests/harbormasters-ledger.oqf --to json --out harbor.json
```

`oqf graph <path> [--quest <id>]` prints the step graph as a mermaid flowchart.
Ending steps take the double bracket shape, optional steps a dashed border.

```
oqf graph quests/harbormasters-ledger.oqf --quest harbormasters_ledger
```

`oqf schema` prints the JSON Schema for the JSON form.

```
oqf schema > oqf.schema.json
```

Exit codes: `0` success, `1` a validation error or an unusable file, `2` an
unknown command or a bad flag.
