# Reference quest: The Harbormaster's Ledger

The reference quest for Cozy Coast. Every v1 feature appears in it at least once: lore dialogue with no effect, a hint that is optional, two routes to the same step, a step reward, three outcomes including a failure, quest-level rewards per outcome, and a custom emitted event. It is written in prose here and will be written in compact, JSON, oqf-dialogue, Ink and Yarn in phase 1.

## Cast

| Ref | Display name | Role |
|-----|--------------|------|
| `harbormaster` | Harbormaster Ines | Quest giver |
| `otter` | Old Salt Otter | Has the ledger |
| `gull_feeder` | The Gull Feeder | Optional hint |
| `smuggler` | Cove Smuggler | Alternate buyer |

| Location ref | Display name |
|--------------|--------------|
| `harbor` | Harbor pier |
| `otter_den` | Otter's den under the boardwalk |
| `smuggler_cove` | Smuggler's cove |

| Item ref | Display name |
|----------|--------------|
| `fish.rare` | Silver koi |
| `ledger` | Harbor ledger |
| `lure.golden` | Golden lure |

## Story

Harbormaster Ines has lost the harbor ledger. Without it the pier cannot log catches and the season's records are at risk. She asks the player to find it.

The player can ask Ines about the old lighthouse, the pier's history, and why the ledger matters. None of this changes anything. It is lore.

The Gull Feeder on the pier has seen who took it, if the player bothers to ask. Talking to them sets a flag that makes the next step easier: the player learns the ledger is with Old Salt Otter in the den under the boardwalk. Without the hint the player still finds the otter by exploring; the hint just skips the search.

Old Salt Otter has the ledger and is not giving it up for free. The player has two ways to get it:

- **Trade.** Catch five silver koi and bring them to the otter. The otter hands over the ledger. This route grants experience per fish and a small experience reward on completion.
- **Steal.** Sneak into the den at night and take the ledger. This route is faster and grants nothing. If the harbor guard catches the player in the den, the quest fails: the ledger is confiscated and Ines hears about it.

Both routes end with the player holding the ledger. From there, two choices:

- **Return it.** Bring the ledger to Ines. Outcome `returned`. Harbor reputation goes up, the player receives a golden lure, and a custom event `cozycoast.ledger.restored` fires so the game can unlock the pier's catch log feature and a Steam achievement.
- **Sell it.** Take the ledger to the smuggler at the cove. Outcome `sold`. The player receives coins, harbor reputation goes down, and the smuggler becomes available as a vendor.

Once an outcome is reached the quest closes. It does not repeat.

## Steps

| ID | Title | Unlock | Complete | Fail | Optional | Rewards | Outcome |
|----|-------|--------|----------|------|----------|---------|---------|
| `talk_ines` | Speak with Harbormaster Ines | start | talk `harbormaster` (dialogue `ines_intro`) | | | | |
| `ask_gulls` | Ask around the pier | `step.talk_ines` | talk `gull_feeder` (dialogue `gulls_hint`) | | yes | 10 coins | |
| `find_otter` | Find who has the ledger | `step.talk_ines` | reach `otter_den` | | | | |
| `trade` | Trade five silver koi for the ledger | `step.find_otter` | collect `fish.rare` 5 and talk `otter` (dialogue `otter_trade`) | | | 50 xp | |
| `steal` | Take the ledger from the den at night | `step.find_otter` | interact `ledger_chest` and `var.time.isNight` | event `guard.caught` | | | |
| `have_ledger` | Decide what to do with the ledger | `step.trade` or `step.steal` | immediate | | | | |
| `return_ledger` | Return the ledger to Ines | `step.have_ledger` | talk `harbormaster` (dialogue `ines_return`) | | | | `returned` |
| `sell_ledger` | Sell the ledger to the smuggler | `step.have_ledger` | talk `smuggler` (dialogue `smuggler_deal`) | | | | `sold` |
| `caught` | Caught in the den | `step.steal == "failed"` | immediate | | | | `!confiscated` |

Notes on the table:

- `ask_gulls` is optional: nothing depends on it. Its dialogue sets `flag.knows_otter`, which the game uses to show a map marker on `otter_den`. The validator derives optionality; the `optional` flag is set anyway so the tracker can style it.
- `steal` uses `var.time.isNight`, a game-provided variable. The validator will report that the `sold` and `returned` outcomes are reachable through `trade` regardless, so completability is proven without the variable.
- `have_ledger` is a join step with no objective. It exists so both routes converge on one ID that later steps depend on.
- `caught` is a failed ending. It unlocks only when `steal` has failed, which happens on the `guard.caught` event.
- `trade` and `steal` are both reachable and the player may start both. Completing one does not fail the other; when an outcome is reached the other is marked `skipped`.

## Quest-level rewards

| Outcome | Rewards |
|---------|---------|
| `returned` | reputation `harbor` +10, item `lure.golden`, event `cozycoast.ledger.restored` |
| `sold` | currency `coins` 200, reputation `harbor` -10, flag `smuggler_vendor_open` |
| `confiscated` | reputation `harbor` -5 |

## Dialogue

Five conversations, all oqf-dialogue, all bound from the steps above.

- `ines_intro`: Ines explains the loss and asks for help. Three lore branches (`lore: true`): the old lighthouse, the pier's history, why the ledger matters. One branch ends the conversation and completes `talk_ines`.
- `gulls_hint`: the Gull Feeder tells the player about the otter. Sets `flag.knows_otter`. One lore branch about gulls.
- `otter_trade`: the otter offers the deal. If `count.trade >= 5` the player can hand over the fish and the conversation ends; otherwise the otter tells them to come back.
- `ines_return`: Ines thanks the player. Ends the conversation, which completes `return_ledger`.
- `smuggler_deal`: the smuggler makes an offer. The player can back out (conversation ends, step stays active) or accept (ends and completes `sell_ledger`).

## Events the game must emit

`dialogue.ended`, `location.entered`, `item.collected` (mapped from Cozy Coast's `fish.caught`), `object.interacted`, `guard.caught`. Plus a resolver for `var.time.isNight`.

## Events the game listens to

`reward.granted` for coins, xp, reputation, items and the flag; `cozycoast.ledger.restored` for the catch log feature and the achievement; `quest.harbormasters_ledger.step.*` for the tracker.
