import { LEVEL_COUNT, STARTING_COINS, type SaveData } from "./types";

const KEY = "glow-jars-save-v1";

const fallback = (): SaveData => ({
  coins: STARTING_COINS,
  maxUnlocked: 1,
  stars: Array.from({ length: LEVEL_COUNT }, () => 0),
  sound: true,
  haptic: true,
  seenLessons: [],
  locale: "en",
});

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fallback();
    const parsed = JSON.parse(raw) as Partial<SaveData>;
    const base = fallback();
    return {
      coins: typeof parsed.coins === "number" ? parsed.coins : base.coins,
      maxUnlocked: Math.min(
        LEVEL_COUNT,
        Math.max(1, typeof parsed.maxUnlocked === "number" ? parsed.maxUnlocked : 1),
      ),
      stars: Array.from({ length: LEVEL_COUNT }, (_, i) => {
        const n = Array.isArray(parsed.stars) ? parsed.stars[i] : 0;
        return n === 1 || n === 2 || n === 3 ? n : 0;
      }),
      sound: parsed.sound !== false,
      haptic: parsed.haptic !== false,
      seenLessons: Array.isArray(parsed.seenLessons)
        ? parsed.seenLessons.filter((x): x is string => typeof x === "string")
        : [],
      locale: parsed.locale === "vi" ? "vi" : "en",
    };
  } catch {
    return fallback();
  }
}

export function writeSave(data: SaveData): void {
  localStorage.setItem(KEY, JSON.stringify(data));
}

export function resetSave(): SaveData {
  const data = fallback();
  writeSave(data);
  return data;
}

export function starsFor(stats: {
  undos: number;
  hints: number;
  extraJar: boolean;
  moves: number;
  extraMoves: number;
  limit: number;
}): number {
  if (stats.hints > 0 || stats.extraJar) return 1;
  const over = stats.moves - (stats.limit + stats.extraMoves);
  if (over <= 0 && stats.undos <= 2) return 3;
  if (over <= 4) return 2;
  return 1;
}

export function coinReward(stars: number, firstClear: boolean, comboMax: number): number {
  return (firstClear ? 18 : 6) + stars * 4 + Math.min(20, comboMax * 6);
}
