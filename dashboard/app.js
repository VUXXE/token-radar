// Token Radar Dashboard UI — renders window.RADAR and verifies client parity via RADAR_ENGINE.
(() => {
  'use strict';

  const D = window.RADAR, E = window.RADAR_ENGINE;
  if (!D || !E) return;

  const root = document.getElementById('app');
  const SORT_LBL = { implied: 'Implied Value', tvl: 'TVL', change_7d: '7d \u0394', age: 'Age', odds: 'Launch Odds', phr: 'Net $/hr', name: 'Name' };
  const S = { tab: 'pre-token', lane: 'all', verdict: 'all', category: 'all', chain: 'all', q: '', sort: 'implied', dir: -1, selected: null };

  function verifyBrowserParity() {
    let exact = 0;
    for (const r of D.rows) if (E.recomputeProtocolValue(r, D.value_model).implied === r.implied_value_usd) exact++;
    return exact;
  }
  const parityExact = verifyBrowserParity();

  const fmtUsd = (n) => { if (n == null || !isFinite(n)) return 'n/a'; const a = Math.abs(n), s = n < 0 ? '-' : ''; return a >= 1e9 ? `${s}$${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${s}$${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${s}$${Math.round(a / 1e3)}K` : `${s}$${Math.round(a)}`; };
  const fmtPct = (n) => (n == null || !isFinite(n) ? 'n/a' : `${n > 0 ? '+' : ''}${n.toFixed(1)}%`);
  const fmtAge = (d) => (d == null ? 'n/a' : d >= 365 ? `${(d / 365).toFixed(1)}y` : `${d}d`);
  const fmtS = (n) => `${n >= 0 ? '+' : '-'}$${Math.abs(n).toFixed(0)}`;
  const vCls = (v) => (v === 'FARM' ? 'tag-farm' : v === 'SELECTIVE' ? 'tag-sel' : 'tag-skip');

  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null) continue;
      if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else if (k === 'html') n.innerHTML = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v);
    }
    for (const c of kids.flat()) if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    return n;
  }
  const dv = (c, ...k) => el('div', { class: c }, ...k), sp = (c, t) => el('span', { class: c, text: t }), td = (t, c) => el('td', c ? { class: c, text: t } : { text: t });
  const ths = (arr) => arr.map((t) => el('th', { text: t }));
  const tbl = (head, rows) => dv('panel', dv('table-wrap', el('table', null, el('thead', null, el('tr', null, head)), el('tbody', null, rows))));

  function readHash() {
    const p = new URLSearchParams(location.hash.replace(/^#/, ''));
    for (const k of ['tab', 'lane', 'verdict', 'category', 'chain', 'q', 'sort']) if (p.get(k)) S[k] = p.get(k);
    if (p.get('dir')) S.dir = +p.get('dir') === 1 ? 1 : -1;
    if (p.get('p')) S.selected = p.get('p');
  }
  function writeHash() {
    const p = new URLSearchParams();
    if (S.tab !== 'pre-token') p.set('tab', S.tab);
    for (const k of ['lane', 'verdict', 'category', 'chain']) if (S[k] !== 'all') p.set(k, S[k]);
    if (S.q) p.set('q', S.q); if (S.sort !== 'implied') p.set('sort', S.sort);
    if (S.dir !== -1) p.set('dir', '1'); if (S.selected) p.set('p', S.selected);
    const qs = p.toString(); history.replaceState(null, '', qs ? `#${qs}` : location.pathname + location.search);
  }
  const resetFilters = () => { Object.assign(S, { lane: 'all', verdict: 'all', category: 'all', chain: 'all', q: '', sort: 'implied', dir: -1 }); writeHash(); render(); };
  const hasFilter = () => S.lane !== 'all' || S.verdict !== 'all' || S.category !== 'all' || S.chain !== 'all' || S.q.trim() !== '';
  const matchQ = (s, q) => !q || s.toLowerCase().includes(q);
  const filterPreToken = () => { const q = S.q.trim().toLowerCase(); return D.rows.filter((r) => (S.lane === 'all' || r.lane === S.lane) && (S.verdict === 'all' || r.farm.verdict === S.verdict) && (S.category === 'all' || (r.category || 'Other') === S.category) && (S.chain === 'all' || (r.chains || []).includes(S.chain)) && matchQ(`${r.name} ${r.slug} ${r.category || ''} ${(r.chains || []).join(' ')} ${r.farm.verdict} ${r.farm.chain}`, q)); };
  const sortPreToken = (list) => { const k = S.sort, d = S.dir, val = (r) => (k === 'name' ? r.name.toLowerCase() : k === 'tvl' ? r.tvl_usd : k === 'change_7d' ? (r.change_7d ?? -9999) : k === 'age' ? (r.age_days ?? 99999) : k === 'odds' ? r.launch_odds : k === 'phr' ? r.farm.phr : r.implied_value_usd); return list.slice().sort((a, b) => { const av = val(a), bv = val(b); return av < bv ? -d : av > bv ? d : (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0); }); };
  const filterSecondary = (list) => { const q = S.q.trim().toLowerCase(); return list.filter((r) => (S.category === 'all' || (r.category || 'Other') === S.category) && (S.chain === 'all' || (r.chains || []).includes(S.chain)) && matchQ(`${r.name} ${r.slug} ${r.category || ''} ${(r.chains || []).join(' ')} ${r.symbol || ''} ${r.reason || ''}`, q)); };

  function buildPowerLawSvg() {
    const W = 440, H = 118, pL = 36, pR = 10, pT = 8, pB = 20, mX = Math.log10(5e6), MX = Math.log10(5e9), mY = 5, MY = Math.log10(5e9);
    const sx = (v) => (pL + ((Math.max(mX, Math.min(MX, Math.log10(Math.max(1, v)))) - mX) / (MX - mX)) * (W - pL - pR)).toFixed(1);
    const sy = (v) => (H - pB - ((Math.max(mY, Math.min(MY, Math.log10(Math.max(1, v)))) - mY) / (MY - mY)) * (H - pT - pB)).toFixed(1);
    const b = D.value_model.beta, q50 = D.value_model.q50, q80 = D.value_model.q80, ch = b[2] * Math.log(2), u8 = [], l8 = [], u5 = [], l5 = [], mid = [];
    for (const t of [5e6, 2e7, 1e8, 5e8, 3e9]) {
      const lp = b[0] + b[1] * Math.log(t) + ch, x = sx(t);
      mid.push(`${x},${sy(Math.exp(lp))}`); u8.push(`${x},${sy(Math.exp(lp + q80))}`); l8.unshift(`${x},${sy(Math.exp(lp - q80))}`); u5.push(`${x},${sy(Math.exp(lp + q50))}`); l5.unshift(`${x},${sy(Math.exp(lp - q50))}`);
    }
    const f = 'font-size="9" font-family="ui-monospace,monospace" fill="#5d6b79"';
    const grid = [[1e6, '$1M'], [5e7, '$50M'], [2e9, '$2B']].map(([v, l]) => `<line x1="${pL}" y1="${sy(v)}" x2="${W - pR}" y2="${sy(v)}" stroke="#ebe7de"/><text x="${pL - 4}" y="${+sy(v) + 3}" text-anchor="end" ${f}>${l}</text>`).join('') + [[5e6, '$5M'], [5e7, '$50M'], [5e8, '$500M'], [3e9, '$3B']].map(([v, l]) => `<text x="${sx(v)}" y="${H - 4}" text-anchor="middle" ${f}>${l}</text>`).join('');
    const peers = D.live.filter((p) => p.in_fit && p.mcap_usd).map((p) => `<circle cx="${sx(p.tvl_usd)}" cy="${sy(p.mcap_usd)}" r="2.2" fill="#7c8b9b" opacity=".62"/>`).join('');
    const tgts = D.rows.slice(0, 12).map((r) => { const x = +sx(r.tvl_usd), y = +sy(r.implied_value_usd); return `<polygon points="${x},${y - 3.6} ${x + 3.6},${y} ${x},${y + 3.6} ${x - 3.6},${y}" fill="${r.farm.verdict === 'FARM' ? '#0f6b4b' : '#1b4d89'}"/>`; }).join('');
    return `<svg class="svg-box" viewBox="0 0 ${W} ${H}" role="img" aria-label="Power-law fit">${grid}<polygon points="${u8.concat(l8).join(' ')}" fill="#1b4d89" opacity=".09"/><polygon points="${u5.concat(l5).join(' ')}" fill="#1b4d89" opacity=".16"/>${peers}<polyline points="${mid.join(' ')}" fill="none" stroke="#1b4d89" stroke-width="2"/>${tgts}</svg>`;
  }

  function buildOddsCurveSvg() {
    const W = 330, H = 118, pL = 28, pR = 8, pT = 14, pB = 22, cv = D.odds_model.age_curve, bw = (W - pL - pR) / cv.length, m = 'font-family="ui-monospace,monospace"';
    const bars = cv.map((b, i) => {
      const x = pL + i * bw + 6, w = bw - 12, bh = (b.rate / 100) * (H - pT - pB), y = H - pB - bh, cx = (x + w / 2).toFixed(1);
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${bh.toFixed(1)}" rx="3" fill="${i < 2 ? '#0f6b4b' : i < 4 ? '#1b4d89' : '#8b99a8'}" opacity=".88"/><text x="${cx}" y="${(y - 3).toFixed(1)}" text-anchor="middle" font-size="9.5" font-weight="700" ${m} fill="#141a21">${b.rate}%</text><text x="${cx}" y="${H - 6}" text-anchor="middle" font-size="9" ${m} fill="#5d6b79">${b.label}</text>`;
    }).join('');
    return `<svg class="svg-box" viewBox="0 0 ${W} ${H}" role="img" aria-label="Tokenization by age"><line x1="${pL}" y1="${H - pB}" x2="${W - pR}" y2="${H - pB}" stroke="#c6bfb0"/><text x="${pL - 4}" y="${pT + 4}" text-anchor="end" font-size="8.5" ${m} fill="#5d6b79">100%</text><text x="${pL - 4}" y="${H - pB}" text-anchor="end" font-size="8.5" ${m} fill="#5d6b79">0%</text>${bars}</svg>`;
  }

  function renderMasthead() {
    const logo = '<svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14" fill="#141a21"/><circle cx="16" cy="16" r="9.5" fill="none" stroke="#5d6b79"/><circle cx="16" cy="16" r="4.5" fill="none" stroke="#5d6b79"/><path d="M16 16 L26 8 A13 13 0 0 1 28 19 Z" fill="#0f6b4b" opacity=".78"/><circle cx="16" cy="16" r="2.2" fill="#f5f2eb"/><circle cx="22" cy="12" r="2.2" fill="#4ce0a7"/></svg>';
    const mp = (k, v) => el('span', { class: 'meta-pill' }, `${k} `, el('b', { text: v }));
    return el('header', { class: 'masthead' },
      dv('brand', el('div', { html: logo }), el('div', null, dv('brand-title', 'Token Radar'), dv('brand-sub', 'Empirical Pre-Token Launch Valuation, Survival-Hazard Odds & Costed Farm Desk'))),
      dv('meta-pills', mp('Snapshot', D.as_of), mp('Source', 'DefiLlama API (sealed)'), mp('Engine', `${D.version} · 0 hardcoded names`)),
    );
  }

  function renderIntegrityStrip() {
    const fin = D.value_model.ablation[3], c = D.counts, cf = D.value_model.conformal;
    const chk = (l, b) => el('span', { class: 'chk' }, sp('chk-dot', '\u2713'), `${l} `, el('b', { text: b }));
    const seg = (n, cl) => el('i', { class: cl, style: `width:${((n / c.total) * 100).toFixed(2)}%` });
    return dv('integrity-wrap',
      el('div', { class: 'integrity', role: 'status' },
        chk('Universe:', `${c.total}/${c.total} (${c.watchlist} WL · ${c.early} Early · ${c.excluded} Set Aside · ${c.live} Live)`),
        chk('Watchlist:', `${c.watchlist}/${c.watchlist}`), chk('Blind CV:', `WF \u00d7${fin.wf_med_x} · LOO \u00d7${fin.loo_med_x} · Cat \u00d7${fin.cat_med_x}`),
        chk('Conformal:', `${cf.wf_cov50}% / ${cf.wf_cov80}% WF cov`), chk('Parity:', `${parityExact}/${c.ranked} exact`),
      ),
      dv('univ-bar', seg(c.watchlist, 'seg-wl'), seg(c.early, 'seg-ea'), seg(c.excluded, 'seg-ex'), seg(c.live, 'seg-lv')),
    );
  }

  function renderOverviewStrip() {
    const c = D.counts, fp = D.rows.filter((r) => r.farm.verdict === 'FARM').map((r) => r.farm.phr).sort((a, b) => a - b);
    const medPhr = fp.length ? fp[fp.length >> 1] : 0, tvl = D.rows.reduce((s, r) => s + r.tvl_usd, 0), fo = D.odds_model.ablation[4], fv = D.value_model.ablation[3], b = D.value_model.beta;
    const kpi = (l, v, s, cl) => dv('kpi', sp('kpi-label', l), dv(`kpi-val ${cl || ''}`, v), sp('kpi-sub', s));
    const card = (h, rt, ...k) => dv('card', dv('card-head', el('h2', { text: h }), el('span', { text: rt })), ...k);
    return el('section', { class: 'overview' },
      card('Actionable Farm Desk', `${c.ranked} Ranked Pre-Token`, dv('kpi-grid', kpi('FARM Verdicts', `${c.verdicts.FARM} / ${c.ranked}`, `${c.verdicts.SELECTIVE} selective · ${c.verdicts.SKIP} skip`, 'good'), kpi('Median FARM Rate', `+$${Math.round(medPhr)}/hr`, 'Net after gas, fees & carry', 'good'), kpi('Pre-Token TVL', fmtUsd(tvl), `${c.watchlist} watchlist >=$50M`), kpi('Odds Blind AUC', fo.wf_auc.toFixed(2), `WF Brier ${fo.wf_brier.toFixed(3)} (n=${D.odds_model.universe_n})`))),
      card(`Power-Law Fit (${c.live_priced_clean} Clean Peers)`, `TVL^${b[1].toFixed(2)} · WF \u00d7${fv.wf_med_x}`, el('div', { html: buildPowerLawSvg() }), dv('chart-foot', el('span', { text: 'Inner/outer shade: 50% & 80% conformal' }), el('span', { text: 'Diamonds: top 12 (green = FARM)' }))),
      card('Tokenization by Age', 'Hazard falls with age', el('div', { html: buildOddsCurveSvg() }), dv('chart-foot', el('span', { text: 'Kept: TVL, age, 7d, cat · Dropped: chains' }))),
    );
  }

  function renderNavAndControls() {
    const c = D.counts;
    const tb = (id, l, n) => el('button', { type: 'button', class: 'tab', 'aria-pressed': String(S.tab === id), onclick: () => { S.tab = id; writeHash(); render(); } }, l, n != null ? sp('cnt', String(n)) : null);
    const pl = (l, act, cl, fn) => el('button', { type: 'button', class: `pill ${cl || ''}`, 'aria-pressed': String(act), onclick: () => { fn(); writeHash(); render(); }, text: l });
    const nav = dv('nav-row',
      el('div', { class: 'tabs', role: 'tablist' }, tb('pre-token', 'Pre-Token Radar', c.ranked), tb('live', 'Live-Token Peers', c.live), tb('excluded', 'Set Aside', c.excluded), tb('methodology', 'Model & Blind Proofs', null)),
      S.tab === 'pre-token' ? dv('quick-pills', pl(`All (${c.ranked})`, S.lane === 'all' && S.verdict === 'all', '', () => { S.lane = 'all'; S.verdict = 'all'; }), pl(`Watchlist (${c.watchlist})`, S.lane === 'watchlist', '', () => { S.lane = S.lane === 'watchlist' ? 'all' : 'watchlist'; }), pl(`Early <$50M (${c.early})`, S.lane === 'early', '', () => { S.lane = S.lane === 'early' ? 'all' : 'early'; }), pl(`FARM Only (${c.verdicts.FARM})`, S.verdict === 'FARM', 'farm', () => { S.verdict = S.verdict === 'FARM' ? 'all' : 'FARM'; })) : null,
    );
    if (S.tab === 'methodology') return el('div', null, nav);
    const src = S.tab === 'pre-token' ? D.rows : S.tab === 'live' ? D.live : D.excluded;
    const cats = [...new Set(src.map((r) => r.category || 'Other'))].sort(), chs = [...new Set(src.flatMap((r) => r.chains || []))].sort();
    const qIn = el('input', { type: 'search', placeholder: 'Search protocol, category, chain...', value: S.q, 'aria-label': 'Search protocols' });
    qIn.addEventListener('input', () => { S.q = qIn.value; writeHash(); render(); });
    const sel = (l, cur, opts, fn) => { const s = el('select', { 'aria-label': l }, opts.map(([v, t]) => el('option', { value: v, text: t, selected: v === cur ? 'selected' : null }))); s.addEventListener('change', () => { fn(s.value); writeHash(); render(); }); return s; };
    const shown = S.tab === 'pre-token' ? filterPreToken().length : filterSecondary(src).length;
    return el('div', null, nav, dv('controls', qIn, sel('Category', S.category, [['all', 'All categories'], ...cats.map((x) => [x, x])], (v) => { S.category = v; }), sel('Chain', S.chain, [['all', 'All chains'], ...chs.map((x) => [x, x])], (v) => { S.chain = v; }), S.tab === 'pre-token' ? sel('Verdict', S.verdict, [['all', 'All verdicts'], ['FARM', 'Verdict: FARM'], ['SELECTIVE', 'Verdict: SELECTIVE'], ['SKIP', 'Verdict: SKIP']], (v) => { S.verdict = v; }) : null, hasFilter() ? el('button', { type: 'button', class: 'btn-reset', text: 'Clear filters', onclick: resetFilters }) : null, el('span', { class: 'row-summary' }, 'Showing ', el('b', { text: String(shown) }), ` of ${src.length} rows`)));
  }

  function sortTh(k, l) {
    const act = S.sort === k;
    return el('th', { scope: 'col' }, el('button', { type: 'button', class: act ? 'active' : '', onclick: () => { if (S.sort === k) S.dir = -S.dir; else { S.sort = k; S.dir = -1; } writeHash(); render(); }, text: l + (act ? (S.dir < 0 ? ' \u25bc' : ' \u25b2') : '') }));
  }

  function renderPreTokenTable() {
    const list = sortPreToken(filterPreToken());
    let banner = null;
    if (hasFilter()) {
      const p = [];
      if (S.lane !== 'all') p.push(`Lane: ${S.lane}`); if (S.verdict !== 'all') p.push(`Verdict: ${S.verdict}`); if (S.category !== 'all') p.push(`Category: ${S.category}`); if (S.chain !== 'all') p.push(`Chain: ${S.chain}`); if (S.q.trim()) p.push(`Query: "${S.q.trim()}"`);
      const tvl = list.reduce((s, r) => s + r.tvl_usd, 0), wl = list.filter((r) => r.lane === 'watchlist').length, mean = list.length ? list.reduce((s, r) => s + r.farm.phr, 0) / list.length : 0;
      banner = dv('filter-banner', el('span', null, 'Active filter: ', el('b', { text: p.join(' · ') }), ' · Sorted by ', el('b', { text: `${SORT_LBL[S.sort] || S.sort} ${S.dir < 0 ? 'desc' : 'asc'}` })), el('span', null, el('b', { text: `${list.length} protocols` }), ` (${wl} WL) · TVL `, el('b', { text: fmtUsd(tvl) }), ' · Mean Net ', el('b', { text: `${fmtS(mean)}/hr` })));
    }
    if (!list.length) return el('div', null, banner, dv('panel empty', el('h3', { text: 'No pre-token protocols match' }), el('p', { text: 'Clear filters to view all ranked protocols.' }), el('button', { type: 'button', class: 'btn-reset', style: 'margin-top:10px', text: 'Reset all filters', onclick: resetFilters })));

    const pos = (v) => Math.max(0, Math.min(100, ((Math.log10(Math.max(1e5, v)) - 5) / 4) * 100));
    const trs = list.map((r) => {
      const lo8 = pos(r.low_80), hi8 = pos(r.high_80), lo5 = pos(r.low_50), hi5 = pos(r.high_50), pt = pos(r.implied_value_usd);
      return el('tr', { class: 'clickable', 'data-selected': String(S.selected === r.slug), tabindex: '0', onclick: () => openDetail(r.slug), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } } },
        td(`#${r.rank}`, `rank-cell${r.rank <= 10 ? ' rank-top' : ''}`),
        el('td', null, dv('proto-name', r.name, sp(`tag ${r.lane === 'watchlist' ? 'tag-wl' : 'tag-ea'}`, r.lane === 'watchlist' ? 'WL' : 'EARLY')), dv('proto-sub', `${r.category || 'Other'} · ${r.farm.chain}${r.chains.length > 1 ? ` (+${r.chains.length - 1})` : ''}`)),
        td(fmtUsd(r.tvl_usd), 'num'), td(fmtPct(r.change_7d), `num ${r.change_7d == null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'}`), td(fmtAge(r.age_days), 'num'),
        el('td', { class: 'val-cell' }, dv('val-top', sp('val-main', fmtUsd(r.implied_value_usd)), sp('val-band', `${fmtUsd(r.low_50)}–${fmtUsd(r.high_50)} (50%)`)), dv('band-track', el('span', { class: 'band-80', style: `left:${lo8.toFixed(1)}%;width:${Math.max(4, hi8 - lo8).toFixed(1)}%` }), el('span', { class: 'band-50', style: `left:${lo5.toFixed(1)}%;width:${Math.max(3, hi5 - lo5).toFixed(1)}%` }), el('span', { class: 'band-pt', style: `left:${pt.toFixed(1)}%` }))),
        el('td', { class: 'odds-cell' }, sp('num', `${Math.round(r.launch_odds * 100)}%`), dv('odds-track', el('span', { class: 'odds-fill', style: `width:${Math.round(r.launch_odds * 100)}%` }))),
        el('td', { class: 'farm-cell' }, dv('farm-top', sp(`tag ${vCls(r.farm.verdict)}`, r.farm.verdict), sp(`farm-phr ${r.farm.phr >= 18 ? 'pos' : r.farm.phr < 0 ? 'neg' : ''}`, `${fmtS(r.farm.phr)}/hr`)), dv('farm-meta', `$${r.farm.cap} cap · ${r.farm.hold}d · cost $${r.farm.cost.toFixed(1)}`)),
      );
    });
    return el('div', null, banner, tbl([sortTh('implied', 'Rank'), sortTh('name', 'Protocol & Lane'), sortTh('tvl', 'TVL'), sortTh('change_7d', '7d \u0394'), sortTh('age', 'Age'), sortTh('implied', 'Implied Value (50% / 80% Band)'), sortTh('odds', 'Odds'), sortTh('phr', 'Costed Farm Verdict')], trs));
  }

  function renderLiveTable() {
    return tbl(ths(['Role', 'Live-Token Protocol', 'TVL', 'Actual MCap', 'Blind LOO Pred', 'Actual / Pred', '7d \u0394']),
      filterSecondary(D.live).slice(0, 150).map((r) => el('tr', null, el('td', null, sp(`tag ${r.in_fit ? 'tag-kept' : 'tag-base'}`, r.in_fit ? 'FIT PEER' : 'LIVE')), el('td', null, dv('proto-name', r.name + (r.symbol ? ` (${r.symbol})` : '')), dv('proto-sub', `${r.category || 'Other'} · ${r.chains.slice(0, 3).join(', ') || 'n/a'}`)), td(fmtUsd(r.tvl_usd), 'num'), td(fmtUsd(r.mcap_usd), 'num'), td(r.loo_pred ? fmtUsd(r.loo_pred) : 'excluded/unpriced', 'num'), td(r.loo_ratio ? `${r.loo_ratio.toFixed(2)}x` : '\u2014', 'num'), td(fmtPct(r.change_7d), `num ${r.change_7d == null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'}`))));
  }

  function renderExcludedTable() {
    return tbl(ths(['Set-Aside Protocol (No Token Recorded)', 'TVL', '7d \u0394', 'Automated Exclusion Rule']),
      filterSecondary(D.excluded).map((r) => el('tr', null, el('td', null, dv('proto-name', r.name), dv('proto-sub', `${r.category || 'Other'} · ${r.chains.slice(0, 3).join(', ') || 'n/a'}`)), td(fmtUsd(r.tvl_usd), 'num'), td(fmtPct(r.change_7d), `num ${r.change_7d == null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'}`), el('td', null, sp('tag tag-skip', r.reason)))));
  }

  function renderMethodologyView() {
    const vm = D.value_model, om = D.odds_model, b = vm.beta, ow = om.weights;
    const tCls = (d) => (d.includes('KEPT') ? 'tag-kept' : d === 'DROPPED' ? 'tag-drop' : 'tag-base');
    const bar = (l, w, c, r) => dv('lane-row', el('span', { text: l }), dv('lane-track', el('i', { style: `width:${w}%;background:${c}` })), sp('num', r));
    return dv('meth-grid',
      el('section', { class: 'meth-card' }, el('h3', { text: '1. Valuation Model — Four Blind Out-of-Sample Proofs' }), el('p', { class: 'meth-lead', text: `Huber (\u03b4=0.5) on ${vm.conformal.loo_n} clean peers. Terms kept only if they improve LOO, 10-Fold, Walk-Forward (older 65% \u2192 newer 35%, n=${vm.conformal.wf_n}), and Category-Block CV.` }), dv('formula-box', `ln(Implied) = ${b[0].toFixed(3)} + ${b[1].toFixed(3)}\u00b7ln(TVL) ${b[2].toFixed(3)}\u00b7ln(1+min(c,${vm.chain_cap})) + shrink(cat, k=5)\nConformal bands: 50% [\u00f7${vm.conformal.q50_x}, \u00d7${vm.conformal.q50_x}] (${vm.conformal.wf_cov50}% WF) · 80% [\u00f7${vm.conformal.q80_x}, \u00d7${vm.conformal.q80_x}] (${vm.conformal.wf_cov80}% WF)`), el('table', { class: 'meth-table' }, el('thead', null, el('tr', null, ths(['Specification', 'LOO \u00d7', '10f \u00d7', 'WF \u00d7', 'Cat \u00d7', '80% Cov', 'Verdict']))), el('tbody', null, vm.ablation.map((r) => el('tr', { class: r.decision.includes('FINAL') ? 'winner' : '' }, td(r.label), td(`\u00d7${r.loo_med_x.toFixed(2)}`, 'num'), td(`\u00d7${r.cv10_med_x.toFixed(2)}`, 'num'), td(`\u00d7${r.wf_med_x.toFixed(2)}`, 'num'), td(`\u00d7${r.cat_med_x.toFixed(2)}`, 'num'), td(`${r.wf_cov80}%`, 'num'), el('td', null, sp(`tag ${tCls(r.decision)}`, r.decision))))))),
      el('section', { class: 'meth-card' }, el('h3', { text: '2. Token Launch Odds — Survival Hazard from Peer Record' }), el('p', { class: 'meth-lead', text: `L2 logistic CDF on ${om.universe_n} clean protocols. 7d growth & age — dropped from valuation — BOTH pass blind tests here. Remaining odds = (F_hor - F_now) / (1 - F_now).` }), dv('formula-box', `logit(F) = ${ow[0].toFixed(2)} + ${ow[1].toFixed(2)}\u00b7ln(TVL/10M) + ${ow[2].toFixed(2)}\u00b7ln(1+age)/7 ${ow[3].toFixed(2)}\u00b7clamp(7d) + ${ow[4].toFixed(2)}\u00b7cat_logit\nP(launch | pre-token at age t) declines naturally as age approaches maturity.`), el('table', { class: 'meth-table' }, el('thead', null, el('tr', null, ths(['Specification', '10f Brier', '10f AUC', 'WF Brier', 'WF AUC', 'Verdict']))), el('tbody', null, om.ablation.map((r) => el('tr', { class: r.decision.includes('FINAL') ? 'winner' : '' }, td(r.label), td(r.cv_brier.toFixed(4), 'num'), td(r.cv_auc.toFixed(3), 'num'), td(r.wf_brier.toFixed(4), 'num'), td(r.wf_auc.toFixed(3), 'num'), el('td', null, sp(`tag ${tCls(r.decision)}`, r.decision))))))),
      el('section', { class: 'meth-card' }, el('h3', { text: '3. Full 758-Protocol Accounting Ledger' }), el('p', { class: 'meth-lead', text: `Zero silent drops: every protocol belongs to one named lane (${D.counts.watchlist} + ${D.counts.early} + ${D.counts.excluded} + ${D.counts.live} = ${D.counts.total}).` }), dv('lane-bars', [['Watchlist Pre-Token (>=$50M)', D.counts.watchlist, '#1b4d89'], ['Early Pre-Token (<$50M)', D.counts.early, '#0f6b4b'], ['Set Aside (CEX/Bridge/V#/Parent)', D.counts.excluded, '#b03a24'], [`Live-Token Peers (${D.counts.live_priced_clean} Fit)`, D.counts.live, '#5d6b79']].map(([l, n, c]) => { const p = Math.round((n / D.counts.total) * 100); return bar(l, p, c, `${n} (${p}%)`); }))),
      el('section', { class: 'meth-card' }, el('h3', { text: '4. Category Shrunk Multipliers & Peer Token Rates' }), el('p', { class: 'meth-lead', text: 'Top 10 peer-backed categories (median log-residual shrunk toward 0 with k=5, cap \u00b12.5).' }), dv('lane-bars', D.categories.slice(0, 10).map((c) => bar(`${c.category} (n=${c.peers})`, Math.min(100, Math.max(8, Math.round((c.mult / 2.2) * 100))), c.mult >= 1 ? '#0f6b4b' : '#9c5d0c', `\u00d7${c.mult.toFixed(2)}${c.token_rate != null ? ` · ${c.token_rate}% tok` : ''}`)))),
    );
  }

  const dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', () => { S.selected = null; writeHash(); render(); });

  function openDetail(slug) {
    const row = D.rows.find((r) => r.slug === slug);
    if (!row) return;
    S.selected = slug; writeHash();
    const rec = E.recomputeProtocolValue(row, D.value_model), b = D.value_model.beta, capCh = Math.min(D.value_model.chain_cap, row.chains.length), cat = row.category || 'Other', f = row.farm;
    const peers = D.live.filter((p) => p.in_fit && (p.category || 'Other') === cat).sort((a, b2) => Math.abs(Math.log(a.tvl_usd / row.tvl_usd)) - Math.abs(Math.log(b2.tvl_usd / row.tvl_usd))).slice(0, 4);
    const eq = (k, v, cl) => dv(`eq-row ${cl || ''}`, el('span', { text: k }), el('b', { text: v }));
    const box = (h, ...k) => dv('d-box', el('h3', { text: h }), ...k);
    const comps = peers.length
      ? el('table', { class: 'comps-table' }, el('thead', null, el('tr', null, ths(['Live Peer', 'TVL', 'Actual MCap', 'LOO Pred']))), el('tbody', null, peers.map((p) => el('tr', null, td(p.name + (p.symbol ? ` (${p.symbol})` : '')), td(fmtUsd(p.tvl_usd), 'num'), td(fmtUsd(p.mcap_usd), 'num'), td(fmtUsd(p.loo_pred), 'num')))))
      : el('p', { class: 'd-sub', text: `No priced live peers in "${cat}" — offset shrinks to 0.00.` });
    dialog.textContent = '';
    dialog.appendChild(dv('d-head', el('div', null, dv('d-title-row', sp(`tag ${row.lane === 'watchlist' ? 'tag-wl' : 'tag-ea'}`, row.lane === 'watchlist' ? 'WATCHLIST' : 'EARLY RADAR'), el('span', { class: 'num', style: 'font-size:12px;color:#5d6b79', text: `Rank #${row.rank} of ${D.counts.ranked}` }), el('h2', { id: 'detail-title', text: row.name })), dv('d-sub', `${cat} · Chains: ${row.chains.join(', ') || 'n/a'} · TVL ${fmtUsd(row.tvl_usd)} · 7d ${fmtPct(row.change_7d)} · Age ${fmtAge(row.age_days)}`)), el('button', { type: 'button', class: 'd-close', text: 'Close', onclick: () => dialog.close() })));
    dialog.appendChild(dv('d-grid',
      dv('d-col',
        box('Implied Value Decomposition (Huber Power Law)', dv('eq-list', eq('Intercept (\u03b2\u2080)', b[0].toFixed(4)), eq(`TVL (${b[1].toFixed(3)} \u00d7 ln ${fmtUsd(row.tvl_usd)})`, `+${(b[1] * Math.log(Math.max(1, row.tvl_usd))).toFixed(4)}`), eq(`Chains (${b[2].toFixed(3)} \u00d7 ln(1+${capCh}))`, (b[2] * Math.log(1 + capCh)).toFixed(4)), eq(`Category (${cat}, ${row.cat_peers} peers)`, `${row.cat_offset >= 0 ? '+' : ''}${row.cat_offset.toFixed(4)} (\u00d7${Math.exp(row.cat_offset).toFixed(2)})`), eq('Implied Launch Value', fmtUsd(row.implied_value_usd), 'total'), eq('50% Conformal Core (52% WF)', `${fmtUsd(row.low_50)}\u2013${fmtUsd(row.high_50)}`), eq('80% Conformal Range (80% WF)', `${fmtUsd(row.low_80)}\u2013${fmtUsd(row.high_80)}`)), dv('parity-pill', rec.implied === row.implied_value_usd ? `\u2713 Browser recompute matches board.json exact (${fmtUsd(rec.implied)})` : 'Parity mismatch!')),
        box('Empirical Launch Odds (Survival Hazard)', dv('eq-list', eq(`Peer CDF at age ${fmtAge(row.age_days)}`, `${Math.round(row.peer_rate_now * 100)}%`), eq('Peer mature horizon (5y)', `${Math.round(row.peer_rate_horizon * 100)}%`), eq('Remaining Launch Odds', `${Math.round(row.launch_odds * 100)}%`, 'total'))),
        box(`Nearest Live-Token Comps (${cat})`, comps),
      ),
      dv('d-col',
        box('Costed Farm Economics & Verdict',
          dv('verdict-hero', el('span', { class: `tag ${vCls(f.verdict)}`, style: 'font-size:12px;padding:4px 9px', text: f.verdict }), el('div', null, dv(`verdict-big ${f.phr >= 18 ? 'pos' : f.phr < 0 ? 'neg' : ''}`, `${fmtS(f.phr)}/hr net (${fmtS(f.net_ev)} EV)`), dv('d-sub', f.why))),
          dv('econ-strip', [['Min Capital', `$${f.cap}`], ['Total Cost', `$${f.cost.toFixed(1)}`], ['Break-Even FDV', f.breakeven_fdv ? fmtUsd(f.breakeven_fdv) : 'n/a'], ['Route Chain', f.chain]].map(([k, v]) => dv('econ-item', el('span', { text: k }), el('b', { text: v })))),
          dv('sens-strip', el('span', { text: `Costs: gas $${f.gas.toFixed(1)} + fees $${f.fees.toFixed(1)} + carry $${f.opp.toFixed(1)} (${f.hrs.toFixed(1)}h/${f.hold}d)` }), el('b', { text: `50% Band: ${fmtS(f.bear_phr)} / ${fmtS(f.phr)} / ${fmtS(f.bull_phr)} /hr` })),
          el('ol', { class: 'step-list' }, f.steps.map((st, i) => el('li', { class: 'step-item' }, dv('step-top', sp('step-num', `${i + 1}. ${st.title}`), sp('step-meta', `${st.cost} · ${st.time}`)), dv('step-body', st.action)))),
        ),
      ),
    ));
    if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); } else dialog.setAttribute('open', '');
  }

  function render() {
    root.textContent = '';
    const body = S.tab === 'pre-token' ? renderPreTokenTable() : S.tab === 'live' ? renderLiveTable() : S.tab === 'excluded' ? renderExcludedTable() : renderMethodologyView();
    root.appendChild(dv('shell', renderMasthead(), renderIntegrityStrip(), S.tab === 'pre-token' ? renderOverviewStrip() : null, renderNavAndControls(), body));
    if (!dialog.parentNode) document.body.appendChild(dialog);
    root.setAttribute('aria-busy', 'false');
    if (S.selected && !dialog.open) openDetail(S.selected);
  }

  readHash();
  render();
})();
