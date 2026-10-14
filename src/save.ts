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
  lowFx: false,
  coinAdDay: "",
  coinAdCount: 0,
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
      lowFx: parsed.lowFx === true,
      coinAdDay: typeof parsed.coinAdDay === "string" ? parsed.coinAdDay : "",
      coinAdCount:
        typeof parsed.coinAdCount === "number" && parsed.coinAdCount >= 0 ? Math.floor(parsed.coinAdCount) : 0,
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

/** Any paid rescue caps the result: hint or extra jar → 1 star, extra moves or >2 undos → 2 stars. */
export function starsFor(stats: { undos: number; hints: number; extraJar: boolean; extraMoves: number }): number {
  if (stats.hints > 0 || stats.extraJar) return 1;
  if (stats.extraMoves > 0 || stats.undos > 2) return 2;
  return 3;
}
