import {
  bindAds,
  doubleCoinsEnabled,
  initAds,
  maybeInterstitial,
  noteLevelCleared,
  openPrivacyOptions,
  privacyOptionsRequired,
  setPlayBanner,
  showRewarded,
  type RewardOutcome,
} from "./ads";
import { track } from "./analytics";
import { sfx, setMuted, unlockAudio } from "./audio";
import {
  addExtraJar,
  applyPour,
  cloneState,
  hintMove,
  hitIce,
  isFrozen,
  isMystery,
  isSealed,
  isSolved,
  revealed,
  topColor,
  topValue,
  undoMove,
} from "./engine";
import { cloneLevel, modifierHint, modifierTitle, specForLevel } from "./generator";
import {
  applyStaticI18n,
  constellationName,
  getLocale,
  setLocale,
  t,
  type Locale,
} from "./i18n";
import { Board } from "./render";
import { coinReward, loadSave, resetSave, starsFor, writeSave } from "./save";
import {
  allowedJar,
  buildLesson,
  eventMatches,
  lessonForLevel,
  type CoachEvent,
  type CoachLesson,
  type LessonId,
} from "./tutorial";
import {
  LEVEL_COUNT,
  UNDO_FREE,
  type GameState,
  type LevelSpec,
  type Move,
  type PlayStats,
  type SaveData,
} from "./types";

const MOVES_COST = 50;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const screens = {
  home: $("home"),
  levels: $("levels"),
  play: $("play"),
  settings: $("settings"),
};

const winModal = $("win");
const adModal = $("ad");
const outModal = $("outmoves");
const canvas = $("board") as unknown as HTMLCanvasElement;
const board = new Board(canvas);

let save: SaveData = loadSave();
let levelId = 1;
let spec: LevelSpec = specForLevel(1);
let state: GameState = cloneLevel(1);
let history: Move[] = [];
let stats: PlayStats = emptyStats();
let selected: number | null = null;
let busy = false;
let winBusy = false;
let winReward = 0;
let toastTimer = 0;
let combo = 0;
let poursSinceSeal = 0;
let coach: { lesson: CoachLesson; i: number } | null = null;
let playToken = 0;

function emptyStats(): PlayStats {
  return { undos: 0, hints: 0, extraJar: false, moves: 0, comboMax: 0, extraMoves: 0 };
}

function showScreen(name: keyof typeof screens): void {
  for (const [key, el] of Object.entries(screens)) {
    const on = key === name;
    el.classList.toggle("active", on);
    el.inert = !on;
    el.setAttribute("aria-hidden", on ? "false" : "true");
  }
  setPlayBanner(name === "play" ? levelId : null);
}

function haptic(ms: number | number[] = 12): void {
  if (save.haptic && navigator.vibrate) navigator.vibrate(ms);
}

function screenFlash(color: string): void {
  const el = $("play");
  el.style.setProperty("--flash", color);
  el.classList.remove("flash");
  void el.offsetWidth;
  el.classList.add("flash");
}

function popComboChip(): void {
  const chip = $("combo-chip");
  chip.classList.toggle("hot", combo >= 4);
  chip.classList.remove("pop");
  void chip.offsetWidth;
  chip.classList.add("pop");
}

function toast(text: string): void {
  const el = $("toast");
  el.textContent = text;
  el.classList.remove("hidden");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.add("hidden"), 2600);
}

function toastMissedReward(outcome: RewardOutcome): void {
  if (outcome === "granted") return;
  sfx.error();
  toast(t(outcome === "cancelled" ? "adCancelled" : "adUnavailable"));
}

function persist(): void {
  writeSave(save);
  refreshCoins();
}

function refreshCoins(): void {
  $("home-coins").textContent = String(save.coins);
  $("levels-coins").textContent = String(save.coins);
  $("play-coins").textContent = String(save.coins);
}

function remainingMoves(): number {
  return spec.moveLimit + stats.extraMoves - stats.moves;
}

function coachWaiting() {
  return coach?.lesson.steps[coach.i] ?? null;
}

function markLessonSeen(id: LessonId): void {
  if (save.seenLessons.includes(id)) return;
  save.seenLessons.push(id);
  persist();
}

function hideCoach(complete: boolean): void {
  if (complete && coach) markLessonSeen(coach.lesson.id);
  coach = null;
  $("coach").classList.add("hidden");
  $("coach").classList.remove("blocking");
  board.setHint(null);
  $("tutorial").textContent = modifierHint(spec);
}

function layoutCoach(): void {
  if (!coach) return;
  const step = coach.lesson.steps[coach.i];
  if (!step) return;
  const spot = $("coach-spot");
  const spotB = $("coach-spot-b");
  const play = $("play").getBoundingClientRect();
  const place = (el: HTMLElement, box: DOMRect | { left: number; top: number; width: number; height: number } | null, round = false) => {
    if (!box) {
      el.classList.remove("on");
      return;
    }
    el.classList.add("on");
    el.classList.toggle("round", round);
    el.style.left = `${box.left - play.left - 7}px`;
    el.style.top = `${box.top - play.top - 7}px`;
    el.style.width = `${box.width + 14}px`;
    el.style.height = `${box.height + 14}px`;
  };
  const canvasBox = () => canvas.getBoundingClientRect();
  const toView = (r: { x: number; y: number; w: number; h: number } | null) => {
    if (!r) return null;
    const c = canvasBox();
    return { left: c.left + r.x, top: c.top + r.y, width: r.w, height: r.h };
  };
  const jarBox = (index: number) => toView(board.jarRect(index));
  const orbBox = (index: number) => {
    const jar = state.jars[index];
    if (!jar?.length) return jarBox(index);
    return toView(board.orbRect(index));
  };
  spotB.classList.remove("on");
  if (step.target.type === "jar") place(spot, jarBox(step.target.index));
  else if (step.target.type === "jars") {
    place(spot, jarBox(step.target.indices[0]!));
    place(spotB, jarBox(step.target.indices[1] ?? -1));
  } else if (step.target.type === "orb") place(spot, orbBox(step.target.index), true);
  else if (step.target.type === "orbs") {
    const a = step.target.indices[0]!;
    const b = step.target.indices[1] ?? -1;
    place(spot, orbBox(a), Boolean(state.jars[a]?.length));
    place(spotB, orbBox(b), Boolean(state.jars[b]?.length));
  } else if (step.target.type === "dom") {
    const node = document.getElementById(step.target.id);
    place(spot, node?.getBoundingClientRect() ?? null, node?.id === "move-chip");
  } else if (step.target.type === "hud") place(spot, $("hud").getBoundingClientRect());
  else spot.classList.remove("on");
}

function renderCoachStep(): void {
  if (!coach) return;
  const step = coach.lesson.steps[coach.i];
  if (!step) {
    hideCoach(true);
    return;
  }
  const root = $("coach");
  root.classList.remove("hidden");
  root.classList.toggle("blocking", step.wait.type === "next");
  $("coach-step").textContent = `${coach.i + 1} / ${coach.lesson.steps.length}`;
  $("coach-title").textContent = step.title;
  $("coach-body").textContent = step.body;
  $("tutorial").textContent = step.body;
  const nextBtn = $("btn-coach-next");
  const skipBtn = $("btn-coach-skip");
  const isNext = step.wait.type === "next";
  skipBtn.classList.toggle("hidden", false);
  skipBtn.classList.toggle("span", !isNext);
  nextBtn.classList.toggle("hidden", !isNext);
  nextBtn.classList.toggle("span", false);
  nextBtn.textContent = coach.i === coach.lesson.steps.length - 1 ? t("play") : t("next");
  $("coach-card").classList.toggle("top", step.card === "top");
  $("coach-card").classList.toggle("bottom", step.card === "bottom");
  if (step.wait.type === "select") board.setHint({ from: step.wait.jar, to: step.wait.jar, count: 0, color: 0, payload: [] });
  else if (step.wait.type === "pour") board.setHint({ from: step.wait.from, to: step.wait.to, count: 0, color: 0, payload: [] });
  else board.setHint(null);
  requestAnimationFrame(() => layoutCoach());
}

function advanceCoach(): void {
  if (!coach) return;
  coach.i += 1;
  if (coach.i >= coach.lesson.steps.length) hideCoach(true);
  else renderCoachStep();
}

function coachNotify(event: CoachEvent): boolean {
  const step = coachWaiting();
  if (!step || !eventMatches(step.wait, event)) return false;
  advanceCoach();
  return true;
}

function beginCoach(): void {
  const id = lessonForLevel(spec, save.seenLessons);
  if (!id) return;
  const lesson = buildLesson(id, state);
  if (!lesson?.steps.length) return;
  coach = { lesson, i: 0 };
  renderCoachStep();
  window.setTimeout(layoutCoach, 80);
}

function afterLayout(fn: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(fn));
}

function refreshHud(): void {
  $("mod-chip").textContent = modifierTitle(spec);
  const left = remainingMoves();
  const moveChip = $("move-chip");
  moveChip.textContent = t("movesLeft", { n: left });
  moveChip.classList.toggle("warn", left <= 3);
  const comboChip = $("combo-chip");
  comboChip.textContent = t("combo", { n: combo });
  comboChip.classList.toggle("hidden", combo < 2);
  $("undo-left").textContent = String(Math.max(0, UNDO_FREE - stats.undos));
}

function currentConstellation(): number {
  return Math.min(7, Math.floor((save.maxUnlocked - 1) / 10));
}

function renderHome(): void {
  refreshCoins();
  const group = currentConstellation();
  const start = group * 10 + 1;
  const end = Math.min(start + 9, LEVEL_COUNT);
  const cleared = save.stars.filter((n) => n > 0).length;
  const next = Math.min(save.maxUnlocked, LEVEL_COUNT);
  $("levels-count-label").textContent = t("levelsCount", { n: LEVEL_COUNT });
  $("constellation-range").textContent = t("chapterRange", {
    a: start,
    b: end,
    name: constellationName(group),
  });
  const dots = $("constellation-dots");
  dots.innerHTML = "";
  for (let i = 0; i < 10; i++) {
    const id = start + i;
    if (id > LEVEL_COUNT) break;
    const span = document.createElement("span");
    span.textContent = String(id);
    if (save.stars[id - 1]) span.classList.add("on");
    else if (id === next) span.classList.add("play");
    if (id > save.maxUnlocked) span.classList.add("locked");
    dots.appendChild(span);
  }
  $("btn-play").textContent =
    save.maxUnlocked === 1 && !save.stars[0]
      ? t("playStart")
      : t("playLevel", { n: next });
  $("home-level").textContent = String(next);
  $("home-stars").textContent = String(save.stars.reduce((sum, n) => sum + n, 0));
  $("home-cleared").textContent = `${cleared}/${LEVEL_COUNT}`;
  $("constellation-progress").textContent = t("clearedOf", { a: cleared, b: LEVEL_COUNT });
  $("progress-fill").style.width = `${Math.round((cleared / LEVEL_COUNT) * 100)}%`;
}

function renderLevels(): void {
  refreshCoins();
  $("levels-title").textContent = t("levelsTitle", { n: LEVEL_COUNT });
  const grid = $("level-grid");
  grid.innerHTML = "";
  for (let i = 1; i <= LEVEL_COUNT; i++) {
    const btn = document.createElement("button");
    btn.className = "level-cell";
    btn.type = "button";
    btn.disabled = i > save.maxUnlocked;
    const flags = specForLevel(i);
    const mark = flags.ice ? " ·" : flags.mystery ? " °" : "";
    btn.innerHTML = `<span>${i}${mark}</span><span class="mini-stars">${"★".repeat(save.stars[i - 1] ?? 0)}</span>`;
    btn.addEventListener("click", () => startLevel(i));
    grid.appendChild(btn);
  }
}

function startLevel(id: number): void {
  unlockAudio();
  playToken += 1;
  hideCoach(false);
  winModal.classList.add("hidden");
  outModal.classList.add("hidden");
  levelId = id;
  spec = specForLevel(id);
  state = cloneLevel(id);
  history = [];
  stats = emptyStats();
  selected = null;
  busy = false;
  combo = 0;
  poursSinceSeal = 0;
  $("play-level").textContent = t("levelLabel", { n: id });
  $("tutorial").textContent = modifierHint(spec);
  $("btn-extra").toggleAttribute("disabled", false);
  board.resetFx();
  board.setState(state);
  board.setSelected(null);
  board.setHint(null);
  refreshHud();
  refreshCoins();
  showScreen("play");
  afterLayout(() => beginCoach());
  track("level_start", { level: id });
}

function freshlySealed(before: GameState, after: GameState): number[] {
  const hit: number[] = [];
  after.jars.forEach((jar, i) => {
    if (isSealed(jar, after.cap) && !isSealed(before.jars[i] ?? [], before.cap)) {
      hit.push(i);
    }
  });
  return hit;
}

async function tryPour(from: number, to: number): Promise<void> {
  if (remainingMoves() <= 0) {
    sfx.error();
    $("tutorial").textContent = t("outOfMoves");
    board.shake(from);
    openOutOfMoves();
    return;
  }
  const before = cloneState(state);
  const next = cloneState(state);
  const move = applyPour(next, from, to);
  if (!move) {
    if (coach) {
      sfx.error();
      board.shake(to);
      haptic(20);
      return;
    }
    const dest = state.jars[to]!;
    if (dest.length && !isSealed(dest, state.cap)) {
      selected = to;
      board.setSelected(to);
      sfx.tap();
      return;
    }
    sfx.error();
    board.shake(to);
    haptic(20);
    return;
  }
  history.push(move);
  stats.moves += 1;
  selected = null;
  board.setSelected(null);
  board.setHint(null);
  sfx.pour();
  haptic();
  busy = true;
  const token = playToken;
  await board.animatePour(move, next);
  if (token !== playToken) {
    busy = false;
    return;
  }
  state = next;
  const sealed = freshlySealed(before, state);
  if (sealed.length) {
    poursSinceSeal = 0;
    combo += sealed.length;
    stats.comboMax = Math.max(stats.comboMax, combo);
    for (const i of sealed) {
      sfx.seal(combo - 1);
      board.burst(i, topColor(state.jars[i]!) ?? 1, combo);
      if (combo >= 2) {
        sfx.combo(combo);
        board.popup(i, `COMBO x${combo}`, combo >= 4 ? "#ffd166" : "#7ee0c6", 1 + Math.min(3, combo - 1) * 0.18);
      } else {
        board.popup(i, t("sealedPop"), "#ffd166");
      }
    }
    haptic(combo >= 2 ? [20, 40, 30, 40, 45] : [18, 30, 28]);
    screenFlash(combo >= 3 ? "rgba(255, 209, 102, 0.4)" : "rgba(190, 170, 255, 0.28)");
  } else {
    poursSinceSeal += 1;
    if (poursSinceSeal >= 2) combo = 0;
  }
  refreshHud();
  if (sealed.length && combo >= 2) popComboChip();
  busy = false;
  coachNotify({ type: "pour", from: move.from, to: move.to });
  layoutCoach();
  if (isSolved(state) && stats.moves > 0) await onWin();
  else if (remainingMoves() <= 0 && !coach) {
    $("tutorial").textContent = t("outOfMoves");
    window.setTimeout(() => {
      if (token === playToken && remainingMoves() <= 0 && !isSolved(state)) openOutOfMoves();
    }, 450);
  }
}

function openOutOfMoves(): void {
  if (coach || !winModal.classList.contains("hidden")) return;
  selected = null;
  board.setSelected(null);
  const coinsBtn = $("btn-om-coins") as HTMLButtonElement;
  coinsBtn.textContent = t("omCoins", { n: MOVES_COST });
  coinsBtn.disabled = save.coins < MOVES_COST;
  outModal.classList.remove("hidden");
  track("out_of_moves", { level: levelId });
}

function grantMoves(): void {
  stats.extraMoves += 5;
  $("tutorial").textContent = t("plusMovesToast");
  refreshHud();
  sfx.coin();
}

async function onWin(): Promise<void> {
  if (stats.moves <= 0) return;
  hideCoach(true);
  busy = true;
  sfx.win();
  board.celebrate();
  haptic([30, 50, 30, 50, 80]);
  screenFlash("rgba(255, 230, 150, 0.45)");
  const first = (save.stars[levelId - 1] ?? 0) === 0;
  const stars = starsFor({ ...stats, limit: spec.moveLimit });
  const reward = coinReward(stars, first, stats.comboMax);
  save.coins += reward;
  save.stars[levelId - 1] = Math.max(save.stars[levelId - 1] ?? 0, stars);
  save.maxUnlocked = Math.max(save.maxUnlocked, Math.min(LEVEL_COUNT, levelId + 1));
  persist();
  noteLevelCleared();
  track("level_end", { level: levelId, success: true, stars, moves: stats.moves });
  winReward = reward;
  winBusy = false;
  $("win-title").textContent = t("levelLabel", { n: levelId });
  $("win-stars").innerHTML = [0, 1, 2]
    .map((k) => `<span class="${k < stars ? "on" : "off"}" style="animation-delay:${180 + k * 170}ms">${k < stars ? "★" : "☆"}</span>`)
    .join("");
  $("win-reward").textContent = t("coinsReward", { n: 0 });
  const doubleBtn = $("btn-win-double") as HTMLButtonElement;
  doubleBtn.textContent = t("winDouble", { n: reward });
  doubleBtn.disabled = false;
  doubleBtn.classList.toggle("hidden", !doubleCoinsEnabled() || reward <= 0);
  $("win-note").textContent =
    combo >= 2
      ? t("winNoteCombo", { moves: stats.moves, combo: stats.comboMax })
      : t("winNoteMoves", { moves: stats.moves, limit: spec.moveLimit });
  $("btn-win-next").textContent = levelId >= LEVEL_COUNT ? t("homeBtn") : t("nextLevel");
  await new Promise((r) => setTimeout(r, 950));
  winModal.classList.remove("hidden");
  countUpReward(0, reward, 500);
  busy = false;
}

let rewardAnim = 0;

function countUpReward(from: number, to: number, delay = 0): void {
  const el = $("win-reward");
  const token = ++rewardAnim;
  const start = performance.now() + delay;
  const dur = 700;
  let ticks = 0;
  const step = (now: number) => {
    if (token !== rewardAnim || winModal.classList.contains("hidden")) return;
    const k = Math.max(0, Math.min(1, (now - start) / dur));
    const n = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
    el.textContent = t("coinsReward", { n });
    if (k > 0 && k < 1 && ++ticks % 4 === 0) sfx.tap();
    if (k < 1) requestAnimationFrame(step);
    else if (to > from) sfx.coin();
  };
  requestAnimationFrame(step);
}

async function leaveWin(to: "next" | "levels"): Promise<void> {
  if (winBusy) return;
  winBusy = true;
  await maybeInterstitial(levelId);
  winModal.classList.add("hidden");
  winBusy = false;
  if (to === "levels") {
    renderLevels();
    showScreen("levels");
  } else if (levelId >= LEVEL_COUNT) {
    renderHome();
    showScreen("home");
  } else {
    startLevel(levelId + 1);
  }
}

function handleTap(index: number): void {
  if (busy || !winModal.classList.contains("hidden") || !outModal.classList.contains("hidden")) return;
  const step = coachWaiting();
  if (step && !allowedJar(step.wait, index, selected)) {
    sfx.error();
    board.shake(index);
    return;
  }
  unlockAudio();
  const jar = state.jars[index]!;
  if (selected === null) {
    if (!jar.length || isSealed(jar, state.cap)) {
      sfx.error();
      board.shake(index);
      return;
    }
    const top = topValue(jar)!;
    if (isFrozen(top)) {
      const result = hitIce(state, index);
      if (result) {
        sfx.crack();
        board.iceShatter(index);
        board.popup(index, result.thawed ? t("thawed") : `${result.hits}/3`, "#c6f3ff");
        board.setState(state);
        haptic(result.thawed ? 28 : 18);
        coachNotify({ type: "ice", jar: index, thawed: result.thawed });
        layoutCoach();
        return;
      }
    }
    if (isMystery(top)) {
      jar[jar.length - 1] = revealed(top);
      sfx.reveal();
      board.popup(index, t("revealed"), "#d7d2c8");
      board.setState(state);
      haptic(12);
      coachNotify({ type: "reveal", jar: index });
      layoutCoach();
      return;
    }
    selected = index;
    board.setSelected(index);
    sfx.tap();
    haptic(8);
    coachNotify({ type: "select", jar: index });
    layoutCoach();
    return;
  }
  if (selected === index) {
    if (step?.wait.type === "pour" && step.wait.from === index) return;
    selected = null;
    board.setSelected(null);
    sfx.tap();
    return;
  }
  const destTop = topValue(jar);
  if (destTop !== null && isMystery(destTop) && !isFrozen(destTop)) {
    jar[jar.length - 1] = revealed(destTop);
    sfx.reveal();
    board.popup(index, t("revealed"), "#d7d2c8");
    board.setState(state);
    haptic(12);
    coachNotify({ type: "reveal", jar: index });
    layoutCoach();
    return;
  }
  void tryPour(selected, index);
}

board.onTap(handleTap);

$("play-level").addEventListener("click", () => {
  if (!busy) startLevel(levelId);
});
$("btn-play").addEventListener("click", () => startLevel(Math.min(save.maxUnlocked, LEVEL_COUNT)));
$("btn-levels").addEventListener("click", () => {
  renderLevels();
  showScreen("levels");
});
$("btn-levels-back").addEventListener("click", () => {
  renderHome();
  showScreen("home");
});
$("btn-play-back").addEventListener("click", () => {
  if (busy) return;
  hideCoach(false);
  outModal.classList.add("hidden");
  renderHome();
  showScreen("home");
});
$("btn-settings").addEventListener("click", () => {
  ($("toggle-sound") as HTMLInputElement).checked = save.sound;
  ($("toggle-haptic") as HTMLInputElement).checked = save.haptic;
  syncLangButtons();
  $("btn-privacy").classList.toggle("hidden", !privacyOptionsRequired());
  showScreen("settings");
});
$("btn-privacy").addEventListener("click", () => {
  void openPrivacyOptions();
});
$("btn-settings-back").addEventListener("click", () => {
  renderHome();
  showScreen("home");
});
$("toggle-sound").addEventListener("change", (e) => {
  save.sound = (e.target as HTMLInputElement).checked;
  setMuted(!save.sound);
  persist();
});
$("toggle-haptic").addEventListener("change", (e) => {
  save.haptic = (e.target as HTMLInputElement).checked;
  persist();
});
$("btn-reset").addEventListener("click", () => {
  if (!confirm(t("resetConfirm"))) return;
  const locale = save.locale;
  save = resetSave();
  save.locale = locale;
  persist();
  setMuted(!save.sound);
  hideCoach(false);
  refreshLocale();
  renderHome();
  showScreen("home");
});
$("btn-replay-guide").addEventListener("click", () => {
  save.seenLessons = [];
  persist();
  $("btn-replay-guide").textContent = t("guideReset");
});

$("btn-undo").addEventListener("click", () => {
  if (coach || busy || !history.length) return;
  const needCoins = UNDO_FREE - stats.undos <= 0;
  if (needCoins && save.coins < 15) {
    sfx.error();
    return;
  }
  if (needCoins) {
    save.coins -= 15;
    persist();
  }
  const move = history.pop()!;
  undoMove(state, move);
  stats.undos += 1;
  stats.moves = Math.max(0, stats.moves - 1);
  combo = 0;
  selected = null;
  board.setSelected(null);
  board.setState(state);
  refreshHud();
});

$("btn-hint").addEventListener("click", async () => {
  if (coach || busy) return;
  const useAd = save.coins < 40;
  if (useAd) {
    const outcome = await showRewarded(t("rewardHint"), "hint");
    if (outcome !== "granted") return toastMissedReward(outcome);
  } else {
    save.coins -= 40;
    persist();
  }
  const move = hintMove(state);
  if (!move) {
    sfx.error();
    return;
  }
  stats.hints += 1;
  board.setHint(move);
  sfx.coin();
});

$("btn-extra").addEventListener("click", async () => {
  if (coach || busy || stats.extraJar) return;
  const useAd = save.coins < 80;
  if (useAd) {
    const outcome = await showRewarded(t("rewardJar"), "extra_jar");
    if (outcome !== "granted") return toastMissedReward(outcome);
  } else {
    save.coins -= 80;
    persist();
  }
  state = addExtraJar(state);
  stats.extraJar = true;
  $("btn-extra").toggleAttribute("disabled", true);
  board.setState(state);
  sfx.coin();
});

$("btn-moves").addEventListener("click", async () => {
  if (coach || busy) return;
  const useAd = save.coins < MOVES_COST;
  if (useAd) {
    const outcome = await showRewarded(t("rewardMoves"), "moves");
    if (outcome !== "granted") return toastMissedReward(outcome);
  } else {
    save.coins -= MOVES_COST;
    persist();
  }
  grantMoves();
});

$("btn-om-ad").addEventListener("click", async () => {
  const btn = $("btn-om-ad") as HTMLButtonElement;
  if (btn.disabled) return;
  btn.disabled = true;
  const outcome = await showRewarded(t("rewardMoves"), "out_of_moves");
  btn.disabled = false;
  if (outcome !== "granted") return toastMissedReward(outcome);
  outModal.classList.add("hidden");
  grantMoves();
});
$("btn-om-coins").addEventListener("click", () => {
  if (save.coins < MOVES_COST) return;
  save.coins -= MOVES_COST;
  persist();
  outModal.classList.add("hidden");
  grantMoves();
});
$("btn-om-retry").addEventListener("click", () => {
  track("level_end", { level: levelId, success: false, stars: 0, moves: stats.moves });
  startLevel(levelId);
});
$("btn-om-close").addEventListener("click", () => outModal.classList.add("hidden"));

$("btn-win-double").addEventListener("click", async () => {
  const btn = $("btn-win-double") as HTMLButtonElement;
  if (winBusy || btn.disabled) return;
  winBusy = true;
  btn.disabled = true;
  const outcome = await showRewarded(t("rewardDouble", { n: winReward }), "double_coins");
  winBusy = false;
  if (outcome !== "granted") {
    btn.disabled = false;
    return toastMissedReward(outcome);
  }
  save.coins += winReward;
  persist();
  countUpReward(winReward, winReward * 2);
  btn.classList.add("hidden");
  board.celebrate();
  haptic([20, 40, 30]);
});
$("btn-win-levels").addEventListener("click", () => {
  void leaveWin("levels");
});
$("btn-win-next").addEventListener("click", () => {
  void leaveWin("next");
});

$("btn-coach-skip").addEventListener("click", () => hideCoach(true));
$("btn-coach-next").addEventListener("click", () => {
  coachNotify({ type: "next" });
});
window.addEventListener("resize", () => layoutCoach());

bindAds({
  show(kind, title, body) {
    return new Promise((resolve) => {
      $("ad-kind").textContent = kind === "rewarded" ? "REWARDED" : "INTERSTITIAL";
      $("ad-title").textContent = title;
      $("ad-body").textContent = body;
      const btn = $("btn-ad-done") as HTMLButtonElement;
      const timer = $("ad-timer");
      timer.innerHTML = "<i></i>";
      const bar = timer.firstElementChild as HTMLElement;
      btn.disabled = true;
      btn.textContent = t("adWatching");
      adModal.classList.remove("hidden");
      const wait = kind === "rewarded" ? 2200 : 1600;
      bar.animate([{ width: "0%" }, { width: "100%" }], { duration: wait, fill: "forwards" });
      window.setTimeout(() => {
        btn.disabled = false;
        btn.textContent = kind === "rewarded" ? t("adClaim") : t("adContinue");
      }, wait);
      const done = () => {
        btn.removeEventListener("click", done);
        adModal.classList.add("hidden");
        resolve({ watched: true });
      };
      btn.addEventListener("click", done);
    });
  },
});

function bindPressFeedback(): void {
  document.addEventListener("pointerdown", (e) => {
    const btn = (e.target as HTMLElement | null)?.closest("button");
    if (!btn || btn.disabled) return;
    btn.classList.add("pressing");
    if (btn.classList.contains("tool")) {
      unlockAudio();
      sfx.tap();
      haptic(16);
    }
  });
  const clear = () => {
    document.querySelectorAll("button.pressing").forEach((btn) => btn.classList.remove("pressing"));
  };
  document.addEventListener("pointerup", clear);
  document.addEventListener("pointercancel", clear);
}

function syncLangButtons(): void {
  const loc = getLocale();
  $("btn-lang-en").classList.toggle("active", loc === "en");
  $("btn-lang-vi").classList.toggle("active", loc === "vi");
}

function refreshLocale(): void {
  applyStaticI18n();
  syncLangButtons();
  refreshHud();
  if (screens.home.classList.contains("active")) renderHome();
  if (screens.levels.classList.contains("active")) renderLevels();
  if (screens.play.classList.contains("active")) {
    $("play-level").textContent = t("levelLabel", { n: levelId });
    if (!coach) $("tutorial").textContent = modifierHint(spec);
  }
}

function changeLocale(next: Locale): void {
  if (next === getLocale()) return;
  setLocale(next);
  save.locale = next;
  persist();
  refreshLocale();
}

$("btn-lang-en").addEventListener("click", () => changeLocale("en"));
$("btn-lang-vi").addEventListener("click", () => changeLocale("vi"));

setLocale(save.locale);
setMuted(!save.sound);
void initAds();
bindPressFeedback();
refreshLocale();
showScreen("home");
renderHome();
import.meta.hot?.accept(() => location.reload());
