import {
  beamSprite,
  freeSprite,
  haloSprite,
  heartSprite,
  jarBackSprite,
  jarFrontSprite,
  jarPath,
  lidSprite,
  lighten,
  MYSTERY_HEX,
  orbSprite,
  paintHighlight,
  roundRect,
  starSprite,
  type Face,
  type Sprite,
} from "./art";
import { iceHits, isFrozen, isMystery, isSealed, orbColor, topRun } from "./engine";
import { fx, sampleFrame } from "./perf";
import { PALETTE, type GameState, type Move } from "./types";

type Rect = { i: number; x: number; y: number; w: number; h: number };
type Fly = {
  color: number;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  start: number;
  dur: number;
  landed?: boolean;
};
type Spark = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  size?: number;
  decay?: number;
  g?: number;
};
/** Rotating ✦ sparkle drawn from a sprite; `spin` offsets its twinkle phase. */
type Twinkle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  decay: number;
  size: number;
  color: string;
  g: number;
  spin: number;
};
type Floater = { x: number; y: number; life: number; text: string; color: string; scale: number };
type Heart = { x: number; y: number; vy: number; life: number; color: string; phase: number };
type Beam = { x: number; y: number; w: number; h: number; life: number; color: string };
type Ring = { x: number; y: number; r0: number; max: number; life: number; color: string; width: number };
type Confetti = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  w: number;
  h: number;
  color: string;
  life: number;
};
type Firework = { at: number; x: number; y: number; color: string };
type Drag = {
  id: number;
  from: number;
  x0: number;
  y0: number;
  x: number;
  y: number;
  moved: boolean;
  deferTap: boolean;
};
type Shard = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  life: number;
  size: number;
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function easeOutCubic(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}

/** Stable 0..1 noise per orb slot, so blinks are staggered but repeatable. */
function slotNoise(i: number, n: number): number {
  const v = Math.sin(i * 12.9898 + n * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

const AMBIENT = ["#7ee0c6", "#c77dff", "#ffd166", "#ff5d7a", "#4cc9f0"];
const GLITTER = ["#ffffff", "#fff3c4", "#ffd166", "#c6f3ff", "#ffc6e0"];
const RAINBOW = ["#ff6b9a", "#ffd166", "#7ee0c6", "#7ab8ff", "#c77dff"];
/** Frame length the particle constants were tuned for. */
const FRAME_MS = 1000 / 60;

export class Board {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private state: GameState | null = null;
  private selected: number | null = null;
  private hint: Move | null = null;
  private rects: Rect[] = [];
  private flies: Fly[] = [];
  private sparks: Spark[] = [];
  private twinkles: Twinkle[] = [];
  /** Idle sparkles around sealed jars; they don't keep the board at full frame rate. */
  private glints: Twinkle[] = [];
  private floaters: Floater[] = [];
  private hearts: Heart[] = [];
  private beams: Beam[] = [];
  private shards: Shard[] = [];
  private rings: Ring[] = [];
  private confetti: Confetti[] = [];
  private fireworks: Firework[] = [];
  private jarFlash = new Map<number, { start: number; color: string }>();
  private lidDrop = new Map<number, number>();
  private quakeUntil = 0;
  private quakeDur = 1;
  private quakePower = 0;
  private crackFlash = 0;
  private shakeUntil = 0;
  private shakeJar = -1;
  private nextGlint = 0;
  private raf = 0;
  private tap: ((index: number) => void) | null = null;
  private hidden = new Map<string, number>();
  private pourGen = 0;
  private pourTimers: number[] = [];
  private pourResolve: (() => void) | null = null;
  private pourAfter: GameState | null = null;
  private drag: Drag | null = null;
  private dpr = 1;
  private lastFrame = 0;
  private lastDraw = 0;
  private oddFrame = false;
  /** Size-dependent art (orbs, jars, lids), rebuilt when layout or resolution changes. */
  private sprites = new Map<string, Sprite>();
  /** Fixed-size effect art (stars, hearts, beams), keyed by color. */
  private fxSprites = new Map<string, Sprite>();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas");
    this.ctx = ctx;
    this.onDown = this.onDown.bind(this);
    this.onMove = this.onMove.bind(this);
    this.onUp = this.onUp.bind(this);
    this.onCancel = this.onCancel.bind(this);
    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerup", this.onUp);
    canvas.addEventListener("pointercancel", this.onCancel);
    this.raf = requestAnimationFrame(() => this.loop());
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener("pointerdown", this.onDown);
    this.canvas.removeEventListener("pointermove", this.onMove);
    this.canvas.removeEventListener("pointerup", this.onUp);
    this.canvas.removeEventListener("pointercancel", this.onCancel);
    this.clearSprites();
  }

  onTap(cb: (index: number) => void): void {
    this.tap = cb;
  }

  setState(state: GameState): void {
    this.state = state;
  }

  setSelected(i: number | null): void {
    this.selected = i;
  }

  setHint(move: Move | null): void {
    this.hint = move;
  }

  jarRect(index: number): { x: number; y: number; w: number; h: number } | null {
    const r = this.rects.find((x) => x.i === index);
    return r ? { x: r.x, y: r.y, w: r.w, h: r.h } : null;
  }

  orbRect(index: number): { x: number; y: number; w: number; h: number } | null {
    const r = this.rects.find((x) => x.i === index);
    if (!r || !this.state) return null;
    const jar = this.state.jars[index];
    if (!jar) return null;
    const orb = this.metrics().orb;
    const slot = Math.max(0, jar.length - 1);
    const size = orb * 2.6;
    const cx = r.x + r.w / 2;
    const cy = this.orbY(r, slot, orb);
    return { x: cx - size / 2, y: cy - size / 2, w: size, h: size };
  }

  shake(index: number): void {
    this.shakeJar = index;
    this.shakeUntil = performance.now() + 280;
  }

  popup(index: number, text: string, color = "#e4c27a", scale = 1): void {
    const r = this.rects.find((x) => x.i === index);
    if (!r) return;
    this.floaters.push({
      x: r.x + r.w / 2,
      y: r.y + 8,
      life: 1,
      text,
      color,
      scale,
    });
  }

  quake(power: number, dur: number): void {
    const now = performance.now();
    if (now < this.quakeUntil && this.quakePower > power) return;
    this.quakePower = power;
    this.quakeDur = dur;
    this.quakeUntil = now + dur;
  }

  /** Scales a particle count to the device profile and the live-particle budget. */
  private spawnCount(base: number, min = 4): number {
    const live = this.sparks.length + this.confetti.length + this.twinkles.length + this.glints.length;
    const room = fx().maxParticles - live;
    return Math.max(0, Math.min(room, Math.max(min, Math.round(base * fx().particles))));
  }

  private addTwinkle(list: Twinkle[], t: Omit<Twinkle, "spin">): void {
    list.push({ ...t, spin: Math.random() * Math.PI * 2 });
  }

  /** Seal celebration; `power` grows with the combo (1..4). */
  burst(index: number, color: number, power = 1): void {
    const r = this.rects.find((x) => x.i === index);
    if (!r) return;
    const p = Math.max(1, Math.min(4, power));
    const hex = PALETTE[(orbColor(color) - 1) % PALETTE.length]!;
    const pale = lighten(hex, 0.4);
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h * 0.42;

    const sparks = this.spawnCount(18 + p * 6, 8);
    for (let n = 0; n < sparks; n++) {
      const a = (Math.PI * 2 * n) / sparks + Math.random() * 0.2;
      const spd = (2 + Math.random() * 2.4) * (0.9 + p * 0.15);
      this.sparks.push({
        x: cx,
        y: cy,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd - 1,
        life: 1,
        color: n % 4 === 0 ? "#fff6d8" : n % 4 === 1 ? pale : hex,
        size: 1.4 + Math.random() * 2,
        decay: 0.017 + Math.random() * 0.01,
        g: 0.06,
      });
    }
    const stars = this.spawnCount(8 + p * 3, 4);
    for (let n = 0; n < stars; n++) {
      const a = Math.random() * Math.PI * 2;
      const spd = 1 + Math.random() * 2.6;
      this.addTwinkle(this.twinkles, {
        x: cx,
        y: cy,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd - 1.2,
        life: 1,
        decay: 0.014 + Math.random() * 0.008,
        size: 5 + Math.random() * 5 + p,
        color: n % 3 === 0 ? "#ffffff" : n % 3 === 1 ? "#fff3c4" : pale,
        g: 0.03,
      });
    }

    const now = performance.now();
    this.rings.push({ x: cx, y: cy, r0: r.w * 0.3, max: r.w * (1.1 + p * 0.3), life: 1, color: hex, width: 3 + p });
    if (p >= 2) {
      this.rings.push({ x: cx, y: cy, r0: r.w * 0.1, max: r.w * (1.6 + p * 0.4), life: 1.25, color: "#fff3c4", width: 2 });
    }
    this.beams.push({ x: cx, y: r.y + r.h, w: r.w * 1.25, h: r.h * 2.1, life: 1, color: hex });
    this.jarFlash.set(index, { start: now, color: hex });
    this.lidDrop.set(index, now);
    this.quake((2.5 + p * 1.5) * fx().quake, 240 + p * 60);
    const hearts = p >= 3 ? 2 : 1;
    for (let n = 0; n < hearts; n++) {
      this.hearts.push({
        x: cx + (n ? 12 : -4),
        y: r.y,
        vy: -1.2 - Math.random() * 0.5,
        life: 1,
        color: lighten(hex, 0.15),
        phase: Math.random() * 6,
      });
    }
  }

  /** Confetti rain, glitter and a few fireworks over the board. */
  celebrate(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w < 8 || h < 8) return;
    const now = performance.now();
    const count = this.spawnCount(Math.min(170, 70 + w * 0.1), 16);
    for (let n = 0; n < count; n++) {
      this.confetti.push({
        x: Math.random() * w,
        y: -20 - Math.random() * h * 0.5,
        vx: (Math.random() - 0.5) * 1.6,
        vy: 2 + Math.random() * 2.6,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.3,
        w: 6 + Math.random() * 5,
        h: 3 + Math.random() * 3,
        color: PALETTE[n % PALETTE.length]!,
        life: 1,
      });
    }
    const glitter = this.spawnCount(30, 8);
    for (let n = 0; n < glitter; n++) {
      this.addTwinkle(this.twinkles, {
        x: Math.random() * w,
        y: -10 - Math.random() * h * 0.3,
        vx: (Math.random() - 0.5) * 0.6,
        vy: 1 + Math.random() * 1.4,
        life: 1.4,
        decay: 0.008 + Math.random() * 0.005,
        size: 4 + Math.random() * 5,
        color: GLITTER[n % GLITTER.length]!,
        g: 0.01,
      });
    }
    const shows = fx().tier === "low" ? 2 : fx().tier === "mid" ? 4 : 5;
    for (let k = 0; k < shows; k++) {
      this.fireworks.push({
        at: now + k * 230,
        x: w * (0.18 + ((k * 0.37) % 0.64)),
        y: h * (0.18 + (k % 2) * 0.18),
        color: PALETTE[(k * 3) % PALETTE.length]!,
      });
    }
    this.quake(5 * fx().quake, 420);
  }

  private explode(x: number, y: number, color: string): void {
    const count = this.spawnCount(28, 10);
    for (let n = 0; n < count; n++) {
      const a = (Math.PI * 2 * n) / count;
      const spd = 2.4 + Math.random() * 2.2;
      this.sparks.push({
        x,
        y,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd,
        life: 1,
        color: n % 4 === 0 ? "#ffffff" : color,
        size: 1.8 + Math.random() * 2,
        decay: 0.014 + Math.random() * 0.008,
        g: 0.05,
      });
    }
    const stars = this.spawnCount(8, 3);
    for (let n = 0; n < stars; n++) {
      const a = (Math.PI * 2 * n) / stars + 0.3;
      const spd = 1.2 + Math.random() * 1.6;
      this.addTwinkle(this.twinkles, {
        x,
        y,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd,
        life: 1,
        decay: 0.012 + Math.random() * 0.006,
        size: 6 + Math.random() * 4,
        color: n % 2 ? "#ffffff" : lighten(color, 0.3),
        g: 0.025,
      });
    }
    this.rings.push({ x, y, r0: 4, max: 70, life: 1, color, width: 3 });
  }

  private splash(x: number, y: number, hex: string, orb: number): void {
    const count = this.spawnCount(7, 3);
    for (let n = 0; n < count; n++) {
      const a = -Math.PI / 2 + (n - (count - 1) / 2) * 0.32;
      const spd = 1.4 + Math.random() * 1.6;
      this.sparks.push({
        x,
        y: y - orb * 0.6,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd,
        life: 0.8,
        color: n % 3 ? hex : "#ffffff",
        size: 1.2 + Math.random() * 1.4,
        decay: 0.035,
        g: 0.09,
      });
    }
    if (this.spawnCount(1, 1) > 0) {
      this.addTwinkle(this.twinkles, {
        x: x + (Math.random() - 0.5) * orb,
        y: y - orb,
        vx: 0,
        vy: -0.6,
        life: 0.8,
        decay: 0.03,
        size: 5,
        color: "#ffffff",
        g: 0,
      });
    }
    this.rings.push({ x, y, r0: orb * 0.8, max: orb * 1.9, life: 0.7, color: hex, width: 2 });
  }

  iceShatter(index: number): void {
    const r = this.rects.find((x) => x.i === index);
    if (!r || !this.state) return;
    const jar = this.state.jars[index]!;
    const m = this.metrics();
    const x = r.x + r.w / 2;
    const y = this.orbY(r, jar.length - 1, m.orb);
    this.crackFlash = performance.now() + 420;
    const count = Math.max(6, Math.round(14 * fx().particles));
    for (let n = 0; n < count; n++) {
      const a = (Math.PI * 2 * n) / count + Math.random() * 0.3;
      const spd = 1.8 + Math.random() * 2.4;
      this.shards.push({
        x,
        y,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd - 1.2,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.4,
        life: 1,
        size: 3 + Math.random() * 5,
      });
      this.sparks.push({
        x,
        y,
        vx: Math.cos(a) * (0.8 + Math.random()),
        vy: Math.sin(a) * (0.8 + Math.random()) - 0.4,
        life: 1,
        color: n % 2 ? "#e8fbff" : "#7ad7ff",
      });
    }
  }

  animatePour(move: Move, after: GameState): Promise<void> {
    const gen = this.pourGen;
    const from = this.rects.find((x) => x.i === move.from);
    const to = this.rects.find((x) => x.i === move.to);
    if (!from || !to || !this.state || move.count <= 0) {
      if (this.pourGen === gen) this.state = after;
      return Promise.resolve();
    }
    const before = this.state;
    const srcLen = before.jars[move.from]!.length;
    const dstLen = before.jars[move.to]!.length;
    const orb = this.metrics().orb;
    const now = performance.now();
    this.flies = [];
    for (let k = 0; k < move.count; k++) {
      const key = `${move.from}:${srcLen - 1 - k}`;
      this.hidden.set(key, move.color);
      this.flies.push({
        color: move.color,
        sx: from.x + from.w / 2,
        sy: this.orbY(from, srcLen - 1 - k, orb),
        tx: to.x + to.w / 2,
        ty: this.orbY(to, dstLen + k, orb),
        start: now + k * 52,
        dur: 440,
      });
    }
    this.pourAfter = after;
    return new Promise((resolve) => {
      this.pourResolve = resolve;
      const wait = 440 + Math.max(0, move.count - 1) * 52 + 90;
      const id = window.setTimeout(() => this.finishPour(gen), wait);
      this.pourTimers.push(id);
    });
  }

  private finishPour(gen: number): void {
    if (this.pourGen !== gen) return;
    const after = this.pourAfter;
    const done = this.pourResolve;
    this.pourAfter = null;
    this.pourResolve = null;
    this.hidden.clear();
    this.flies = [];
    if (after) this.state = after;
    done?.();
  }

  resetFx(): void {
    const pending = this.pourResolve;
    this.pourGen += 1;
    for (const id of this.pourTimers) window.clearTimeout(id);
    this.pourTimers = [];
    this.pourResolve = null;
    this.pourAfter = null;
    this.flies = [];
    this.sparks = [];
    this.twinkles = [];
    this.glints = [];
    this.shards = [];
    this.floaters = [];
    this.hearts = [];
    this.beams = [];
    this.rings = [];
    this.confetti = [];
    this.fireworks = [];
    this.jarFlash.clear();
    this.lidDrop.clear();
    this.quakeUntil = 0;
    this.hidden.clear();
    this.selected = null;
    this.hint = null;
    this.shakeJar = -1;
    this.drag = null;
    pending?.();
  }

  private metrics() {
    const n = this.state?.jars.length ?? 4;
    const cap = this.state?.cap ?? 4;
    const w = Math.max(8, this.canvas.clientWidth);
    const h = Math.max(8, this.canvas.clientHeight);
    let cols = 4;
    if (n <= 4) cols = n;
    else if (n <= 6) cols = 3;
    else if (n <= 8) cols = 4;
    else if (n <= 12) cols = 4;
    else cols = 5;
    // Tablet-sized boards get larger jars; phones keep the original caps.
    const big = Math.min(w, h) >= 560 || (w >= 760 && h >= 380);
    if (big && w > h * 1.25) cols = n <= 8 ? n : Math.ceil(n / 2);
    const rows = Math.ceil(n / cols);
    const gapX = big ? 22 : 12;
    const gapY = big ? 34 : 22;
    let jarW = Math.max(36, Math.min(big ? 124 : 78, (w - 28 - gapX * (cols - 1)) / cols));
    let orb = Math.max(10, Math.min(big ? 46 : 28, jarW * 0.42));
    let jarH = cap * (orb * 1.55) + 36;
    const roomH = h - 16 - (rows - 1) * gapY;
    if (rows * jarH > roomH && roomH > 0) {
      const k = Math.max(0.5, roomH / (rows * jarH));
      orb = Math.max(10, orb * k);
      jarW = Math.max(36, jarW * k);
      jarH = cap * (orb * 1.55) + 36;
    }
    const totalW = cols * jarW + (cols - 1) * gapX;
    const totalH = rows * jarH + (rows - 1) * gapY;
    const ox = (w - totalW) / 2;
    const oy = Math.max(8, (h - totalH) / 2 - 6);
    return { cols, rows, jarW, jarH, orb, ox, oy, gapX, gapY };
  }

  private orbY(rect: Rect, indexFromBottom: number, orb: number): number {
    const innerBottom = rect.y + rect.h - 14;
    return innerBottom - orb - indexFromBottom * (orb * 1.55);
  }

  private localPoint(ev: PointerEvent): { x: number; y: number } {
    const bounds = this.canvas.getBoundingClientRect();
    return { x: ev.clientX - bounds.left, y: ev.clientY - bounds.top };
  }

  private jarAt(x: number, y: number, pad = 0): number | null {
    for (const r of this.rects) {
      if (x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad) {
        return r.i;
      }
    }
    return null;
  }

  private dragging(): boolean {
    return !!this.drag && this.drag.moved && this.selected === this.drag.from;
  }

  private onDown(ev: PointerEvent): void {
    if (this.drag) return;
    const { x, y } = this.localPoint(ev);
    const hit = this.jarAt(x, y);
    if (hit === null) return;
    // Tapping the selected jar deselects it, so wait for release to tell tap from drag.
    const deferTap = this.selected === hit;
    if (!deferTap) this.tap?.(hit);
    this.drag = { id: ev.pointerId, from: hit, x0: x, y0: y, x, y, moved: false, deferTap };
    try {
      this.canvas.setPointerCapture(ev.pointerId);
    } catch {
      /* capture is optional */
    }
  }

  private onMove(ev: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.id !== ev.pointerId) return;
    const { x, y } = this.localPoint(ev);
    drag.x = x;
    drag.y = y;
    if (!drag.moved && Math.hypot(x - drag.x0, y - drag.y0) > 10) drag.moved = true;
  }

  private onUp(ev: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.id !== ev.pointerId) return;
    this.drag = null;
    const { x, y } = this.localPoint(ev);
    if (!drag.moved) {
      if (drag.deferTap) this.tap?.(drag.from);
      return;
    }
    if (this.selected !== drag.from) return;
    const target = this.jarAt(x, y, 14);
    if (target !== null && target !== drag.from) this.tap?.(target);
  }

  private onCancel(ev: PointerEvent): void {
    if (this.drag?.id === ev.pointerId) this.drag = null;
  }

  private drawDrag(orb: number, now: number): void {
    const drag = this.drag;
    if (!drag || !this.dragging() || !this.state) return;
    const jar = this.state.jars[drag.from];
    if (!jar?.length) return;
    const ctx = this.ctx;
    const target = this.jarAt(drag.x, drag.y, 14);
    if (target !== null && target !== drag.from) {
      const r = this.rects.find((q) => q.i === target);
      if (r) {
        ctx.strokeStyle = "rgba(126,224,198,0.9)";
        ctx.lineWidth = 2.4;
        roundRect(ctx, r.x - 6, r.y - 8, r.w + 12, r.h + 14, 18);
        ctx.stroke();
      }
    }
    const run = topRun(jar, false);
    const value = jar[jar.length - 1]!;
    ctx.save();
    ctx.globalAlpha = 0.92;
    for (let k = Math.min(run, 4) - 1; k >= 0; k--) {
      this.drawOrb(drag.x, drag.y - orb * 1.4 - k * orb * 0.5, value, orb, true, now, 1, "happy");
    }
    ctx.restore();
  }

  private loop(): void {
    const now = performance.now();
    if (this.lastFrame && this.canvas.clientWidth >= 8) sampleFrame(now - this.lastFrame);
    this.lastFrame = now;
    this.oddFrame = !this.oddFrame;
    // Weaker devices redraw idle boards (only slow ambient motion) at half rate.
    if (!(this.oddFrame && fx().idleHalfRate && !this.animating(now))) {
      try {
        this.draw(now);
      } catch {
        /* one bad frame must not freeze the board */
      }
    }
    this.raf = requestAnimationFrame(() => this.loop());
  }

  private animating(now: number): boolean {
    return (
      this.flies.length > 0 ||
      this.sparks.length > 0 ||
      this.twinkles.length > 0 ||
      this.rings.length > 0 ||
      this.confetti.length > 0 ||
      this.fireworks.length > 0 ||
      this.hearts.length > 0 ||
      this.beams.length > 0 ||
      this.shards.length > 0 ||
      this.floaters.length > 0 ||
      this.jarFlash.size > 0 ||
      this.lidDrop.size > 0 ||
      this.drag !== null ||
      now < this.quakeUntil ||
      now < this.shakeUntil ||
      now < this.crackFlash
    );
  }

  /* ---------- sprite cache ---------- */

  private clearSprites(): void {
    for (const s of this.sprites.values()) freeSprite(s);
    this.sprites.clear();
  }

  private sprite(key: string, make: () => Sprite): Sprite {
    const hit = this.sprites.get(key);
    if (hit) return hit;
    if (this.sprites.size > 320) this.clearSprites();
    const s = make();
    this.sprites.set(key, s);
    return s;
  }

  private fxSprite(key: string, make: () => Sprite): Sprite {
    let s = this.fxSprites.get(key);
    if (!s) {
      s = make();
      this.fxSprites.set(key, s);
    }
    return s;
  }

  private blit(s: Sprite, x: number, y: number): void {
    this.ctx.drawImage(s.image, x - s.ox, y - s.oy, s.w, s.h);
  }

  /* ---------- frame ---------- */

  private draw(now: number): void {
    const { canvas, ctx } = this;
    const dpr = Math.min(fx().dprMax, window.devicePixelRatio || 1);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w < 8 || h < 8) return;
    // Particle steps were tuned per 60fps frame; scale them by real elapsed time.
    const k = this.lastDraw ? Math.min(3, Math.max(0.25, (now - this.lastDraw) / FRAME_MS)) : 1;
    this.lastDraw = now;
    if (dpr !== this.dpr) {
      this.dpr = dpr;
      this.clearSprites();
    }
    const bw = Math.max(1, Math.floor(w * dpr));
    const bh = Math.max(1, Math.floor(h * dpr));
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    this.drawAmbient(w, h, now);

    if (!this.state) return;
    const state = this.state;
    const m = this.metrics();
    this.rects = [];

    let qx = 0;
    let qy = 0;
    if (now < this.quakeUntil) {
      const q = (this.quakeUntil - now) / this.quakeDur;
      const p = this.quakePower * q * q;
      qx = Math.sin(now / 15) * p;
      qy = Math.cos(now / 21) * p * 0.7;
      ctx.translate(qx, qy);
    }

    state.jars.forEach((jar, i) => {
      const col = i % m.cols;
      const row = Math.floor(i / m.cols);
      let x = m.ox + col * (m.jarW + m.gapX);
      const y = m.oy + row * (m.jarH + m.gapY);
      if (this.shakeJar === i && now < this.shakeUntil) {
        x += Math.sin(now / 18) * 5;
      }
      this.rects.push({ i, x, y, w: m.jarW, h: m.jarH });
      this.drawJar(jar, i, x, y, m.jarW, m.jarH, m.orb, now);
    });

    this.spawnGlints(state, now);

    let flying = false;
    const additive = fx().additive;
    for (const fly of this.flies) {
      const raw = (now - fly.start) / fly.dur;
      if (raw < 0) {
        flying = true;
        continue;
      }
      const t = Math.max(0, Math.min(1, raw));
      if (t < 1) flying = true;
      const hex = isMystery(fly.color) ? MYSTERY_HEX : PALETTE[(orbColor(fly.color) - 1) % PALETTE.length]!;
      if (t < 1) {
        ctx.save();
        if (additive) ctx.globalCompositeOperation = "lighter";
        for (let n = 1; n <= 4; n++) {
          const tt = t - n * 0.05;
          if (tt <= 0) break;
          const p = this.flyPos(fly, tt);
          ctx.globalAlpha = 0.32 - n * 0.07;
          ctx.fillStyle = hex;
          ctx.beginPath();
          ctx.arc(p.x, p.y, m.orb * (0.85 - n * 0.12), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      } else if (!fly.landed) {
        fly.landed = true;
        this.splash(fly.tx, fly.ty, hex, m.orb);
      }
      const p = this.flyPos(fly, t);
      const scale = 1 + Math.sin(t * Math.PI) * 0.12;
      this.drawOrb(p.x, p.y, fly.color, m.orb, true, now, scale, isMystery(fly.color) ? "sleep" : "happy");
    }
    if (this.flies.length && !flying) this.finishPour(this.pourGen);

    this.drawDrag(m.orb, now);

    for (let i = this.fireworks.length - 1; i >= 0; i--) {
      const f = this.fireworks[i]!;
      if (now < f.at) continue;
      this.explode(f.x, f.y, f.color);
      this.fireworks.splice(i, 1);
    }

    ctx.save();
    if (additive) ctx.globalCompositeOperation = "lighter";
    this.drawBeams(k);
    this.drawRings(k);
    this.drawSparks(k, now);
    this.drawTwinkles(this.twinkles, k, now);
    this.drawTwinkles(this.glints, k, now);
    ctx.restore();

    this.drawConfetti(k, now, h, dpr, qx, qy);
    this.drawHearts(k, now);
    this.drawShards(k);
    this.drawFloaters(k, m.orb);
  }

  /* ---------- effects ---------- */

  /** Lazy sparkles drifting up out of sealed jars while the board is idle. */
  private spawnGlints(state: GameState, now: number): void {
    if (fx().tier === "low" || now < this.nextGlint) return;
    this.nextGlint = now + (fx().tier === "high" ? 260 : 520);
    const sealed = this.rects.filter((r) => isSealed(state.jars[r.i]!, state.cap));
    if (!sealed.length || this.spawnCount(1, 1) <= 0) return;
    const r = sealed[Math.floor(Math.random() * sealed.length)]!;
    const top = state.jars[r.i]![state.jars[r.i]!.length - 1]!;
    const hex = PALETTE[(orbColor(top) - 1) % PALETTE.length]!;
    this.addTwinkle(this.glints, {
      x: r.x + r.w * (0.15 + Math.random() * 0.7),
      y: r.y + 14 + Math.random() * (r.h - 24),
      vx: 0,
      vy: -0.25 - Math.random() * 0.2,
      life: 1,
      decay: 0.016 + Math.random() * 0.01,
      size: 3 + Math.random() * 3,
      color: Math.random() < 0.5 ? "#ffffff" : lighten(hex, 0.45),
      g: 0,
    });
  }

  private drawBeams(k: number): void {
    const ctx = this.ctx;
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i]!;
      b.life -= 0.022 * k;
      if (b.life <= 0) {
        this.beams.splice(i, 1);
        continue;
      }
      const s = this.fxSprite(`beam|${b.color}`, () => beamSprite(b.color));
      const grow = easeOutCubic(1 - b.life);
      const bw = b.w * (0.7 + 0.3 * grow);
      const bh = b.h * (0.55 + 0.45 * grow);
      ctx.globalAlpha = b.life * b.life * 0.8;
      ctx.drawImage(s.image, b.x - bw / 2, b.y - bh, bw, bh);
    }
  }

  private drawRings(k: number): void {
    const ctx = this.ctx;
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const g = this.rings[i]!;
      g.life -= 0.035 * k;
      const life = Math.min(1, g.life);
      if (life <= 0) {
        this.rings.splice(i, 1);
        continue;
      }
      const r = lerp(g.r0, g.max, easeOutCubic(1 - life));
      ctx.globalAlpha = life * 0.7;
      ctx.strokeStyle = g.color;
      ctx.lineWidth = Math.max(0.5, g.width * life);
      ctx.beginPath();
      ctx.arc(g.x, g.y, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawSparks(k: number, now: number): void {
    const ctx = this.ctx;
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i]!;
      s.x += s.vx * k;
      s.y += s.vy * k;
      s.vx *= Math.pow(0.985, k);
      s.vy += (s.g ?? 0.04) * k;
      s.life -= (s.decay ?? 0.02) * k;
      if (s.life <= 0) {
        this.sparks.splice(i, 1);
        continue;
      }
      const size = s.size ?? 2.2;
      const flick = 0.7 + 0.3 * Math.sin(now / 45 + i);
      ctx.fillStyle = s.color;
      ctx.globalAlpha = s.life * 0.22 * flick;
      ctx.beginPath();
      ctx.arc(s.x, s.y, size * 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = Math.min(1, s.life) * flick;
      ctx.beginPath();
      ctx.arc(s.x, s.y, size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawTwinkles(list: Twinkle[], k: number, now: number): void {
    const ctx = this.ctx;
    for (let i = list.length - 1; i >= 0; i--) {
      const t = list[i]!;
      t.x += t.vx * k;
      t.y += t.vy * k;
      t.vx *= Math.pow(0.97, k);
      t.vy += t.g * k;
      t.life -= t.decay * k;
      if (t.life <= 0) {
        list.splice(i, 1);
        continue;
      }
      const s = this.fxSprite(`star|${t.color}`, () => starSprite(t.color));
      const pulse = 0.6 + 0.4 * Math.sin(t.spin + now / 70);
      const d = t.size * 2 * pulse * Math.min(1, t.life * 2);
      if (d < 0.5) continue;
      ctx.globalAlpha = Math.min(1, t.life * 1.4);
      ctx.drawImage(s.image, t.x - d / 2, t.y - d / 2, d, d);
    }
  }

  private drawConfetti(k: number, now: number, h: number, dpr: number, qx: number, qy: number): void {
    if (!this.confetti.length) return;
    const ctx = this.ctx;
    for (let i = this.confetti.length - 1; i >= 0; i--) {
      const c = this.confetti[i]!;
      c.x += (c.vx + Math.sin(now / 260 + c.rot) * 0.7) * k;
      c.y += c.vy * k;
      c.rot += c.vr * k;
      if (c.y > h * 0.6) c.life -= 0.02 * k;
      if (c.life <= 0 || c.y > h + 20) {
        this.confetti.splice(i, 1);
        continue;
      }
      // Direct matrix instead of save/translate/rotate/scale/restore per piece.
      const cos = Math.cos(c.rot);
      const sin = Math.sin(c.rot);
      const flip = Math.cos(now / 140 + c.rot * 3);
      ctx.setTransform(cos * dpr, sin * dpr, -sin * flip * dpr, cos * flip * dpr, (c.x + qx) * dpr, (c.y + qy) * dpr);
      ctx.globalAlpha = c.life;
      ctx.fillStyle = c.color;
      ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(dpr, 0, 0, dpr, qx * dpr, qy * dpr);
  }

  private drawHearts(k: number, now: number): void {
    const ctx = this.ctx;
    for (let i = this.hearts.length - 1; i >= 0; i--) {
      const L = this.hearts[i]!;
      L.y += L.vy * k;
      L.life -= 0.011 * k;
      if (L.life <= 0) {
        this.hearts.splice(i, 1);
        continue;
      }
      const s = this.fxSprite(`heart|${L.color}`, () => heartSprite(L.color));
      const grow = Math.min(1, (1 - L.life) * 6);
      const d = 22 * (0.5 + 0.5 * grow);
      ctx.globalAlpha = Math.min(1, L.life * 1.5);
      ctx.drawImage(s.image, L.x + Math.sin(now / 260 + L.phase) * 6 - d / 2, L.y - d / 2, d, d);
    }
    ctx.globalAlpha = 1;
  }

  private drawShards(k: number): void {
    const ctx = this.ctx;
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const s = this.shards[i]!;
      s.x += s.vx * k;
      s.y += s.vy * k;
      s.vy += 0.08 * k;
      s.rot += s.vr * k;
      s.life -= 0.022 * k;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.rot);
      ctx.globalAlpha = Math.max(0, s.life);
      ctx.fillStyle = "rgba(210, 245, 255, 0.9)";
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(0, -s.size);
      ctx.lineTo(s.size * 0.55, s.size * 0.35);
      ctx.lineTo(-s.size * 0.4, s.size * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      if (s.life <= 0) this.shards.splice(i, 1);
    }
  }

  /** Bouncy candy-gradient labels; big combos get a rainbow fill. */
  private drawFloaters(k: number, orb: number): void {
    const ctx = this.ctx;
    const base = Math.max(16, orb * 0.62);
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i]!;
      f.y -= 0.7 * k;
      f.life -= 0.016 * k;
      if (f.life <= 0) {
        this.floaters.splice(i, 1);
        continue;
      }
      const pop = f.life > 0.86 ? 1 + ((f.life - 0.86) / 0.14) * 0.7 : 1;
      const size = Math.round(base * f.scale * pop);
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(Math.sin((1 - f.life) * 14) * 0.05 * f.scale);
      ctx.font = `900 ${size}px "Trebuchet MS", sans-serif`;
      ctx.textAlign = "center";
      ctx.lineJoin = "round";
      ctx.globalAlpha = Math.min(1, f.life * 1.6);
      ctx.lineWidth = Math.max(3, size * 0.24);
      ctx.strokeStyle = "rgba(34,14,52,0.9)";
      ctx.strokeText(f.text, 0, 0);
      let fill: CanvasGradient;
      if (f.scale >= 1.3) {
        const tw = ctx.measureText(f.text).width;
        fill = ctx.createLinearGradient(-tw / 2, 0, tw / 2, 0);
        RAINBOW.forEach((c, n) => fill.addColorStop(n / (RAINBOW.length - 1), c));
      } else {
        fill = ctx.createLinearGradient(0, -size * 0.85, 0, size * 0.1);
        fill.addColorStop(0, "#ffffff");
        fill.addColorStop(0.5, lighten(f.color, 0.35));
        fill.addColorStop(1, f.color);
      }
      if (fx().shadows) {
        ctx.shadowColor = f.color;
        ctx.shadowBlur = 12;
      }
      ctx.fillStyle = fill;
      ctx.fillText(f.text, 0, 0);
      ctx.restore();
    }
  }

  private flyPos(fly: Fly, t: number): { x: number; y: number } {
    const e = easeOutCubic(t);
    const span = Math.abs(fly.tx - fly.sx);
    const lift = Math.sin(t * Math.PI) * Math.min(58, span * 0.38 + 26);
    return { x: lerp(fly.sx, fly.tx, e), y: lerp(fly.sy, fly.ty, e) - lift };
  }

  private drawAmbient(w: number, h: number, now: number): void {
    if (w < 8 || h < 8) return;
    const ctx = this.ctx;
    const motes = fx().ambient;
    for (let i = 0; i < motes + 2; i++) {
      const x = ((i * 89 + now / 80) % (w + 40)) - 20;
      const y = (i * 47) % h;
      ctx.fillStyle = `rgba(255,255,255,${0.08 + (i % 3) * 0.04})`;
      ctx.beginPath();
      ctx.arc(x, y, i % 2 ? 1.2 : 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.save();
    if (fx().additive) ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < motes; i++) {
      const speed = 42 + (i % 5) * 16;
      const x = ((i * 97.3) % w) + Math.sin(now / 2400 + i * 1.7) * 22;
      const y = h + 20 - ((now / speed + i * 83) % (h + 40));
      const r = 1.4 + (i % 4) * 0.9;
      const a = 0.16 + (i % 3) * 0.07;
      ctx.fillStyle = AMBIENT[i % AMBIENT.length]!;
      ctx.globalAlpha = a * 0.3;
      ctx.beginPath();
      ctx.arc(x, y, r * 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /* ---------- jars & orbs ---------- */

  private drawJar(
    jar: number[],
    index: number,
    x: number,
    y: number,
    w: number,
    h: number,
    orb: number,
    now: number,
  ): void {
    const ctx = this.ctx;
    const cap = this.state!.cap;
    const selected = this.selected === index;
    const hinted = this.hint && (this.hint.from === index || this.hint.to === index);
    const sealed = isSealed(jar, cap);
    const topValue = jar[jar.length - 1];
    const tint = sealed && topValue !== undefined ? PALETTE[(orbColor(topValue) - 1) % PALETTE.length]! : null;
    const dpr = this.dpr;
    const size = `${Math.round(w * 2)}x${Math.round(h * 2)}`;

    ctx.save();
    if (selected) ctx.translate(0, -(6 + Math.sin(now / 180) * 1.5));

    let flashA = 0;
    const flash = this.jarFlash.get(index);
    if (flash) {
      flashA = 1 - (now - flash.start) / 700;
      if (flashA <= 0) {
        this.jarFlash.delete(index);
        flashA = 0;
      }
    }

    if (tint || selected) {
      const color = selected ? "#ffd27a" : tint!;
      const halo = this.sprite(`halo|${size}|${color}`, () => haloSprite(w, h, color, dpr));
      const pulse = selected ? 0.85 : 0.5 + Math.sin(now / 420 + index) * 0.2;
      ctx.globalAlpha = Math.min(1, pulse + flashA * 0.6);
      this.blit(halo, x, y);
      ctx.globalAlpha = 1;
    }

    const look = `${size}|${tint ?? ""}|${+selected}`;
    this.blit(this.sprite(`jb|${look}`, () => jarBackSprite(w, h, tint, selected, dpr)), x, y);

    const run = jar.length - topRun(jar, false);
    for (let n = 0; n < jar.length; n++) {
      if (this.hidden.has(`${index}:${n}`)) continue;
      const value = jar[n]!;
      const glow = selected && n >= run;
      let face: Face = "open";
      if (isFrozen(value)) face = "cold";
      else if (isMystery(value)) face = "sleep";
      else if (sealed || glow) face = "happy";
      else if (this.blinking(now, index, n)) face = "blink";
      this.drawOrb(x + w / 2, this.orbY({ i: index, x, y, w, h }, n, orb), value, orb, glow, now, 1, face);
    }

    this.blit(this.sprite(`jf|${look}`, () => jarFrontSprite(w, h, tint, selected, dpr)), x, y);

    if (tint) {
      if (flashA > 0) {
        jarPath(ctx, x, y, w, h);
        ctx.fillStyle = `rgba(255,255,255,${0.3 * flashA})`;
        ctx.fill();
      }
      let sweep = -1;
      if (flash && flashA > 0) sweep = (now - flash.start) / 600;
      else if (fx().tier !== "low") {
        const t = ((now + index * 830) % 3600) / 3600;
        if (t < 0.17) sweep = t / 0.17;
      }
      if (sweep >= 0 && sweep <= 1) this.drawGlint(x, y, w, h, sweep);

      const dropAt = this.lidDrop.get(index);
      let off = 0;
      if (dropAt !== undefined) {
        const t = (now - dropAt) / 420;
        if (t >= 1) this.lidDrop.delete(index);
        else off = -30 * (1 - t) * (1 - t) * Math.abs(Math.cos(t * Math.PI * 2));
      }
      this.blit(this.sprite(`lid|${Math.round(w * 2)}|${tint}`, () => lidSprite(w, tint, dpr)), x, y + off);
    }

    if (hinted) {
      ctx.strokeStyle = "rgba(228,194,122,0.85)";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      roundRect(ctx, x - 6, y - 8, w + 12, h + 14, 18);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  /** Each orb blinks for ~140ms every 4–7s, staggered by slot. */
  private blinking(now: number, jar: number, slot: number): boolean {
    const n = slotNoise(jar, slot);
    const period = 4200 + n * 2600;
    return (now + n * 9000) % period < 140;
  }

  /** Diagonal shine sweeping across the glass; `p` runs 0..1. */
  private drawGlint(x: number, y: number, w: number, h: number, p: number): void {
    const ctx = this.ctx;
    ctx.save();
    jarPath(ctx, x, y, w, h);
    ctx.clip();
    const bx = x - w * 0.5 + p * w * 2;
    const g = ctx.createLinearGradient(bx - w * 0.3, y + h * 0.2, bx + w * 0.3, y);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.5, "rgba(255,255,255,0.42)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }

  private drawOrb(
    x: number,
    y: number,
    value: number,
    r: number,
    glow = false,
    now = 0,
    scale = 1,
    face: Face = "happy",
  ): void {
    const radius = Math.max(4, r);
    const mystery = isMystery(value);
    const frozen = isFrozen(value);
    const hex = mystery ? MYSTERY_HEX : PALETTE[(orbColor(value) - 1) % PALETTE.length]!;
    // Faces are unreadable on tiny orbs.
    const shown: Face | null = radius >= 8 ? face : null;
    const key = `o|${hex}|${+mystery}${+frozen}${+glow}|${shown ?? "-"}|${Math.round(radius * 4)}`;
    const sprite = this.sprite(key, () => orbSprite(hex, radius, { mystery, frozen, glow, face: shown }, this.dpr));
    this.ctx.drawImage(sprite.image, x - sprite.ox * scale, y - sprite.oy * scale, sprite.w * scale, sprite.h * scale);
    if (!frozen) return;
    // The ice shell animates (cracks, flash), so it stays live; frozen orbs are few.
    this.drawIceShell(x, y, radius * scale, iceHits(value), now);
    paintHighlight(this.ctx, x, y, radius * scale);
  }

  private drawIceShell(x: number, y: number, r: number, hits: number, now: number): void {
    const radius = Math.max(4, r);
    const ctx = this.ctx;
    const stage = Math.max(0, Math.min(2, hits));
    const t = stage / 2;
    const flash = now < this.crackFlash ? (this.crackFlash - now) / 420 : 0;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.clip();

    const ice = ctx.createRadialGradient(
      x - radius * 0.2,
      y - radius * 0.35,
      Math.max(0.2, radius * 0.1),
      x,
      y,
      radius,
    );
    ice.addColorStop(0, `rgba(255,255,255,${0.55 - t * 0.32})`);
    ice.addColorStop(0.45, `rgba(170, 225, 255, ${0.5 - t * 0.28})`);
    ice.addColorStop(1, `rgba(70, 150, 200, ${0.38 - t * 0.12})`);
    ctx.fillStyle = ice;
    ctx.fill();

    if (stage === 0) {
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.lineWidth = 1;
      for (let i = 0; i < 3; i++) {
        const a = (Math.PI * 2 * i) / 3 + now / 2400;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(a) * radius * 0.2, y + Math.sin(a) * radius * 0.2);
        ctx.lineTo(x + Math.cos(a) * radius * 0.9, y + Math.sin(a) * radius * 0.9);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    ctx.strokeStyle = stage ? "rgba(255,255,255,0.55)" : "rgba(230, 250, 255, 0.95)";
    ctx.lineWidth = stage ? 1.4 : 2.2;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(1, radius - 0.8), 0, Math.PI * 2);
    ctx.stroke();

    if (stage > 0) {
      ctx.strokeStyle = `rgba(255,255,255,${0.85 + flash * 0.12})`;
      ctx.lineWidth = 1.8;
      ctx.lineCap = "round";
      const cracks: number[][] = [
        [0, -0.15, 0.18, -0.55, 0.08, -0.92],
        [0.1, 0.05, 0.48, 0.12, 0.88, 0.28],
        [-0.08, 0.1, -0.42, 0.38, -0.72, 0.82],
        [0.12, -0.05, 0.55, -0.42, 0.8, -0.7],
        [-0.15, -0.08, -0.5, -0.22, -0.9, -0.12],
      ];
      const shown = stage === 1 ? cracks.slice(0, 2) : cracks;
      for (const c of shown) {
        ctx.beginPath();
        ctx.moveTo(x + c[0]! * radius, y + c[1]! * radius);
        ctx.lineTo(x + c[2]! * radius, y + c[3]! * radius);
        ctx.lineTo(x + c[4]! * radius, y + c[5]! * radius);
        ctx.stroke();
      }
      if (stage === 2) {
        ctx.strokeStyle = "rgba(90, 170, 210, 0.7)";
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(x - radius * 0.2, y - radius * 0.1);
        ctx.lineTo(x + radius * 0.15, y + radius * 0.55);
        ctx.stroke();
      }

      ctx.fillStyle = `rgba(200, 240, 255, ${0.1 + stage * 0.08 + flash * 0.25})`;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      ctx.beginPath();
      ctx.ellipse(x - radius * 0.18, y - radius * 0.28, Math.max(0.5, radius * 0.38), Math.max(0.5, radius * 0.18), -0.6, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}
