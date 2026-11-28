// Node 22 TypeScript bridge & gate validator for Token Radar (radar-7).
// Loads dashboard/engine.js as the single deterministic source of truth so
// board.json, data.js, and the browser dashboard execute identical arithmetic.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  lane: 'watchlist' | 'early';
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  conformal_low_80: number;
  conformal_high_80: number;
  launch_odds: number;
  farm_verdict: 'FARM' | 'SELECTIVE' | 'SKIP';
  farm_net_per_hour: number;
  farm_steps: string[];
}

export interface RadarBundle {
  board: BoardRow[];
  radar: Record<string, unknown> & {
    counts: {
      total: number;
      watchlist: number;
      early: number;
      ranked: number;
      excluded: number;
      live: number;
      live_priced_clean: number;
      verdicts: { FARM: number; SELECTIVE: number; SKIP: number };
    };
  };
}

interface EngineApi {
  CFG: { version: string; chainCap: number };
  ageDays(asOf: string, d: string | null): number | null;
  bySlug(a: { slug: string }, b: { slug: string }): number;
  round4(n: number): number;
  round2(n: number): number;
  exclusionReason(p: SnapshotProtocol, floor: number, isWl: boolean): string | null;
  classifyUniverse(snap: Snapshot): {
    wlSet: Set<string>;
    watchlist: SnapshotProtocol[];
    early: SnapshotProtocol[];
    excluded: { protocol: SnapshotProtocol; reason: string }[];
    live: SnapshotProtocol[];
    livePricedClean: SnapshotProtocol[];
    exclCounts: Record<string, number>;
  };
  predictLogValue(fit: unknown, p: SnapshotProtocol, asOf: string): number;
  runValueBenchmarks(peers: SnapshotProtocol[], asOf: string): {
    fit: { beta: number[]; catOffsets: Record<string, number>; catCounts: Record<string, number> };
    table: unknown[];
    conformal: { q50: number; q80: number; [k: string]: unknown };
    looMap: Record<string, { pred: number; ratio: number }>;
  };
  runOddsBenchmarks(univ: { p: SnapshotProtocol; y: number }[], asOf: string): {
    fit: { weights: number[]; baseRate: number; catRates: Record<string, { rate: number }> };
    table: unknown[];
    ageCurve: unknown[];
    universeN: number;
    wfTestN: number;
  };
  estimateLaunchHazard(fit: unknown, p: SnapshotProtocol, asOf: string): {
    peer_rate_now: number;
    peer_rate_horizon: number;
    launch_odds: number;
  };
  buildCostedFarmPlan(
    p: SnapshotProtocol,
    implied: number,
    low50: number,
    high50: number,
    odds: number,
    age: number | null,
  ): {
    verdict: 'FARM' | 'SELECTIVE' | 'SKIP';
    phr: number;
    step_strings: string[];
    [k: string]: unknown;
  };
  recomputeProtocolValue(row: unknown, valueModel: unknown): { implied: number };
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/** Load dashboard/engine.js once in a clean deterministic VM context. */
function loadEngine(): EngineApi {
  const enginePath = join(repoRoot, 'dashboard', 'engine.js');
  const source = readFileSync(enginePath, 'utf8');
  const sandbox: { globalThis?: Record<string, unknown>; RADAR_ENGINE?: EngineApi } = {};
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: 'dashboard/engine.js' });
  if (!sandbox.RADAR_ENGINE) throw new Error('dashboard/engine.js did not export RADAR_ENGINE');
  return sandbox.RADAR_ENGINE;
}

const ENGINE = loadEngine();

/** Parse and validate the sealed snapshot JSON. */
export function parseSnapshot(raw: string): Snapshot {
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch (err) {
    throw new SnapshotError(`snapshot is not valid JSON: ${(err as Error).message}`);
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new SnapshotError('snapshot root must be a JSON object');
  }
  const s = doc as Record<string, unknown>;
  if (typeof s.as_of !== 'string' || !Array.isArray(s.protocols) || !Array.isArray(s.watchlist)) {
    throw new SnapshotError('snapshot is missing required as_of, protocols, or watchlist fields');
  }
  return doc as Snapshot;
}

/** Run the canonical engine, assemble board.json + window.RADAR, and verify 100% browser parity. */
export function buildRadar(snapshot: Snapshot): RadarBundle {
  const E = ENGINE;
  const lanes = E.classifyUniverse(snapshot);
  const valRes = E.runValueBenchmarks(lanes.livePricedClean, snapshot.as_of);
  const oddsUniv = [
    ...lanes.watchlist.map((p) => ({ p, y: 0 })),
    ...lanes.early.map((p) => ({ p, y: 0 })),
    ...lanes.live.filter((p) => !E.exclusionReason(p, snapshot.floor_usd, false)).map((p) => ({ p, y: 1 })),
  ].sort((a, b) => E.bySlug(a.p, b.p));
  const oddsRes = E.runOddsBenchmarks(oddsUniv, snapshot.as_of);
  const { q50, q80 } = valRes.conformal;

  const scored = [...lanes.watchlist, ...lanes.early].map((p) => {
    const age = E.ageDays(snapshot.as_of, p.listed_at);
    const cat = p.category || 'Other';
    const lp = E.predictLogValue(valRes.fit, p, snapshot.as_of);
    const implied = Math.max(1, Math.round(Math.exp(lp)));
    const low50 = Math.max(1, Math.round(Math.exp(lp - q50)));
    const high50 = Math.max(implied, Math.round(Math.exp(lp + q50)));
    const low80 = Math.max(1, Math.round(Math.exp(lp - q80)));
    const high80 = Math.max(implied, Math.round(Math.exp(lp + q80)));
    const odds = E.estimateLaunchHazard(oddsRes.fit, p, snapshot.as_of);
    const farm = E.buildCostedFarmPlan(p, implied, low50, high50, odds.launch_odds, age);
    return {
      p,
      lane: (lanes.wlSet.has(p.slug) ? 'watchlist' : 'early') as 'watchlist' | 'early',
      age,
      catOffset: E.round4(valRes.fit.catOffsets[cat] || 0),
      catPeers: valRes.fit.catCounts[cat] || 0,
      implied,
      low50,
      high50,
      low80,
      high80,
      odds,
      farm,
    };
  }).sort((a, b) => b.implied - a.implied || E.bySlug(a.p, b.p));

  const verdicts = { FARM: 0, SELECTIVE: 0, SKIP: 0 };
  const board: BoardRow[] = [];
  const rows: Record<string, unknown>[] = [];
  scored.forEach((s, i) => {
    const rank = i + 1;
    verdicts[s.farm.verdict]++;
    const { slug, name, category, chains, tvl_usd, change_7d, listed_at } = s.p;
    const base = { rank, slug, name, lane: s.lane, category, chains, tvl_usd, change_7d, listed_at, age_days: s.age, implied_value_usd: s.implied };
    board.push({
      ...base,
      conformal_low_80: s.low80,
      conformal_high_80: s.high80,
      launch_odds: s.odds.launch_odds,
      farm_verdict: s.farm.verdict,
      farm_net_per_hour: s.farm.phr,
      farm_steps: s.farm.step_strings,
    });
    const { step_strings: _omitted, ...farm } = s.farm;
    rows.push({
      ...base,
      low_50: s.low50,
      high_50: s.high50,
      low_80: s.low80,
      high_80: s.high80,
      cat_offset: s.catOffset,
      cat_peers: s.catPeers,
      peer_rate_now: s.odds.peer_rate_now,
      peer_rate_horizon: s.odds.peer_rate_horizon,
      launch_odds: s.odds.launch_odds,
      farm,
    });
  });

  const live = lanes.live
    .slice()
    .sort((a, b) => (b.mcap_usd || 0) - (a.mcap_usd || 0) || b.tvl_usd - a.tvl_usd || E.bySlug(a, b))
    .map((p) => {
      const l = valRes.looMap[p.slug];
      return {
        slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd,
        change_7d: p.change_7d, symbol: p.symbol, age_days: E.ageDays(snapshot.as_of, p.listed_at),
        in_fit: !!l, loo_pred: l ? l.pred : null, loo_ratio: l ? l.ratio : null,
      };
    });

  const excluded = lanes.excluded
    .slice()
    .sort((a, b) => b.protocol.tvl_usd - a.protocol.tvl_usd || E.bySlug(a.protocol, b.protocol))
    .map(({ protocol: p, reason }) => ({
      slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, change_7d: p.change_7d, reason,
    }));

  const categories = Object.keys(valRes.fit.catOffsets)
    .map((c) => ({
      category: c,
      peers: valRes.fit.catCounts[c] || 0,
      offset: E.round4(valRes.fit.catOffsets[c]),
      mult: E.round2(Math.exp(valRes.fit.catOffsets[c])),
      token_rate: oddsRes.fit.catRates[c] ? Math.round(oddsRes.fit.catRates[c].rate * 100) : null,
    }))
    .sort((a, b) => b.peers - a.peers || (a.category < b.category ? -1 : 1));

  const valueModel = {
    beta: valRes.fit.beta,
    chain_cap: E.CFG.chainCap,
    cat_offsets: valRes.fit.catOffsets,
    cat_counts: valRes.fit.catCounts,
    q50,
    q80,
    conformal: valRes.conformal,
    ablation: valRes.table,
  };

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] as { slug: string; implied_value_usd: number };
    const check = E.recomputeProtocolValue(r, valueModel);
    if (check.implied !== r.implied_value_usd) {
      throw new Error(`browser parity mismatch on ${r.slug}: ${check.implied} != ${r.implied_value_usd}`);
    }
  }

  return {
    board,
    radar: {
      version: E.CFG.version,
      as_of: snapshot.as_of,
      source: snapshot.source,
      floor_usd: snapshot.floor_usd,
      counts: {
        total: snapshot.protocols.length,
        watchlist: lanes.watchlist.length,
        early: lanes.early.length,
        ranked: board.length,
        excluded: excluded.length,
        live: live.length,
        live_priced_clean: lanes.livePricedClean.length,
        verdicts,
      },
      excl_reasons: lanes.exclCounts,
      value_model: valueModel,
      odds_model: {
        weights: oddsRes.fit.weights.map(E.round4),
        base_rate: E.round4(oddsRes.fit.baseRate),
        universe_n: oddsRes.universeN,
        wf_test_n: oddsRes.wfTestN,
        ablation: oddsRes.table,
        age_curve: oddsRes.ageCurve,
      },
      categories,
      rows,
      live,
      excluded,
    },
  };
}

/** Verify every board gate invariant before writing /output. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) {
    return `board has ${board.length} rows (gate requires 100..4000)`;
  }
  const knownSlugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  let prevValue = Infinity;
  const distinctValues = new Set<number>();

  for (let i = 0; i < board.length; i++) {
    const row = board[i]!;
    if (row.rank !== i + 1) return `row ${row.slug} has rank ${row.rank}, expected ${i + 1}`;
    if (!knownSlugs.has(row.slug)) return `unknown slug ${row.slug}`;
    if (seen.has(row.slug)) return `duplicate slug ${row.slug}`;
    seen.add(row.slug);
    if (!row.name.trim()) return `empty name on ${row.slug}`;
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd < 1 || row.implied_value_usd > 100_000_000_000_000) {
      return `invalid implied_value_usd ${row.implied_value_usd} on ${row.slug}`;
    }
    if (row.implied_value_usd > prevValue) {
      return `implied_value_usd rises at rank ${row.rank} (${row.implied_value_usd} > ${prevValue})`;
    }
    prevValue = row.implied_value_usd;
    distinctValues.add(row.implied_value_usd);

    if (!Array.isArray(row.farm_steps) || row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `row ${row.slug} has ${row.farm_steps?.length ?? 0} farm_steps (need 3..12)`;
    }
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `farm step length ${len} out of 20..600 on ${row.slug}`;
    }
  }
  if (distinctValues.size < 2) return 'all implied_value_usd values are identical';
  for (const wlSlug of snapshot.watchlist) {
    if (!seen.has(wlSlug)) return `missing watchlist slug ${wlSlug}`;
  }
  return null;
}

/** Deterministic local script payload exposing window.RADAR without network fetches. */
export function dataScript(radar: RadarBundle['radar']): string {
  const safeJson = JSON.stringify(radar).replace(/<\/script/gi, '<\\/script');
  return `window.RADAR=${safeJson};\n`;
}
