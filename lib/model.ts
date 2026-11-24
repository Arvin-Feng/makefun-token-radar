// Token Radar's model, version radar-2: a comps-calibrated implied value.
//
// The board ranks every pre-token protocol the snapshot can rank: the 40 on the watchlist, plus
// every other pre-token protocol that passes the watchlist's own exclusion rule (no wrapped,
// staked or bridged product of a token that already trades, no versioned pool, no exchange, no
// CEX). That is 198 rows on this snapshot. A protocol is pre-token when its record carries no
// token at all (no market cap, no CoinGecko id, no symbol); the snapshot's live-token protocols
// are kept apart and shown with the market's own values, never mixed into the ranking.
//
// Implied value is calibrated on the snapshot's own market, not on a flat multiple:
//
//   compMultiple = the category's median mcap / TVL among the snapshot's tokenized protocols
//                  (at least 3 of them, else the whole market's median), clamped to [0.05, 0.80]
//   base         = tvl_usd x compMultiple
//   growthMult   = 1 + clamp(change_7d, -60, 120) / 100 x 0.5
//   maturityMult = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age unknown: 365 days)
//   implied      = max(1, round(base x growthMult x maturityMult))
//
// The comps are computed from the snapshot at run time, inside this file: no protocol name is
// ever special-cased, no multiple is hard-coded, and the same function scores every row. The
// dashboard shows the comps table the run computed, and recomputes each row from the same
// figures, so the page's code and the board's data are visibly the same arithmetic.

/**
 * The snapshot's protocol entry: exactly the ten fields the sealed input carries.
 *
 * `tvl_usd` is the locked value in dollars; `change_7d` the week's move in percent, null
 * when the snapshot carries none. `mcap_usd`, `gecko_id` and `symbol` are all null for a
 * pre-token protocol, and that is how the model knows one: any one of them set means the
 * protocol already trades. `listed_at` is a `YYYY-MM-DD` date or null when unlisted.
 */
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

/**
 * The whole snapshot document.
 *
 * `as_of` is the snapshot's date; `floor_usd` the watchlist's TVL floor in dollars.
 * `watchlist` names the 40 slugs the board must cover, in no particular order. The
 * protocols list carries every protocol the snapshot tracks, tokenized or not.
 */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/**
 * The model's constants, as the dashboard states them.
 *
 * `growth_weight` halves the 7-day move, so a week never doubles a value on its own.
 * `growth_floor` and `growth_cap` bound that move to [-60, 120] percent. `maturity_floor`
 * is the multiplier a newborn protocol gets, and `maturity_range` is what waiting up to
 * `maturity_days` days adds; `unknown_age_days` stands in for a missing listing date.
 * `comp_min_n` is how many tokenized protocols a category needs before it earns its own
 * multiple, and `comp_floor` / `comp_cap` bound every multiple to [0.05, 0.80].
 */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  comp_min_n: number;
  comp_floor: number;
  comp_cap: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  comp_min_n: 3,
  comp_floor: 0.05,
  comp_cap: 0.8,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/**
 * One row of the comps table: what the market pays per dollar of TVL, per category.
 *
 * `n` counts the tokenized protocols the median was taken over; a category with fewer
 * than `comp_min_n` of them never gets its own row and falls back to the global multiple.
 */
export interface CompRow {
  category: string;
  n: number;
  multiple: number;
}

/**
 * The comps the run computed from the snapshot's tokenized protocols.
 *
 * `global_multiple` is the whole market's median ratio, the fallback every category
 * without its own row uses; `global_n` counts the protocols it was taken over.
 */
export interface Comps {
  global_multiple: number;
  global_n: number;
  by_category: CompRow[];
}

/**
 * A farm step: the action, what it costs, and how long it takes.
 *
 * The dashboard shows the finished string, not this shape: `stepText` joins the three
 * fields into one sentence of 20..600 characters, so a step always reads as one action.
 */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/**
 * One row of board.json: the ranked board's row.
 *
 * `rank` runs 1..n in implied-value order, ties broken by slug. `token_status` is always
 * 'pre-token': a row that already trades never reaches this board. `watchlist` marks the
 * 40 the snapshot's watchlist names. `age_days` is the days from `listed_at` to the
 * snapshot's date, null when the listing date is unknown. `model` carries the breakdown
 * the dashboard recomputes from the same figures: the comp multiple, the growth and
 * maturity multipliers, and the age. `farm_steps` holds the plan's six steps as finished
 * strings, each 20..600 characters, in the order the farmer follows them.
 */
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
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    comp_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/**
 * The dashboard's compact view of one row, with farm plans generated in the page.
 *
 * This is what `data.js` carries: the same figures as `BoardRow`, minus the farm steps,
 * which the page builds from the row itself, so the page and the board can never disagree
 * about a protocol's numbers.
 */
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
  watchlist: boolean;
  implied_value_usd: number;
  comp_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
}

/**
 * A live-token protocol: it already trades, so the board shows the market's own value.
 *
 * Live rows are never ranked by implied value. The dashboard's Live token view shows
 * them by market cap, largest first, so a reader can see what the board's candidates
 * would be measured against once they launch.
 */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/**
 * Everything the dashboard needs: the board, the live set, the comps and the model.
 *
 * `board_size` is the ranked rows, `early_size` the rows below the watchlist floor, and
 * `live_size` the live-token protocols shown apart. `model` and `model_version` travel
 * with the data so the page can state the exact constants the numbers were computed with.
 */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  comps: Comps;
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

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a sorted-or-not list, or null when it holds nothing. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Every usable market-cap-to-TVL ratio in the snapshot, whole-market and per category. */
interface RatioPools {
  all: number[];
  byCategory: Map<string, number[]>;
}

/**
 * The ratios the comps are medians of: a tokenized protocol counts when it has a positive
 * market cap and a positive TVL, so a listing with no value or no locked value never sets a
 * multiple. A ratio of zero or less, or one that is not finite, is skipped the same way.
 */
function collectRatios(snapshot: Snapshot): RatioPools {
  const all: number[] = [];
  const byCategory = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    all.push(ratio);
    if (p.category !== null) {
      const list = byCategory.get(p.category) ?? [];
      list.push(ratio);
      byCategory.set(p.category, list);
    }
  }
  return { all, byCategory };
}

/**
 * The comps: for every category with at least `comp_min_n` tokenized protocols, the median of
 * their market-cap-to-TVL ratios; everything else falls back to the whole market's median. Both
 * are clamped to [comp_floor, comp_cap], so one outlier category never sets the board's scale.
 */
export function computeComps(snapshot: Snapshot, model: ModelConstants = MODEL): Comps {
  const { all, byCategory } = collectRatios(snapshot);
  const clamp = (n: number): number => Math.min(model.comp_cap, Math.max(model.comp_floor, n));
  const globalMedian = median(all);
  const globalMultiple = clamp(globalMedian ?? 0.2);
  const by_category: CompRow[] = [...byCategory.entries()]
    .filter(([, v]) => v.length >= model.comp_min_n)
    .map(([category, v]) => ({ category, n: v.length, multiple: clamp(median(v) ?? globalMultiple) }))
    .sort((a, b) => b.multiple - a.multiple || (a.category < b.category ? -1 : 1));
  return { global_multiple: globalMultiple, global_n: all.length, by_category };
}

/** The comp multiple one protocol gets: its category's, or the market's when it has none. */
export function compMultipleFor(p: SnapshotProtocol, comps: Comps): number {
  if (p.category !== null) {
    const row = comps.by_category.find((c) => c.category === p.category);
    if (row !== undefined) return row.multiple;
  }
  return comps.global_multiple;
}

/** The 7-day move clamped to the model's band: wild weeks do not set the board's scale. */
function clampedGrowth(raw: number, model: ModelConstants): number {
  return Math.min(model.growth_cap, Math.max(model.growth_floor, raw));
}

/**
 * The growth multiplier: a protocol's 7-day move, halved, so a +20% week lifts the value by
 * 10% and a -20% week cuts it by 10%. A protocol with no 7-day figure scores as flat.
 */
function growthMultiplier(protocol: SnapshotProtocol, model: ModelConstants = MODEL): { pct: number; mult: number } {
  const rawGrowth = finite(protocol.change_7d, 0);
  const pct = clampedGrowth(rawGrowth, model);
  return { pct, mult: 1 + (pct / 100) * model.growth_weight };
}

/**
 * The maturity multiplier: a protocol earns the full range only after `maturity_days` days
 * without a token, so a launch that has waited earns more than one that only just appeared.
 * An unknown listing date scores as one year old.
 */
function maturityMultiplier(age: number | null, model: ModelConstants = MODEL): number {
  const ageForModel = age ?? model.unknown_age_days;
  const capped = Math.min(Math.max(ageForModel, 0), model.maturity_days);
  return model.maturity_floor + (capped / model.maturity_days) * model.maturity_range;
}

/** The multipliers and the implied value one protocol gets under the comps model. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  comps: Comps,
  model: ModelConstants = MODEL,
): { implied: number; comp: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const comp = compMultipleFor(protocol, comps);
  const { pct: growthPct, mult: growthMult } = growthMultiplier(protocol, model);
  const maturityMult = maturityMultiplier(age, model);
  const base = protocol.tvl_usd * comp;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult));
  return { implied, comp, growthPct, growthMult, maturityMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word, wrapped, staked or staking, anywhere in a name. */
const WRAPPED_OR_STAKED = /\b(wrapped|staked|staking)\b/i;

/** Categories the watchlist rule keeps off the board: bridged, staked or exchange products. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Names of exchanges whose product a protocol is when its name begins with one. */
const EXCHANGES = new Set(['binance', 'coinbase', 'bybit', 'kraken', 'bitget', 'okx', 'bitfinex', 'gemini']);

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token, and passing the watchlist's own
 * exclusion rule, so a wrapped or staked product of a token that already trades never ranks
 * as a launch candidate, whatever its TVL.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_OR_STAKED.test(p.name)) return false;
  const first = p.name.toLowerCase().split(/[\s-]+/)[0];
  if (first !== undefined && EXCHANGES.has(first)) return false;
  return true;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/**
 * The protocols the board ranks: the watchlist first, then every other pre-token protocol
 * that passes the watchlist's own exclusion rule. The watchlist is the floor, never a
 * ceiling: the radar exists to find the whole pre-token field, so there is no TVL cap and
 * no top-N cut here. A slug the snapshot no longer carries cannot rank, but the board's
 * coverage is the gate's row and is never gambled on a missing record.
 */
function selectRankable(snapshot: Snapshot): SnapshotProtocol[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }
  return [...chosen.values()];
}

/** One scored protocol as a board row, at its rank, with the model breakdown attached. */
function toBoardRow(
  p: SnapshotProtocol,
  v: { implied: number; comp: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null },
  rank: number,
  watchlist: string[],
): BoardRow {
  return {
    rank,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    mcap_usd: p.mcap_usd,
    listed_at: p.listed_at,
    gecko_id: p.gecko_id,
    symbol: p.symbol,
    token_status: 'pre-token',
    watchlist: watchlist.includes(p.slug),
    age_days: v.age,
    implied_value_usd: v.implied,
    model: {
      comp_multiple: round4(v.comp),
      growth_pct: v.growthPct,
      growth_multiplier: round4(v.growthMult),
      maturity_multiplier: round4(v.maturityMult),
      age_days: v.age,
    },
    farm_steps: farmSteps(p, v.age).map(stepText),
  };
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, comps: Comps, model: ModelConstants = MODEL): BoardRow[] {
  const scored = selectRankable(snapshot).map((p) => {
    const v = impliedValue(p, snapshot.as_of, comps, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => toBoardRow(s.p, s, i + 1, snapshot.watchlist));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** One category rule for the farm plan's main action. First match wins, in table order. */
interface ActionRule {
  /** Substrings of the lower-cased category; any one of them matches. */
  words: string[];
  /** The action's text, given the capital, the protocol's name and its first chain. */
  make: (capital: number, name: string, chain: string) => string;
}

/**
 * The main action, by category. The table reads top to bottom, so a category that names two
 * kinds of product takes the first rule: lending beats vaults, dexes beat bridges, and the
 * generic deposit is the last resort, never the first.
 */
const ACTION_RULES: ActionRule[] = [
  { words: ['lend', 'cdp', 'collateral'], make: (capital, name, chain) => `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.` },
  { words: ['dex', 'amm'], make: (capital, name, chain) => `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.` },
  { words: ['perpetual', 'derivative'], make: (capital, name) => `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.` },
  { words: ['bridge'], make: (capital, name, chain) => `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.` },
  { words: ['staking', 'restak'], make: (capital, name) => `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.` },
  { words: ['yield', 'vault', 'curator', 'allocator'], make: (capital, name, chain) => `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.` },
  { words: ['prediction'], make: (capital, name) => `Fund $${capital} and place one market position on ${name}.` },
  { words: ['stable'], make: (capital, name, chain) => `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.` },
  { words: ['rwa'], make: (capital, name, chain) => `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.` },
  { words: ['insurance'], make: (capital, name, chain) => `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.` },
  { words: ['leveraged farm'], make: (capital, name) => `Open a $${capital} leveraged farm position on ${name} and watch the health factor.` },
];

/** The category's main action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  for (const rule of ACTION_RULES) {
    if (rule.words.some((w) => c.includes(w))) return rule.make(capital, p.name, chain);
  }
  return `Deposit $${capital} of USDC into ${p.name} on ${chain} and keep the position open.`;
}

/** One category rule for the farm plan's weekly qualifying action. First match wins. */
interface WeeklyRule {
  /** Substrings of the lower-cased category; any one of them matches. */
  words: string[];
  /** The week's action, as one sentence. */
  text: string;
}

/**
 * The weekly qualifying action, by category. It is the step that keeps a position alive in
 * the record: a deposit alone is one event, a deposit plus a weekly action is a history.
 */
const WEEKLY_RULES: WeeklyRule[] = [
  { words: ['lend', 'cdp', 'collateral'], text: 'Borrow a small amount against the collateral, then repay it, so the loan book records the wallet.' },
  { words: ['dex', 'amm'], text: 'Swap a small amount through the pool and collect any fees the position earned.' },
  { words: ['perpetual', 'derivative'], text: 'Close and reopen one small hedge so the trading book records the wallet.' },
  { words: ['bridge'], text: 'Bridge a small amount back the other way so both directions record the wallet.' },
  { words: ['staking', 'restak'], text: 'Check the staking dashboard and claim any points it shows, from the protocol’s own page only.' },
  { words: ['yield', 'vault', 'curator', 'allocator'], text: 'Add a small top-up to the vault so the deposit history shows repeat activity.' },
  { words: ['prediction'], text: 'Settle one small market and place the next, so the market book records the wallet.' },
  { words: ['stable'], text: 'Move a small amount of the stable asset in and out of the protocol so the ledger records the wallet.' },
  { words: ['rwa'], text: 'Check the yield asset’s accrual page and keep the position receipt in the farm log.' },
  { words: ['insurance'], text: 'Check the policy page and keep the cover receipt in the farm log.' },
];

/** The category's weekly qualifying action, so the plan is more than one deposit. */
function weeklyFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  for (const rule of WEEKLY_RULES) {
    if (rule.words.some((w) => c.includes(w))) return rule.text;
  }
  return 'Make one qualifying action, such as a deposit, a borrow, a swap or a vote.';
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list
 * of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas on ${chain}`,
      time: '15 minutes to set up',
    },
    {
      text: weeklyFor(p),
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
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

/** The live set's order: market cap first, TVL as the tiebreak, so the view is stable. */
function byMarketCap(a: SnapshotProtocol, b: SnapshotProtocol): number {
  return (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd;
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort(byMarketCap)
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

/** A board row's compact form for data.js, with the farm plan generated in the page. */
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
    watchlist: row.watchlist,
    implied_value_usd: row.implied_value_usd,
    comp_multiple: row.model.comp_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const comps = computeComps(snapshot, model);
  const board = buildBoard(snapshot, comps, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !r.watchlist).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    comps,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** One protocol out of the snapshot's raw record: the fields the model scores, nothing else. */
function parseProtocol(v: unknown, i: number): SnapshotProtocol {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
  const p = v as Record<string, unknown>;
  if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
    throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
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

/** The snapshot's envelope, checked: the date, the source, the floor, and the two lists. */
function snapshotDocument(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  return o;
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  const o = snapshotDocument(raw);
  const protocols = (o.protocols as unknown[]).map((v, i) => parseProtocol(v, i));
  return {
    as_of: o.as_of as string,
    source: o.source as string,
    floor_usd: o.floor_usd as number,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why one board row is not one the gate will take, or null: farm steps and implied value. */
function rowIssue(r: BoardRow): string | null {
  const steps = r.farm_steps;
  if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
  for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
  if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  return null;
}

/** Why a board's order is not one the gate will take, or null: ranks 1..n, then value order. */
function orderIssue(board: BoardRow[]): string | null {
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  return null;
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const issue = orderIssue(board);
  if (issue !== null) return issue;
  for (const r of board) {
    const row = rowIssue(r);
    if (row !== null) return row;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
