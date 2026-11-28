// Empirical Token Launch Radar Engine (radar-7).
// Single deterministic source of truth executed by both Node (lib/model.ts)
// and the browser (dashboard/app.js) for live parity and budget simulation.
((root) => {
 'use strict';
 const DAY_MS = 86_400_000, { abs, ceil, exp, floor, log, max, min, round, sqrt } = Math;
 const VERSIONED_RE = /(\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)|[A-Za-z]V\d+(\.\d+)?)$/;
 const WRAPPED_RE = /\b(wrapped|staked|staking)\b/i;
 const STAKED_TICKER_RE = /\bst[A-Z]{2,}\b/;
 const EXCLUDED_CATS = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
 const EXCH_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
 // Empirical per-transaction gas estimates (USD) for cheapest-chain routing.
 const CHAIN_GAS_USD = {
  Solana: 0.02, Algorand: 0.02, Near: 0.02, Stellar: 0.02, Sui: 0.03, Aptos: 0.03, Sei: 0.03,
  Polygon: 0.05, Sonic: 0.05, Gnosis: 0.05, TON: 0.05, Monad: 0.1, 'Hyperliquid L1': 0.1,
  Mantle: 0.1, Flare: 0.1, Plasma: 0.1, Ink: 0.12, Unichain: 0.12, Starknet: 0.12,
  Base: 0.15, Arbitrum: 0.15, Optimism: 0.15, Binance: 0.15, BSC: 0.15, Berachain: 0.15,
  Plume: 0.15, 'Plume Mainnet': 0.15, Katana: 0.15, Corn: 0.15, Arc: 0.15, BSquared: 0.15,
  Linea: 0.2, Scroll: 0.2, 'zkSync Era': 0.2, Bittensor: 0.25, Avalanche: 0.35, Tron: 0.8,
  Bitcoin: 3.5, Ethereum: 5.5,
 };
 const CFG = {
  version: 'radar-7', huberDelta: 0.5, ridge: 1e-3, chainCap: 4, catShrinkK: 5, resCap: 2.5,
  oddsL2: 2.0, oddsCatK: 6, wfSplit: 0.65, airdropPoolPct: 0.075, activeTvlFrac: 0.35, loyaltyBoost: 1.85,
 };
 const clamp = (v, lo, hi) => min(hi, max(lo, v));
 const round4 = (n) => round(n * 1e4) / 1e4;
 const round2 = (n) => round(n * 100) / 100;
 const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
 const bySlug = (a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
 const sigmoid = (z) => 1 / (1 + exp(-clamp(z, -30, 30)));
 const clamp7d = (v) => clamp(typeof v === 'number' && isFinite(v) ? v : 0, -60, 120) / 100;
 const hasLiveToken = (p) => p.gecko_id !== null || p.symbol !== null || p.mcap_usd !== null;
 const fmtGas = (n) => (n < 1 ? `$${n.toFixed(2)}` : n < 10 ? `$${n.toFixed(1)}` : `$${round(n)}`);
 const fmtCompact = (n) => (n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${round(n / 1e3)}K`);
 const rmse = (errs) => (errs.length ? round2(sqrt(errs.reduce((s, x) => s + x * x, 0) / errs.length)) : 0);
 function ageDays(asOf, listedAt) {
  if (!listedAt) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`), b = Date.parse(`${listedAt}T00:00:00Z`);
  return isFinite(a) && isFinite(b) ? max(0, floor((a - b) / DAY_MS)) : null;
 }
 function median(vals) {
  if (!vals.length) return 0;
  const s = vals.slice().sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
 }
 function conformalQuantile(vals, q) {
  if (!vals.length) return 0;
  const s = vals.slice().sort((x, y) => x - y);
  return s[clamp(ceil(q * (s.length + 1)) - 1, 0, s.length - 1)];
 }
 function solveLinear(A, b) {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
   let piv = col;
   for (let r = col + 1; r < n; r++) if (abs(M[r][col]) > abs(M[piv][col])) piv = r;
   [M[col], M[piv]] = [M[piv], M[col]];
   const diag = M[col][col];
   if (abs(diag) < 1e-12) continue;
   for (let j = col; j <= n; j++) M[col][j] /= diag;
   for (let r = 0; r < n; r++) {
    if (r === col) continue;
    const f = M[r][col];
    for (let j = col; j <= n; j++) M[r][j] -= f * M[col][j];
   }
  }
  return M.map((row) => row[n]);
 }
 // Normal equation assembly for weighted least squares / IRLS / Newton-Raphson.
 function normalEq(X, rhs, wt, p) {
  const A = Array.from({ length: p }, () => new Array(p).fill(0)), g = new Array(p).fill(0);
  for (let i = 0; i < X.length; i++) {
   const w = wt[i], r = rhs[i], xi = X[i];
   for (let a = 0; a < p; a++) {
    g[a] += r * xi[a];
    for (let c = 0; c < p; c++) A[a][c] += w * xi[a] * xi[c];
   }
  }
  return [A, g];
 }
 // IRLS Huber regression with L2 ridge on slope coefficients.
 function fitHuberPowerLaw(X, y, delta, ridge) {
  const n = y.length, p = X[0].length, w = new Array(n).fill(1);
  let beta = new Array(p).fill(0);
  for (let iter = 0; iter < 30; iter++) {
   const [A, g] = normalEq(X, y.map((yi, i) => w[i] * yi), w, p);
   for (let d = 1; d < p; d++) A[d][d] += ridge;
   beta = solveLinear(A, g);
   for (let i = 0; i < n; i++) { const err = abs(y[i] - dot(beta, X[i])); w[i] = err <= delta ? 1 : delta / err; }
  }
  return beta;
 }
 // Newton-Raphson L2-regularized logistic regression.
 function fitLogisticRegression(X, y, l2) {
  const p = X[0].length;
  let w = new Array(p).fill(0);
  for (let iter = 0; iter < 25; iter++) {
   const ps = X.map((xi) => sigmoid(dot(w, xi)));
   const [H, g] = normalEq(X, y.map((yi, i) => yi - ps[i]), ps.map((pr) => max(1e-6, pr * (1 - pr))), p);
   for (let d = 1; d < p; d++) { H[d][d] += l2; g[d] -= l2 * w[d]; }
   const step = solveLinear(H, g);
   w = w.map((v, k) => v + step[k]);
   if (max(...step.map(abs)) < 1e-6) break;
  }
  return w;
 }
 // Automated exclusion rules mirroring DefiLlama watchlist eligibility.
 function exclusionReason(p, floorUsd, isWatchlist) {
  if (isWatchlist) return null;
  if (p.category === 'CEX') return 'Centralized exchange (CEX)';
  if (p.category && EXCLUDED_CATS.has(p.category)) return `Excluded derivative/infra (${p.category})`;
  if (VERSIONED_RE.test(p.name)) return 'Versioned pool of existing protocol';
  if (WRAPPED_RE.test(p.name) || STAKED_TICKER_RE.test(p.name)) return 'Wrapped or staked receipt token';
  const ex = EXCH_PREFIXES.find((e) => p.name.startsWith(e));
  if (ex) return `Exchange-branded product (${ex})`;
  return !hasLiveToken(p) && p.tvl_usd >= floorUsd ? 'Parent protocol recorded by DefiLlama (>=$50M)' : null;
 }
 // Exact 4-lane partition of all 758 protocols with zero silent drops.
 function classifyUniverse(snapshot) {
  const wlSet = new Set(snapshot.watchlist), watchlist = [], early = [], excluded = [], live = [], livePricedClean = [], exclCounts = {};
  for (const p of snapshot.protocols) {
   if (wlSet.has(p.slug)) watchlist.push(p);
   else if (hasLiveToken(p)) {
    live.push(p);
    if (!exclusionReason(p, snapshot.floor_usd, false) && p.mcap_usd > 0 && p.tvl_usd > 0) livePricedClean.push(p);
   } else {
    const why = exclusionReason(p, snapshot.floor_usd, false);
    if (why) { excluded.push({ protocol: p, reason: why }); exclCounts[why] = (exclCounts[why] || 0) + 1; }
    else early.push(p);
   }
  }
  return { wlSet, watchlist, early, excluded, live, livePricedClean: livePricedClean.sort(bySlug), exclCounts };
 }
 function valueFeatures(p, asOf, spec) {
  const f = [1, log(max(1, p.tvl_usd))];
  if (spec.chains) f.push(log(1 + min(CFG.chainCap, p.chains ? p.chains.length : 0)));
  if (spec.change7d) f.push(clamp7d(p.change_7d));
  if (spec.age) f.push(log(1 + (ageDays(asOf, p.listed_at) ?? 730)));
  return f;
 }
 function fitVal(peers, asOf, spec) {
  if (spec.linear) return { linear: true, medRatio: median(peers.map((p) => p.mcap_usd / p.tvl_usd)) };
  const X = peers.map((p) => valueFeatures(p, asOf, spec)), y = peers.map((p) => log(p.mcap_usd));
  const beta = fitHuberPowerLaw(X, y, CFG.huberDelta, CFG.ridge), catRes = {};
  peers.forEach((p, i) => {
   const c = p.category || 'Other';
   (catRes[c] = catRes[c] || []).push(clamp(y[i] - dot(beta, X[i]), -CFG.resCap, CFG.resCap));
  });
  const catOffsets = {}, catCounts = {};
  for (const c of Object.keys(catRes).sort()) {
   const rs = catRes[c];
   catCounts[c] = rs.length;
   catOffsets[c] = spec.cat ? (rs.length / (rs.length + CFG.catShrinkK)) * median(rs) : 0;
  }
  return { spec, beta, catOffsets, catCounts };
 }
 const predLog = (fit, p, asOf) => fit.linear
  ? log(max(1, p.tvl_usd * fit.medRatio))
  : dot(fit.beta, valueFeatures(p, asOf, fit.spec)) + (fit.catOffsets[p.category || 'Other'] || 0);
 const wfSplit = (items, getP) => {
  const d = items.filter((x) => getP(x).listed_at).sort((a, b) => (getP(a).listed_at < getP(b).listed_at ? -1 : getP(a).listed_at > getP(b).listed_at ? 1 : bySlug(getP(a), getP(b))));
  const k = floor(d.length * CFG.wfSplit);
  return [d.slice(0, k), d.slice(k)];
 };
 const kFold10 = (items, fitFn, evalFn) => {
  const out = [];
  for (let f = 0; f < 10; f++) {
   const fit = fitFn(items.filter((_, i) => i % 10 !== f));
   for (const x of items.filter((_, i) => i % 10 === f)) out.push(evalFn(fit, x));
  }
  return out;
 };
 // Four blind valuation proofs: LOO, 10-Fold, Walk-Forward (65/35), Category-Block.
 function runValueBenchmarks(peers, asOf) {
  const specs = [
   { id: 'linear', label: 'Linear median mcap/TVL', linear: true, decision: 'BASELINE' },
   { id: 'tvl', label: 'Power law: ln(TVL)', decision: 'KEPT' },
   { id: 'tvl_ch', label: '+ Capped chains ln(1+min(c,4))', chains: true, decision: 'KEPT' },
   { id: 'final', label: '+ Category shrunk offset (k=5)', chains: true, cat: true, decision: 'KEPT (FINAL)' },
   { id: 'plus_7d', label: '+ 7d TVL growth (clamped)', chains: true, cat: true, change7d: true, decision: 'DROPPED' },
   { id: 'plus_age', label: '+ Protocol age ln(1+age)', chains: true, cat: true, age: true, decision: 'DROPPED' },
  ];
  const [wfTrain, wfTest] = wfSplit(peers, (p) => p);
  const cats = [...new Set(peers.map((p) => p.category || 'Other'))].sort();
  const absErr = (fit, p) => abs(log(p.mcap_usd) - predLog(fit, p, asOf));
  const table = [], looMap = {};
  let conformal = null;
  for (const s of specs) {
   const loo = peers.map((p, i) => {
    const lp = predLog(fitVal([...peers.slice(0, i), ...peers.slice(i + 1)], asOf, s), p, asOf);
    if (s.id === 'final') looMap[p.slug] = { pred: round(exp(lp)), ratio: round2(exp(log(p.mcap_usd) - lp)) };
    return abs(log(p.mcap_usd) - lp);
   });
   const cv10 = kFold10(peers, (tr) => fitVal(tr, asOf, s), absErr), catErr = [];
   const wfFit = fitVal(wfTrain, asOf, s), wf = wfTest.map((p) => absErr(wfFit, p));
   for (const c of cats) {
    const fit = fitVal(peers.filter((p) => (p.category || 'Other') !== c), asOf, s);
    for (const p of peers.filter((p) => (p.category || 'Other') === c)) catErr.push(absErr(fit, p));
   }
   const q50 = conformalQuantile(loo, 0.5), q80 = conformalQuantile(loo, 0.8);
   const cov = (q) => round((wf.filter((e) => e <= q).length / max(1, wf.length)) * 100);
   const row = {
    id: s.id, label: s.label, decision: s.decision,
    loo_med_x: round2(exp(median(loo))), loo_rmse: rmse(loo), cv10_med_x: round2(exp(median(cv10))),
    wf_med_x: round2(exp(median(wf))), wf_rmse: rmse(wf), cat_med_x: round2(exp(median(catErr))),
    q50_x: round2(exp(q50)), q80_x: round2(exp(q80)), wf_cov50: cov(q50), wf_cov80: cov(q80),
   };
   table.push(row);
   if (s.id === 'final') conformal = { q50, q80, q50_x: row.q50_x, q80_x: row.q80_x, wf_cov50: row.wf_cov50, wf_cov80: row.wf_cov80, wf_n: wfTest.length, loo_n: peers.length };
  }
  return { fit: fitVal(peers, asOf, specs[3]), table, conformal, looMap };
 }
 function oddsFeatures(p, asOf, spec, catFn, oAge, o7d) {
  const f = [1];
  if (spec.tvl) f.push(log(max(1, p.tvl_usd) / 1e7));
  if (spec.age) f.push(log(1 + ((oAge !== undefined ? oAge : ageDays(asOf, p.listed_at)) ?? 730)) / 7);
  if (spec.change7d) f.push(o7d !== undefined ? o7d : clamp7d(p.change_7d));
  if (spec.chains) f.push(log(1 + min(CFG.chainCap, p.chains ? p.chains.length : 0)));
  if (spec.cat) f.push(catFn(p.category || 'Other'));
  return f;
 }
 function fitOdds(train, asOf, spec) {
  let pos = 0;
  const cs = {};
  for (const { p, y } of train) {
   pos += y;
   const c = p.category || 'Other';
   cs[c] = cs[c] || [0, 0];
   cs[c][0] += y; cs[c][1] += 1;
  }
  const baseRate = pos / max(1, train.length);
  const catFn = (c) => {
   const [h, n] = cs[c] || [0, 0];
   const r = clamp((h + CFG.oddsCatK * baseRate) / (n + CFG.oddsCatK), 0.02, 0.98);
   return log(r / (1 - r));
  };
  const weights = fitLogisticRegression(train.map((t) => oddsFeatures(t.p, asOf, spec, catFn)), train.map((t) => t.y), CFG.oddsL2);
  const catLogits = {}, catRates = {};
  for (const c of Object.keys(cs).sort()) {
   catLogits[c] = round4(catFn(c));
   catRates[c] = { tokenized: cs[c][0], total: cs[c][1], rate: round4(cs[c][0] / cs[c][1]) };
  }
  return { spec, weights, baseRate, defLogit: round4(catFn('__')), catLogits, catRates };
 }
 const predOdds = (fit, p, asOf, oAge, o7d) =>
  sigmoid(dot(fit.weights, oddsFeatures(p, asOf, fit.spec, (c) => fit.catLogits[c] ?? fit.defLogit, oAge, o7d)));
 // Bayes survival hazard: P(launch before 5y | still pre-token at age t).
 function estimateLaunchHazard(fit, p, asOf) {
  const cur = ageDays(asOf, p.listed_at) ?? 540, hor = max(cur + 730, 1825);
  const fNow = predOdds(fit, p, asOf, cur, clamp7d(p.change_7d)), fHor = predOdds(fit, p, asOf, hor, 0);
  return { peer_rate_now: round4(fNow), peer_rate_horizon: round4(fHor), launch_odds: round4(clamp((fHor - fNow) / max(0.05, 1 - fNow), 0.04, 0.85)) };
 }
 function computeAuc(ys, ps) {
  const pos = [], neg = [];
  ys.forEach((y, i) => (y === 1 ? pos : neg).push(ps[i]));
  if (!pos.length || !neg.length) return 0.5;
  let wins = 0;
  for (const a of pos) for (const b of neg) wins += a > b ? 1 : a === b ? 0.5 : 0;
  return wins / (pos.length * neg.length);
 }
 function runOddsBenchmarks(univ, asOf) {
  const specs = [
   { id: 'base', label: 'Base rate only', decision: 'BASELINE' },
   { id: 'cat', label: '+ Category shrunk prior (k=6)', cat: true, decision: 'KEPT' },
   { id: 'cat_tvl', label: '+ ln(TVL)', cat: true, tvl: true, decision: 'KEPT' },
   { id: 'cat_tvl_age', label: '+ Protocol age ln(1+age)', cat: true, tvl: true, age: true, decision: 'KEPT' },
   { id: 'final', label: '+ 7d TVL growth (clamped)', cat: true, tvl: true, age: true, change7d: true, decision: 'KEPT (FINAL)' },
   { id: 'plus_chains', label: '+ Capped chains ln(1+min(c,4))', cat: true, tvl: true, age: true, change7d: true, chains: true, decision: 'DROPPED' },
  ];
  const [wfTr, wfTe] = wfSplit(univ, (t) => t.p);
  const brier = (ys, ps) => round4(ys.reduce((s, y, i) => s + (ps[i] - y) ** 2, 0) / ys.length);
  const table = specs.map((s) => {
   const cv = kFold10(univ, (tr) => fitOdds(tr, asOf, s), (fit, t) => [predOdds(fit, t.p, asOf), t.y]);
   const cvP = cv.map((x) => x[0]), cvY = cv.map((x) => x[1]);
   const wfF = fitOdds(wfTr, asOf, s), wfP = wfTe.map((t) => predOdds(wfF, t.p, asOf)), wfY = wfTe.map((t) => t.y);
   return { id: s.id, label: s.label, decision: s.decision, cv_brier: brier(cvY, cvP), cv_auc: round4(computeAuc(cvY, cvP)), wf_brier: brier(wfY, wfP), wf_auc: round4(computeAuc(wfY, wfP)) };
  });
  const buckets = [['<6m', 0, 180], ['6-12m', 180, 365], ['1-2y', 365, 730], ['2-3y', 730, 1095], ['3-4y', 1095, 1460], ['4y+', 1460, 99999]];
  const ageCurve = buckets.map(([label, lo, hi]) => {
   let total = 0, tokenized = 0;
   for (const t of univ) { const ad = ageDays(asOf, t.p.listed_at); if (ad !== null && ad >= lo && ad < hi) { total++; tokenized += t.y; } }
   return { label, total, tokenized, rate: total ? round((tokenized / total) * 100) : 0 };
  });
  return { fit: fitOdds(univ, asOf, specs[4]), table, ageCurve, universeN: univ.length, wfTestN: wfTe.length };
 }
 function pickCheapestChain(chains) {
  if (!chains || !chains.length) return { chain: 'primary chain', gas: 0.5, alt: null };
  let best = chains[0], bG = CHAIN_GAS_USD[best] ?? 0.5, worst = best, wG = bG;
  for (const c of chains.slice(1)) {
   const g = CHAIN_GAS_USD[c] ?? 0.5;
   if (g < bG || (g === bG && c < best)) { best = c; bG = g; }
   if (g > wG) { worst = c; wG = g; }
  }
  return { chain: best, gas: bG, alt: wG > bG * 2.5 ? { chain: worst, gas: wG } : null };
 }
 // Costed farm plan with cheapest-chain routing, liquidity realizability,
 // closed-form break-even FDV, 50% band sensitivity, and live budget override.
 function buildCostedFarmPlan(p, impliedUsd, low50Usd, high50Usd, odds, age, budgetOverride) {
  const route = pickCheapestChain(p.chains), chain = route.chain, gasPerTx = route.gas, hiGas = gasPerTx >= 2;
  const hold = age !== null && age < 180 ? 60 : (age === null || age < 365 ? 45 : 30);
  const cad = max(2, ceil(hold / (hiGas ? 14 : 7))), txs = 6 + cad, gas = txs * gasPerTx;
  const catL = (p.category || 'Other').toLowerCase();
  const isInst = /curator|allocator|rwa/.test(catL), isTrd = /dex|perp|deriv|predict|option|basis/.test(catL);
  const baseCap = (p.tvl_usd >= 5e8 && isInst) ? 1000 : p.tvl_usd >= 2e8 ? 750 : p.tvl_usd >= 5e7 ? 500 : p.tvl_usd >= 15e6 ? 300 : 200;
  const minCap = max(baseCap, min(2500, ceil((gas * 25) / 100) * 100));
  const cap = budgetOverride > 0 ? max(100, round(budgetOverride)) : minCap;
  const fees = cap * (isTrd ? 0.0025 : 0.0008), opp = cap * (isTrd ? 0.045 : 0.015) * (hold / 365), cost = gas + fees + opp, hrs = (40 + 5 * cad) / 60;
  const realizable = 0.45 + 0.55 * (p.tvl_usd / (p.tvl_usd + 40e6));
  const proRata = 0.6 * CFG.airdropPoolPct * (cap / max(cap, p.tvl_usd * CFG.activeTvlFrac)) * CFG.loyaltyBoost;
  const tierShare = (0.4 * CFG.airdropPoolPct) / max(1800, sqrt(p.tvl_usd / 120) * 6);
  const unitEv = odds * realizable * (proRata + tierShare), maxPay = cap * 1.1;
  const netAt = (fdv) => min(maxPay, fdv * unitEv) - cost;
  const evGross = min(maxPay, impliedUsd * unitEv), netEv = evGross - cost, phr = netEv / hrs;
  const bearPhr = netAt(low50Usd) / hrs, bullPhr = netAt(high50Usd) / hrs, breakeven = unitEv > 1e-12 ? round(cost / unitEv) : null;
  const fg = fmtGas, fc = fmtCompact, sub = max(25, round(cap * 0.2)), cadLbl = hiGas ? 'bi-weekly' : 'weekly', nm = p.name, loc = `${nm} (${chain})`;
  const isMature = age !== null ? age >= 14 : p.tvl_usd >= 5e7, outflow = p.change_7d !== null && p.change_7d <= -25;
  let verdict = 'SKIP', why = `Costs (${fg(cost)}) exceed expected EV (${fg(evGross)})`;
  if (outflow) why = `Severe 7d TVL outflow (${p.change_7d.toFixed(1)}%) — wait for stabilization`;
  else if (phr < 0) verdict = 'SKIP';
  else if (odds < 0.14 && phr < 15) why = `Low peer-implied remaining launch odds (${round(odds * 100)}%)`;
  else if (phr >= 18 && odds >= 0.24 && isMature && (p.change_7d === null || p.change_7d > -20)) {
   verdict = 'FARM'; why = `Strong +$${round(phr)}/hr net · ${round(odds * 100)}% odds · break-even ${fc(breakeven || 0)}`;
  } else if (!isMature && phr >= 18) {
   verdict = 'SELECTIVE'; why = `Young contract (${age ?? '?'}d old) — cap size until 14d track record`;
  } else {
   verdict = 'SELECTIVE'; why = `Modest +$${round(phr)}/hr — worth farming if capital is already on ${chain}`;
  }
  const ACTIONS = [
   [/lend|cdp|collateral/, 'Supply/borrow', `Supply $${cap} USDC collateral on ${loc} to accrue TVL hours.`, `Borrow $${sub} USDC (<30% LTV) on ${nm}, hold 7d, then repay for credit usage.`],
   [/dex|liquidity/, 'Provide LP', `Provide $${cap} liquidity to ${nm}'s deepest stable/major pool on ${chain}.`, `Execute two $${sub} swaps on ${loc} on separate days for taker volume.`],
   [/basis|perp|deriv|option/, 'Margin hedge', `Deposit $${cap} USDC margin on ${loc} and open a <2x hedged position.`, `Close and reopen a $${sub} position on a second ${nm} market for volume.`],
   [/curator|allocator|yield/, 'Deposit vault', `Deposit $${cap} USDC into ${nm}'s flagship audited vault on ${chain} and hold shares.`, `Add $${sub} into a second ${nm} vault or compound after 14d for retention.`],
   [/rwa|stable|payment/, 'Mint/hold RWA', `Mint or deposit $${cap} into ${nm}'s yield/stable instrument on ${chain} and hold natively.`, `Complete one $${sub} transfer, redemption, or re-mint cycle on ${nm}.`],
   [/restak|stak/, 'Stake receipt', `Stake $${cap} native asset via ${nm} on ${chain} and hold the liquid receipt token.`, `Verify delegation on ${nm} and top up $${sub} after 14d for sustained stake.`],
   [/./, 'Deposit core', `Deposit $${cap} USDC into ${nm}'s core contract on ${chain} across snapshot epochs.`, `Run a $${sub} follow-up action (top-up, swap, or claim check) inside ${nm} 7d later.`],
  ];
  const [, shortVerb, act1, act2] = ACTIONS.find(([re]) => re.test(catL));
  const risk = outflow ? `Outflow guard: TVL fell ${abs(round(p.change_7d))}% in 7d — cap at $${cap}; exit if outflows persist.`
   : gas >= 25 ? `Gas guard: ${fg(gas)} L1 gas is ${(gas / cap * 100).toFixed(1)}% of $${cap} — batch at low gwei, never size below $${minCap}.`
   : odds < 0.15 ? `Tokenization guard: peers imply ${round(odds * 100)}% odds — farm only if native APY covers ${fg(gas)} gas.`
   : p.tvl_usd < 12e6 ? `Liquidity guard: TVL is ${fc(p.tvl_usd)} — run a $25 test exit before full deposit.`
   : age !== null && age < 90 ? `Maturity guard: listed ${age}d ago — verify audits/timelocks and cap at $${cap} until 90d.`
   : `Contract guard: monitor ${nm}'s TVL concentration weekly; unwind if 7d TVL falls >25%.`;
  const routeNote = route.alt ? ` Route via ${chain} (${fg(gasPerTx)}/tx) vs ${route.alt.chain} (${fg(route.alt.gas)}/tx — ${round(route.alt.gas / gasPerTx)}x cheaper).` : ` Budget ${fg(gasPerTx)}/tx on ${chain}.`;
  const steps = [
   ['Isolate wallet & route cheapest chain', `Fund a dedicated wallet with $${cap} plus ${fg(gas)} gas on ${chain}.${routeNote}`, `${fg(gasPerTx * 2)} gas`, '10 min'],
   ['Open primary qualifying position', act1, `$${cap} cap + ${fg(gasPerTx * 2 + fees * 0.6)}`, '10 min'],
   ['Complete second qualifying action', act2, `${fg(gasPerTx * 2 + fees * 0.4)} gas/fees`, '10 min'],
   [`Maintain ${cadLbl} snapshot cadence`, `Execute ${cad} small ${cadLbl} actions on ${loc} over ${hold}d for multi-epoch snapshots.`, `${fg(cad * gasPerTx)} (${cad} tx)`, `${cad * 5} min`],
   ['Enforce protocol-specific risk guard', risk, `${fg(opp)} carry`, `${hold}d hold`],
   ['Verify claim & break-even exit rule', `After ${hold}d check ${nm}'s official claim portal (never pay third-party fees); unwind if unannounced near ${fc(breakeven || 0)} break-even.`, `${fg(cost)} total`, `${hrs.toFixed(1)}h total`],
  ].map(([title, action, c, time]) => ({ title, action, cost: c, time }));
  const step_strings = steps.map((st) => { const s = `${st.action} Cost: ${st.cost}. Time: ${st.time}.`; return s.length > 600 ? `${s.slice(0, 596)}...` : s; });
  return {
   verdict, why, summary: `${shortVerb} $${cap} on ${chain}`, chain,
   alt_chain: route.alt ? route.alt.chain : null, alt_gas: route.alt ? route.alt.gas : null,
   gas_tx: round2(gasPerTx), cap, min_cap: minCap, hold, txs,
   gas: round2(gas), fees: round2(fees), opp: round2(opp), cost: round2(cost), hrs: round2(hrs),
   ev_gross: round2(evGross), net_ev: round2(netEv), phr: round2(phr),
   bear_phr: round2(bearPhr), bull_phr: round2(bullPhr), breakeven_fdv: breakeven, steps, step_strings,
  };
 }
 // Live browser parity recomputation executed for every ranked protocol.
 function recomputeProtocolValue(row, vm) {
  const b = vm.beta, capCh = min(vm.chain_cap, row.chains ? row.chains.length : 0);
  const lp = b[0] + b[1] * log(max(1, row.tvl_usd)) + b[2] * log(1 + capCh) + (vm.cat_offsets[row.category || 'Other'] || 0);
  const implied = max(1, round(exp(lp)));
  return {
   implied,
   low50: max(1, round(exp(lp - vm.q50))), high50: max(implied, round(exp(lp + vm.q50))),
   low80: max(1, round(exp(lp - vm.q80))), high80: max(implied, round(exp(lp + vm.q80))),
  };
 }
 root.RADAR_ENGINE = {
  CFG, ageDays, bySlug, round4, round2, exclusionReason, classifyUniverse, fitHuberPowerLaw,
  predictLogValue: predLog, runValueBenchmarks, fitLogisticRegression, runOddsBenchmarks,
  estimateLaunchHazard, buildCostedFarmPlan, recomputeProtocolValue,
 };
})(typeof globalThis !== 'undefined' ? globalThis : window);
