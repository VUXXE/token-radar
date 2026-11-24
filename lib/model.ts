// Token Radar's model, version radar-4.
//
// One snapshot of the protocol universe goes in; one ranked board comes out. The board
// covers every slug on the snapshot's watchlist, and it adds the early rows the radar
// exists to find: pre-token protocols below the watchlist floor, ranked by the same
// function. A protocol counts as pre-token when its index entry records no token at
// all: no market cap, no CoinGecko id, no symbol. Protocols that already trade are
// kept apart and shown with the market's own values, never mixed into the ranking.
//
// Implied value is derived only from the snapshot's own figures, never from a
// hand-written list of names. The price of a category is set by its own live-token
// peers: the median market-cap-to-TVL ratio of the protocols in that category that
// already trade, in the same snapshot. A category with only one or two peers cannot
// set its own price, so its median is shrunk toward the global median in proportion
// to its peer count, and the result is clamped to a sane band. Six factors then
// turn a protocol's TVL into its implied value:
//
//   category multiple = shrink(median of the category's live peers, global median)
//                       clamped to [multiple_min, multiple_max]
//   growth factor     = 1 + clamp(change_7d, growth_floor, growth_cap) / 100
//                       x growth_weight
//   momentum factor   = 1 + clamp(category momentum, momentum_floor, momentum_cap)
//                       / 100 x momentum_weight, where the category momentum is the
//                       median seven-day change of the category's live-token peers,
//                       shrunk toward the global momentum by the same peer-count
//                       weight that shrinks the multiple: a category whose traded
//                       protocols are holding up scores higher than one whose peers
//                       are falling, even when the protocol's own week is flat, and
//                       a thin category's momentum is pulled toward the market's
//   maturity factor   = maturity_floor + min(age_days, maturity_days)
//                       / maturity_days x maturity_range
//                       (age_days unknown: unknown_age_days)
//   breadth factor    = 1 + min(chains - 1, breadth_max_chains) x breadth_per_chain
//   implied value     = max(1, round(tvl_usd x multiple x growth x momentum
//                       x maturity x breadth))
//
// The same function scores every row, and the peer multiples are computed from the
// snapshot at run time, so a future snapshot re-prices every category on its own
// market. The farm plan is derived the same way, from the protocol's own record
// (category, chains, TVL, age): the action, the capital, the hold and every cost
// and time follow from those figures, never from a list of names.
//
// Beside the value, the model states how much the price can be trusted. Signal
// strength (0..100) scores the evidence behind a row's multiple: how many live
// peers set it, how tightly those peers agree (the middle half of their ratios
// against the median), and whether the protocol's own figures are complete. It does
// not change the implied value; it says how much the value can be trusted. The
// evidence range is the same idea in dollars: the implied value the row would carry
// if its category priced at the lower or the upper quartile of its peers instead of
// their median, so a category whose peers disagree shows a wide range and one whose
// peers agree shows a narrow one.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
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

/** The whole snapshot document: the protocol index, the floor and the watchlist. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  multiple_min: number;
  multiple_max: number;
  shrink_k: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
  momentum_weight: number;
  momentum_floor: number;
  momentum_cap: number;
  signal_peer_weight: number;
  signal_agreement_weight: number;
  signal_change_weight: number;
  signal_age_weight: number;
}

/** The radar-4 constants: the weights and bands every factor above is built from. */
export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  multiple_min: 0.05,
  multiple_max: 1.5,
  shrink_k: 5,
  breadth_per_chain: 0.02,
  breadth_max_chains: 4,
  momentum_weight: 0.3,
  momentum_floor: -30,
  momentum_cap: 30,
  signal_peer_weight: 40,
  signal_agreement_weight: 40,
  signal_change_weight: 10,
  signal_age_weight: 10,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-4';

/** How many pre-token protocols below the watchlist floor the early radar carries, by
 * TVL. A ceiling, not a target: the board carries fewer when fewer rankable protocols
 * exist below the floor (226 rows in the sealed snapshot: 40 watchlist plus 186 early). */
export const EARLY_ROWS = 260;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row, with the model's own breakdown. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    peer_count: number;
    growth_pct: number;
    growth_multiplier: number;
    momentum_multiplier: number;
    momentum_pct: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
    signal_strength: number;
    implied_low: number;
    implied_high: number;
    low_multiple: number;
    high_multiple: number;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with the farm plan generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  peer_count: number;
  growth_multiplier: number;
  momentum_multiplier: number;
  category_momentum: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  signal_strength: number;
  implied_low: number;
  implied_high: number;
  low_multiple: number;
  high_multiple: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own
 * value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  global_multiple: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`: the model's guard against missing figures. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is
 * absent or bad. The snapshot's dates are calendar dates, so both are read at midnight UTC. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const asOfMs = Date.parse(`${asOf}T00:00:00Z`);
  const listedMs = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(asOfMs) || !Number.isFinite(listedMs)) return null;
  return Math.max(0, Math.floor((asOfMs - listedMs) / DAY_MS));
}

/** The median of a non-empty list, else `fallback`. An even count takes the mean of
 * the two middle values, so the median is stable under either parity. */
function median(values: number[], fallback: number): number {
  if (values.length === 0) return fallback;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** A quantile of a sorted list, by linear interpolation: the value a quarter or
 * three quarters of the way through the peers, so the middle half of a category's
 * ratios has two edges to quote. */
function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const at = p * (sorted.length - 1);
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo);
}

/** A category's price and how much it can be trusted: the multiple from its peers'
 * median, the lower and upper quartile multiples that bound the evidence range,
 * how tightly the peers agree, and the category's momentum. */
export interface PeerMultiple {
  multiple: number;
  peers: number;
  lowMultiple: number;
  highMultiple: number;
  agreement: number;
  momentum: number;
}

/** Every live-token protocol's market-cap-to-TVL ratio, grouped by category. A
 * protocol counts as a live peer only when it records a market cap above zero, a TVL
 * above zero, and a CoinGecko id: a token that trades is a price, a token that does
 * not trade is not. Categories with no category at all are grouped as "Other". */
function peerRatiosByCategory(protocols: SnapshotProtocol[]): Map<string, number[]> {
  const ratiosByCategory = new Map<string, number[]>();
  for (const protocol of protocols) {
    if (protocol.mcap_usd === null || protocol.mcap_usd <= 0) continue;
    if (protocol.tvl_usd <= 0 || protocol.gecko_id === null) continue;
    const category = protocol.category ?? 'Other';
    const ratios = ratiosByCategory.get(category);
    if (ratios === undefined) ratiosByCategory.set(category, [protocol.mcap_usd / protocol.tvl_usd]);
    else ratios.push(protocol.mcap_usd / protocol.tvl_usd);
  }
  return ratiosByCategory;
}

/** Shrink a category's median toward the global median. The weight is
 * peers / (peers + shrinkK), so a category with many peers keeps its own price and a
 * category with one or two peers is pulled most of the way to the global median. */
function shrinkToward(categoryMedian: number, globalMedian: number, peerCount: number, shrinkK: number): number {
  const weight = peerCount / (peerCount + shrinkK);
  return weight * categoryMedian + (1 - weight) * globalMedian;
}

/** A multiple inside the model's band: no category may price itself below the floor
 * or above the ceiling, whatever its peers say. */
function clampMultiple(value: number, model: ModelConstants): number {
  return Math.min(model.multiple_max, Math.max(model.multiple_min, value));
}

/** The seven-day changes of each category's live-token peers, for the momentum:
 * only peers that record a change count. */
function changesByCategory(protocols: SnapshotProtocol[]): Map<string, number[]> {
  const changesByCategory = new Map<string, number[]>();
  for (const protocol of protocols) {
    if (protocol.mcap_usd === null || protocol.mcap_usd <= 0) continue;
    if (protocol.tvl_usd <= 0 || protocol.gecko_id === null) continue;
    if (protocol.change_7d === null || !Number.isFinite(protocol.change_7d)) continue;
    const category = protocol.category ?? 'Other';
    const changes = changesByCategory.get(category);
    if (changes === undefined) changesByCategory.set(category, [protocol.change_7d]);
    else changes.push(protocol.change_7d);
  }
  return changesByCategory;
}

/** Everything the model calibrates from the snapshot at run time: each category's
 * multiple and peer count, the global median, and the global momentum. */
export interface Calibration {
  byCategory: Map<string, PeerMultiple>;
  global: number;
  globalMomentum: number;
}

/**
 * Every category's multiple, evidence range, agreement and momentum, calibrated
 * from the snapshot itself: the median mcap/TVL of its live-token peers, shrunk
 * toward the global median by peer count and clamped to the model's band, with the
 * lower and upper quartile multiples shrunk the same way so the evidence range is
 * the same arithmetic at the quartiles; the agreement is one over one plus the
 * middle half's width against the median, so peers that price the category alike
 * score near one and peers that disagree score near zero; the momentum is the median
 * seven-day change of the category's live-token peers, shrunk toward the global
 * momentum by the count of peers that record a change. A category with no live
 * peers takes the global median outright. Computed from the snapshot at run time, so
 * a new snapshot re-prices every category on its own market.
 */
export function peerMultiples(protocols: SnapshotProtocol[], model: ModelConstants): Calibration {
  const ratiosByCategory = peerRatiosByCategory(protocols);
  const allRatios = [...ratiosByCategory.values()].flat();
  const global = median(allRatios, model.multiple_min);
  const changes = changesByCategory(protocols);
  const allChanges = [...changes.values()].flat();
  const globalMomentum = median(allChanges, 0);
  const calibrated = new Map<string, PeerMultiple>();
  for (const [category, ratios] of ratiosByCategory) {
    const sorted = [...ratios].sort((a, b) => a - b);
    const med = median(ratios, global);
    const q1 = quantile(sorted, 0.25);
    const q3 = quantile(sorted, 0.75);
    const n = ratios.length;
    const multiple = clampMultiple(shrinkToward(med, global, n, model.shrink_k), model);
    const lowMultiple = clampMultiple(shrinkToward(q1, global, n, model.shrink_k), model);
    const highMultiple = clampMultiple(shrinkToward(q3, global, n, model.shrink_k), model);
    const iqrMed = med > 0 ? (q3 - q1) / med : Infinity;
    const agreement = n < 2 ? 0 : 1 / (1 + iqrMed);
    const peerChanges = changes.get(category) ?? [];
    const catMomentum = peerChanges.length > 0 ? median(peerChanges, globalMomentum) : globalMomentum;
    const momentum = shrinkToward(catMomentum, globalMomentum, peerChanges.length, model.shrink_k);
    calibrated.set(category, { multiple, peers: n, lowMultiple, highMultiple, agreement, momentum });
  }
  return { byCategory: calibrated, global, globalMomentum };
}

/** A protocol's category price and how much it can be trusted; the global median
 * and global momentum when its category has no live peers at all, with no agreement
 * to quote and a range that collapses to the value itself. */
function categoryMultipleFor(
  category: string | null,
  multiples: Calibration,
): PeerMultiple {
  const peer = multiples.byCategory.get(category ?? 'Other');
  if (peer !== undefined) return peer;
  return { multiple: multiples.global, peers: 0, lowMultiple: multiples.global, highMultiple: multiples.global, agreement: 0, momentum: multiples.globalMomentum };
}

/** Signal strength (0..100): how much a row's multiple can be trusted. More live
 * peers setting the price, tighter agreement among those peers, and complete figures
 * each add their weight; a category with no live peers scores only on completeness,
 * because its price is the global median and there is no agreement to quote. */
function signalStrength(peer: PeerMultiple, change7d: number | null, age: number | null, model: ModelConstants): number {
  const peerPart = model.signal_peer_weight * (peer.peers / (peer.peers + model.shrink_k));
  const agreementPart = model.signal_agreement_weight * peer.agreement;
  const changePart = change7d !== null && Number.isFinite(change7d) ? model.signal_change_weight : 0;
  const agePart = age !== null ? model.signal_age_weight : 0;
  return Math.round(peerPart + agreementPart + changePart + agePart);
}

/** The momentum factor: 1 plus the clamped category momentum times the model's
 * weight. A category whose peers are flat scores 1.00; one whose peers fell 10% in
 * a week scores 0.97; one whose peers rose 10% scores 1.03. */
function momentumFactor(momentumPct: number, model: ModelConstants): number {
  const clamped = Math.min(model.momentum_cap, Math.max(model.momentum_floor, momentumPct));
  return 1 + (clamped / 100) * model.momentum_weight;
}

/** The seven-day growth, in per cent, a protocol's change_7d contributes: clamped to
 * the model's band, and zero when the snapshot records no change. The clamp keeps a
 * single wild week from setting the price. */
function clampedGrowth(change7d: number | null, model: ModelConstants): number {
  const raw = finite(change7d, 0);
  return Math.min(model.growth_cap, Math.max(model.growth_floor, raw));
}

/** The growth factor: 1 plus the clamped growth times the model's weight. A protocol
 * growing 20% in a week scores 1.10; one shrinking 20% scores 0.90. */
function growthFactor(change7d: number | null, model: ModelConstants): number {
  return 1 + (clampedGrowth(change7d, model) / 100) * model.growth_weight;
}

/** The maturity factor: a protocol that has run longer with no token scores higher,
 * up to the model's ceiling at maturity_days. An unknown age is read as
 * unknown_age_days, so an unlisted protocol is neither new nor ancient. */
function maturityFactor(age: number | null, model: ModelConstants): number {
  const ageForModel = age ?? model.unknown_age_days;
  const capped = Math.min(Math.max(ageForModel, 0), model.maturity_days);
  return model.maturity_floor + (capped / model.maturity_days) * model.maturity_range;
}

/** The breadth factor: one extra chain at a time, up to the model's cap, so a
 * protocol on five chains scores 1.08 and a single-chain protocol scores 1.00. */
function breadthFactor(chainCount: number, model: ModelConstants): number {
  const extra = Math.min(Math.max(chainCount - 1, 0), model.breadth_max_chains);
  return 1 + extra * model.breadth_per_chain;
}

/** The multipliers and the implied value one protocol gets under `model`. The
 * arithmetic is the model's whole definition: TVL times the category multiple times
 * the growth, momentum, maturity and breadth factors, rounded to a whole dollar and
 * never below $1. The evidence range is the same arithmetic at the category's lower
 * and upper quartile multiples, and the signal strength scores the evidence behind
 * the multiple. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  multiples: Calibration,
): { implied: number; multiple: number; peers: number; growthPct: number; growthMult: number; momentumPct: number; momentumMult: number; maturityMult: number; breadthMult: number; age: number | null; signal: number; bandLow: number; bandHigh: number; lowMultiple: number; highMultiple: number } {
  const age = ageDays(asOf, protocol.listed_at);
  const peer = categoryMultipleFor(protocol.category, multiples);
  const growthPct = clampedGrowth(protocol.change_7d, model);
  const growthMult = growthFactor(protocol.change_7d, model);
  const momentumPct = peer.momentum;
  const momentumMult = momentumFactor(momentumPct, model);
  const maturityMult = maturityFactor(age, model);
  const breadthMult = breadthFactor(protocol.chains.length, model);
  const factors = growthMult * momentumMult * maturityMult * breadthMult;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * peer.multiple * factors));
  const bandLow = Math.max(1, Math.round(protocol.tvl_usd * peer.lowMultiple * factors));
  const bandHigh = Math.max(implied, Math.round(protocol.tvl_usd * peer.highMultiple * factors));
  const signal = signalStrength(peer, protocol.change_7d, age, model);
  return { implied, multiple: peer.multiple, peers: peer.peers, growthPct, growthMult, momentumPct, momentumMult, maturityMult, breadthMult, age, signal, bandLow, bandHigh, lowMultiple: peer.lowMultiple, highMultiple: peer.highMultiple };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another
 * protocol, not a protocol of its own, so it is never ranked. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all: no market cap, no CoinGecko id, no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a
 * versioned pool. Exchanges are a different market and versioned pools are not
 * protocols. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocols indexed by slug, for the watchlist lookup. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The watchlist rows: every watchlist slug the snapshot carries, in watchlist order.
 * The watchlist is the floor, so every slug is taken even when the snapshot's order
 * would put it elsewhere. */
function watchlistRows(snapshot: Snapshot): SnapshotProtocol[] {
  const index = bySlug(snapshot.protocols);
  const rows: SnapshotProtocol[] = [];
  for (const slug of snapshot.watchlist) {
    const protocol = index.get(slug);
    if (protocol !== undefined) rows.push(protocol);
  }
  return rows;
}

/** The early rows: rankable pre-token protocols below the watchlist floor, strongest
 * TVL first, capped at EARLY_ROWS, skipping anything already chosen. A tie on TVL
 * falls back to the slug so the order is stable. */
function earlyRows(snapshot: Snapshot, alreadyChosen: Set<string>): SnapshotProtocol[] {
  return snapshot.protocols
    .filter((p) => !alreadyChosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
}

/** Score one chosen protocol under the calibrated multiples, keeping the protocol
 * beside its value so the ranking can sort on the number. */
function scoreProtocol(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  multiples: Calibration,
): { protocol: SnapshotProtocol; value: ReturnType<typeof impliedValue> } {
  return { protocol, value: impliedValue(protocol, asOf, model, multiples) };
}

/** The protocols the board ranks, strongest implied value first, with ranks 1..n. A
 * tie on implied value falls back to the slug so the order is stable. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const multiples = peerMultiples(snapshot.protocols, model);
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it
  // cannot, but the board's coverage is the gate's row and is never gambled on a missing
  // record). The early radar then fills the board below the floor, never replacing a
  // watchlist row: a chosen protocol stays chosen.
  const chosen = new Map<string, SnapshotProtocol>();
  for (const protocol of watchlistRows(snapshot)) chosen.set(protocol.slug, protocol);
  for (const protocol of earlyRows(snapshot, new Set(chosen.keys()))) chosen.set(protocol.slug, protocol);

  const scored = [...chosen.values()].map((p) => scoreProtocol(p, snapshot.as_of, model, multiples));
  scored.sort((a, b) => b.value.implied - a.value.implied || (a.protocol.slug < b.protocol.slug ? -1 : a.protocol.slug > b.protocol.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.protocol.slug,
    name: s.protocol.name,
    category: s.protocol.category,
    chains: s.protocol.chains,
    tvl_usd: s.protocol.tvl_usd,
    change_7d: s.protocol.change_7d,
    mcap_usd: s.protocol.mcap_usd,
    listed_at: s.protocol.listed_at,
    gecko_id: s.protocol.gecko_id,
    symbol: s.protocol.symbol,
    token_status: 'pre-token',
    age_days: s.value.age,
    implied_value_usd: s.value.implied,
    model: {
      category_multiple: s.value.multiple,
      peer_count: s.value.peers,
      growth_pct: s.value.growthPct,
      growth_multiplier: round4(s.value.growthMult),
      momentum_multiplier: round4(s.value.momentumMult),
      momentum_pct: s.value.momentumPct,
      maturity_multiplier: round4(s.value.maturityMult),
      breadth_multiplier: round4(s.value.breadthMult),
      age_days: s.value.age,
      signal_strength: s.value.signal,
      implied_low: s.value.bandLow,
      implied_high: s.value.bandHigh,
      low_multiple: s.value.lowMultiple,
      high_multiple: s.value.highMultiple,
    },
    farm_steps: farmSteps(s.protocol, s.value.age).map(stepText),
  }));
}

/** A multiplier rounded to four decimals, as the board carries it. */
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's
 * 20..600 characters. A step that runs long is cut with an ellipsis; a step that
 * runs short is given a closing line, so every step the gate reads is in band. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase when it names none. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** What one transaction costs on a chain, in dollars: the chain's own gas, not a
 * guess. A chain the table does not name is priced at $1, the middle of the range,
 * so an unknown chain never prices a plan at zero or at Ethereum's cost. */
const GAS_USD: Record<string, number> = {
  Ethereum: 6,
  Solana: 0.05,
  Base: 0.3,
  Arbitrum: 0.3,
  Optimism: 0.3,
  Binance: 0.2,
  Avalanche: 0.5,
  Polygon: 0.05,
  'Hyperliquid L1': 0.1,
  Monad: 0.1,
  Plasma: 0.1,
  Flare: 0.2,
  Berachain: 0.2,
  Sui: 0.05,
  Aptos: 0.05,
  'zkSync Era': 0.3,
  Linea: 0.3,
  Scroll: 0.3,
  Mantle: 0.1,
  Sei: 0.05,
};

function gasFor(chain: string): number {
  return GAS_USD[chain] ?? 1;
}

/** A dollar amount as the plan writes it: cents below a dollar, whole dollars above. */
function dollars(n: number): string {
  return n < 1 ? `$${n.toFixed(2)}` : `$${Math.round(n)}`;
}

/** How much capital one farm position needs, from the protocol's own TVL: the bigger
 * the protocol, the bigger the position that looks like a real user. */
const CAPITAL_TIERS: { atLeast: number; capital: number }[] = [
  { atLeast: 5_000_000_000, capital: 250 },
  { atLeast: 1_000_000_000, capital: 150 },
  { atLeast: 100_000_000, capital: 100 },
];

function capitalFor(p: SnapshotProtocol): number {
  for (const tier of CAPITAL_TIERS) if (p.tvl_usd >= tier.atLeast) return tier.capital;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer
 * qualifying window, because a new protocol's snapshots are further apart in effect.
 * An unknown age holds the middle window. */
const HOLD_TIERS: { under: number; days: number }[] = [
  { under: 180, days: 60 },
  { under: 365, days: 45 },
];

function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  for (const tier of HOLD_TIERS) if (age < tier.under) return tier.days;
  return 30;
}

/** One category action: the keywords that select it and the sentence it writes. The
 * keywords are matched against the protocol's lowercased category, in table order,
 * so the first matching row wins and a category that matches nothing takes the
 * fallback below. */
type ActionTemplate = (name: string, capital: number, chain: string) => string;

const PRIMARY_ACTIONS: { keywords: string[]; build: ActionTemplate }[] = [
  { keywords: ['lend', 'cdp', 'collateral'], build: (name, capital, chain) => `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.` },
  { keywords: ['dex', 'yield', 'leveraged farm'], build: (name, capital, chain) => `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.` },
  { keywords: ['bridge'], build: (name, capital, chain) => `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.` },
  { keywords: ['staking', 'restak'], build: (name, capital) => `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.` },
  { keywords: ['perpetual', 'derivative'], build: (name, capital) => `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.` },
  { keywords: ['prediction'], build: (name, capital) => `Fund $${capital} and place one market position on ${name}.` },
  { keywords: ['curator', 'allocator'], build: (name, capital, chain) => `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.` },
  { keywords: ['stable'], build: (name, capital, chain) => `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.` },
  { keywords: ['rwa'], build: (name, capital, chain) => `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.` },
  { keywords: ['insurance'], build: (name, capital, chain) => `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.` },
];

const SECOND_ACTIONS: { keywords: string[]; build: ActionTemplate }[] = [
  { keywords: ['lend', 'cdp', 'collateral'], build: (name) => `Borrow $20 of USDC against the supply on ${name}, then repay it a week later.` },
  { keywords: ['dex', 'yield', 'leveraged farm'], build: (name, _capital, chain) => `Swap $25 of USDC through ${name}'s main pool on ${chain}, then swap $25 back.` },
  { keywords: ['bridge'], build: (name) => `Bridge $25 back the other way through ${name} so the round trip is on record.` },
  { keywords: ['staking', 'restak'], build: (name) => `Claim the staking receipt on ${name} and check the points page it links to.` },
  { keywords: ['perpetual', 'derivative'], build: (name) => `Close the hedge on ${name} and open a fresh one half the size.` },
  { keywords: ['prediction'], build: (name) => `Settle the first position on ${name} and place a second one on a different market.` },
  { keywords: ['curator', 'allocator'], build: (name) => `Check the vault's allocation on ${name} and add $25 to the same vault.` },
  { keywords: ['stable'], build: (name) => `Redeem $25 of the stable asset through ${name} and re-mint it the same day.` },
  { keywords: ['rwa'], build: (name) => `Check the yield accrual on ${name} and add $25 to the same position.` },
  { keywords: ['insurance'], build: (name) => `Check the cover's expiry on ${name} and renew the smallest amount it offers.` },
];

/** The first table row whose keywords appear in the category, or null when none
 * matches. Matching is by substring on the lowercased category, so "Lending" and
 * "lending" select the same row. */
function matchAction(table: { keywords: string[]; build: ActionTemplate }[], category: string): ActionTemplate | null {
  const lowered = category.toLowerCase();
  for (const row of table) {
    if (row.keywords.some((keyword) => lowered.includes(keyword))) return row.build;
  }
  return null;
}

/** The category's one action, in the words a farmer can follow: the position to open,
 * the capital it takes, the chain it runs on. A category the tables do not name takes
 * a plain deposit, so no protocol is left without an action. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const template = matchAction(PRIMARY_ACTIONS, p.category ?? '')
    ?? ((name: string, cap: number, ch: string) => `Deposit $${cap} of USDC into ${name} on ${ch} and keep the position open.`);
  return template(p.name, capital, chain);
}

/** The second qualifying action: the other side of the same position, so the plan is
 * not one click. A lending supply is followed by a borrow, a liquidity position by a
 * swap, a bridge by the return trip. */
function secondActionFor(p: SnapshotProtocol, chain: string): string {
  const template = matchAction(SECOND_ACTIONS, p.category ?? '')
    ?? ((name: string, _cap: number, ch: string) => `Do one more qualifying action inside ${name} on ${ch}, such as a swap, a vote or a deposit.`);
  return template(p.name, 0, chain);
}

/** The one risk that matters most for this protocol, from its own figures: a
 * falling week, a thin pool, or a young protocol each get their own warning, so the
 * plan names the risk instead of a generic caution. */
function riskFor(p: SnapshotProtocol, age: number | null): string {
  const change = p.change_7d;
  if (change !== null && change < -20) {
    return `TVL fell ${Math.abs(Math.round(change))}% in the last week — check the trend is turning before you add capital, and size the position for a protocol that is shrinking.`;
  }
  if (p.tvl_usd < 10_000_000) {
    return `TVL is under $10M, so the pool is thin — check slippage on a small test exit before you commit the full position.`;
  }
  if (age !== null && age < 90) {
    return `The protocol is under 90 days old — check its points program and its audit status before you commit, and treat the position as experimental.`;
  }
  return `Smart-contract risk is real on any protocol — check the protocol's audit and its points page, and never farm with funds you cannot afford to lose.`;
}

/**
 * A protocol's farm plan: eight steps, each an action with a cost and a time. The plan
 * is derived from the protocol's own record (category, chains, TVL, age, seven-day
 * change), never from a hand-written list of names. Gas is priced on the protocol's
 * own chain, capital on its TVL, the hold on its age, and the risk step on the one
 * risk its own figures name.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const gas = gasFor(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const second = secondActionFor(p, chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: `under ${dollars(gas * 3)} of gas for the first transaction on ${chain}`,
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about ${dollars(gas * 2)} of gas on ${chain}`,
      time: '15 minutes to set up',
    },
    {
      text: second,
      cost: `about ${dollars(gas * 3)} of gas on ${chain}`,
      time: '15 minutes',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: `about ${dollars(gas)} of gas a week on ${chain}`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: riskFor(p, age),
      cost: 'nothing but the check',
      time: '5 minutes a week',
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view.
 * Exchanges are left out: their market caps are a different market. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page
 * from the same derivation main.ts writes to board.json. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    peer_count: row.model.peer_count,
    growth_multiplier: row.model.growth_multiplier,
    momentum_multiplier: row.model.momentum_multiplier,
    category_momentum: row.model.momentum_pct,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    signal_strength: row.model.signal_strength,
    implied_low: row.model.implied_low,
    implied_high: row.model.implied_high,
    low_multiple: row.model.low_multiple,
    high_multiple: row.model.high_multiple,
  };
}

/** Everything the dashboard renders, from the snapshot: the ranked board, the live
 * set, and the model that scored them. The early count is the board rows that are
 * not watchlist rows. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    global_multiple: peerMultiples(snapshot.protocols, model).global,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** One protocol entry out of the snapshot's raw JSON, refused unless it carries a
 * slug, a name and a finite TVL. The remaining fields are read when present and
 * typed, and default to null or an empty list when absent, so a sparse entry still
 * scores. */
function parseProtocol(value: unknown, index: number): SnapshotProtocol {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SnapshotError(`snapshot.json's protocol ${index} is not an object`);
  }
  const p = value as Record<string, unknown>;
  if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
    throw new SnapshotError(`snapshot.json's protocol ${index} lacks a slug, a name or a TVL`);
  }
  return {
    slug: p.slug,
    name: p.name,
    category: typeof p.category === 'string' ? p.category : null,
    chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
    tvl_usd: p.tvl_usd,
    change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
    mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
    listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
    gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
    symbol: typeof p.symbol === 'string' ? p.symbol : null,
  };
}

/** The snapshot out of a file's text, refused unless it is the shape the model
 * scores: a dated document with a positive floor, a protocols array and a watchlist
 * of slugs. Every check names the missing piece, so a bad input fails with its cause. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols: o.protocols.map((v, i) => parseProtocol(v, i)),
    watchlist: o.watchlist as string[],
  };
}

/** Coverage: every watchlist slug must appear on the board. The message names the
 * first five missing slugs so a gap is found at a glance. */
function coverageIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length === 0) return null;
  return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
}

/** Ranks: they must run exactly 1..n, once each, in board order. */
function ranksIssue(board: BoardRow[]): string | null {
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  return null;
}

/** Order: implied value must not rise as the rank ascends, and the board must not
 * rank every row at the same value, which would be a ranking of nothing. */
function orderIssue(board: BoardRow[]): string | null {
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  return null;
}

/** Rows: every row needs 3..12 farm steps of 20..600 characters and a positive whole
 * implied value. The first offending row is named, with the count that offends. */
function rowsIssue(board: BoardRow[]): string | null {
  for (const row of board) {
    const steps = row.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${row.slug} has ${steps.length} farm steps`;
    for (const step of steps) if (step.length < 20 || step.length > 600) return `${row.slug} has a farm step of ${step.length} characters`;
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0) return `${row.slug} has implied value ${row.implied_value_usd}`;
  }
  return null;
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one
 * shared implied value, and farm steps, in that order. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  return coverageIssue(board, snapshot) ?? ranksIssue(board) ?? orderIssue(board) ?? rowsIssue(board);
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no
 * network. The dashboard reads window.RADAR from the file beside it. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
