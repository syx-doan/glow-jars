/** Coin prices for in-level rescue tools. */
export const PRICE = {
  undo: 15,
  hint: 40,
  jar: 80,
  moves: 50,
} as const;

export type Tool = keyof typeof PRICE;

/** Bonus per star gained on a replay. */
const REPLAY_STAR_COINS = 5;

/**
 * Coins for a cleared level. First clears scale with level depth; replays only pay for
 * newly earned stars so easy early levels can't be farmed.
 */
export function levelReward(level: number, prevStars: number, stars: number, comboMax: number): number {
  if (prevStars > 0) return Math.max(0, stars - prevStars) * REPLAY_STAR_COINS;
  const base = 12 + Math.floor((level - 1) / 10) * 2;
  return base + stars * 3 + Math.min(12, Math.max(0, comboMax - 1) * 4);
}

/** Local calendar day, used to reset the daily coin-ad allowance. */
export function todayKey(now = new Date()): string {
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
}
