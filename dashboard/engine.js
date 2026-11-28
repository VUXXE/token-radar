// Empirical Token Launch Radar Engine (radar-5). Single source of truth for
// main.ts (board.json & data.js) and dashboard/app.js (live browser parity check).
((root) => {
  'use strict';

  const DAY_MS = 864e5;
  const VERSIONED_RE = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
  const WRAP_RE = /\b(wrapped|staked|staking)\b/i;
  const EXCL_CATS = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
  const EXCH_PRE = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
  const GAS={Solana:.02,Algorand:.02,Near:.02,Stellar:.02,Sui:.03,Aptos:.03,Sei:.03,Polygon:.05,Sonic:.05,Gnosis:.05,TON:.05,Monad:.1,'Hyperliquid L1':.1,Mantle:.1,Flare:.1,Plasma:.1,Ink:.12,Unichain:.12,Starknet:.12,Base:.15,Arbitrum:.15,Optimism:.15,Binance:.15,BSC:.15,Berachain:.15,Plume:.15,Katana:.15,Corn:.15,Arc:.15,BSquared:.15,Linea:.2,Scroll:.2,'zkSync Era':.2,Bittensor:.25,Avalanche:.35,Tron:.8,Bitcoin:3.5,Ethereum:5.5};
  const CFG={version:'radar-5',delta:.5,ridge:1e-3,catK:5,resCap:2.5,oddsL2:2,oddsCatK:6,wf:.65,poolPct:.075,actTvl:.35,boost:2};

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const r4 = (n) => Math.round(n * 1e4) / 1e4;
  const r2 = (n) => Math.round(n * 100) / 100;
  const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
  const bySlug = (a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
  const sig = (z) => 1 / (1 + Math.exp(-clamp(z, -30, 30)));
  const c7d = (v) => clamp(typeof v === 'number' && isFinite(v) ? v : 0, -60, 120) / 100;
  const hasTok = (p) => p.gecko_id !== null || p.symbol !== null || p.mcap_usd !== null;
  const usdS = (n) => (n < 1 ? `$${n.toFixed(2)}` : n < 10 ? `$${n.toFixed(1)}` : `$${Math.round(n)}`);
  const ageDays = (asOf, d) => {
    if (!d) return null;
    const a = Date.parse(`${asOf}T00:00:00Z`), b = Date.parse(`${d}T00:00:00Z`);
    return isFinite(a) && isFinite(b) ? Math.max(0, Math.floor((a - b) / DAY_MS)) : null;
  };
  const med = (a) => {
    if (!a.length) return 0;
    const s = a.slice().sort((x, y) => x - y), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const confQ = (a, q) => {
    if (!a.length) return 0;
    const s = a.slice().sort((x, y) => x - y);
    return s[clamp(Math.ceil(q * (s.length + 1)) - 1, 0, s.length - 1)];
  };

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
  function fitHuber(X, y, delta, ridge) {
    const n = y.length, p = X[0].length, w = new Array(n).fill(1); let beta = new Array(p).fill(0);
    for (let it = 0; it < 30; it++) {
      const A = Array.from({ length: p }, () => new Array(p).fill(0)), g = new Array(p).fill(0);
      for (let i = 0; i < n; i++) for (let a = 0; a < p; a++) { g[a] += w[i] * X[i][a] * y[i]; for (let c = 0; c < p; c++) A[a][c] += w[i] * X[i][a] * X[i][c]; }
      for (let d = 1; d < p; d++) A[d][d] += ridge;
      beta = solveLinear(A, g);
      for (let i = 0; i < n; i++) { const e = Math.abs(y[i] - dot(beta, X[i])); w[i] = e <= delta ? 1 : delta / e; }
    }
    return beta;
  }
  function fitLogReg(X, y, l2) {
    const n = y.length, p = X[0].length; let w = new Array(p).fill(0);
    for (let it = 0; it < 25; it++) {
      const H = Array.from({ length: p }, () => new Array(p).fill(0)), g = new Array(p).fill(0);
      for (let i = 0; i < n; i++) {
        const pr = sig(dot(w, X[i])), wt = Math.max(1e-6, pr * (1 - pr)), err = y[i] - pr;
        for (let a = 0; a < p; a++) { g[a] += err * X[i][a]; for (let c = 0; c < p; c++) H[a][c] += wt * X[i][a] * X[i][c]; }
      }
      for (let d = 1; d < p; d++) { H[d][d] += l2; g[d] -= l2 * w[d]; }
      const step = solveLinear(H, g); w = w.map((v, k) => v + step[k]);
      if (Math.max(...step.map(Math.abs)) < 1e-6) break;
    }
    return w;
  }

  function exclusionReason(p, floor, isWl) {
    if (isWl) return null;
    if (p.category === 'CEX') return 'Centralized exchange (CEX)';
    if (p.category && EXCL_CATS.has(p.category)) return `Excluded derivative/infra (${p.category})`;
    if (VERSIONED_RE.test(p.name)) return 'Versioned pool of existing protocol';
    if (WRAP_RE.test(p.name)) return 'Wrapped or staked token wrapper';
    const ex = EXCH_PRE.find((e) => p.name.startsWith(e));
    if (ex) return `Exchange-branded product (${ex})`;
    return !hasTok(p) && p.tvl_usd >= floor ? 'Parent protocol recorded by DefiLlama (>=$50M)' : null;
  }
  function classifyUniverse(snap) {
    const wlSet = new Set(snap.watchlist), watchlist = [], early = [], excluded = [], live = [], livePricedClean = [], exclCounts = {};
    for (const p of snap.protocols) {
      if (wlSet.has(p.slug)) watchlist.push(p);
      else if (hasTok(p)) { live.push(p); if (!exclusionReason(p, snap.floor_usd, false) && p.mcap_usd > 0 && p.tvl_usd > 0) livePricedClean.push(p); }
      else { const why = exclusionReason(p, snap.floor_usd, false); if (why) { excluded.push({ protocol: p, reason: why }); exclCounts[why] = (exclCounts[why] || 0) + 1; } else early.push(p); }
    }
    return { wlSet, watchlist, early, excluded, live, livePricedClean: livePricedClean.sort(bySlug), exclCounts };
  }

  function valFeat(p, asOf, sp) {
    const f = [1, Math.log(Math.max(1, p.tvl_usd))];
    if (sp.ch) f.push(Math.log(1 + (p.chains ? p.chains.length : 0)));
    if (sp.d7) f.push(c7d(p.change_7d));
    if (sp.age) f.push(Math.log(1 + (ageDays(asOf, p.listed_at) ?? 365)));
    return f;
  }

  function fitValueSpec(peers, asOf, sp) {
    if (sp.lin) return { lin: true, medR: med(peers.map((p) => p.mcap_usd / p.tvl_usd)) };
    const X = peers.map((p) => valFeat(p, asOf, sp)), y = peers.map((p) => Math.log(p.mcap_usd));
    const beta = fitHuber(X, y, CFG.delta, CFG.ridge), catRes = {};
    peers.forEach((p, i) => {
      const c = p.category || 'Other';
      (catRes[c] = catRes[c] || []).push(clamp(y[i] - dot(beta, X[i]), -CFG.resCap, CFG.resCap));
    });
    const catOffsets = {}, catCounts = {};
    for (const c of Object.keys(catRes).sort()) {
      const rs = catRes[c];
      catCounts[c] = rs.length;
      catOffsets[c] = sp.cat ? (rs.length / (rs.length + CFG.catK)) * med(rs) : 0;
    }
    return { sp, beta, catOffsets, catCounts };
  }

  const predLogVal = (fit, p, asOf) => (fit.lin ? Math.log(Math.max(1, p.tvl_usd * fit.medR)) : dot(fit.beta, valFeat(p, asOf, fit.sp)) + (fit.catOffsets[p.category || 'Other'] || 0));

  function runValueValidation(peers, asOf) {
    const specs = [
      { id: 'linear', label: 'Linear median mcap/TVL', lin: true, decision: 'BASELINE' },
      { id: 'tvl', label: 'Power law: log(TVL)', decision: 'KEPT' },
      { id: 'tvl_chains', label: '+ Chain breadth log(1+chains)', ch: true, decision: 'KEPT' },
      { id: 'final', label: '+ Category shrunk offset (k=5)', ch: true, cat: true, decision: 'KEPT (FINAL)' },
      { id: 'plus_7d', label: '+ 7d TVL growth (clamped)', ch: true, cat: true, d7: true, decision: 'DROPPED' },
      { id: 'plus_age', label: '+ Protocol age log(1+age)', ch: true, cat: true, age: true, decision: 'DROPPED' },
    ];
    const dated = peers.filter((p) => p.listed_at).sort((a, b) => (a.listed_at < b.listed_at ? -1 : a.listed_at > b.listed_at ? 1 : bySlug(a, b)));
    const sp = Math.floor(dated.length * CFG.wf), wfTr = dated.slice(0, sp), wfTe = dated.slice(sp), table = [], looMap = {};
    let conformal = null;
    for (const s of specs) {
      const loo = peers.map((p, i) => {
        const pr = predLogVal(fitValueSpec([...peers.slice(0, i), ...peers.slice(i + 1)], asOf, s), p, asOf);
        if (s.id === 'final') looMap[p.slug] = { pred: Math.round(Math.exp(pr)), ratio: r2(Math.exp(Math.log(p.mcap_usd) - pr)) };
        return Math.abs(Math.log(p.mcap_usd) - pr);
      });
      const wfF = fitValueSpec(wfTr, asOf, s), wf = wfTe.map((p) => Math.abs(Math.log(p.mcap_usd) - predLogVal(wfF, p, asOf)));
      const q50 = confQ(loo, .5), q80 = confQ(loo, .8), cov = (q) => Math.round((wf.filter((e) => e <= q).length / Math.max(1, wf.length)) * 100);
      const rmse = (a) => r2(Math.sqrt(a.reduce((t, e) => t + e * e, 0) / a.length));
      const row = { id: s.id, label: s.label, decision: s.decision, loo_med_x: r2(Math.exp(med(loo))), loo_rmse: rmse(loo), wf_med_x: r2(Math.exp(med(wf))), wf_rmse: rmse(wf), q50_x: r2(Math.exp(q50)), q80_x: r2(Math.exp(q80)), wf_cov50: cov(q50), wf_cov80: cov(q80) };
      table.push(row);
      if (s.id === 'final') conformal = { q50, q80, q50_x: row.q50_x, q80_x: row.q80_x, wf_cov50: row.wf_cov50, wf_cov80: row.wf_cov80, wf_n: wfTe.length, loo_n: peers.length };
    }
    return { fit: fitValueSpec(peers, asOf, specs[3]), table, conformal, looMap };
  }

  function oddsFeat(p, asOf, sp, catLogitFn, oAge, o7d) {
    const f = [1];
    if (sp.tvl) f.push(Math.log(Math.max(1, p.tvl_usd) / 1e7));
    if (sp.age) f.push(Math.log(1 + ((oAge !== undefined ? oAge : ageDays(asOf, p.listed_at)) ?? 730)) / 7);
    if (sp.d7) f.push(o7d !== undefined ? o7d : c7d(p.change_7d));
    if (sp.ch) f.push(Math.log(1 + (p.chains ? p.chains.length : 0)));
    if (sp.cat) f.push(catLogitFn(p.category || 'Other'));
    return f;
  }

  function fitOddsSpec(train, asOf, sp) {
    let pos = 0;
    const cs = {};
    for (const { p, y } of train) { pos += y; const c = p.category || 'Other'; cs[c] = cs[c] || [0, 0]; cs[c][0] += y; cs[c][1] += 1; }
    const base = pos / Math.max(1, train.length);
    const clog = (c) => { const [s, n] = cs[c] || [0, 0]; const r = clamp((s + CFG.oddsCatK * base) / (n + CFG.oddsCatK), .02, .98); return Math.log(r / (1 - r)); };
    const w = fitLogReg(train.map((t) => oddsFeat(t.p, asOf, sp, clog)), train.map((t) => t.y), CFG.oddsL2);
    const catLogits = {}, catRates = {};
    for (const c of Object.keys(cs).sort()) { catLogits[c] = r4(clog(c)); catRates[c] = { tokenized: cs[c][0], total: cs[c][1], rate: r4(cs[c][0] / cs[c][1]) }; }
    return { sp, w, base, defLogit: r4(clog('__')), catLogits, catRates };
  }

  const predOdds = (fit, p, asOf, oAge, o7d) => sig(dot(fit.w, oddsFeat(p, asOf, fit.sp, (c) => fit.catLogits[c] ?? fit.defLogit, oAge, o7d)));

  function forwardLaunchOdds(fit, p, asOf) {
    const cur = ageDays(asOf, p.listed_at) ?? 540, hor = Math.max(cur + 730, 1825);
    const fNow = predOdds(fit, p, asOf, cur, c7d(p.change_7d)), fHor = predOdds(fit, p, asOf, hor, 0);
    return { peer_rate_now: r4(fNow), peer_rate_horizon: r4(fHor), launch_odds: r4(clamp((fHor - fNow) / Math.max(.05, 1 - fNow), .04, .85)) };
  }

  function computeAuc(ys, ps) {
    const pos = [], neg = [];
    ys.forEach((y, i) => (y === 1 ? pos : neg).push(ps[i]));
    if (!pos.length || !neg.length) return .5;
    let w = 0;
    for (const a of pos) for (const b of neg) w += a > b ? 1 : a === b ? .5 : 0;
    return w / (pos.length * neg.length);
  }

  function runOddsValidation(univ, asOf) {
    const specs = [
      { id: 'base', label: 'Base rate only', decision: 'BASELINE' },
      { id: 'cat', label: '+ Category shrunk prior (k=6)', cat: true, decision: 'KEPT' },
      { id: 'cat_tvl', label: '+ log(TVL)', cat: true, tvl: true, decision: 'KEPT' },
      { id: 'cat_tvl_age', label: '+ Protocol age log(1+age)', cat: true, tvl: true, age: true, decision: 'KEPT' },
      { id: 'final', label: '+ 7d TVL growth (clamped)', cat: true, tvl: true, age: true, d7: true, decision: 'KEPT (FINAL)' },
      { id: 'plus_chains', label: '+ Chain breadth log(1+chains)', cat: true, tvl: true, age: true, d7: true, ch: true, decision: 'DROPPED' },
    ];
    const dated = univ.filter((t) => t.p.listed_at).sort((a, b) => (a.p.listed_at < b.p.listed_at ? -1 : a.p.listed_at > b.p.listed_at ? 1 : bySlug(a.p, b.p)));
    const sp = Math.floor(dated.length * CFG.wf), wfTr = dated.slice(0, sp), wfTe = dated.slice(sp);
    const br = (ys, ps) => r4(ys.reduce((a, y, i) => a + (ps[i] - y) ** 2, 0) / ys.length);
    const table = specs.map((s) => {
      const cvP = [], cvY = [];
      for (let f = 0; f < 10; f++) {
        const fit = fitOddsSpec(univ.filter((_, i) => i % 10 !== f), asOf, s);
        for (const t of univ.filter((_, i) => i % 10 === f)) { cvP.push(predOdds(fit, t.p, asOf)); cvY.push(t.y); }
      }
      const wfF = fitOddsSpec(wfTr, asOf, s), wfP = wfTe.map((t) => predOdds(wfF, t.p, asOf)), wfY = wfTe.map((t) => t.y);
      return { id: s.id, label: s.label, decision: s.decision, cv_brier: br(cvY, cvP), cv_auc: r4(computeAuc(cvY, cvP)), wf_brier: br(wfY, wfP), wf_auc: r4(computeAuc(wfY, wfP)) };
    });
    const ageCurve = [['<6m', 0, 180], ['6-12m', 180, 365], ['1-2y', 365, 730], ['2-3y', 730, 1095], ['3-4y', 1095, 1460], ['4y+', 1460, 99999]].map(([label, lo, hi]) => {
      let n = 0, pos = 0;
      for (const t of univ) { const ad = ageDays(asOf, t.p.listed_at); if (ad !== null && ad >= lo && ad < hi) { n++; pos += t.y; } }
      return { label, total: n, tokenized: pos, rate: n ? Math.round((pos / n) * 100) : 0 };
    });
    return { fit: fitOddsSpec(univ, asOf, specs[4]), table, ageCurve, universeN: univ.length, wfTestN: wfTe.length };
  }
  function pickFarmChain(chains) {
    if (!chains || !chains.length) return { chain: 'primary chain', gas: .5, alt: null };
    let best = chains[0], bG = GAS[best] ?? .5, worst = best, wG = bG;
    for (const c of chains.slice(1)) { const g = GAS[c] ?? .5; if (g < bG || (g === bG && c < best)) { best = c; bG = g; } if (g > wG) { worst = c; wG = g; } }
    return { chain: best, gas: bG, alt: wG > bG * 3 ? { chain: worst, gas: wG } : null };
  }

  function buildFarmPlan(p, impliedUsd, odds, age) {
    const pick = pickFarmChain(p.chains), chain = pick.chain, gTx = pick.gas, hiGas = gTx >= 2;
    const hold = age !== null && age < 180 ? 60 : (age === null || age < 365 ? 45 : 30);
    const cad = Math.max(2, Math.ceil(hold / (hiGas ? 14 : 7))), txs = 6 + cad, gasTot = txs * gTx;
    const cL = (p.category || 'Other').toLowerCase(), isInst = /curator|allocator|rwa/.test(cL), isTrd = /dex|perp|deriv|predict|option/.test(cL);
    const baseCap = (p.tvl_usd >= 5e8 && isInst) ? 1000 : p.tvl_usd >= 2e8 ? 750 : p.tvl_usd >= 5e7 ? 500 : p.tvl_usd >= 15e6 ? 300 : 200;
    const cap = Math.max(baseCap, Math.min(2500, Math.ceil((gasTot * 25) / 100) * 100));
    const fees = cap * (isTrd ? .0025 : .0008), carry = isTrd ? .045 : .015, opp = cap * carry * (hold / 365);
    const cost = gasTot + fees + opp, hrs = (40 + 5 * cad) / 60;
    const pool = CFG.poolPct * impliedUsd;
    const evGross = odds * Math.min(cap * 1.2, (.6 * pool) * (cap / Math.max(cap, p.tvl_usd * CFG.actTvl)) * CFG.boost + (.4 * pool) / Math.max(900, Math.sqrt(p.tvl_usd / 250) * 5));
    const netEv = evGross - cost, phr = netEv / hrs;

    let verdict = 'SKIP', why = 'Sub-threshold net $/hr after gas and carry';
    if (p.change_7d !== null && p.change_7d <= -25) { verdict = 'SKIP'; why = `Severe 7d TVL outflow (${p.change_7d.toFixed(1)}%)`; }
    else if (phr >= 25 && odds >= .25) { verdict = 'FARM'; why = `Strong net $${Math.round(phr)}/hr with ${Math.round(odds * 100)}% launch odds`; }
    else if (phr >= 5 && odds >= .14 && (p.change_7d === null || p.change_7d > -35)) { verdict = 'SELECTIVE'; why = `Positive $${Math.round(phr)}/hr if capital is already on ${chain}`; }
    else if (odds < .14) { verdict = 'SKIP'; why = `Low peer-implied remaining launch odds (${Math.round(odds * 100)}%)`; }

    const sub = Math.max(25, Math.round(cap * .2)), cadLbl = hiGas ? 'bi-weekly' : 'weekly';
    const [a1, a2] = /lend|cdp|collateral/.test(cL)
      ? [`Supply $${cap} USDC collateral on ${p.name} (${chain}) to accrue TVL hours.`, `Borrow $${sub} USDC (<30% LTV) on ${p.name}, hold 7d, then repay to log credit usage.`]
      : /dex|liquidity/.test(cL)
      ? [`Provide $${cap} liquidity to ${p.name}'s deepest stable/major pool on ${chain}.`, `Run two organic $${sub} swaps on ${p.name} (${chain}) on separate days for taker volume.`]
      : /basis|perp|deriv|option/.test(cL)
      ? [`Deposit $${cap} USDC margin on ${p.name} (${chain}) and open a <2x hedged position.`, `Close and reopen a $${sub} position on a second ${p.name} market for multi-market volume.`]
      : /curator|allocator|yield/.test(cL)
      ? [`Deposit $${cap} USDC into ${p.name}'s flagship audited vault on ${chain} and hold shares.`, `Add $${sub} into a second ${p.name} vault or compound after 14d to prove retention.`]
      : /rwa|stable|payment/.test(cL)
      ? [`Mint or deposit $${cap} into ${p.name}'s yield/stable instrument on ${chain} and hold natively.`, `Complete one $${sub} transfer, redemption, or re-mint cycle on ${p.name}.`]
      : /restak|stak/.test(cL)
      ? [`Stake $${cap} native asset via ${p.name} on ${chain} and hold the liquid receipt token.`, `Verify delegation on ${p.name} and top up $${sub} after 14d to confirm sustained stake.`]
      : [`Deposit $${cap} USDC into ${p.name}'s core contract on ${chain} through snapshot cycles.`, `Run a $${sub} follow-up action (swap, top-up, or sign-in) inside ${p.name} 7d later.`];

    const risk = p.change_7d !== null && p.change_7d <= -20 ? `Outflow guard: TVL fell ${Math.abs(Math.round(p.change_7d))}% in 7d — cap at $${cap} and exit if outflows persist.`
      : gasTot >= 25 ? `Gas guard: ${usdS(gasTot)} L1 gas is ${(gasTot / cap * 100).toFixed(1)}% of $${cap} — batch approvals at low gwei, never size below $${cap}.`
      : odds < .15 ? `Tokenization guard: peers give ${Math.round(odds * 100)}% remaining odds — farm only if vault yield covers ${usdS(gasTot)} gas.`
      : p.tvl_usd < 12e6 ? `Liquidity guard: TVL is $${(p.tvl_usd / 1e6).toFixed(1)}M — run a $25 test exit before full deposit.`
      : age !== null && age < 90 ? `Young-contract guard: listed ${age}d ago — verify audits/timelocks and cap at $${cap} until 90d.`
      : `Contract guard: audit ${p.name}'s TVL concentration weekly; unwind if 7d TVL falls >25%.`;

    const route = pick.alt ? ` Route on ${chain} (${usdS(gTx)}/tx) vs ${pick.alt.chain} (${usdS(pick.alt.gas)}/tx).` : ` Budget ${usdS(gTx)}/tx on ${chain}.`;
    const steps = [
      { title: 'Isolate wallet & route funding', action: `Fund a dedicated wallet with $${cap} plus ${usdS(gasTot)} gas on ${chain}.${route}`, cost: `${usdS(gTx * 2)} gas`, time: '10 min' },
      { title: 'Open primary qualifying position', action: a1, cost: `$${cap} cap + ${usdS(gTx * 2 + fees * .6)}`, time: '10 min' },
      { title: 'Complete second qualifying action', action: a2, cost: `${usdS(gTx * 2 + fees * .4)} gas/fees`, time: '10 min' },
      { title: `Maintain ${cadLbl} snapshot cadence`, action: `Run ${cad} small ${cadLbl} on-chain actions on ${p.name} (${chain}) across ${hold}d for multi-epoch snapshots.`, cost: `${usdS(cad * gTx)} (${cad} tx)`, time: `${cad * 5} min` },
      { title: 'Run protocol-specific risk guard', action: risk, cost: `${usdS(opp)} carry`, time: `${hold}d hold` },
      { title: 'Verify claim & enforce unwind rule', action: `After ${hold}d check ${p.name}'s official claim portal (never pay third-party fees); unwind if unannounced and net $/hr < $5.`, cost: `${usdS(cost)} total`, time: `${hrs.toFixed(1)}h total` },
    ];
    const step_strings = steps.map((st) => { const s = `${st.action} Cost: ${st.cost}. Time: ${st.time}.`; return s.length > 600 ? `${s.slice(0, 596)}...` : s; });
    return { verdict, why, chain, gas_tx: r2(gTx), cap, hold, txs, gas: r2(gasTot), fees: r2(fees), opp: r2(opp), cost: r2(cost), hrs: r2(hrs), ev_gross: r2(evGross), net_ev: r2(netEv), phr: r2(phr), steps, step_strings };
  }

  function recomputeRow(row, vm) {
    const b = vm.beta, off = vm.cat_offsets[row.category || 'Other'] || 0;
    const lp = b[0] + b[1] * Math.log(Math.max(1, row.tvl_usd)) + b[2] * Math.log(1 + (row.chains ? row.chains.length : 0)) + off;
    const implied = Math.max(1, Math.round(Math.exp(lp)));
    return { implied, low80: Math.max(1, Math.round(Math.exp(lp - vm.q80))), high80: Math.max(implied, Math.round(Math.exp(lp + vm.q80))) };
  }

  function buildRadar(snap) {
    const lanes = classifyUniverse(snap), valRes = runValueValidation(lanes.livePricedClean, snap.as_of);
    const oddsUniv = [...lanes.watchlist.map((p) => ({ p, y: 0 })), ...lanes.early.map((p) => ({ p, y: 0 })), ...lanes.live.filter((p) => !exclusionReason(p, snap.floor_usd, false)).map((p) => ({ p, y: 1 }))].sort((a, b) => bySlug(a.p, b.p));
    const oddsRes = runOddsValidation(oddsUniv, snap.as_of), { q50, q80 } = valRes.conformal;
    const scored = [...lanes.watchlist, ...lanes.early].map((p) => {
      const age = ageDays(snap.as_of, p.listed_at), cat = p.category || 'Other', lp = predLogVal(valRes.fit, p, snap.as_of);
      const implied = Math.max(1, Math.round(Math.exp(lp))), odds = forwardLaunchOdds(oddsRes.fit, p, snap.as_of), farm = buildFarmPlan(p, implied, odds.launch_odds, age);
      return {
        p, lane: lanes.wlSet.has(p.slug) ? 'watchlist' : 'early', age, catOffset: r4(valRes.fit.catOffsets[cat] || 0), catPeers: valRes.fit.catCounts[cat] || 0,
        implied, low50: Math.max(1, Math.round(Math.exp(lp - q50))), high50: Math.max(implied, Math.round(Math.exp(lp + q50))),
        low80: Math.max(1, Math.round(Math.exp(lp - q80))), high80: Math.max(implied, Math.round(Math.exp(lp + q80))), odds, farm,
      };
    }).sort((a, b) => b.implied - a.implied || bySlug(a.p, b.p));
    const verdicts = { FARM: 0, SELECTIVE: 0, SKIP: 0 }, board = [], rows = [];
    scored.forEach((s, i) => {
      const rank = i + 1; verdicts[s.farm.verdict]++;
      const { slug, name, category, chains, tvl_usd, change_7d, listed_at } = s.p;
      const base = { rank, slug, name, lane: s.lane, category, chains, tvl_usd, change_7d, listed_at, age_days: s.age, implied_value_usd: s.implied };
      board.push({ ...base, conformal_low_80: s.low80, conformal_high_80: s.high80, launch_odds: s.odds.launch_odds, farm_verdict: s.farm.verdict, farm_net_per_hour: s.farm.phr, farm_steps: s.farm.step_strings });
      const { step_strings: _s, ...farm } = s.farm;
      rows.push({ ...base, low_50: s.low50, high_50: s.high50, low_80: s.low80, high_80: s.high80, cat_offset: s.catOffset, cat_peers: s.catPeers, peer_rate_now: s.odds.peer_rate_now, peer_rate_horizon: s.odds.peer_rate_horizon, launch_odds: s.odds.launch_odds, farm });
    });
    const live = lanes.live.slice().sort((a, b) => (b.mcap_usd || 0) - (a.mcap_usd || 0) || b.tvl_usd - a.tvl_usd || bySlug(a, b)).map((p) => {
      const l = valRes.looMap[p.slug];
      return { slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d, symbol: p.symbol, age_days: ageDays(snap.as_of, p.listed_at), in_fit: !!l, loo_pred: l ? l.pred : null, loo_ratio: l ? l.ratio : null };
    });
    const excluded = lanes.excluded.slice().sort((a, b) => b.protocol.tvl_usd - a.protocol.tvl_usd || bySlug(a.protocol, b.protocol)).map(({ protocol: p, reason }) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, change_7d: p.change_7d, reason }));
    const categories = Object.keys(valRes.fit.catOffsets).map((c) => ({ category: c, peers: valRes.fit.catCounts[c] || 0, offset: r4(valRes.fit.catOffsets[c]), mult: r2(Math.exp(valRes.fit.catOffsets[c])), token_rate: oddsRes.fit.catRates[c] ? Math.round(oddsRes.fit.catRates[c].rate * 100) : null })).sort((a, b) => b.peers - a.peers || (a.category < b.category ? -1 : 1));
    return {
      board,
      radar: {
        version: CFG.version, as_of: snap.as_of, source: snap.source, floor_usd: snap.floor_usd,
        counts: { total: snap.protocols.length, watchlist: lanes.watchlist.length, early: lanes.early.length, ranked: board.length, excluded: excluded.length, live: live.length, live_priced_clean: lanes.livePricedClean.length, verdicts },
        excl_reasons: lanes.exclCounts,
        value_model: { beta: valRes.fit.beta, cat_offsets: valRes.fit.catOffsets, cat_counts: valRes.fit.catCounts, q50, q80, conformal: valRes.conformal, ablation: valRes.table },
        odds_model: { weights: oddsRes.fit.w.map(r4), base_rate: r4(oddsRes.fit.base), universe_n: oddsRes.universeN, wf_test_n: oddsRes.wfTestN, ablation: oddsRes.table, age_curve: oddsRes.ageCurve },
        categories, rows, live, excluded,
      },
    };
  }

  root.RADAR_ENGINE = { CFG, ageDays, classifyUniverse, fitValueSpec, runValueValidation, runOddsValidation, forwardLaunchOdds, buildFarmPlan, recomputeRow, buildRadar };
})(typeof globalThis !== 'undefined' ? globalThis : window);
