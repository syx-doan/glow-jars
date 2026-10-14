export type Tier = "low" | "mid" | "high";

export type FxProfile = {
  tier: Tier;
  /** Canvas backing-store resolution cap. */
  dprMax: number;
  /** Multiplier on particle counts per effect. */
  particles: number;
  /** Hard cap on live sparks + confetti. */
  maxParticles: number;
  /** Live shadowBlur on jars and text (orbs use pre-baked sprites on every tier). */
  shadows: boolean;
  /** Additive blending for sparks and ambient motes. */
  additive: boolean;
  /** Drifting background motes on the board. */
  ambient: number;
  /** Full-screen color flash on seals and wins. */
  screenFlash: boolean;
  /** Board shake strength multiplier. */
  quake: number;
  /** Redraw at ~30fps while nothing is animating. */
  idleHalfRate: boolean;
};

const PROFILES: Record<Tier, FxProfile> = {
  high: {
    tier: "high",
    dprMax: 2,
    particles: 1,
    maxParticles: 420,
    shadows: true,
    additive: true,
    ambient: 16,
    screenFlash: true,
    quake: 1,
    idleHalfRate: false,
  },
  mid: {
    tier: "mid",
    dprMax: 1.75,
    particles: 0.6,
    maxParticles: 220,
    shadows: true,
    additive: true,
    ambient: 10,
    screenFlash: true,
    quake: 0.8,
    idleHalfRate: true,
  },
  low: {
    tier: "low",
    dprMax: 1.5,
    particles: 0.32,
    maxParticles: 90,
    shadows: false,
    additive: false,
    ambient: 6,
    screenFlash: false,
    quake: 0.5,
    idleHalfRate: true,
  },
};

const ORDER: Tier[] = ["low", "mid", "high"];
const KEY = "glow-jars-fx-v1";
/** A runtime downgrade sticks for a few days, then the device gets re-measured. */
const DOWNGRADE_TTL_MS = 3 * 24 * 60 * 60 * 1000;
/** Frames slower than this on average (~40fps) trigger a downgrade. */
const SLOW_FRAME_MS = 25;
const MIN_SAMPLES = 90;

let detected: Tier = detect();
let reduced = false;
let avg = 16.7;
let samples = 0;
const listeners: Array<(p: FxProfile) => void> = [];

function minTier(a: Tier, b: Tier): Tier {
  return ORDER.indexOf(a) <= ORDER.indexOf(b) ? a : b;
}

function hardwareTier(): Tier {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const mem = nav.deviceMemory;
  const cores = nav.hardwareConcurrency || 4;
  if ((mem !== undefined && mem <= 2) || cores <= 4) return "low";
  if ((mem !== undefined && mem <= 4) || cores <= 6) return "mid";
  return "high";
}

function storedTier(): Tier | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as { tier?: unknown; at?: unknown } | null;
    if (!raw || typeof raw.at !== "number" || Date.now() - raw.at > DOWNGRADE_TTL_MS) return null;
    return ORDER.includes(raw.tier as Tier) ? (raw.tier as Tier) : null;
  } catch {
    return null;
  }
}

function detect(): Tier {
  let tier = hardwareTier();
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) tier = "low";
  const stored = storedTier();
  return stored ? minTier(tier, stored) : tier;
}

function apply(): void {
  const p = fx();
  document.documentElement.dataset.fx = p.tier;
  for (const fn of listeners) fn(p);
}

export function fx(): FxProfile {
  return PROFILES[reduced ? "low" : detected];
}

export function onFxChange(fn: (p: FxProfile) => void): void {
  listeners.push(fn);
}

/** User setting: force the lightest profile regardless of hardware. */
export function setReducedEffects(on: boolean): void {
  reduced = on;
  apply();
}

/** Feed real frame intervals; sustained slow frames step the profile down one tier. */
export function sampleFrame(dt: number): void {
  if (reduced || detected === "low" || dt <= 0 || dt > 250) return;
  avg = avg * 0.94 + dt * 0.06;
  samples += 1;
  if (samples < MIN_SAMPLES || avg < SLOW_FRAME_MS) return;
  detected = ORDER[ORDER.indexOf(detected) - 1]!;
  samples = 0;
  avg = 16.7;
  try {
    localStorage.setItem(KEY, JSON.stringify({ tier: detected, at: Date.now() }));
  } catch {
    /* storage unavailable — re-measured next launch */
  }
  apply();
}

apply();
