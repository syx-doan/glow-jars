import type { GameState, Jar, Move } from "./types";

export function core(v: number): number {
  return v % 1000;
}

export function iceHits(v: number): number {
  return Math.floor(v / 1000);
}

export function orbColor(v: number): number {
  const n = core(v) % 100;
  return n === 0 ? 100 : n;
}

export function isFrozen(v: number): boolean {
  const band = Math.floor(core(v) / 100);
  return band === 1 || band === 3;
}

export function isMystery(v: number): boolean {
  return core(v) >= 200;
}

export function asFrozen(color: number): number {
  return 100 + orbColor(color);
}

export function asMystery(color: number): number {
  return 200 + orbColor(color);
}

export function revealed(v: number): number {
  const hits = iceHits(v);
  const c = core(v);
  let next = c;
  if (c >= 300) next = 100 + orbColor(c);
  else if (c >= 200) next = orbColor(c);
  return hits ? next + hits * 1000 : next;
}

export function thawed(v: number): number {
  if (!isFrozen(v)) return v % 1000;
  return isMystery(v) ? asMystery(orbColor(v)) : orbColor(v);
}

export function applyIceHit(v: number): number {
  const hits = iceHits(v);
  const base = core(v);
  if (hits >= 2) return thawed(base);
  return base + (hits + 1) * 1000;
}

export function cloneState(state: GameState): GameState {
  return {
    cap: state.cap,
    jars: state.jars.map((j) => j.slice()),
  };
}

export function topValue(jar: Jar): number | null {
  return jar.length ? jar[jar.length - 1]! : null;
}

export function topColor(jar: Jar): number | null {
  const v = topValue(jar);
  return v === null ? null : orbColor(v);
}

export function topRun(jar: Jar, crackedTop: boolean): number {
  if (!jar.length) return 0;
  const top = jar[jar.length - 1]!;
  if (isFrozen(top) && !crackedTop) return 0;
  if (isMystery(top)) return 0;
  const color = orbColor(top);
  let n = 0;
  for (let i = jar.length - 1; i >= 0; i--) {
    const v = jar[i]!;
    if (isMystery(v)) break;
    if (orbColor(v) !== color) break;
    if (isFrozen(v) && !(i === jar.length - 1 && crackedTop)) break;
    n++;
  }
  return n;
}

export function isUniform(jar: Jar): boolean {
  if (!jar.length) return true;
  const c = orbColor(jar[0]!);
  return jar.every((v) => orbColor(v) === c && !isFrozen(v) && !isMystery(v));
}

export function isSealed(jar: Jar, cap: number): boolean {
  return jar.length === cap && isUniform(jar);
}

export function isSolved(state: GameState): boolean {
  return state.jars.every((jar) => jar.length === 0 || isSealed(jar, state.cap));
}

export function pourAmount(state: GameState, from: number, to: number): number {
  const src = state.jars[from];
  const dst = state.jars[to];
  if (!src || !dst) return 0;
  if (src.length === 0 || dst.length >= state.cap) return 0;
  if (isSealed(src, state.cap)) return 0;
  const moving = topRun(src, false);
  if (moving <= 0) return 0;
  const color = orbColor(src[src.length - 1]!);
  if (dst.length > 0) {
    const destTop = dst[dst.length - 1]!;
    if (isMystery(destTop) || orbColor(destTop) !== color) return 0;
  }
  const movingAllToEmpty = dst.length === 0 && src.length === moving && isUniform(src);
  if (movingAllToEmpty) return 0;
  return Math.min(moving, state.cap - dst.length);
}

export function applyPour(state: GameState, from: number, to: number): Move | null {
  if (from === to) return null;
  const count = pourAmount(state, from, to);
  if (count <= 0) return null;
  const src = state.jars[from]!;
  const dst = state.jars[to]!;
  const payload: number[] = [];
  for (let i = 0; i < count; i++) payload.push(src.pop()!);
  const color = orbColor(payload[0]!);
  for (let i = payload.length - 1; i >= 0; i--) {
    dst.push(thawed(payload[i]!));
  }
  return { from, to, count, color, payload };
}

export function undoMove(state: GameState, move: Move): void {
  const src = state.jars[move.from]!;
  const dst = state.jars[move.to]!;
  for (let i = 0; i < move.count; i++) dst.pop();
  for (let i = move.payload.length - 1; i >= 0; i--) src.push(move.payload[i]!);
}

export function disorder(state: GameState): number {
  let score = 0;
  for (const jar of state.jars) {
    if (!jar.length) continue;
    if (isSealed(jar, state.cap)) continue;
    const colors = new Set(jar.map(orbColor));
    score += colors.size * 3 + (state.cap - topRun(jar, false));
    if (!isUniform(jar)) score += 4;
    for (const v of jar) {
      if (isFrozen(v)) score += 2;
      if (isMystery(v)) score += 1;
    }
  }
  return score;
}

export function legalMoves(state: GameState): Move[] {
  const moves: Move[] = [];
  for (let from = 0; from < state.jars.length; from++) {
    for (let to = 0; to < state.jars.length; to++) {
      const probe = cloneState(state);
      const move = applyPour(probe, from, to);
      if (move) moves.push(move);
    }
  }
  return moves;
}

function moveScore(state: GameState, move: Move): number {
  const next = cloneState(state);
  applyPour(next, move.from, move.to);
  const srcAfter = next.jars[move.from]!;
  const dstAfter = next.jars[move.to]!;
  let score = disorder(state) - disorder(next);
  if (isSealed(dstAfter, next.cap)) score += 50;
  if (srcAfter.length === 0) score += 6;
  if (isUniform(srcAfter) && srcAfter.length) score += 8;
  if (move.count > 1) score += 4;
  return score;
}

export function hintMove(state: GameState): Move | null {
  const moves = legalMoves(state);
  if (!moves.length) return null;
  let best = moves[0]!;
  let bestScore = -Infinity;
  for (const move of moves) {
    const next = cloneState(state);
    applyPour(next, move.from, move.to);
    let score = moveScore(state, move);
    score += isSolved(next) ? 80 : 0;
    if (score > bestScore) {
      bestScore = score;
      best = move;
    }
  }
  return best;
}

export function findTopIndex(state: GameState, pred: (v: number) => boolean): number | null {
  for (let i = 0; i < state.jars.length; i++) {
    const v = topValue(state.jars[i]!);
    if (v !== null && pred(v)) return i;
  }
  return null;
}

export function playerAction(state: GameState): "solved" | "pour" | "ice" | "mystery" | "stuck" {
  if (isSolved(state)) return "solved";
  if (legalMoves(state).length) return "pour";
  if (findTopIndex(state, isFrozen) !== null) return "ice";
  if (findTopIndex(state, isMystery) !== null) return "mystery";
  return "stuck";
}

export function addExtraJar(state: GameState): GameState {
  const next = cloneState(state);
  next.jars.push([]);
  return next;
}

export function hitIce(state: GameState, index: number): { thawed: boolean; hits: number } | null {
  const jar = state.jars[index];
  if (!jar?.length) return null;
  const top = jar[jar.length - 1]!;
  if (!isFrozen(top)) return null;
  const next = applyIceHit(top);
  jar[jar.length - 1] = next;
  if (!isFrozen(next)) return { thawed: true, hits: 3 };
  return { thawed: false, hits: iceHits(next) };
}
