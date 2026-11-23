# Token Radar

A pre-token protocol radar: it reads a frozen DefiLlama snapshot, ranks the protocols that
record no token by an implied value, and renders a static dashboard with a farm plan for
every row.

## Run

```sh
node main.ts --input <snapshot.json|directory>
```

Outside the grader, `MAKEFUN_OUTPUT_DIR` stands in for `/output`. The program writes
`board.json` (the ranked board), `data.js` (the dashboard's data), `dashboard/` and
`screenshots/` to the output directory, and `dossier.json` last.

## Model (radar-2)

Each category's multiple is the median market-cap-to-TVL of that category's live-token peers
in the same snapshot, shrunk toward the global median so a category with one or two peers
cannot set the price, and clamped to 0.05–1.50x. Then:

```
implied = round(tvl_usd x category multiple
  x (1 + clamp(change_7d, -60, 120) / 100 x 0.5)
  x (0.6 + min(age_days, 1095) / 1095 x 0.4)
  x (1 + min(chains - 1, 4) x 0.02))
```

No protocol name is special-cased: the same function scores every row, and the peer
multiples are computed from the snapshot at run time, so a future snapshot re-prices every
category on its own market.

## Board

226 rows for the 2026-11-14 snapshot: the 40 watchlist protocols (TVL at or above $50M,
no token on record) plus 186 pre-token protocols below the floor, by TVL. The 24 largest
live-token protocols are set aside with their market caps shown. Every row carries seven
farm steps with a cost and a time, priced on the protocol's own chain.

## Entry

Built for the make.fun bounty "Build the best token launch radar" (token-radar-01).
Node 22, standard library only, no network. `vendor/makefun-board.ts` is make.fun's
dossier library, copied unchanged.
