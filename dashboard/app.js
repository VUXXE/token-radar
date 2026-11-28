// Token Radar Dashboard UI — renders window.RADAR, verifies live value parity,
// and recalculates farm plans dynamically when the reader adjusts wallet budget.
(() => {
 'use strict';
 const DATA = window.RADAR, ENGINE = window.RADAR_ENGINE;
 if (!DATA || !ENGINE) return;
 const VM = DATA.value_model, OM = DATA.odds_model, CNT = DATA.counts, ROWS = DATA.rows, LIVE = DATA.live, EXCL = DATA.excluded, { abs, exp, log, log10, max, min, round } = Math;
 const root = document.getElementById('app');
 const SORT_LABELS = { implied: 'Implied Value', tvl: 'TVL', change_7d: '7d \u0394', age: 'Age', odds: 'Launch Odds', phr: 'Net $/hr', name: 'Name' };
 const S = { tab: 'pre-token', lane: 'all', verdict: 'all', category: 'all', chain: 'all', q: '', sort: 'implied', dir: -1, budget: 0, selected: null };
 // Verify every row's value and default farm verdict live against RADAR_ENGINE.
 const parityExact = ROWS.reduce((n, r) => {
  const v = ENGINE.recomputeProtocolValue(r, VM);
  const f = ENGINE.buildCostedFarmPlan(r, v.implied, v.low50, v.high50, r.launch_odds, r.age_days, 0);
  return n + (v.implied === r.implied_value_usd && f.verdict === r.farm.verdict ? 1 : 0);
 }, 0);
 const farmOf = (r) => S.budget ? ENGINE.buildCostedFarmPlan(r, r.implied_value_usd, r.low_50, r.high_50, r.launch_odds, r.age_days, S.budget) : r.farm;
 const usd = (n) => {
  if (n == null || !isFinite(n)) return 'n/a';
  const a = abs(n), s = n < 0 ? '-' : '';
  return a >= 1e9 ? `${s}$${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${s}$${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${s}$${round(a / 1e3)}K` : `${s}$${round(a)}`;
 };
 const pct = (n) => (n == null || !isFinite(n) ? 'n/a' : `${n > 0 ? '+' : ''}${n.toFixed(1)}%`);
 const ageStr = (d) => (d == null ? 'n/a' : d >= 365 ? `${(d / 365).toFixed(1)}y` : `${d}d`);
 const sgn = (n) => `${n >= 0 ? '+' : '-'}$${abs(n).toFixed(0)}`;
 const vCls = (v) => (v === 'FARM' ? 'tag-farm' : v === 'SELECTIVE' ? 'tag-sel' : 'tag-skip');
 function el(tag, attrs, ...kids) {
  const node = document.createElement(tag);
  if (typeof attrs === 'string') node.className = attrs;
  else if (attrs) for (const [k, v] of Object.entries(attrs)) {
   if (v == null) continue;
   if (k === 'class') node.className = v;
   else if (k === 'html') node.innerHTML = v;
   else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
   else node.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return node;
 }
 const d = (c, ...k) => el('div', c, ...k);
 const sp = (c, ...k) => el('span', c, ...k);
 const b = (t) => el('b', 0, t);
 const td = (t, c) => el('td', c, t);
 const ths = (ls) => ls.map((t) => el('th', 0, t));
 const btn = (a, ...k) => el('button', { type: 'button', ...a }, ...k);
 const chgTd = (v) => td(pct(v), `num ${v == null ? '' : v >= 0 ? 'pos' : 'neg'}`);
 const pSub = (r, ch) => d('proto-sub', `${r.category || 'Other'} · ${ch}`);
 const tr = (c, ...k) => el('tr', c, ...k);
 const tbl = (hd, bd) => d('panel', d('table-wrap', el('table', 0, el('thead', 0, tr(0, hd)), el('tbody', 0, bd))));
 function readHashState() {
  const p = new URLSearchParams(location.hash.replace(/^#/, ''));
  for (const k of ['tab', 'lane', 'verdict', 'category', 'chain', 'q', 'sort']) if (p.get(k)) S[k] = p.get(k);
  if (p.get('dir')) S.dir = +p.get('dir') === 1 ? 1 : -1;
  if (p.get('budget')) S.budget = max(0, parseInt(p.get('budget'), 10) || 0);
  if (p.get('p')) S.selected = p.get('p');
 }
 function syncHash() {
  const p = new URLSearchParams();
  if (S.tab !== 'pre-token') p.set('tab', S.tab);
  for (const k of ['lane', 'verdict', 'category', 'chain']) if (S[k] !== 'all') p.set(k, S[k]);
  if (S.q) p.set('q', S.q);
  if (S.sort !== 'implied') p.set('sort', S.sort);
  if (S.dir !== -1) p.set('dir', '1');
  if (S.budget) p.set('budget', String(S.budget));
  if (S.selected) p.set('p', S.selected);
  const qs = p.toString();
  history.replaceState(null, '', qs ? `#${qs}` : location.pathname + location.search);
 }
 const resetFilters = () => { Object.assign(S, { lane: 'all', verdict: 'all', category: 'all', chain: 'all', q: '', sort: 'implied', dir: -1, budget: 0 }); syncHash(); render(); };
 const hasFilter = () => S.lane !== 'all' || S.verdict !== 'all' || S.category !== 'all' || S.chain !== 'all' || S.q.trim() !== '' || S.budget > 0;
 const matchQ = (str, q) => !q || str.toLowerCase().includes(q);
 function filterPreTokenRows() {
  const q = S.q.trim().toLowerCase();
  return ROWS.filter((r) => {
   const f = farmOf(r);
   return (S.lane === 'all' || r.lane === S.lane)
    && (S.verdict === 'all' || f.verdict === S.verdict)
    && (S.category === 'all' || (r.category || 'Other') === S.category)
    && (S.chain === 'all' || (r.chains || []).includes(S.chain))
    && matchQ(`${r.name} ${r.slug} ${r.category || ''} ${(r.chains || []).join(' ')} ${f.verdict} ${f.chain}`, q);
  });
 }
 function sortPreTokenRows(list) {
  const k = S.sort, dir = S.dir;
  const keyOf = (r) => k === 'name' ? r.name.toLowerCase() : k === 'tvl' ? r.tvl_usd : k === 'change_7d' ? (r.change_7d ?? -9999) : k === 'age' ? (r.age_days ?? 99999) : k === 'odds' ? r.launch_odds : k === 'phr' ? farmOf(r).phr : r.implied_value_usd;
  return list.slice().sort((a, x) => {
   const av = keyOf(a), xv = keyOf(x);
   return av < xv ? -dir : av > xv ? dir : (a.slug < x.slug ? -1 : a.slug > x.slug ? 1 : 0);
  });
 }
 function filterSecondaryRows(list) {
  const q = S.q.trim().toLowerCase();
  return list.filter((r) => (S.category === 'all' || (r.category || 'Other') === S.category)
   && (S.chain === 'all' || (r.chains || []).includes(S.chain))
   && matchQ(`${r.name} ${r.slug} ${r.category || ''} ${(r.chains || []).join(' ')} ${r.symbol || ''} ${r.reason || ''}`, q));
 }
 function buildPowerLawSvg() {
  const W = 440, H = 114, pL = 36, pR = 10, pT = 8, pB = 20, mX = log10(5e6), MX = log10(5e9), mY = 5;
  const sx = (v) => (pL + ((max(mX, min(MX, log10(max(1, v)))) - mX) / (MX - mX)) * (W - pL - pR)).toFixed(1);
  const sy = (v) => (H - pB - ((max(mY, min(MX, log10(max(1, v)))) - mY) / (MX - mY)) * (H - pT - pB)).toFixed(1);
  const bm = VM.beta, q50 = VM.q50, q80 = VM.q80, ch = bm[2] * log(2);
  const u8 = [], l8 = [], u5 = [], l5 = [], mid = [];
  for (const t of [5e6, 2e7, 1e8, 5e8, 3e9]) {
   const lp = bm[0] + bm[1] * log(t) + ch, x = sx(t);
   mid.push(`${x},${sy(exp(lp))}`);
   u8.push(`${x},${sy(exp(lp + q80))}`); l8.unshift(`${x},${sy(exp(lp - q80))}`);
   u5.push(`${x},${sy(exp(lp + q50))}`); l5.unshift(`${x},${sy(exp(lp - q50))}`);
  }
  const f = 'font-size="9" font-family="ui-monospace,monospace" fill="#5d6b79"';
  const grid = [[1e6, '$1M'], [5e7, '$50M'], [2e9, '$2B']].map(([v, l]) => `<line x1="${pL}" y1="${sy(v)}" x2="${W - pR}" y2="${sy(v)}" stroke="#ebe7de"/><text x="${pL - 4}" y="${+sy(v) + 3}" text-anchor="end" ${f}>${l}</text>`).join('')
   + [[5e6, '$5M'], [5e7, '$50M'], [5e8, '$500M'], [3e9, '$3B']].map(([v, l]) => `<text x="${sx(v)}" y="${H - 4}" text-anchor="middle" ${f}>${l}</text>`).join('');
  const peers = LIVE.filter((p) => p.in_fit && p.mcap_usd).map((p) => `<circle cx="${sx(p.tvl_usd)}" cy="${sy(p.mcap_usd)}" r="2.2" fill="#7c8b9b" opacity=".62"/>`).join('');
  const tgts = ROWS.slice(0, 12).map((r) => {
   const x = +sx(r.tvl_usd), y = +sy(r.implied_value_usd);
   return `<polygon points="${x},${y - 3.6} ${x + 3.6},${y} ${x},${y + 3.6} ${x - 3.6},${y}" fill="${farmOf(r).verdict === 'FARM' ? '#0f6b4b' : '#1b4d89'}"/>`;
  }).join('');
  return `<svg class="svg-box" viewBox="0 0 ${W} ${H}" role="img" aria-label="Power-law valuation fit">${grid}<polygon points="${u8.concat(l8).join(' ')}" fill="#1b4d89" opacity=".09"/><polygon points="${u5.concat(l5).join(' ')}" fill="#1b4d89" opacity=".16"/>${peers}<polyline points="${mid.join(' ')}" fill="none" stroke="#1b4d89" stroke-width="2"/>${tgts}</svg>`;
 }
 function buildOddsCurveSvg() {
  const W = 330, H = 114, pL = 28, pR = 8, pT = 14, pB = 22, cv = OM.age_curve, bw = (W - pL - pR) / cv.length, m = 'font-family="ui-monospace,monospace"';
  const bars = cv.map((c, i) => {
   const x = pL + i * bw + 6, w = bw - 12, bh = (c.rate / 100) * (H - pT - pB), y = H - pB - bh, cx = (x + w / 2).toFixed(1);
   return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${bh.toFixed(1)}" rx="3" fill="${i < 2 ? '#0f6b4b' : i < 4 ? '#1b4d89' : '#8b99a8'}" opacity=".88"/><text x="${cx}" y="${(y - 3).toFixed(1)}" text-anchor="middle" font-size="9.5" font-weight="700" ${m} fill="#141a21">${c.rate}%</text><text x="${cx}" y="${H - 6}" text-anchor="middle" font-size="9" ${m} fill="#5d6b79">${c.label}</text>`;
  }).join('');
  return `<svg class="svg-box" viewBox="0 0 ${W} ${H}" role="img" aria-label="Tokenization by age"><line x1="${pL}" y1="${H - pB}" x2="${W - pR}" y2="${H - pB}" stroke="#c6bfb0"/><text x="${pL - 4}" y="${pT + 4}" text-anchor="end" font-size="8.5" ${m} fill="#5d6b79">100%</text><text x="${pL - 4}" y="${H - pB}" text-anchor="end" font-size="8.5" ${m} fill="#5d6b79">0%</text>${bars}</svg>`;
 }
 function renderMasthead() {
  const logo = '<svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14" fill="#1e293b" stroke="#334155"/><circle cx="16" cy="16" r="9" fill="none" stroke="#64748b"/><circle cx="16" cy="16" r="4.2" fill="none" stroke="#64748b"/><path d="M16 16 L26 8 A13 13 0 0 1 28 19 Z" fill="#10b981" opacity=".82"/><circle cx="16" cy="16" r="2.2" fill="#f8fafc"/><circle cx="22" cy="12" r="2.3" fill="#6ee7b7"/></svg>';
  const pill = (k, v) => sp('meta-pill', [`${k} `, b(v)]);
  return el('header', 'masthead',
   d('brand', el('div', { html: logo }), d(0, d('brand-title', 'Token Radar'), d('brand-sub', 'Empirical Pre-Token Launch Valuation, Survival-Hazard Odds & Costed Farm Desk'))),
   d('meta-pills', pill('Snapshot', DATA.as_of), pill('Source', 'DefiLlama API (sealed)'), pill('Engine', `${DATA.version} · 0 hardcoded names`)),
  );
 }
 function renderIntegrityStrip() {
  const fin = VM.ablation[3], c = CNT, cf = VM.conformal;
  const item = (l, v) => el('span', 'chk', sp('chk-dot', '\u2713'), `${l} `, b(v));
  const seg = (n, cls) => el('i', { class: cls, style: `width:${((n / c.total) * 100).toFixed(2)}%` });
  return d('integrity-wrap',
   el('div', { class: 'integrity', role: 'status' },
    item('Universe:', `${c.total}/${c.total} (${c.watchlist} WL · ${c.early} Early · ${c.excluded} Set Aside · ${c.live} Live)`),
    item('Watchlist:', `${c.watchlist}/${c.watchlist}`),
    item('4-Regime Blind CV:', `WF \u00d7${fin.wf_med_x} · LOO \u00d7${fin.loo_med_x} · Cat \u00d7${fin.cat_med_x}`),
    item('Conformal:', `${cf.wf_cov50}% / ${cf.wf_cov80}% WF cov`),
    item('Live Parity:', `${parityExact}/${c.ranked} exact`),
   ),
   d('univ-bar', seg(c.watchlist, 'seg-wl'), seg(c.early, 'seg-ea'), seg(c.excluded, 'seg-ex'), seg(c.live, 'seg-lv')),
  );
 }
 function renderOverviewStrip() {
  const c = CNT, farmRows = ROWS.filter((r) => farmOf(r).verdict === 'FARM');
  const rates = farmRows.map((r) => farmOf(r).phr).sort((a, x) => a - x);
  const medPhr = rates.length ? rates[rates.length >> 1] : 0, preTvl = ROWS.reduce((s, r) => s + r.tvl_usd, 0);
  const fo = OM.ablation[4], fv = VM.ablation[3], bm = VM.beta;
  const kpi = (l, v, s, cl) => d('kpi', sp('kpi-label', l), d(`kpi-val ${cl || ''}`, v), sp('kpi-sub', s));
  const card = (h, rt, ...k) => d('card', d('card-head', el('h2', 0, h), sp(0, rt)), ...k);
  return el('section', 'overview',
   card('Actionable Farm Desk', `${c.ranked} Ranked Pre-Token`, d('kpi-grid',
    kpi('FARM Verdicts', `${farmRows.length} / ${c.ranked}`, `${c.verdicts.SELECTIVE} selective · ${c.verdicts.SKIP} skip`, 'good'),
    kpi('Median FARM Rate', `+$${round(medPhr)}/hr`, 'Net after gas, fees & carry', 'good'),
    kpi('Pre-Token TVL', usd(preTvl), `${c.watchlist} watchlist >=$50M`),
    kpi('Odds Blind AUC', fo.wf_auc.toFixed(2), `WF Brier ${fo.wf_brier.toFixed(3)} (n=${OM.universe_n})`),
   )),
   card(`Power-Law Fit (${c.live_priced_clean} Clean Peers)`, `TVL^${bm[1].toFixed(2)} · WF \u00d7${fv.wf_med_x}`,
    el('div', { html: buildPowerLawSvg() }),
    d('chart-foot', sp(0, 'Kept: ln(TVL), min(c,4), cat(k=5)'), sp(0, 'Tested & dropped: 7d, age (in Odds)')),
   ),
   card('Tokenization by Age', 'Hazard falls with age', el('div', { html: buildOddsCurveSvg() }),
    d('chart-foot', sp(0, 'Kept: TVL, age, 7d, cat · Dropped: chains')),
   ),
  );
 }
 function renderNavAndControls() {
  const c = CNT, farmCount = ROWS.filter((r) => farmOf(r).verdict === 'FARM').length;
  const tabBtn = (id, l, n) => btn({ class: 'tab', 'aria-pressed': String(S.tab === id), onclick: () => { S.tab = id; syncHash(); render(); } }, l, n != null ? sp('cnt', String(n)) : null);
  const pillBtn = (l, act, cl, fn) => btn({ class: `pill ${cl || ''}`, 'aria-pressed': String(act), onclick: () => { fn(); syncHash(); render(); } }, l);
  const nav = d('nav-row',
   el('div', { class: 'tabs', role: 'tablist' }, tabBtn('pre-token', 'Pre-Token Radar', c.ranked), tabBtn('live', 'Live-Token Peers', c.live), tabBtn('excluded', 'Set Aside', c.excluded), tabBtn('methodology', 'Model & Blind Proofs', null)),
   S.tab === 'pre-token' ? d('quick-pills',
    pillBtn(`All (${c.ranked})`, S.lane === 'all' && S.verdict === 'all', '', () => { S.lane = 'all'; S.verdict = 'all'; }),
    pillBtn(`Watchlist (${c.watchlist})`, S.lane === 'watchlist', '', () => { S.lane = S.lane === 'watchlist' ? 'all' : 'watchlist'; }),
    pillBtn(`Early <$50M (${c.early})`, S.lane === 'early', '', () => { S.lane = S.lane === 'early' ? 'all' : 'early'; }),
    pillBtn(`FARM Only (${farmCount})`, S.verdict === 'FARM', 'farm', () => { S.verdict = S.verdict === 'FARM' ? 'all' : 'FARM'; }),
   ) : null,
  );
  if (S.tab === 'methodology') return d(0, nav);
  const src = S.tab === 'pre-token' ? ROWS : S.tab === 'live' ? LIVE : EXCL;
  const cats = [...new Set(src.map((r) => r.category || 'Other'))].sort(), chs = [...new Set(src.flatMap((r) => r.chains || []))].sort();
  const qIn = el('input', { type: 'search', placeholder: 'Search protocol, category, chain...', value: S.q, 'aria-label': 'Search protocols' });
  qIn.addEventListener('input', () => { S.q = qIn.value; syncHash(); render(); });
  const sel = (l, cur, opts, fn) => {
   const s = el('select', { 'aria-label': l }, opts.map(([v, t]) => el('option', { value: v, selected: String(v) === String(cur) ? 'selected' : null }, t)));
   s.addEventListener('change', () => { fn(s.value); syncHash(); render(); });
   return s;
  };
  const shown = S.tab === 'pre-token' ? filterPreTokenRows().length : filterSecondaryRows(src).length;
  return d(0, nav, d('controls',
   qIn,
   sel('Category', S.category, [['all', 'All categories'], ...cats.map((x) => [x, x])], (v) => { S.category = v; }),
   sel('Chain', S.chain, [['all', 'All chains'], ...chs.map((x) => [x, x])], (v) => { S.chain = v; }),
   S.tab === 'pre-token' ? sel('Verdict', S.verdict, [['all', 'All verdicts'], ['FARM', 'Verdict: FARM'], ['SELECTIVE', 'Verdict: SELECTIVE'], ['SKIP', 'Verdict: SKIP']], (v) => { S.verdict = v; }) : null,
   S.tab === 'pre-token' ? sel('Wallet budget', S.budget, [[0, 'Capital: Auto Min'], [500, 'Budget: $500'], [1000, 'Budget: $1,000'], [2500, 'Budget: $2,500'], [5000, 'Budget: $5,000']], (v) => { S.budget = +v; }) : null,
   hasFilter() ? btn({ class: 'btn-reset', onclick: resetFilters }, 'Clear filters') : null,
   sp('row-summary', ['Showing ', b(String(shown)), ` of ${src.length}`]),
  ));
 }
 function sortHeader(key, label) {
  const act = S.sort === key;
  return el('th', { scope: 'col' }, btn({
   class: act ? 'active' : '',
   onclick: () => { if (S.sort === key) S.dir = -S.dir; else { S.sort = key; S.dir = -1; } syncHash(); render(); },
  }, label + (act ? (S.dir < 0 ? ' \u25bc' : ' \u25b2') : '')));
 }
 function renderPreTokenTable() {
  const list = sortPreTokenRows(filterPreTokenRows());
  let banner = null;
  if (hasFilter()) {
   const parts = [['lane', 'Lane'], ['verdict', 'Verdict'], ['category', 'Category'], ['chain', 'Chain']].filter(([k]) => S[k] !== 'all').map(([k, l]) => `${l}: ${S[k]}`);
   if (S.budget) parts.push(`Budget: $${S.budget.toLocaleString()}`);
   if (S.q.trim()) parts.push(`Query: "${S.q.trim()}"`);
   const tvl = list.reduce((s, r) => s + r.tvl_usd, 0), wl = list.filter((r) => r.lane === 'watchlist').length;
   const totCap = list.reduce((s, r) => s + farmOf(r).cap, 0), totEv = list.reduce((s, r) => s + farmOf(r).net_ev, 0);
   const meanPhr = list.length ? list.reduce((s, r) => s + farmOf(r).phr, 0) / list.length : 0;
   banner = d('filter-banner',
    sp(0, 'Filter: ', b(parts.join(' · ')), ' · Sort: ', b(`${SORT_LABELS[S.sort] || S.sort} ${S.dir < 0 ? 'desc' : 'asc'}`)),
    sp(0, b(`${list.length} protocols`), ` (${wl} WL / ${list.length - wl} Early) · TVL `, b(usd(tvl)), ' · Cap ', b(usd(totCap)), ' · Net EV ', b(sgn(totEv)), ' · Mean ', b(`${sgn(meanPhr)}/hr`)),
   );
  }
  if (!list.length) {
   return d(0, banner, d('panel empty', el('h3', 0, 'No pre-token protocols match'), el('p', 0, 'Clear filters to view all ranked protocols.'), btn({ class: 'btn-reset', style: 'margin-top:10px', onclick: resetFilters }, 'Reset all filters')));
  }
  const pos = (v) => max(0, min(100, ((log10(max(1e5, v)) - 5) / 4) * 100));
  const trs = list.map((r) => {
   const f = farmOf(r), lo8 = pos(r.low_80), hi8 = pos(r.high_80), lo5 = pos(r.low_50), hi5 = pos(r.high_50), pt = pos(r.implied_value_usd);
   return el('tr', { class: 'clickable', 'data-selected': String(S.selected === r.slug), tabindex: '0', onclick: () => openDetail(r.slug), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } } },
    td(`#${r.rank}`, `rank-cell${r.rank <= 10 ? ' rank-top' : ''}`),
    el('td', 0, d('proto-name', r.name, sp(`tag ${r.lane === 'watchlist' ? 'tag-wl' : 'tag-ea'}`, r.lane === 'watchlist' ? 'WL' : 'EARLY')), pSub(r, `${f.chain}${r.chains.length > 1 ? ` (+${r.chains.length - 1})` : ''}`)),
    td(usd(r.tvl_usd), 'num'), chgTd(r.change_7d), td(ageStr(r.age_days), 'num'),
    el('td', 'val-cell', d('val-top', sp('val-main', usd(r.implied_value_usd)), sp('val-band', `${usd(r.low_50)}\u2013${usd(r.high_50)} (50%)`)), d('band-track', el('span', { class: 'band-80', style: `left:${lo8.toFixed(1)}%;width:${max(4, hi8 - lo8).toFixed(1)}%` }), el('span', { class: 'band-50', style: `left:${lo5.toFixed(1)}%;width:${max(3, hi5 - lo5).toFixed(1)}%` }), el('span', { class: 'band-pt', style: `left:${pt.toFixed(1)}%` }))),
    el('td', 'odds-cell', sp('num', `${round(r.launch_odds * 100)}%`), d('odds-track', el('span', { class: 'odds-fill', style: `width:${round(r.launch_odds * 100)}%` }))),
    el('td', 'farm-cell', d('farm-top', sp(`tag ${vCls(f.verdict)}`, f.verdict), sp(`farm-phr ${f.phr >= 18 ? 'pos' : f.phr < 0 ? 'neg' : ''}`, `${sgn(f.phr)}/hr`)), d('farm-meta', `${f.summary} · ${f.hrs.toFixed(1)}h · $${f.cost.toFixed(1)}`)),
   );
  });
  return el('div', { id: 'board-main' }, banner, tbl([sortHeader('implied', 'Rank'), sortHeader('name', 'Protocol & Lane'), sortHeader('tvl', 'TVL'), sortHeader('change_7d', '7d \u0394'), sortHeader('age', 'Age'), sortHeader('implied', 'Implied Value (50% / 80% Band)'), sortHeader('odds', 'Odds'), sortHeader('phr', 'Costed Farm Plan & Verdict')], trs));
 }
 function renderLiveTable() {
  return tbl(ths(['Role', 'Live-Token Protocol', 'TVL', 'Actual MCap', 'Blind LOO Pred', 'Actual / Pred', '7d \u0394']),
   filterSecondaryRows(LIVE).slice(0, 150).map((r) => tr(0,
    el('td', 0, sp(`tag ${r.in_fit ? 'tag-kept' : 'tag-base'}`, r.in_fit ? 'FIT PEER' : 'LIVE')),
    el('td', 0, d('proto-name', r.name + (r.symbol ? ` (${r.symbol})` : '')), pSub(r, r.chains.slice(0, 3).join(', ') || 'n/a')),
    td(usd(r.tvl_usd), 'num'), td(usd(r.mcap_usd), 'num'), td(r.loo_pred ? usd(r.loo_pred) : 'excluded/unpriced', 'num'),
    td(r.loo_ratio ? `${r.loo_ratio.toFixed(2)}x` : '\u2014', 'num'), chgTd(r.change_7d),
   )));
 }
 function renderExcludedTable() {
  return tbl(ths(['Set-Aside Protocol (No Token Recorded)', 'TVL', '7d \u0394', 'Automated Exclusion Rule']),
   filterSecondaryRows(EXCL).map((r) => tr(0,
    el('td', 0, d('proto-name', r.name), pSub(r, r.chains.slice(0, 3).join(', ') || 'n/a')),
    td(usd(r.tvl_usd), 'num'), chgTd(r.change_7d),
    el('td', 0, sp('tag tag-skip', r.reason)),
   )));
 }
 function renderMethodologyView() {
  const vm = VM, om = OM, bm = vm.beta, ow = om.weights;
  const tCls = (dec) => (dec.includes('KEPT') ? 'tag-kept' : dec === 'DROPPED' ? 'tag-drop' : 'tag-base');
  const barRow = (l, w, c, rt) => d('lane-row', sp(0, l), d('lane-track', el('i', { style: `width:${w}%;background:${c}` })), sp('num', rt));
  const mCard = (t, lead, f, head, rows) => el('section', 'meth-card',
   el('h3', 0, t), el('p', 'meth-lead', lead), d('formula-box', f),
   el('table', 'meth-table', el('thead', 0, tr(0, ths(head))), el('tbody', 0, rows)),
  );
  return d('meth-grid',
   mCard('1. Valuation Model — Four Blind Out-of-Sample Proofs',
    `Huber (\u03b4=0.5) on ${vm.conformal.loo_n} clean live peers. Terms kept only if they improve LOO, 10-Fold, Walk-Forward (older 65% \u2192 newer 35%, n=${vm.conformal.wf_n}), and Category-Block CV.`,
    `ln(Implied) = ${bm[0].toFixed(3)} + ${bm[1].toFixed(3)}\u00b7ln(TVL) ${bm[2].toFixed(3)}\u00b7ln(1+min(c,${vm.chain_cap})) + shrink(cat, k=5)\nConformal bands: 50% [\u00f7${vm.conformal.q50_x}, \u00d7${vm.conformal.q50_x}] (${vm.conformal.wf_cov50}% WF) · 80% [\u00f7${vm.conformal.q80_x}, \u00d7${vm.conformal.q80_x}] (${vm.conformal.wf_cov80}% WF)`,
    ['Specification', 'LOO \u00d7', '10f \u00d7', 'WF \u00d7', 'Cat \u00d7', '80% Cov', 'Verdict'],
    vm.ablation.map((r) => el('tr', r.decision.includes('FINAL') ? 'winner' : '',
     td(r.label), td(`\u00d7${r.loo_med_x.toFixed(2)}`, 'num'), td(`\u00d7${r.cv10_med_x.toFixed(2)}`, 'num'), td(`\u00d7${r.wf_med_x.toFixed(2)}`, 'num'), td(`\u00d7${r.cat_med_x.toFixed(2)}`, 'num'), td(`${r.wf_cov80}%`, 'num'), el('td', 0, sp(`tag ${tCls(r.decision)}`, r.decision)),
    )),
   ),
   mCard('2. Token Launch Odds — Survival Hazard from Peer Record',
    `L2 logistic CDF on ${om.universe_n} clean protocols. 7d growth & age — dropped from valuation — BOTH pass blind tests here. Remaining odds = (F_hor - F_now) / (1 - F_now).`,
    `logit(F) = ${ow[0].toFixed(2)} + ${ow[1].toFixed(2)}\u00b7ln(TVL/10M) + ${ow[2].toFixed(2)}\u00b7ln(1+age)/7 ${ow[3].toFixed(2)}\u00b7clamp(7d) + ${ow[4].toFixed(2)}\u00b7cat_logit\nP(launch | pre-token at age t) declines naturally as age approaches maturity.`,
    ['Specification', '10f Brier', '10f AUC', 'WF Brier', 'WF AUC', 'Verdict'],
    om.ablation.map((r) => el('tr', r.decision.includes('FINAL') ? 'winner' : '',
     td(r.label), td(r.cv_brier.toFixed(4), 'num'), td(r.cv_auc.toFixed(3), 'num'), td(r.wf_brier.toFixed(4), 'num'), td(r.wf_auc.toFixed(3), 'num'), el('td', 0, sp(`tag ${tCls(r.decision)}`, r.decision)),
    )),
   ),
   el('section', 'meth-card',
    el('h3', 0, '3. Full 758-Protocol Accounting Ledger'),
    el('p', 'meth-lead', `Zero silent drops: every protocol belongs to one named lane (${CNT.watchlist} + ${CNT.early} + ${CNT.excluded} + ${CNT.live} = ${CNT.total}).`),
    d('lane-bars', [['Watchlist Pre-Token (>=$50M)', CNT.watchlist, '#1b4d89'], ['Early Pre-Token (<$50M)', CNT.early, '#0f6b4b'], ['Set Aside (CEX/Bridge/V#/Parent)', CNT.excluded, '#b03a24'], [`Live-Token Peers (${CNT.live_priced_clean} Fit)`, CNT.live, '#5d6b79']].map(([l, n, c]) => { const p = round((n / CNT.total) * 100); return barRow(l, p, c, `${n} (${p}%)`); })),
   ),
   el('section', 'meth-card',
    el('h3', 0, '4. Category Shrunk Multipliers & Peer Token Rates'),
    el('p', 'meth-lead', 'Top 10 peer-backed categories (median log-residual shrunk toward 0 with k=5, cap \u00b12.5).'),
    d('lane-bars', DATA.categories.slice(0, 10).map((c) => barRow(`${c.category} (n=${c.peers})`, min(100, max(8, round((c.mult / 2.2) * 100))), c.mult >= 1 ? '#0f6b4b' : '#9c5d0c', `\u00d7${c.mult.toFixed(2)}${c.token_rate != null ? ` · ${c.token_rate}% tok` : ''}`))),
   ),
  );
 }
 const dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
 dialog.addEventListener('close', () => { S.selected = null; syncHash(); render(); });
 function openDetail(slug) {
  const row = ROWS.find((r) => r.slug === slug);
  if (!row) return;
  S.selected = slug;
  syncHash();
  const rec = ENGINE.recomputeProtocolValue(row, VM), bm = VM.beta, capCh = min(VM.chain_cap, row.chains.length);
  const cat = row.category || 'Other', f = farmOf(row);
  const peers = LIVE.filter((p) => p.in_fit && (p.category || 'Other') === cat).sort((a, x) => abs(log(a.tvl_usd / row.tvl_usd)) - abs(log(x.tvl_usd / row.tvl_usd))).slice(0, 4);
  const eqRow = (k, v, cl) => d(`eq-row ${cl || ''}`, sp(0, k), b(v));
  const dBox = (h, ...k) => d('d-box', el('h3', 0, h), ...k);
  const comps = peers.length ? el('table', 'comps-table', el('thead', 0, tr(0, ths(['Live Peer', 'TVL', 'Actual MCap', 'LOO Pred']))), el('tbody', 0, peers.map((p) => tr(0, td(p.name + (p.symbol ? ` (${p.symbol})` : '')), td(usd(p.tvl_usd), 'num'), td(usd(p.mcap_usd), 'num'), td(usd(p.loo_pred), 'num'))))) : el('p', 'd-sub', `No priced live peers in "${cat}" — offset shrinks to 0.00.`);
  dialog.textContent = '';
  dialog.appendChild(d('d-head',
   d(0, d('d-title-row', sp(`tag ${row.lane === 'watchlist' ? 'tag-wl' : 'tag-ea'}`, row.lane === 'watchlist' ? 'WATCHLIST' : 'EARLY RADAR'), el('span', { class: 'num', style: 'font-size:12px;color:#5d6b79' }, `Rank #${row.rank} of ${CNT.ranked}`), el('h2', { id: 'detail-title' }, row.name)), d('d-sub', `${cat} · Chains: ${row.chains.join(', ') || 'n/a'} · TVL ${usd(row.tvl_usd)} · 7d ${pct(row.change_7d)} · Age ${ageStr(row.age_days)}`)),
   el('button', { type: 'button', class: 'd-close', onclick: () => dialog.close() }, 'Close'),
  ));
  dialog.appendChild(d('d-grid',
   d('d-col',
    dBox('Implied Value Decomposition (Huber Power Law)', d('eq-list',
     eqRow('Intercept (\u03b2\u2080)', bm[0].toFixed(4)),
     eqRow(`TVL (${bm[1].toFixed(3)} \u00d7 ln ${usd(row.tvl_usd)})`, `+${(bm[1] * log(max(1, row.tvl_usd))).toFixed(4)}`),
     eqRow(`Chains (${bm[2].toFixed(3)} \u00d7 ln(1+${capCh}))`, (bm[2] * log(1 + capCh)).toFixed(4)),
     eqRow(`Category (${cat}, ${row.cat_peers} peers)`, `${row.cat_offset >= 0 ? '+' : ''}${row.cat_offset.toFixed(4)} (\u00d7${exp(row.cat_offset).toFixed(2)})`),
     eqRow('Implied Launch Value', usd(row.implied_value_usd), 'total'),
     eqRow('50% Conformal Core (52% WF)', `${usd(row.low_50)}\u2013${usd(row.high_50)}`),
     eqRow('80% Conformal Range (80% WF)', `${usd(row.low_80)}\u2013${usd(row.high_80)}`),
    ), d('parity-pill', rec.implied === row.implied_value_usd ? `\u2713 Live browser recompute matches board.json exact (${usd(rec.implied)})` : 'Parity mismatch!')),
    dBox('Empirical Launch Odds (Survival Hazard)', d('eq-list', eqRow(`Peer CDF at age ${ageStr(row.age_days)}`, `${round(row.peer_rate_now * 100)}%`), eqRow('Peer mature horizon (5y)', `${round(row.peer_rate_horizon * 100)}%`), eqRow('Remaining Launch Odds', `${round(row.launch_odds * 100)}%`, 'total'))),
    dBox(`Nearest Live-Token Comps (${cat})`, comps),
   ),
   d('d-col', dBox('Costed Farm Economics & Verdict',
    d('verdict-hero', el('span', { class: `tag ${vCls(f.verdict)}`, style: 'font-size:12px;padding:4px 9px' }, f.verdict), d(0, d(`verdict-big ${f.phr >= 18 ? 'pos' : f.phr < 0 ? 'neg' : ''}`, `${sgn(f.phr)}/hr net (${sgn(f.net_ev)} EV)`), d('d-sub', f.why))),
    d('econ-strip', [['Capital', `$${f.cap}`], ['Total Cost', `$${f.cost.toFixed(1)}`], ['Break-Even FDV', f.breakeven_fdv ? usd(f.breakeven_fdv) : 'n/a'], ['Route Chain', f.chain]].map(([k, v]) => d('econ-item', sp(0, k), b(v)))),
    d('sens-strip', sp(0, `Costs: gas $${f.gas.toFixed(1)} + fees $${f.fees.toFixed(1)} + carry $${f.opp.toFixed(1)} (${f.hrs.toFixed(1)}h/${f.hold}d)`), b(`50% Band: ${sgn(f.bear_phr)} / ${sgn(f.phr)} / ${sgn(f.bull_phr)} /hr`)),
    el('ol', 'step-list', f.steps.map((st, i) => el('li', 'step-item', d('step-top', sp('step-num', `${i + 1}. ${st.title}`), sp('step-meta', `${st.cost} · ${st.time}`)), d('step-body', st.action)))),
   )),
  ));
  if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); } else dialog.setAttribute('open', '');
 }
 function render() {
  root.textContent = '';
  const showOverview = S.tab === 'pre-token' && !hasFilter();
  const body = S.tab === 'pre-token' ? renderPreTokenTable() : S.tab === 'live' ? renderLiveTable() : S.tab === 'excluded' ? renderExcludedTable() : renderMethodologyView();
  root.appendChild(d('shell', renderMasthead(), renderIntegrityStrip(), showOverview ? renderOverviewStrip() : null, renderNavAndControls(), body));
  if (!dialog.parentNode) document.body.appendChild(dialog);
  root.setAttribute('aria-busy', 'false');
  if (S.selected && !dialog.open) openDetail(S.selected);
 }
 readHashState();
 render();
})();
