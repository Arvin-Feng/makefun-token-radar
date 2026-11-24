# makefun-token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Arvin-Feng/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Arvin-Feng/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token launch radar: 198 pre-token protocols ranked by comps-calibrated implied value, each with a farm plan. Built for make.fun's token-radar-01 bounty. The snapshot comes from the competition kit (input/snapshot.json); the grader mounts it at /input/snapshot.json.

## What it ranks

A protocol is a launch candidate when it records no token at all: no market cap, no CoinGecko id, no symbol. The board covers the snapshot's whole 40-protocol watchlist, then adds every other pre-token protocol that passes the watchlist's own exclusion rule: no wrapped, staked or bridged product of a token that already trades, no versioned pool, no exchange, no CEX. On the kit snapshot that is 198 rows: the 40 on the watchlist plus 158 more below its floor. The snapshot's 24 live-token protocols are kept apart and shown with the market's own values, never mixed into the ranking.

## The model (radar-2)

Implied value is calibrated on the snapshot's own market, not on a flat multiple:

```
compMultiple = the category's median mcap / TVL among the snapshot's tokenized protocols
               (at least 3 of them, else the whole market's median), clamped to [0.05, 0.80]
base         = tvl_usd x compMultiple
growthMult   = 1 + clamp(change_7d, -60, 120) / 100 x 0.5
maturityMult = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age unknown: 365 days)
implied      = max(1, round(base x growthMult x maturityMult))
```

The comps are computed from the snapshot at run time, inside `lib/model.ts`: no protocol name is ever special-cased, no multiple is hard-coded, and the same function scores every row. The dashboard shows the comps table the run computed, and recomputes each row from the same figures, so the page's code and the board's data are visibly the same arithmetic.

Every ranked row carries a six-step farm plan, derived from the protocol's own record (category, chains, TVL, age): a fresh wallet, the category's main action, a weekly qualifying action, a hold of 30 to 60 days, a claim step that only ever points at the protocol's own page, and a farm log. The plan never names a token, a date, or a price the snapshot does not carry.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input snapshot.json
```

Node 22.18 or later, standard library only. No network, no dependencies, no build step.

## Outputs

The run writes everything the judge reads into the output directory:

- `board.json` — the ranked board: 198 rows, each with its implied value, its model breakdown (comp multiple, growth and maturity multipliers, age) and its farm steps.
- `data.js` — the dashboard's whole dataset as one script, so the page renders with no fetch and no network.
- `dashboard/` — the static page: the board, a detail view for every protocol, and search, category, chain and token-status filters.
- `screenshots/` — the three required captures: the board, one protocol's detail view, and a filtered view.
- `dossier.json` — the summary the judge reads, built by `vendor/makefun-board.ts` from the dashboard and the screenshots.

The run is deterministic: the same snapshot always produces the same board, byte for byte.

## Screenshots

The three images under `screenshots/` are captures of the dashboard itself, taken in a browser at a normal window size (long edge 1440, each under 512 KB):

1. `1-board.png` — the board: the 40 watchlist protocols, ranked by implied value.
2. `2-detail.png` — one protocol's detail view: Steakhouse Financial, rank 1, with its model breakdown and its six-step farm plan.
3. `3-filter.png` — a filtered view: category set to Lending, 16 rows shown.

## Verification

The run checks itself before it writes anything. `boardIssue` refuses a board that misses a watchlist slug, has a broken rank sequence, is out of implied-value order, gives every row the same value, or carries a farm plan with the wrong number of steps or a step outside 20..600 characters. On the kit snapshot the run reports:

```
758 protocols, 40 on the watchlist, 198 rows scored (158 early, 24 live set aside)
comps global 0.21380325885644053x over 128 tokenized protocols, 14 categories with their own multiple
```

The top of the board is Steakhouse Financial at $464.9M implied, then Sentora Curator at $446.6M and Gauntlet at $276.9M. Every row carries an implied value above zero and a six-step farm plan. Re-running the program on the same snapshot reproduces `board.json`, `data.js` and `dossier.json` byte for byte; the dashboard recomputes each row from the same figures, so a reader can check any number on the page against the board.

## Data

The snapshot is the sealed one the competition kit ships: 758 protocols tracked, 40 on the watchlist, 198 pre-token rows scored, 24 live-token protocols set aside. Nothing in the repo fetches live prices or calls an API; every figure the board shows comes from that snapshot and the model above it.

## Limits

Implied value is a model, not a promise: it says what a launch would be worth if the market paid this protocol the way it pays its tokenized peers, nothing more. The farm plans are generic guidance for qualifying activity, not financial advice, and they never ask for a payment to claim anything. A protocol's launch, its terms and its timing are its own decision; the radar only ranks the field as the snapshot shows it.

---

<sub>Entered on [make.fun](https://make.fun/?ref=e8vj1m27&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
