# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/VUXXE/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/VUXXE/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

An empirical pre-token launch radar and costed farming desk built from a sealed DefiLlama protocol snapshot. Every valuation term and token-launch odds term is fitted at run time and kept only if it improves **two blind out-of-sample tests** (Leave-One-Out CV and Temporal Walk-Forward). Zero hardcoded protocol names, zero network calls, 100% browser-to-board recomputation parity, and full accounting for all 758 protocols in the snapshot.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

`main.ts` executes `dashboard/engine.js` (single source of truth for both Node and the browser), validates all gate invariants, writes `board.json` and `data.js`, copies `dashboard/` and `screenshots/`, and writes `dossier.json` last via `vendor/makefun-board.ts`.

## Empirical Model (`radar-5`)

1. **Full 758-Protocol Partition**: 40 Watchlist ($\ge\$50\text{M}$) + 138 Early Pre-Token ($<\$50\text{M}$) + 164 Set Aside (CEX, Bridges, LST/Restaked, Versioned Pools, Parent Protocols) + 416 Live-Token Protocols (`92` watchlist-rule priced fit peers).
2. **Implied Launch Value (Huber $\delta=0.5$ Power Law + Category Shrinkage)**:
   - Tested blind on 92 clean live peers (LOO-CV + Walk-Forward older 65% $\to$ newer 35%):
   - Linear median `mcap/TVL` baseline: LOO `×4.65`, WF `×4.52`.
   - Final kept model (`log(TVL)` + `log(1+chains)` + shrunk category residual $k=5$): **LOO `×2.96` (RMSE `1.94`), WF `×2.96` (RMSE `2.23`)**.
   - 7d TVL growth and protocol age were tested and **dropped** from valuation after degrading both blind tests.
   - **Conformal Prediction Intervals**: 50% and 80% bands calibrated from LOO residuals achieve **52% / 80% empirical coverage** on blind Walk-Forward holdout.
3. **Token Launch Odds (L2 Logistic CDF + Bayes Survival Hazard)**:
   - Fitted on 422 clean protocols; 7d growth and age **pass** both 10-fold CV (Brier `0.2077`, AUC `0.709`) and Walk-Forward (Brier `0.2288`, AUC `0.708`).
   - Conditional remaining odds $P(\text{launch} \mid \text{pre-token at age } t) = (F_{\text{horizon}} - F(t)) / (1 - F(t))$ fall naturally with age.
4. **Costed Farm Verdicts (`$/hour`)**:
   - Routes each protocol to its lowest-gas active chain, sizes minimum viable capital to clear gas & TVL tier, prices gas + protocol fees + net carry + active hours, and outputs 6 concrete protocol-specific steps with a `FARM` / `SELECTIVE` / `SKIP` verdict.

## Entry

Built for the make.fun bounty "Build the best token launch radar" (`token-radar-01`). Node 22 standard library only, offline static dashboard, MIT licensed. `vendor/makefun-board.ts` is make.fun's dossier library, copied unchanged.

---

<sub>Entered on [make.fun](https://make.fun/?ref=t21ja6gd&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
