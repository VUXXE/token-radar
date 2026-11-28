# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/VUXXE/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/VUXXE/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

An empirical pre-token launch radar and costed farming desk built from a sealed DefiLlama protocol snapshot. Every valuation term and token-launch odds term is fitted at run time and kept only if it passes **four blind out-of-sample tests** (Leave-One-Out CV, 10-Fold CV, Temporal Walk-Forward, and Category-Block CV). Zero hardcoded protocol names, zero network calls, 100% browser-to-board recomputation parity, and full accounting for all 758 protocols in the snapshot.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

`main.ts` executes `dashboard/engine.js` (single source of truth for both Node via `lib/model.ts` and the browser via `dashboard/app.js`), validates every gate invariant, writes `board.json` and `data.js`, copies `dashboard/` and `screenshots/`, and writes `dossier.json` last via `vendor/makefun-board.ts`.

## Empirical Model (`radar-6`)

1. **Full 758-Protocol Partition**: 40 Watchlist ($\ge\$50\text{M}$) + 136 Early Pre-Token ($<\$50\text{M}$) + 166 Set Aside (CEX, Bridges, LST/Restaked, Versioned Pools, Staked Receipt Wrappers, Parent Protocols) + 416 Live-Token Protocols (`91` watchlist-rule priced fit peers).
2. **Implied Launch Value (Huber $\delta=0.5$ Power Law + Capped Chain Breadth + Category Shrinkage)**:
   - Tested blind on 91 clean live peers across four held-out regimes (LOO-CV, 10-Fold CV, Temporal Walk-Forward older 65% $\to$ newer 35%, and Category-Block CV):
   - Linear median `mcap/TVL` baseline: LOO `×4.61`, 10f `×4.69`, WF `×4.29`, Cat-Block `×4.52`.
   - Final kept model (`ln(TVL)` + `ln(1+min(chains, 4))` + shrunk category residual $k=5$): **LOO `×3.09` (RMSE `1.95`), 10f `×3.20`, WF `×2.85` (RMSE `2.26`), Cat-Block `×3.02`**.
   - 7d TVL growth and protocol age were tested and **dropped** from valuation after degrading blind tests.
   - **Conformal Prediction Intervals**: 50% core (`±3.09×`) and 80% outer (`±11.44×`) bands calibrated from LOO residuals achieve **52% / 80% empirical coverage** on blind Walk-Forward holdout.
3. **Token Launch Odds (L2 Logistic CDF + Bayes Survival Hazard)**:
   - Fitted on 419 clean protocols; 7d growth and protocol age — dropped from valuation — **pass** both 10-fold CV (Brier `0.2095`, AUC `0.702`) and Walk-Forward (Brier `0.2267`, AUC `0.709`).
   - Conditional remaining odds $P(\text{launch} \mid \text{pre-token at age } t) = (F_{\text{horizon}} - F(t)) / (1 - F(t))$ fall naturally with age.
4. **Costed Farm Verdicts (`$/hour` + Break-Even FDV + 50% Band Sensitivity)**:
   - Routes each protocol to its lowest-gas active chain, sizes minimum viable capital to clear gas & TVL tier, enforces a 14-day contract-maturity guard, prices gas + protocol fees + net carry + active hours, computes closed-form break-even FDV plus Bear/Base/Bull `$/hr` across the 50% conformal band, and outputs 6 concrete protocol-specific steps with a `FARM` / `SELECTIVE` / `SKIP` verdict.

## Entry

Built for the make.fun bounty "Build the best token launch radar" (`token-radar-01`). Node 22 standard library only, offline static dashboard, MIT licensed. `vendor/makefun-board.ts` is make.fun's dossier library, copied unchanged.

---

<sub>Entered on [make.fun](https://make.fun/?ref=t21ja6gd&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
