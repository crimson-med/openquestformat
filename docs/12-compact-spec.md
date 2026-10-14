# Compact format, frozen column order

This is the column order the parsers and serializers implement. It supersedes the sketch in [06-formats.md](06-formats.md). v0.1 froze it; columns may be appended in later minor versions, never reordered or removed. v0.2 appends `cooldown` and `expire` to `Q`, `deadline` to `S`, and adds the `P` record; those are marked below. A v0.1 file is a v0.2 file with the new cells absent.

## Lexical rules

- UTF-8, LF line endings. A trailing LF is optional on read and always written.
- A line is TAB-separated cells. The first cell is the record type, one character.
- Blank lines are ignored. Lines starting with `#` are comments and ignored.
- Text cells escape `\` as `\\`, TAB as `\t`, LF as `\n`, CR as `\r`. Nothing else is escaped.
- An empty cell means "absent". Trailing empty cells may be omitted on write and are treated as absent on read.
- A record with fewer cells than the spec lists is valid (older writer). A record with more cells is valid (newer writer); extra cells are preserved in `ext` under `x-oqf.extra` so they round-trip.
- Numbers are written in shortest decimal form. Booleans in cells are `1` or empty.

## Records

```
OQF1                                   line 1, exactly. Major version.
#  any text                            comment
A  ref  ref  ...                       actors dictionary
L  ref  ref  ...                       locations dictionary
I  ref  ref  ...                       items dictionary
T  ref  ref  ...                       tags dictionary
Q  id  version  flags  tagRefs  unlock  title  summary  cooldown  expire
P  name  type  constraint                 parameter of the quest (v0.2)
R  id  kind  ref  amount  outcome  payload
S  id  flags  unlock  activate  complete  fail  outcome  rewardRefs  dialogue  location  actorRefs  title  journal  deadline
X  ns  key  value
```

Counting from the first cell after the record type, `cooldown` is column 8 and `expire` column 9 of `Q`, and `deadline` is column 14 of `S`. All three are v0.2.

Order rules:

- `OQF1` first. Dictionaries (`A`, `L`, `I`, `T`) next, at most one line each, any order among themselves, all before the first `Q`. A missing dictionary line means empty.
- `Q` starts a quest. `P`, `R` and `S` lines belong to the most recent `Q`. `P` lines come first, then `R`, then `S`, so parameters are known before the objectives that reference them and step `rewardRefs` can be resolved on a single pass.
- `X` attaches to the most recent `Q`, `P`, `R` or `S` line. Before any `Q` it is a document-level extension, which the model does not carry and which is therefore a parse error in v0.1.

## Cell encodings

| Cell | Encoding |
|------|----------|
| `ref` (dictionary entry) | `id` or `id\|Display Name`. The pipe is literal; display names may not contain a pipe. |
| `flags` on `Q` | letters, any order, no separator: `r` repeat. Empty for none. |
| `flags` on `S` | letters: `s` start, `o` optional, `r` repeat. |
| `tagRefs`, `rewardRefs`, `actorRefs` | comma-separated zero-based indices into `T`, the quest's `R` lines, and `A`. Empty for none. |
| `location` | one zero-based index into `L`. |
| `unlock`, `activate` | condition infix text per docs/02-conditions.md. |
| `complete`, `fail` | `<objective> [and <condition>]` or `<condition>`. The `fail` objective maps to `Step.failObjective`. |
| `outcome` on `S` | `name`, `!name` for failed, optionally `name\|Title`. |
| `outcome` on `R` | outcome name. Present only on quest-level rewards. |
| `amount` | number. Empty means 1. |
| `payload` | `key=value;key=value`. Values: number if numeric, `true`/`false` as booleans, else string. Keys and values escape `;` as `\;` and `=` as `\=` in addition to the cell escapes. |
| `dialogue` | `provider:ref`. |
| `cooldown`, `expire` on `Q`, `deadline` on `S` | a duration: an ISO 8601 span (`PT20H`, `P3D`, `P1W`), or `day`, `week` or `month`. See [01-model.md](01-model.md). |
| `name`, `type`, `constraint` on `P` | the parameter name, one of `item`, `actor`, `location`, `number`, `string`, and the optional constraint: a tag id, or `min..max` for `number`. |
| `kind` on `R` | one of the reward kinds. |
| `X` value | a scalar as for payload values, or `key=value;...` for a flat map. |

Objective references inside `complete` (`collect fish.rare 5`) use ids, not dictionary indices. Dictionaries intern the columns; conditions stay readable. A parameter reference is written `$name` in an objective and in a condition (`collect $fish $n`, `count.catch >= $n`).

## Normalization for byte-stable round trips

A serializer writes:

- dictionaries in first-use order as encountered when walking quests, then steps, then rewards; unreferenced entries after, in original order;
- `P` lines in `Quest.params` order, `R` lines in `Quest.rewards` order, `S` lines in `Quest.steps` order;
- durations in one spelling: uppercase ISO 8601 with no zero components and no leading zeros (`P1DT12H`, never `P1DT12H0M`), or the bare keyword;
- conditions through `formatCondition`, which has one canonical spelling (lowercase keywords, single spaces, minimal parentheses, double-quoted strings);
- no trailing empty cells;
- `X` lines sorted by `ns` then `key`.

Two parsers reading the same normalized text must produce deep-equal models, and serializing that model must reproduce the text exactly.

## Example

```
OQF1
A	harbormaster|Harbormaster Ines	otter|Old Salt Otter
L	otter_den|Otter's den
I	fish.rare|Silver koi	ledger|Harbor ledger
T	main
Q	harbormasters_ledger	1		0		The Harbormaster's Ledger	Find the missing harbor ledger.
R	xp_trade	xp	xp	50
R	rep_returned	reputation	harbor	10	returned
S	talk_ines	s			talk harbormaster ines_intro				oqf:ines_intro		0	Speak with Harbormaster Ines
S	find_otter		step.talk_ines		reach otter_den					0	1	Find who has the ledger
S	trade		step.find_otter		collect fish.rare 5 and flag.otter_agreed			0	oqf:otter_trade	0	1	Trade five silver koi for the ledger
S	return_ledger		step.trade		talk harbormaster ines_return		returned		oqf:ines_return		0	Return the ledger to Ines
X	cozycoast	marker	pier_02
```

Cell by cell for the `talk_ines` line: id, flags `s`, unlock (empty), activate (empty), complete, fail (empty), outcome (empty), rewardRefs (empty), dialogue, location (empty), actorRefs `0`, title. The journal and deadline cells are omitted because they are empty and trailing.

A quest that uses every v0.2 cell, a daily request with two parameters, is written out in [14-recurrence.md](14-recurrence.md).
