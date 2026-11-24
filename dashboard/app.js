// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, a filterable table, a per-protocol detail
// drawer with the model's own inputs, and the protocol's farm plan. No network:
// every byte it shows is in data.js, so the page works from a plain file.
//
// The page is organised as small builders, one per section: the header, the lede,
// the top-ten chips, the filter controls, the board table, the live-token table, the
// model panel, and the detail drawer. A shared `el` helper builds the DOM, the
// formatters turn numbers into the board's text, and the farm plan is the same
// derivation main.ts writes to board.json, recomputed here from the same figures.
(function () {
  'use strict';

  var dataset = window.RADAR;
  if (!dataset) return;
  var boardRoot = document.getElementById('board');
  // What the viewer is looking at: the search text, the two filters, the tab, the
  // sort key and direction, and the protocol whose detail drawer is open.
  var view = { q: '', category: 'all', chain: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  /** A dollar amount as the board writes it: billions, millions, thousands, then whole dollars. */
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }

  /** A per-cent change with its sign, two decimals, or 'n/a' when the snapshot records none. */
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }

  /** An age in days as the board writes it: years past a year, days below it, 'unknown' when unlisted. */
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  /** A category multiple with its 'x', or 'n/a' when there is none. */
  function fmtMult(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return n.toFixed(2) + 'x';
  }

  /** A peer count in words: '1 live peer', '7 live peers'. */
  function peersLabel(n) {
    return n + (n === 1 ? ' live peer' : ' live peers');
  }

  // The model, recomputed in the page: the detail drawer re-scores a row from the
  // snapshot figures and checks the number board.json carries, so the page's code
  // and the board's data are visibly the same arithmetic. Each factor is its own
  // function, mirroring lib/model.ts.

  /** The clamped seven-day growth, in per cent, a row's change_7d contributes. */
  function clampGrowth(change7d, model) {
    var raw = change7d === null || change7d === undefined ? 0 : change7d;
    return Math.min(model.growth_cap, Math.max(model.growth_floor, raw));
  }

  /** The growth factor: 1 plus the clamped growth times the model's weight. */
  function growthMultiplier(change7d, model) {
    return 1 + (clampGrowth(change7d, model) / 100) * model.growth_weight;
  }

  /** The momentum factor: 1 plus the clamped category momentum times the model's
   * weight. The category momentum is the median seven-day change of the category's
   * live-token peers, carried on the row by the model. */
  function momentumMultiplier(categoryMomentum, model) {
    var raw = categoryMomentum === null || categoryMomentum === undefined ? 0 : categoryMomentum;
    var clamped = Math.min(model.momentum_cap, Math.max(model.momentum_floor, raw));
    return 1 + (clamped / 100) * model.momentum_weight;
  }

  /** The maturity factor: a protocol that has run longer with no token scores higher,
   * up to the model's ceiling; an unknown age reads as the model's unknown-age days. */
  function maturityMultiplier(ageDays, model) {
    var age = ageDays === null || ageDays === undefined ? model.unknown_age_days : ageDays;
    return model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  }

  /** The breadth factor: one extra chain at a time, up to the model's cap. */
  function breadthMultiplier(chainCount, model) {
    var extra = Math.min(Math.max(chainCount - 1, 0), model.breadth_max_chains);
    return 1 + extra * model.breadth_per_chain;
  }

  /** A row's implied value, recomputed from its own figures: TVL times the category
   * multiple times the growth, momentum, maturity and breadth factors, rounded and
   * never below $1. */
  function recomputeImplied(row, model) {
    return Math.max(1, Math.round(row.tvl_usd * row.category_multiple
      * growthMultiplier(row.change_7d, model)
      * momentumMultiplier(row.category_momentum, model)
      * maturityMultiplier(row.age_days, model)
      * breadthMultiplier((row.chains || []).length, model)));
  }

  /** Build a DOM node: the tag, an attribute map (class, text, html, on* handlers,
   * or any other attribute), then children. Strings become text nodes, arrays are
   * flattened, nulls are skipped. */
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category,
  // chains, TVL and age decide the action, the capital, the hold and every cost and
  // time. No name is special-cased, and the strings below are the same ones the
  // model writes, so the drawer and the board agree word for word.

  /** The first chain a protocol names, or a neutral phrase when it names none. */
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }

  /** What one transaction costs on a chain, in dollars: the chain's own gas, not a
   * guess. A chain the table does not name is priced at $1, the middle of the range. */
  var GAS_USD = {
    Ethereum: 6, Solana: 0.05, Base: 0.3, Arbitrum: 0.3, Optimism: 0.3, Binance: 0.2,
    Avalanche: 0.5, Polygon: 0.05, 'Hyperliquid L1': 0.1, Monad: 0.1, Plasma: 0.1,
    Flare: 0.2, Berachain: 0.2, Sui: 0.05, Aptos: 0.05, 'zkSync Era': 0.3,
    Linea: 0.3, Scroll: 0.3, Mantle: 0.1, Sei: 0.05
  };
  function gasFor(chain) { return GAS_USD[chain] === undefined ? 1 : GAS_USD[chain]; }

  /** A dollar amount as the plan writes it: cents below a dollar, whole dollars above. */
  function dollars(n) { return n < 1 ? '$' + n.toFixed(2) : '$' + Math.round(n); }

  /** How much capital one farm position needs, from the protocol's own TVL: the bigger
   * the protocol, the bigger the position that looks like a real user. */
  var CAPITAL_TIERS = [
    { atLeast: 5e9, capital: 250 },
    { atLeast: 1e9, capital: 150 },
    { atLeast: 1e8, capital: 100 }
  ];
  function capitalFor(p) {
    for (var i = 0; i < CAPITAL_TIERS.length; i++) {
      if (p.tvl_usd >= CAPITAL_TIERS[i].atLeast) return CAPITAL_TIERS[i].capital;
    }
    return 50;
  }

  /** How long to hold, from the protocol's age: younger protocols get a longer
   * qualifying window. An unknown age holds the middle window. */
  var HOLD_TIERS = [
    { under: 180, days: 60 },
    { under: 365, days: 45 }
  ];
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    for (var i = 0; i < HOLD_TIERS.length; i++) {
      if (age < HOLD_TIERS[i].under) return HOLD_TIERS[i].days;
    }
    return 30;
  }

  /** One category action: the keywords that select it and the sentence it writes.
   * Keywords are matched against the protocol's lowercased category, in table order,
   * so the first matching row wins and a category that matches nothing takes the
   * fallback. The two tables share one matcher. */
  var PRIMARY_ACTIONS = [
    { keywords: ['lend', 'cdp', 'collateral'], build: function (name, capital, chain) { return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.'; } },
    { keywords: ['dex', 'yield', 'leveraged farm'], build: function (name, capital, chain) { return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.'; } },
    { keywords: ['bridge'], build: function (name, capital, chain) { return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.'; } },
    { keywords: ['staking', 'restak'], build: function (name, capital) { return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.'; } },
    { keywords: ['perpetual', 'derivative'], build: function (name, capital) { return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.'; } },
    { keywords: ['prediction'], build: function (name, capital) { return 'Fund $' + capital + ' and place one market position on ' + name + '.'; } },
    { keywords: ['curator', 'allocator'], build: function (name, capital, chain) { return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.'; } },
    { keywords: ['stable'], build: function (name, capital, chain) { return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.'; } },
    { keywords: ['rwa'], build: function (name, capital, chain) { return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.'; } },
    { keywords: ['insurance'], build: function (name, capital, chain) { return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.'; } }
  ];
  var SECOND_ACTIONS = [
    { keywords: ['lend', 'cdp', 'collateral'], build: function (name) { return 'Borrow $20 of USDC against the supply on ' + name + ', then repay it a week later.'; } },
    { keywords: ['dex', 'yield', 'leveraged farm'], build: function (name, capital, chain) { return "Swap $25 of USDC through " + name + "'s main pool on " + chain + ', then swap $25 back.'; } },
    { keywords: ['bridge'], build: function (name) { return 'Bridge $25 back the other way through ' + name + ' so the round trip is on record.'; } },
    { keywords: ['staking', 'restak'], build: function (name) { return 'Claim the staking receipt on ' + name + ' and check the points page it links to.'; } },
    { keywords: ['perpetual', 'derivative'], build: function (name) { return 'Close the hedge on ' + name + ' and open a fresh one half the size.'; } },
    { keywords: ['prediction'], build: function (name) { return 'Settle the first position on ' + name + ' and place a second one on a different market.'; } },
    { keywords: ['curator', 'allocator'], build: function (name) { return "Check the vault's allocation on " + name + ' and add $25 to the same vault.'; } },
    { keywords: ['stable'], build: function (name) { return 'Redeem $25 of the stable asset through ' + name + ' and re-mint it the same day.'; } },
    { keywords: ['rwa'], build: function (name) { return 'Check the yield accrual on ' + name + ' and add $25 to the same position.'; } },
    { keywords: ['insurance'], build: function (name) { return "Check the cover's expiry on " + name + ' and renew the smallest amount it offers.'; } }
  ];

  /** The first table row whose keywords appear in the category, or null when none matches. */
  function matchAction(table, category) {
    var lowered = (category || '').toLowerCase();
    for (var i = 0; i < table.length; i++) {
      var keywords = table[i].keywords;
      for (var j = 0; j < keywords.length; j++) {
        if (lowered.indexOf(keywords[j]) >= 0) return table[i].build;
      }
    }
    return null;
  }

  /** The category's one action, in the words a farmer can follow. A category the
   * tables do not name takes a plain deposit, so no protocol is left without one. */
  function actionFor(p, capital, chain) {
    var template = matchAction(PRIMARY_ACTIONS, p.category)
      || function (name, cap, ch) { return 'Deposit $' + cap + ' of USDC into ' + name + ' on ' + ch + ' and keep the position open.'; };
    return template(p.name, capital, chain);
  }

  /** The second qualifying action: the other side of the same position, so the plan
   * is not one click. */
  function secondActionFor(p, chain) {
    var template = matchAction(SECOND_ACTIONS, p.category)
      || function (name, cap, ch) { return 'Do one more qualifying action inside ' + name + ' on ' + ch + ', such as a swap, a vote or a deposit.'; };
    return template(p.name, 0, chain);
  }

  /** A step as one string: its action, then its cost and time, within 20..600 characters. */
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }

  /** The one risk that matters most for this protocol, from its own figures: a
   * falling week, a thin pool, or a young protocol each get their own warning, so the
   * plan names the risk instead of a generic caution. */
  function riskFor(p) {
    var change = p.change_7d;
    if (change !== null && change !== undefined && change < -20) {
      return 'TVL fell ' + Math.abs(Math.round(change)) + '% in the last week — check the trend is turning before you add capital, and size the position for a protocol that is shrinking.';
    }
    if (p.tvl_usd < 10000000) {
      return 'TVL is under $10M, so the pool is thin — check slippage on a small test exit before you commit the full position.';
    }
    if (p.age_days !== null && p.age_days !== undefined && p.age_days < 90) {
      return 'The protocol is under 90 days old — check its points program and its audit status before you commit, and treat the position as experimental.';
    }
    return "Smart-contract risk is real on any protocol — check the protocol's audit and its points page, and never farm with funds you cannot afford to lose.";
  }

  /** A protocol's farm plan: eight steps, each an action with a cost and a time. Gas
   * is priced on the protocol's own chain, capital on its TVL, the hold on its age,
   * and the risk step on the one risk its own figures name. */
  function farmSteps(p) {
    var chain = chainOf(p);
    var gas = gasFor(chain);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under ' + dollars(gas * 3) + ' of gas for the first transaction on ' + chain, time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about ' + dollars(gas * 2) + ' of gas on ' + chain, time: '15 minutes to set up' },
      { text: secondActionFor(p, chain), cost: 'about ' + dollars(gas * 3) + ' of gas on ' + chain, time: '15 minutes' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about ' + dollars(gas) + ' of gas a week on ' + chain, time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: riskFor(p), cost: 'nothing but the check', time: '5 minutes a week' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  /** Read the view out of the URL hash, so a link to a filtered board or an open
   * detail drawer survives a reload. Only the four named parameters are read. */
  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) view.q = params.get('q');
    if (params.get('p')) view.selected = params.get('p');
    if (params.get('category')) view.category = params.get('category');
    if (params.get('chain')) view.chain = params.get('chain');
  }

  /** Write the view back to the URL hash, dropping every parameter at its default so
   * the plain board has a clean link. */
  function writeHash() {
    var params = new URLSearchParams();
    if (view.q) params.set('q', view.q);
    if (view.category !== 'all') params.set('category', view.category);
    if (view.chain !== 'all') params.set('chain', view.chain);
    if (view.selected) params.set('p', view.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  /** The board rows the current filters leave: the category and chain dropdowns, then
   * the search text matched against the name, slug, category and chains. */
  function filteredRows() {
    var q = view.q.trim().toLowerCase();
    return dataset.rows.filter(function (r) {
      if (view.category !== 'all' && (r.category || 'Other') !== view.category) return false;
      if (view.chain !== 'all' && (r.chains || []).indexOf(view.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  /** Sort the filtered rows by the chosen key. The default is implied value,
   * descending, which is the board's own order (rank 1 first); a tie falls back to
   * the slug so the order is stable. A null growth sorts last, a null age sorts last. */
  function sortedRows(list) {
    var key = view.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'multiple') { av = a.category_multiple; bv = b.category_multiple; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -view.dir;
      if (av > bv) return view.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  /** The page header: the brand mark and name, and the snapshot's date, source and model version. */
  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', null, 'Snapshot ', el('b', { text: dataset.as_of })),
        el('span', null, 'Source: ', el('b', { text: 'DefiLlama protocol index' })),
        el('span', null, 'Model ', el('b', { text: dataset.model_version }))
      )
    );
  }

  /** The lede: what the board ranks, and the radar scope with the five strongest
   * contacts, nearest the centre first. */
  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('span', { class: 'kicker', text: 'The next token launch, before it happens.' }),
        el('h1', { text: dataset.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', null,
          'The watchlist is the floor: every protocol with at least ',
          el('b', { text: '$' + Math.round(dataset.floor_usd / 1e6) + 'M' }),
          ' of TVL and no token on record. The early radar adds ',
          el('b', { text: String(dataset.early_size) }),
          ' pre-token protocols below that floor. Each category is priced off its own live-token peers, so a lending protocol and a DEX are not valued at the same multiple. Implied value is a model, not a promise.'
        )
      ),
      scope()
    );
  }

  /** The radar scope: the five strongest contacts on a dial, nearest the centre
   * first. Radius is the log of implied value, so the strongest contact sits nearest
   * the centre; angle spreads by rank so no two contacts overlap. */
  function scope() {
    var top = dataset.rows.slice(0, 5);
    var dial = el('div', { class: 'scope-dial' });
    var maxLog = Math.log10(top[0].implied_value_usd || 1);
    var minLog = Math.log10(top[top.length - 1].implied_value_usd || 1);
    var angles = [-70, -10, 50, 120, 185];
    top.forEach(function (r, i) {
      var logVal = Math.log10(r.implied_value_usd || 1);
      var frac = maxLog === minLog ? 0.5 : (maxLog - logVal) / (maxLog - minLog);
      var radius = 0.14 + 0.68 * frac;
      var angle = angles[i] * Math.PI / 180;
      var x = 50 + radius * 50 * Math.cos(angle);
      var y = 50 + radius * 50 * Math.sin(angle);
      dial.appendChild(el('span', {
        class: 'blip' + (i === 0 ? ' first' : ''),
        style: 'left:' + x.toFixed(1) + '%;top:' + y.toFixed(1) + '%',
        text: String(r.rank),
        title: r.name + ' — ' + fmtUsd(r.implied_value_usd)
      }));
    });
    var first = top[0];
    return el('div', { class: 'scope' }, dial,
      el('div', { class: 'scope-side' },
        el('span', { class: 'label', text: 'Strongest signal' }),
        el('span', { class: 'strong', text: first.name }),
        el('span', { class: 'strong-value', text: fmtUsd(first.implied_value_usd) + ' implied' }),
        el('span', { class: 'note', text: 'The top five contacts, nearest the centre first.' })
      )
    );
  }

  /** The signal strip: the four facts that say how much board there is, in one line
   * under the lede instead of a column beside it. */
  function factsStrip() {
    return el('div', { class: 'facts' },
      el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: dataset.watchlist_size + ' / ' + dataset.watchlist_size })),
      el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(dataset.board_size) })),
      el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(dataset.early_size) })),
      el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(dataset.live_size) }))
    );
  }

  /** The top-ten chips: the board's first ten rows, each opening its detail drawer. */
  function top10() {
    var chips = dataset.rows.slice(0, 10).map(function (r) {
      return el('button', { type: 'button', class: 'chip', onclick: function () { openDetail(r.slug); } },
        el('b', { text: '#' + r.rank + ' ' + r.name }),
        el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
      );
    });
    return el('div', { class: 'top10' }, chips);
  }

  /** The filter controls: search, the category and chain dropdowns built from the
   * board itself, the pre-token / live-token tabs, and the count of rows shown. */
  function controls() {
    var categories = Array.from(new Set(dataset.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(dataset.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: view.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { view.q = search.value; writeHash(); render(); });
    var catSelect = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === view.category ? 'selected' : null }); })
    );
    catSelect.addEventListener('change', function () { view.category = catSelect.value; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === view.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { view.chain = chainSelect.value; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': view.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { view.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': view.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { view.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSelect),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: view.tab === 'pre-token' ? filteredRows().length + ' rows shown' : dataset.live.length + ' live-token protocols' })
    );
  }

  /** A sortable column header: clicking it sorts by that key, or flips the direction
   * when it is already the sort key. The arrow shows the current sort. */
  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (view.sort === key) view.dir = -view.dir; else { view.sort = key; view.dir = -1; } render(); } },
        label,
        view.sort === key ? el('span', { 'aria-hidden': 'true', text: view.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  /** One board row: rank, protocol, TVL, seven-day growth, age, peer multiple, the
   * implied value with its bar, and the token status. A row opens its detail drawer
   * on click, Enter or Space. */
  function boardRowElement(r, maxImplied) {
    var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
    var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
    return el('tr', {
      class: r.rank <= 3 ? 'top3' : '',
      'data-selected': view.selected === r.slug ? 'true' : 'false',
      tabindex: '0',
      onclick: function () { openDetail(r.slug); },
      onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
    },
      el('td', { class: 'num', text: String(r.rank) }),
      el('td', null, el('div', { class: 'name' },
        el('b', { text: r.name }),
        el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
      )),
      el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
      el('td', { class: 'num ' + growthClass, text: growth }),
      el('td', { class: 'num', text: fmtAge(r.age_days) }),
      el('td', { class: 'num mult', text: fmtMult(r.category_multiple) }),
      el('td', null, el('div', { class: 'implied' },
        el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / maxImplied) * 100)) + '%' })),
        el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
      )),
      el('td', null, el('span', { class: 'status', text: 'no token' }))
    );
  }

  /** The board table, or an empty state with a way back when no row matches the filters. */
  function boardTable() {
    var list = sortedRows(filteredRows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { view.q = ''; view.category = 'all'; view.chain = 'all'; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) { tbody.appendChild(boardRowElement(r, max)); });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('multiple', 'Peer multiple'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  /** The live-token table: the protocols that already trade, with the market's own
   * numbers, set aside from the pre-token ranking. */
  function liveTable() {
    var tbody = el('tbody');
    dataset.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  /** The model panel: the formula, what each part means, and the eight largest
   * categories on the board with the multiple each one carries. */
  function modelPanel() {
    var m = dataset.model;
    var byCat = {};
    dataset.rows.forEach(function (r) {
      var c = r.category || 'Other';
      if (!byCat[c]) byCat[c] = { multiple: r.category_multiple, peers: r.peer_count, rows: 0 };
      byCat[c].rows++;
    });
    var catRows = Object.keys(byCat).sort(function (a, b) { return byCat[b].rows - byCat[a].rows; }).slice(0, 8);
    var tbody = el('tbody');
    catRows.forEach(function (c) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('b', { text: c })),
        el('td', { class: 'num mult', text: fmtMult(byCat[c].multiple) }),
        el('td', { class: 'num', text: peersLabel(byCat[c].peers) }),
        el('td', { class: 'num', text: String(byCat[c].rows) + ' rows' })
      ));
    });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x ', el('b', { text: 'category multiple' }), ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (1 + clamp(category momentum, ' + m.momentum_floor + ', ' + m.momentum_cap + ') / 100 x ' + m.momentum_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x (1 + min(chains - 1, ' + m.breadth_max_chains + ') x ' + m.breadth_per_chain + ') )'
      ),
      el('p', { class: 'sub', text: 'The category multiple is the median market-cap-to-TVL of that category\u2019s live-token peers in this snapshot, shrunk toward the global median so a category with one or two peers cannot set the price, and clamped to ' + m.multiple_min + '\u2013' + m.multiple_max + 'x. The category momentum is the median seven-day change of those same peers, so a category whose traded protocols are holding up scores higher than one whose peers are falling. TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. The early radar is every pre-token protocol below the watchlist floor, by TVL, and the live-token protocols are set aside with their market caps shown.' }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'The eight largest categories on the board, and the multiple each one carries.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Peer multiple' }), el('th', { scope: 'col', text: 'Peers' }), el('th', { scope: 'col', text: 'Board rows' }))),
          tbody
        )
      )
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { view.selected = null; writeHash(); });

  /** Open the detail drawer for one protocol: its rank, its model breakdown with the
   * page's own recomputation, and its farm plan. The recomputed number is checked
   * against the board's number, so a stale dataset shows its own mismatch. */
  function openDetail(slug) {
    var row = dataset.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    view.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var recomputed = recomputeImplied(row, dataset.model);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + dataset.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Category multiple (' + peersLabel(row.peer_count) + ')' }), el('b', { class: 'num', text: fmtMult(row.category_multiple) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Category momentum' }), el('b', { class: 'num', text: fmtPct(row.category_momentum) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Chains (' + (row.chains || []).length + ')' }), el('b', { class: 'num', text: String(row.breadth_multiplier) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Momentum multiplier' }), el('b', { class: 'num', text: String(row.momentum_multiplier) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + dataset.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  /** Render the whole page from the current view: header, lede, top-ten chips and
   * model panel on the pre-token tab, the controls and the right table, then the
   * detail drawer when one is selected. */
  function render() {
    boardRoot.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(factsStrip());
    if (view.tab === 'pre-token') shell.appendChild(top10());
    shell.appendChild(controls());
    shell.appendChild(view.tab === 'pre-token' ? boardTable() : liveTable());
    if (view.tab === 'pre-token') shell.appendChild(modelPanel());
    boardRoot.appendChild(shell);
    boardRoot.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) boardRoot.appendChild(dialog);
    if (view.selected) openDetail(view.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
