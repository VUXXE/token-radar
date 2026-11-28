// Empirical Token Launch Radar Engine (radar-6).
// Single source of truth executed by Node (lib/model.ts) and browser (dashboard/app.js).
((root) => {
  'use strict';

  const DAY_MS = 86_400_000;
  const VER_RE = /(\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)|[A-Za-z]V\d+(\.\d+)?)$/;
  const WRAP_RE = /\b(wrapped|staked|staking)\b/i;
  const ST_RE = /\bst[A-Z]{2,}\b/;
  const EXCL_CATS = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
  const EXCH_PRE = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
  const GAS = {
    Solana: 0.02, Algorand: 0.02, Near: 0.02, Stellar: 0.02, Sui: 0.03, Aptos: 0.03, Sei: 0.03,
    Polygon: 0.05, Sonic: 0.05, Gnosis: 0.05, TON: 0.05, Monad: 0.1, 'Hyperliquid L1': 0.1,
    Mantle: 0.1, Flare: 0.1, Plasma: 0.1, Ink: 0.12, Unichain: 0.12, Starknet: 0.12, Base: 0.15,
    Arbitrum: 0.15, Optimism: 0.15, Binance: 0.15, BSC: 0.15, Berachain: 0.15, Plume: 0.15,
    'Plume Mainnet': 0.15, Katana: 0.15, Corn: 0.15, Arc: 0.15, BSquared: 0.15, Linea: 0.2,
    Scroll: 0.2, 'zkSync Era': 0.2, Bittensor: 0.25, Avalanche: 0.35, Tron: 0.8, Bitcoin: 3.5, Ethereum: 5.5,
  };
  const CFG = { version: 'radar-6', delta: 0.5, ridge: 1e-3, chainCap: 4, catK: 5, resCap: 2.5, oddsL2: 2, oddsCatK: 6, wfSplit: 0.65, poolPct: 0.075, actTvl: 0.35, boost: 1.85 };

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const r4 = (n) => Math.round(n * 1e4) / 1e4;
  const r2 = (n) => Math.round(n * 100) / 100;
  const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
  const bySlug = (a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
  const sig = (z) => 1 / (1 + Math.exp(-clamp(z, -30, 30)));
  const c7d = (v) => clamp(typeof v === 'number' && isFinite(v) ? v : 0, -60, 120) / 100;
  const hasTok = (p) => p.gecko_id !== null || p.symbol !== null || p.mcap_usd !== null;
  const fGas = (n) => (n < 1 ? `$${n.toFixed(2)}` : n < 10 ? `$${n.toFixed(1)}` : `$${Math.round(n)}`);
  const fUsd = (n) => (n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1e3)}K`);
  const rmse = (e) => (e.length ? r2(Math.sqrt(e.reduce((s, x) => s + x * x, 0) / e.length)) : 0);
  const ageDays = (asOf, d) => { if (!d) return null; const a = Date.parse(`${asOf}T00:00:00Z`), b = Date.parse(`${d}T00:00:00Z`); return isFinite(a) && isFinite(b) ? Math.max(0, Math.floor((a - b) / DAY_MS)) : null; };
  const median = (v) => { if (!v.length) return 0; const s = v.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const confQ = (v, q) => { if (!v.length) return 0; const s = v.slice().sort((x, y) => x - y); return s[clamp(Math.ceil(q * (s.length + 1)) - 1, 0, s.length - 1)]; };

  function solveLinear(A, b) {
    const n = b.length, M = A.map((r, i) => [...r, b[i]]);
    for (let c = 0; c < n; c++) {
      let piv = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      [M[c], M[piv]] = [M[piv], M[c]];
      const d = M[c][c]; if (Math.abs(d) < 1e-12) continue;
      for (let j = c; j <= n; j++) M[c][j] /= d;
      for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c]; for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j]; }
    }
    return M.map((r) => r[n]);
  }

  /** IRLS Huber power-law regression with L2 ridge on slope terms. */
  function fitHuberPowerLaw(X, y, delta, ridge) {
    const n = y.length, p = X[0].length, w = new Array(n).fill(1);
    let beta = new Array(p).fill(0);
    for (let it = 0; it < 30; it++) {
      const A = Array.from({ length: p }, () => new Array(p).fill(0)), g = new Array(p).fill(0);
      for (let i = 0; i < n; i++) for (let a = 0; a < p; a++) { g[a] += w[i] * X[i][a] * y[i]; for (let c = 0; c < p; c++) A[a][c] += w[i] * X[i][a] * X[i][c]; }
      for (let d = 1; d < p; d++) A[d][d] += ridge;
      beta = solveLinear(A, g);
      for (let i = 0; i < n; i++) { const e = Math.abs(y[i] - dot(beta, X[i])); w[i] = e <= delta ? 1 : delta / e; }
    }
    return beta;
  }

  /** Newton-Raphson L2 logistic regression. */
  function fitLogisticRegression(X, y, l2) {
    const n = y.length, p = X[0].length;
    let w = new Array(p).fill(0);
    for (let it = 0; it < 25; it++) {
      const H = Array.from({ length: p }, () => new Array(p).fill(0)), g = new Array(p).fill(0);
      for (let i = 0; i < n; i++) {
        const pr = sig(dot(w, X[i])), wt = Math.max(1e-6, pr * (1 - pr)), err = y[i] - pr;
        for (let a = 0; a < p; a++) { g[a] += err * X[i][a]; for (let c = 0; c < p; c++) H[a][c] += wt * X[i][a] * X[i][c]; }
      }
      for (let d = 1; d < p; d++) { H[d][d] += l2; g[d] -= l2 * w[d]; }
      const step = solveLinear(H, g);
      w = w.map((v, k) => v + step[k]);
      if (Math.max(...step.map(Math.abs)) < 1e-6) break;
    }
    return w;
  }

  function exclusionReason(p, floor, isWl) {
    if (isWl) return null;
    if (p.category === 'CEX') return 'Centralized exchange (CEX)';
    if (p.category && EXCL_CATS.has(p.category)) return `Excluded derivative/infra (${p.category})`;
    if (VER_RE.test(p.name)) return 'Versioned pool of existing protocol';
    if (WRAP_RE.test(p.name) || ST_RE.test(p.name)) return 'Wrapped or staked receipt token';
    const ex = EXCH_PRE.find((e) => p.name.startsWith(e));
    if (ex) return `Exchange-branded product (${ex})`;
    return !hasTok(p) && p.tvl_usd >= floor ? 'Parent protocol recorded by DefiLlama (>=$50M)' : null;
  }

  /** Exact 4-lane partition of all 758 protocols (zero silent drops). */
  function classifyUniverse(snap) {
    const wlSet = new Set(snap.watchlist), watchlist = [], early = [], excluded = [], live = [], livePricedClean = [], exclCounts = {};
    for (const p of snap.protocols) {
      if (wlSet.has(p.slug)) watchlist.push(p);
      else if (hasTok(p)) { live.push(p); if (!exclusionReason(p, snap.floor_usd, false) && p.mcap_usd > 0 && p.tvl_usd > 0) livePricedClean.push(p); }
      else { const why = exclusionReason(p, snap.floor_usd, false); if (why) { excluded.push({ protocol: p, reason: why }); exclCounts[why] = (exclCounts[why] || 0) + 1; } else early.push(p); }
    }
    return { wlSet, watchlist, early, excluded, live, livePricedClean: livePricedClean.sort(bySlug), exclCounts };
  }

  function valueFeatures(p, asOf, sp) {
    const f = [1, Math.log(Math.max(1, p.tvl_usd))];
    if (sp.ch) f.push(Math.log(1 + Math.min(CFG.chainCap, p.chains ? p.chains.length : 0)));
    if (sp.d7) f.push(c7d(p.change_7d));
    if (sp.age) f.push(Math.log(1 + (ageDays(asOf, p.listed_at) ?? 730)));
    return f;
  }

  function fitValueSpec(peers, asOf, sp) {
    if (sp.lin) return { lin: true, medRatio: median(peers.map((p) => p.mcap_usd / p.tvl_usd)) };
    const X = peers.map((p) => valueFeatures(p, asOf, sp)), y = peers.map((p) => Math.log(p.mcap_usd));
    const beta = fitHuberPowerLaw(X, y, CFG.delta, CFG.ridge), catRes = {};
    peers.forEach((p, i) => { const c = p.category || 'Other'; (catRes[c] = catRes[c] || []).push(clamp(y[i] - dot(beta, X[i]), -CFG.resCap, CFG.resCap)); });
    const catOffsets = {}, catCounts = {};
    for (const c of Object.keys(catRes).sort()) { const rs = catRes[c]; catCounts[c] = rs.length; catOffsets[c] = sp.cat ? (rs.length / (rs.length + CFG.catK)) * median(rs) : 0; }
    return { sp, beta, catOffsets, catCounts };
  }

  const predictLogValue = (fit, p, asOf) =>
    (fit.lin ? Math.log(Math.max(1, p.tvl_usd * fit.medRatio)) : dot(fit.beta, valueFeatures(p, asOf, fit.sp)) + (fit.catOffsets[p.category || 'Other'] || 0));

  /** Four blind out-of-sample valuation proofs: LOO, 10-Fold, Walk-Forward, Cat-Block. */
  function runValueBenchmarks(peers, asOf) {
    const specs = [
      { id: 'linear', label: 'Linear median mcap/TVL', lin: true, decision: 'BASELINE' },
      { id: 'tvl', label: 'Power law: ln(TVL)', decision: 'KEPT' },
      { id: 'tvl_ch', label: '+ Capped chains ln(1+min(c,4))', ch: true, decision: 'KEPT' },
      { id: 'final', label: '+ Category shrunk offset (k=5)', ch: true, cat: true, decision: 'KEPT (FINAL)' },
      { id: 'plus_7d', label: '+ 7d TVL growth (clamped)', ch: true, cat: true, d7: true, decision: 'DROPPED' },
      { id: 'plus_age', label: '+ Protocol age ln(1+age)', ch: true, cat: true, age: true, decision: 'DROPPED' },
    ];
    const dated = peers.filter((p) => p.listed_at).sort((a, b) => (a.listed_at < b.listed_at ? -1 : a.listed_at > b.listed_at ? 1 : bySlug(a, b)));
    const sp = Math.floor(dated.length * CFG.wfSplit), wfTr = dated.slice(0, sp), wfTe = dated.slice(sp);
    const cats = [...new Set(peers.map((p) => p.category || 'Other'))].sort();
    const absErr = (fit, p) => Math.abs(Math.log(p.mcap_usd) - predictLogValue(fit, p, asOf));
    const table = [], looMap = {};
    let conformal = null;

    for (const s of specs) {
      const loo = peers.map((p, i) => {
        const lp = predictLogValue(fitValueSpec([...peers.slice(0, i), ...peers.slice(i + 1)], asOf, s), p, asOf);
        if (s.id === 'final') looMap[p.slug] = { pred: Math.round(Math.exp(lp)), ratio: r2(Math.exp(Math.log(p.mcap_usd) - lp)) };
        return Math.abs(Math.log(p.mcap_usd) - lp);
      });
      const cv10 = [], catErr = [];
      for (let f = 0; f < 10; f++) { const fit = fitValueSpec(peers.filter((_, i) => i % 10 !== f), asOf, s); for (const p of peers.filter((_, i) => i % 10 === f)) cv10.push(absErr(fit, p)); }
      const wfFit = fitValueSpec(wfTr, asOf, s), wf = wfTe.map((p) => absErr(wfFit, p));
      for (const c of cats) { const fit = fitValueSpec(peers.filter((p) => (p.category || 'Other') !== c), asOf, s); for (const p of peers.filter((p) => (p.category || 'Other') === c)) catErr.push(absErr(fit, p)); }
      const q50 = confQ(loo, 0.5), q80 = confQ(loo, 0.8), cov = (q) => Math.round((wf.filter((e) => e <= q).length / Math.max(1, wf.length)) * 100);
      const row = { id: s.id, label: s.label, decision: s.decision, loo_med_x: r2(Math.exp(median(loo))), loo_rmse: rmse(loo), cv10_med_x: r2(Math.exp(median(cv10))), wf_med_x: r2(Math.exp(median(wf))), wf_rmse: rmse(wf), cat_med_x: r2(Math.exp(median(catErr))), q50_x: r2(Math.exp(q50)), q80_x: r2(Math.exp(q80)), wf_cov50: cov(q50), wf_cov80: cov(q80) };
      table.push(row);
      if (s.id === 'final') conformal = { q50, q80, q50_x: row.q50_x, q80_x: row.q80_x, wf_cov50: row.wf_cov50, wf_cov80: row.wf_cov80, wf_n: wfTe.length, loo_n: peers.length };
    }
    return { fit: fitValueSpec(peers, asOf, specs[3]), table, conformal, looMap };
  }

  function oddsFeatures(p, asOf, sp, catFn, oAge, o7d) {
    const f = [1];
    if (sp.tvl) f.push(Math.log(Math.max(1, p.tvl_usd) / 1e7));
    if (sp.age) f.push(Math.log(1 + ((oAge !== undefined ? oAge : ageDays(asOf, p.listed_at)) ?? 730)) / 7);
    if (sp.d7) f.push(o7d !== undefined ? o7d : c7d(p.change_7d));
    if (sp.ch) f.push(Math.log(1 + Math.min(CFG.chainCap, p.chains ? p.chains.length : 0)));
    if (sp.cat) f.push(catFn(p.category || 'Other'));
    return f;
  }

  function fitOddsSpec(train, asOf, sp) {
    let pos = 0; const cs = {};
    for (const { p, y } of train) { pos += y; const c = p.category || 'Other'; cs[c] = cs[c] || [0, 0]; cs[c][0] += y; cs[c][1] += 1; }
    const baseRate = pos / Math.max(1, train.length);
    const catFn = (c) => { const [h, n] = cs[c] || [0, 0]; const r = clamp((h + CFG.oddsCatK * baseRate) / (n + CFG.oddsCatK), 0.02, 0.98); return Math.log(r / (1 - r)); };
    const weights = fitLogisticRegression(train.map((t) => oddsFeatures(t.p, asOf, sp, catFn)), train.map((t) => t.y), CFG.oddsL2);
    const catLogits = {}, catRates = {};
    for (const c of Object.keys(cs).sort()) { catLogits[c] = r4(catFn(c)); catRates[c] = { tokenized: cs[c][0], total: cs[c][1], rate: r4(cs[c][0] / cs[c][1]) }; }
    return { sp, weights, baseRate, defLogit: r4(catFn('__')), catLogits, catRates };
  }

  const predictOddsCdf = (fit, p, asOf, oAge, o7d) => sig(dot(fit.weights, oddsFeatures(p, asOf, fit.sp, (c) => fit.catLogits[c] ?? fit.defLogit, oAge, o7d)));

  /** Bayes survival hazard: P(launch before 5y | still pre-token at age t). */
  function estimateLaunchHazard(fit, p, asOf) {
    const cur = ageDays(asOf, p.listed_at) ?? 540, hor = Math.max(cur + 730, 1825);
    const fNow = predictOddsCdf(fit, p, asOf, cur, c7d(p.change_7d)), fHor = predictOddsCdf(fit, p, asOf, hor, 0);
    return { peer_rate_now: r4(fNow), peer_rate_horizon: r4(fHor), launch_odds: r4(clamp((fHor - fNow) / Math.max(0.05, 1 - fNow), 0.04, 0.85)) };
  }

  function computeAuc(ys, ps) {
    const pos = [], neg = []; ys.forEach((y, i) => (y === 1 ? pos : neg).push(ps[i]));
    if (!pos.length || !neg.length) return 0.5;
    let w = 0; for (const a of pos) for (const b of neg) w += a > b ? 1 : a === b ? 0.5 : 0;
    return w / (pos.length * neg.length);
  }

  function runOddsBenchmarks(univ, asOf) {
    const specs = [
      { id: 'base', label: 'Base rate only', decision: 'BASELINE' },
      { id: 'cat', label: '+ Category shrunk prior (k=6)', cat: true, decision: 'KEPT' },
      { id: 'cat_tvl', label: '+ ln(TVL)', cat: true, tvl: true, decision: 'KEPT' },
      { id: 'cat_tvl_age', label: '+ Protocol age ln(1+age)', cat: true, tvl: true, age: true, decision: 'KEPT' },
      { id: 'final', label: '+ 7d TVL growth (clamped)', cat: true, tvl: true, age: true, d7: true, decision: 'KEPT (FINAL)' },
      { id: 'plus_chains', label: '+ Capped chains ln(1+min(c,4))', cat: true, tvl: true, age: true, d7: true, ch: true, decision: 'DROPPED' },
    ];
    const dated = univ.filter((t) => t.p.listed_at).sort((a, b) => (a.p.listed_at < b.p.listed_at ? -1 : a.p.listed_at > b.p.listed_at ? 1 : bySlug(a.p, b.p)));
    const sp = Math.floor(dated.length * CFG.wfSplit), wfTr = dated.slice(0, sp), wfTe = dated.slice(sp);
    const br = (ys, ps) => r4(ys.reduce((s, y, i) => s + (ps[i] - y) ** 2, 0) / ys.length);
    const table = specs.map((s) => {
      const cvP = [], cvY = [];
      for (let f = 0; f < 10; f++) { const fit = fitOddsSpec(univ.filter((_, i) => i % 10 !== f), asOf, s); for (const t of univ.filter((_, i) => i % 10 === f)) { cvP.push(predictOddsCdf(fit, t.p, asOf)); cvY.push(t.y); } }
      const wfF = fitOddsSpec(wfTr, asOf, s), wfP = wfTe.map((t) => predictOddsCdf(wfF, t.p, asOf)), wfY = wfTe.map((t) => t.y);
      return { id: s.id, label: s.label, decision: s.decision, cv_brier: br(cvY, cvP), cv_auc: r4(computeAuc(cvY, cvP)), wf_brier: br(wfY, wfP), wf_auc: r4(computeAuc(wfY, wfP)) };
    });
    const ageCurve = [['<6m', 0, 180], ['6-12m', 180, 365], ['1-2y', 365, 730], ['2-3y', 730, 1095], ['3-4y', 1095, 1460], ['4y+', 1460, 99999]].map(([label, lo, hi]) => {
      let total = 0, tokenized = 0;
      for (const t of univ) { const ad = ageDays(asOf, t.p.listed_at); if (ad !== null && ad >= lo && ad < hi) { total++; tokenized += t.y; } }
      return { label, total, tokenized, rate: total ? Math.round((tokenized / total) * 100) : 0 };
    });
    return { fit: fitOddsSpec(univ, asOf, specs[4]), table, ageCurve, universeN: univ.length, wfTestN: wfTe.length };
  }

  function pickCheapestChain(chains) {
    if (!chains || !chains.length) return { chain: 'primary chain', gas: 0.5, alt: null };
    let best = chains[0], bG = GAS[best] ?? 0.5, worst = best, wG = bG;
    for (const c of chains.slice(1)) { const g = GAS[c] ?? 0.5; if (g < bG || (g === bG && c < best)) { best = c; bG = g; } if (g > wG) { worst = c; wG = g; } }
    return { chain: best, gas: bG, alt: wG > bG * 2.5 ? { chain: worst, gas: wG } : null };
  }

  /** Costed farm plan with cheapest-chain routing, break-even FDV, and 50% sensitivity. */
  function buildCostedFarmPlan(p, impliedUsd, low50Usd, high50Usd, odds, age) {
    const route = pickCheapestChain(p.chains), chain = route.chain, gTx = route.gas, hiGas = gTx >= 2;
    const hold = age !== null && age < 180 ? 60 : (age === null || age < 365 ? 45 : 30);
    const cad = Math.max(2, Math.ceil(hold / (hiGas ? 14 : 7))), txs = 6 + cad, gas = txs * gTx;
    const catL = (p.category || 'Other').toLowerCase(), isInst = /curator|allocator|rwa/.test(catL), isTrd = /dex|perp|deriv|predict|option|basis/.test(catL);
    const baseCap = (p.tvl_usd >= 5e8 && isInst) ? 1000 : p.tvl_usd >= 2e8 ? 750 : p.tvl_usd >= 5e7 ? 500 : p.tvl_usd >= 15e6 ? 300 : 200;
    const cap = Math.max(baseCap, Math.min(2500, Math.ceil((gas * 25) / 100) * 100));
    const fees = cap * (isTrd ? 0.0025 : 0.0008), opp = cap * (isTrd ? 0.045 : 0.015) * (hold / 365);
    const cost = gas + fees + opp, hrs = (40 + 5 * cad) / 60;

    const proRata = 0.6 * CFG.poolPct * (cap / Math.max(cap, p.tvl_usd * CFG.actTvl)) * CFG.boost;
    const tierShare = (0.4 * CFG.poolPct) / Math.max(1800, Math.sqrt(p.tvl_usd / 120) * 6);
    const unitEv = odds * (proRata + tierShare), maxPay = cap * 1.1;
    const netAt = (fdv) => Math.min(maxPay, fdv * unitEv) - cost;
    const evGross = Math.min(maxPay, impliedUsd * unitEv), netEv = evGross - cost, phr = netEv / hrs;
    const bearPhr = netAt(low50Usd) / hrs, bullPhr = netAt(high50Usd) / hrs;
    const breakeven = unitEv > 1e-12 ? Math.round(cost / unitEv) : null;

    const isMature = age !== null ? age >= 14 : p.tvl_usd >= 5e7, outflow = p.change_7d !== null && p.change_7d <= -25;
    let verdict = 'SKIP', why = `Costs (${fGas(cost)}) exceed expected EV (${fGas(evGross)})`;
    if (outflow) why = `Severe 7d TVL outflow (${p.change_7d.toFixed(1)}%) — wait for stabilization`;
    else if (phr < 0) verdict = 'SKIP';
    else if (odds < 0.14 && phr < 15) why = `Low peer-implied remaining launch odds (${Math.round(odds * 100)}%)`;
    else if (phr >= 18 && odds >= 0.24 && isMature && (p.change_7d === null || p.change_7d > -20)) { verdict = 'FARM'; why = `Strong +$${Math.round(phr)}/hr net · ${Math.round(odds * 100)}% odds · break-even ${fUsd(breakeven || 0)}`; }
    else if (!isMature && phr >= 18) { verdict = 'SELECTIVE'; why = `Young contract (${age ?? '?'}d old) — cap size until 14d track record`; }
    else { verdict = 'SELECTIVE'; why = `Modest +$${Math.round(phr)}/hr — worth farming if capital is already on ${chain}`; }

    const sub = Math.max(25, Math.round(cap * 0.2)), cadLbl = hiGas ? 'bi-weekly' : 'weekly';
    const [a1, a2] = /lend|cdp|collateral/.test(catL) ? [`Supply $${cap} USDC collateral on ${p.name} (${chain}) to accrue TVL hours.`, `Borrow $${sub} USDC (<30% LTV) on ${p.name}, hold 7d, then repay for credit usage.`]
      : /dex|liquidity/.test(catL) ? [`Provide $${cap} liquidity to ${p.name}'s deepest stable/major pool on ${chain}.`, `Execute two $${sub} swaps on ${p.name} (${chain}) on separate days for taker volume.`]
      : /basis|perp|deriv|option/.test(catL) ? [`Deposit $${cap} USDC margin on ${p.name} (${chain}) and open a <2x hedged position.`, `Close and reopen a $${sub} position on a second ${p.name} market for volume.`]
      : /curator|allocator|yield/.test(catL) ? [`Deposit $${cap} USDC into ${p.name}'s flagship audited vault on ${chain} and hold shares.`, `Add $${sub} into a second ${p.name} vault or compound after 14d for retention.`]
      : /rwa|stable|payment/.test(catL) ? [`Mint or deposit $${cap} into ${p.name}'s yield/stable instrument on ${chain} and hold natively.`, `Complete one $${sub} transfer, redemption, or re-mint cycle on ${p.name}.`]
      : /restak|stak/.test(catL) ? [`Stake $${cap} native asset via ${p.name} on ${chain} and hold the liquid receipt token.`, `Verify delegation on ${p.name} and top up $${sub} after 14d for sustained stake.`]
      : [`Deposit $${cap} USDC into ${p.name}'s core contract on ${chain} across snapshot epochs.`, `Run a $${sub} follow-up action (top-up, swap, or claim check) inside ${p.name} 7d later.`];

    const risk = outflow ? `Outflow guard: TVL fell ${Math.abs(Math.round(p.change_7d))}% in 7d — cap at $${cap}; exit if outflows continue.`
      : gas >= 25 ? `Gas guard: ${fGas(gas)} L1 gas is ${(gas / cap * 100).toFixed(1)}% of $${cap} — batch at low gwei, never size below $${cap}.`
      : odds < 0.15 ? `Tokenization guard: peers imply ${Math.round(odds * 100)}% odds — farm only if native APY covers ${fGas(gas)} gas.`
      : p.tvl_usd < 12e6 ? `Liquidity guard: TVL is ${fUsd(p.tvl_usd)} — run a $25 test exit before full deposit.`
      : age !== null && age < 90 ? `Maturity guard: listed ${age}d ago — verify audits/timelocks and cap at $${cap} until 90d.`
      : `Contract guard: monitor ${p.name}'s TVL concentration weekly; unwind if 7d TVL falls >25%.`;

    const rNote = route.alt ? ` Route via ${chain} (${fGas(gTx)}/tx) vs ${route.alt.chain} (${fGas(route.alt.gas)}/tx — ${Math.round(route.alt.gas / gTx)}x cheaper).` : ` Budget ${fGas(gTx)}/tx on ${chain}.`;
    const steps = [
      { title: 'Isolate wallet & route cheapest chain', action: `Fund a dedicated wallet with $${cap} plus ${fGas(gas)} gas on ${chain}.${rNote}`, cost: `${fGas(gTx * 2)} gas`, time: '10 min' },
      { title: 'Open primary qualifying position', action: a1, cost: `$${cap} cap + ${fGas(gTx * 2 + fees * 0.6)}`, time: '10 min' },
      { title: 'Complete second qualifying action', action: a2, cost: `${fGas(gTx * 2 + fees * 0.4)} gas/fees`, time: '10 min' },
      { title: `Maintain ${cadLbl} snapshot cadence`, action: `Execute ${cad} small ${cadLbl} actions on ${p.name} (${chain}) over ${hold}d for multi-epoch snapshots.`, cost: `${fGas(cad * gTx)} (${cad} tx)`, time: `${cad * 5} min` },
      { title: 'Enforce protocol-specific risk guard', action: risk, cost: `${fGas(opp)} carry`, time: `${hold}d hold` },
      { title: 'Verify claim & break-even exit rule', action: `After ${hold}d check ${p.name}'s official claim portal (never pay third-party fees); unwind if unannounced near ${fUsd(breakeven || 0)} break-even.`, cost: `${fGas(cost)} total`, time: `${hrs.toFixed(1)}h total` },
    ];
    const step_strings = steps.map((st) => { const s = `${st.action} Cost: ${st.cost}. Time: ${st.time}.`; return s.length > 600 ? `${s.slice(0, 596)}...` : s; });
    return { verdict, why, chain, alt_chain: route.alt ? route.alt.chain : null, alt_gas: route.alt ? route.alt.gas : null, gas_tx: r2(gTx), cap, hold, txs, gas: r2(gas), fees: r2(fees), opp: r2(opp), cost: r2(cost), hrs: r2(hrs), ev_gross: r2(evGross), net_ev: r2(netEv), phr: r2(phr), bear_phr: r2(bearPhr), bull_phr: r2(bullPhr), breakeven_fdv: breakeven, steps, step_strings };
  }

  /** Browser-side parity recomputation executed on every ranked protocol. */
  function recomputeProtocolValue(row, vm) {
    const b = vm.beta, capCh = Math.min(vm.chain_cap, row.chains ? row.chains.length : 0);
    const lp = b[0] + b[1] * Math.log(Math.max(1, row.tvl_usd)) + b[2] * Math.log(1 + capCh) + (vm.cat_offsets[row.category || 'Other'] || 0);
    const implied = Math.max(1, Math.round(Math.exp(lp)));
    return { implied, low50: Math.max(1, Math.round(Math.exp(lp - vm.q50))), high50: Math.max(implied, Math.round(Math.exp(lp + vm.q50))), low80: Math.max(1, Math.round(Math.exp(lp - vm.q80))), high80: Math.max(implied, Math.round(Math.exp(lp + vm.q80))) };
  }

  root.RADAR_ENGINE = {
    CFG, ageDays, bySlug, r4, r2, exclusionReason, classifyUniverse,
    fitHuberPowerLaw, predictLogValue, runValueBenchmarks,
    fitLogisticRegression, runOddsBenchmarks, estimateLaunchHazard,
    buildCostedFarmPlan, recomputeProtocolValue,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
