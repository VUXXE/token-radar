// Node 22 TypeScript bridge & gate validator for Token Radar (radar-5).
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
  buildRadar(snapshot: Snapshot): RadarBundle;
  recomputeRow(row: unknown, valueModel: unknown): { implied: number };
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

/** Run the canonical engine and verify 100% browser recomputation parity before returning. */
export function buildRadar(snapshot: Snapshot): RadarBundle {
  const result = ENGINE.buildRadar(snapshot);
  const rows = (result.radar as { rows: unknown[] }).rows;
  const valueModel = (result.radar as { value_model: unknown }).value_model;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] as { slug: string; implied_value_usd: number };
    const check = ENGINE.recomputeRow(r, valueModel);
    if (check.implied !== r.implied_value_usd) {
      throw new Error(`browser parity mismatch on ${r.slug}: ${check.implied} != ${r.implied_value_usd}`);
    }
  }
  return result;
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
