import {
  asFrozen,
  asMystery,
  cloneState,
  disorder,
  isSealed,
  isSolved,
  orbColor,
  playerAction,
  topRun,
} from "./engine";
import { CAP_DEFAULT, type GameState, type LevelSpec } from "./types";
import { t } from "./i18n";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function specForLevel(id: number): LevelSpec {
  let colors = 3;
  let empties = 2;
  let cap = CAP_DEFAULT;
  let scramble = 24;
  let mystery = 0;
  let ice = 0;

  if (id <= 4) {
    colors = 3;
    scramble = 22 + id * 6;
    mystery = id >= 4 ? 2 : 0;
  } else if (id <= 10) {
    colors = 4;
    scramble = 48 + id * 4;
    mystery = 4;
    ice = id >= 6 ? 3 : 0;
    empties = id === 10 ? 1 : 2;
  } else if (id <= 20) {
    colors = 5;
    scramble = 80 + id * 3;
    mystery = 7;
    ice = 4;
    empties = id % 3 === 0 ? 1 : 2;
  } else if (id <= 35) {
    colors = 6;
    scramble = 110 + id * 2;
    mystery = 9;
    ice = 6;
    empties = id % 2 === 0 ? 1 : 2;
  } else if (id <= 50) {
    colors = 7;
    scramble = 140 + id;
    mystery = 12;
    ice = 7;
    empties = 1;
    cap = id % 7 === 0 ? 5 : 4;
  } else if (id <= 65) {
    colors = 8;
    scramble = 170 + id;
    mystery = 14;
    ice = 9;
    empties = 1;
    cap = id % 5 === 0 ? 5 : 4;
  } else {
    colors = 9;
    scramble = 200 + id;
    mystery = 16;
    ice = 11;
    empties = 1;
    cap = id % 4 === 0 ? 5 : 4;
  }

  if (id === 1) scramble = 20;
  if (id === 2) scramble = 28;
  if (id === 3) scramble = 40;

  const moveLimit = Math.max(
    8,
    Math.floor(colors * cap * 0.72) + ice + (empties === 1 ? 4 : 2),
  );

  return { id, colors, empties, cap, scramble, mystery, ice, moveLimit };
}

export function modifierTitle(spec: LevelSpec): string {
  if (spec.ice && spec.mystery) return t("modMysteryIce");
  if (spec.ice) return t("modIce");
  if (spec.mystery) return t("modMystery");
  if (spec.id <= 2) return t("modEarly");
  return t("modDefault");
}

export function modifierHint(spec: LevelSpec): string {
  if (spec.id === 1) return t("hintL1");
  if (spec.id === 3) return t("hintL3");
  if (spec.id === 4) return t("hintL4");
  if (spec.id === 6) return t("hintL6");
  if (spec.ice && spec.mystery) return t("hintBoth");
  if (spec.ice) return t("hintIce");
  if (spec.mystery) return t("hintMystery");
  return t("hintDefault");
}

function solvedState(spec: LevelSpec): GameState {
  const jars: number[][] = [];
  for (let c = 1; c <= spec.colors; c++) {
    jars.push(Array.from({ length: spec.cap }, () => c));
  }
  for (let i = 0; i < spec.empties; i++) jars.push([]);
  return { jars, cap: spec.cap };
}

function mixAmount(from: number[], to: number[], cap: number): number {
  if (!from.length || to.length >= cap) return 0;
  const color = orbColor(from[from.length - 1]!);
  if (to.length > 0 && orbColor(to[to.length - 1]!) !== color) return 0;
  return Math.min(topRun(from, true), cap - to.length);
}

function sealedCount(state: GameState): number {
  return state.jars.filter((j) => isSealed(j, state.cap)).length;
}

function pourOnce(state: GameState, rng: () => number): boolean {
  const from = Math.floor(rng() * state.jars.length);
  const to = Math.floor(rng() * state.jars.length);
  if (from === to) return false;
  const amount = mixAmount(state.jars[from]!, state.jars[to]!, state.cap);
  if (amount <= 0) return false;
  const take = rng() < 0.88 ? 1 : 1 + Math.floor(rng() * amount);
  const src = state.jars[from]!;
  const dst = state.jars[to]!;
  for (let i = 0; i < take; i++) dst.push(src.pop()!);
  return true;
}

function smashSolved(state: GameState, rng: () => number, n: number): void {
  for (let k = 0; k < n; k++) {
    const filled = state.jars.map((_, i) => i).filter((i) => state.jars[i]!.length > 0);
    const room = state.jars.map((_, i) => i).filter((i) => state.jars[i]!.length < state.cap);
    if (!filled.length || !room.length) break;
    const from = filled[Math.floor(rng() * filled.length)]!;
    let to = room[Math.floor(rng() * room.length)]!;
    if (from === to) {
      const other = room.find((i) => i !== from);
      if (other === undefined) continue;
      to = other;
    }
    const src = state.jars[from]!;
    const dst = state.jars[to]!;
    if (!src.length || dst.length >= state.cap) continue;
    dst.push(src.pop()!);
  }
}

function playable(state: GameState): boolean {
  const act = playerAction(state);
  return act === "pour" || act === "ice" || act === "mystery";
}

function scrambleState(spec: LevelSpec): GameState {
  const minDisorder =
    spec.id === 1 ? 10 : spec.id === 2 ? 14 : spec.id === 3 ? 16 : Math.max(20, spec.colors * 7);
  const maxSealed = spec.id <= 3 ? spec.colors - 1 : Math.max(1, spec.colors - 2);
  let best: GameState | null = null;
  let bestScore = -1;

  for (let attempt = 0; attempt < 40; attempt++) {
    const state = solvedState(spec);
    const local = mulberry32((spec.id * 9973 + 1301) ^ (attempt * 7919));
    const target = spec.scramble + attempt * 10;
    let applied = 0;
    let guard = 0;
    while (applied < target && guard < target * 80) {
      guard++;
      if (pourOnce(state, local)) applied++;
    }
    if (isSolved(state)) smashSolved(state, local, spec.cap * spec.colors);
    if (isSolved(state) || !playable(state)) continue;
    if (sealedCount(state) > maxSealed) continue;
    const score = disorder(state);
    if (score > bestScore) {
      best = cloneState(state);
      bestScore = score;
    }
    if (score >= minDisorder) {
      spice(state, spec, local);
      if (playable(state) && !isSolved(state)) return state;
    }
  }

  const fallback = best ?? solvedState(spec);
  const rng = mulberry32(spec.id * 17 + 9);
  if (isSolved(fallback) || !playable(fallback)) smashSolved(fallback, rng, spec.cap * spec.colors + 8);
  spice(fallback, spec, rng);
  if (isSolved(fallback) || !playable(fallback)) {
    smashSolved(fallback, rng, spec.cap * spec.colors + 16);
  }
  if (isSolved(fallback) || !playable(fallback)) {
    smashSolved(fallback, mulberry32(spec.id * 31 + 4), spec.cap * spec.colors * 3);
    if (!playable(fallback)) fallback.jars.push([]);
  }
  return fallback;
}

function spice(state: GameState, spec: LevelSpec, rng: () => number): void {
  const buried: Array<{ j: number; i: number }> = [];
  const any: Array<{ j: number; i: number }> = [];
  state.jars.forEach((jar, j) => {
    jar.forEach((_, i) => {
      any.push({ j, i });
      if (i < jar.length - 1) buried.push({ j, i });
    });
  });

  const mysteryPool = buried.length ? buried : any.slice();
  for (let n = 0; n < spec.mystery && mysteryPool.length; n++) {
    const pick = mysteryPool.splice(Math.floor(rng() * mysteryPool.length), 1)[0];
    if (!pick) break;
    const jar = state.jars[pick.j]!;
    jar[pick.i] = asMystery(jar[pick.i]!);
  }

  let frozenTops = 0;
  const icePool = any.slice();
  for (let n = 0; n < spec.ice && icePool.length; n++) {
    const pick = icePool.splice(Math.floor(rng() * icePool.length), 1)[0];
    if (!pick) break;
    const jar = state.jars[pick.j]!;
    const isTop = pick.i === jar.length - 1;
    if (isTop && frozenTops >= (spec.id < 15 ? 1 : 2)) continue;
    if (isTop) frozenTops += 1;
    jar[pick.i] = asFrozen(orbColor(jar[pick.i]!));
  }
}

export function makeLevel(id: number): GameState {
  const spec = specForLevel(id);
  const state = scrambleState(spec);
  if (isSolved(state)) smashSolved(state, mulberry32(id * 991 + 7), spec.cap * spec.colors * 2);
  return state;
}

export function cloneLevel(id: number): GameState {
  return cloneState(makeLevel(id));
}
