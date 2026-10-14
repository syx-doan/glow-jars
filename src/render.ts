import { iceHits, isFrozen, isMystery, isSealed, orbColor, topRun } from "./engine";
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
type Floater = { x: number; y: number; life: number; text: string; color: string; scale: number };
type Lantern = { x: number; y: number; vy: number; life: number; color: string };
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

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1, 7), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

const AMBIENT = ["#7ee0c6", "#c77dff", "#ffd166", "#ff5d7a", "#4cc9f0"];

export class Board {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private state: GameState | null = null;
  private selected: number | null = null;
  private hint: Move | null = null;
  private rects: Rect[] = [];
  private flies: Fly[] = [];
  private sparks: Spark[] = [];
  private floaters: Floater[] = [];
  private lanterns: Lantern[] = [];
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
  private raf = 0;
  private tap: ((index: number) => void) | null = null;
  private hidden = new Map<string, number>();
  private pourGen = 0;
  private pourTimers: number[] = [];
  private pourResolve: (() => void) | null = null;
  private pourAfter: GameState | null = null;
  private drag: Drag | null = null;

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

  /** Seal celebration; `power` grows with the combo (1..4). */
  burst(index: number, color: number, power = 1): void {
    const r = this.rects.find((x) => x.i === index);
    if (!r) return;
    const p = Math.max(1, Math.min(4, power));
    const hex = PALETTE[(orbColor(color) - 1) % PALETTE.length]!;
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h * 0.42;
    const count = Math.round(26 + p * 10);
    for (let n = 0; n < count; n++) {
      const a = (Math.PI * 2 * n) / count + Math.random() * 0.2;
      const spd = (2 + Math.random() * 2.6) * (0.9 + p * 0.15);
      this.sparks.push({
        x: cx,
        y: cy,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd - 1,
        life: 1,
        color: n % 5 === 0 ? "#fff6d8" : hex,
        size: 1.6 + Math.random() * 2.4,
        decay: 0.016 + Math.random() * 0.01,
        g: 0.06,
      });
    }
    const now = performance.now();
    this.rings.push({ x: cx, y: cy, r0: r.w * 0.3, max: r.w * (1.1 + p * 0.3), life: 1, color: hex, width: 3 + p });
    if (p >= 2) {
      this.rings.push({ x: cx, y: cy, r0: r.w * 0.1, max: r.w * (1.6 + p * 0.4), life: 1.25, color: "#fff3c4", width: 2 });
    }
    this.jarFlash.set(index, { start: now, color: hex });
    this.lidDrop.set(index, now);
    this.quake(2.5 + p * 1.5, 240 + p * 60);
    this.lanterns.push({ x: cx, y: r.y, vy: -1.6, life: 1, color: hex });
  }

  /** Confetti rain plus a few fireworks over the board. */
  celebrate(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w < 8 || h < 8) return;
    const now = performance.now();
    const count = Math.round(Math.min(220, 90 + w * 0.12));
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
        color: PALETTE[n % 6]!,
        life: 1,
      });
    }
    for (let k = 0; k < 4; k++) {
      this.fireworks.push({
        at: now + k * 230,
        x: w * (0.22 + ((k * 0.37) % 0.6)),
        y: h * (0.2 + (k % 2) * 0.18),
        color: PALETTE[(k * 3) % 6]!,
      });
    }
    this.quake(5, 420);
  }

  private explode(x: number, y: number, color: string): void {
    for (let n = 0; n < 34; n++) {
      const a = (Math.PI * 2 * n) / 34;
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
    this.rings.push({ x, y, r0: 4, max: 70, life: 1, color, width: 3 });
  }

  private splash(x: number, y: number, hex: string, orb: number): void {
    for (let n = 0; n < 9; n++) {
      const a = -Math.PI / 2 + (n - 4) * 0.32;
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
    for (let n = 0; n < 14; n++) {
      const a = (Math.PI * 2 * n) / 14 + Math.random() * 0.3;
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
    this.shards = [];
    this.floaters = [];
    this.lanterns = [];
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
        round(ctx, r.x - 6, r.y - 8, r.w + 12, r.h + 14, 18);
        ctx.stroke();
      }
    }
    const run = topRun(jar, false);
    const value = jar[jar.length - 1]!;
    ctx.save();
    ctx.globalAlpha = 0.92;
    for (let k = Math.min(run, 4) - 1; k >= 0; k--) {
      this.drawOrb(drag.x, drag.y - orb * 1.4 - k * orb * 0.5, value, orb, true, now);
    }
    ctx.restore();
  }

  private loop(): void {
    try {
      this.draw(performance.now());
    } catch {
      /* one bad frame must not freeze the board */
    }
    this.raf = requestAnimationFrame(() => this.loop());
  }

  private draw(now: number): void {
    const { canvas, ctx } = this;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w < 8 || h < 8) return;
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
    const m = this.metrics();
    this.rects = [];

    if (now < this.quakeUntil) {
      const k = (this.quakeUntil - now) / this.quakeDur;
      const p = this.quakePower * k * k;
      ctx.translate(Math.sin(now / 15) * p, Math.cos(now / 21) * p * 0.7);
    }

    this.state.jars.forEach((jar, i) => {
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

    let flying = false;
    for (const fly of this.flies) {
      const raw = (now - fly.start) / fly.dur;
      if (raw < 0) {
        flying = true;
        continue;
      }
      const t = Math.max(0, Math.min(1, raw));
      if (t < 1) flying = true;
      const hex = isMystery(fly.color) ? "#d7d2c8" : PALETTE[(orbColor(fly.color) - 1) % PALETTE.length]!;
      if (t < 1) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        for (let k = 1; k <= 4; k++) {
          const tt = t - k * 0.05;
          if (tt <= 0) break;
          const p = this.flyPos(fly, tt);
          ctx.globalAlpha = 0.32 - k * 0.07;
          ctx.fillStyle = hex;
          ctx.beginPath();
          ctx.arc(p.x, p.y, m.orb * (0.85 - k * 0.12), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      } else if (!fly.landed) {
        fly.landed = true;
        this.splash(fly.tx, fly.ty, hex, m.orb);
      }
      const p = this.flyPos(fly, t);
      const scale = 1 + Math.sin(t * Math.PI) * 0.12;
      this.drawOrb(p.x, p.y, fly.color, m.orb * scale, true, now);
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
    ctx.globalCompositeOperation = "lighter";
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const g = this.rings[i]!;
      g.life -= 0.035;
      const life = Math.min(1, g.life);
      if (life <= 0) {
        this.rings.splice(i, 1);
        continue;
      }
      const r = lerp(g.r0, g.max, easeOutCubic(1 - life));
      ctx.globalAlpha = life * 0.85;
      ctx.strokeStyle = g.color;
      ctx.lineWidth = Math.max(0.5, g.width * life);
      ctx.beginPath();
      ctx.arc(g.x, g.y, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i]!;
      s.x += s.vx;
      s.y += s.vy;
      s.vx *= 0.985;
      s.vy += s.g ?? 0.04;
      s.life -= s.decay ?? 0.02;
      if (s.life <= 0) {
        this.sparks.splice(i, 1);
        continue;
      }
      const size = s.size ?? 2.2;
      ctx.fillStyle = s.color;
      ctx.globalAlpha = s.life * 0.28;
      ctx.beginPath();
      ctx.arc(s.x, s.y, size * 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = s.life;
      ctx.beginPath();
      ctx.arc(s.x, s.y, size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    for (let i = this.confetti.length - 1; i >= 0; i--) {
      const c = this.confetti[i]!;
      c.x += c.vx + Math.sin(now / 260 + c.rot) * 0.7;
      c.y += c.vy;
      c.rot += c.vr;
      if (c.y > h * 0.6) c.life -= 0.02;
      if (c.life <= 0 || c.y > h + 20) {
        this.confetti.splice(i, 1);
        continue;
      }
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.rot);
      ctx.scale(1, Math.cos(now / 140 + c.rot * 3));
      ctx.globalAlpha = c.life;
      ctx.fillStyle = c.color;
      ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
      ctx.restore();
    }

    for (let i = this.lanterns.length - 1; i >= 0; i--) {
      const L = this.lanterns[i]!;
      L.y += L.vy;
      L.life -= 0.012;
      ctx.globalAlpha = Math.max(0, L.life);
      ctx.fillStyle = L.color;
      round(ctx, L.x - 7, L.y - 10, 14, 18, 4);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (L.life <= 0) this.lanterns.splice(i, 1);
    }

    for (let i = this.shards.length - 1; i >= 0; i--) {
      const s = this.shards[i]!;
      s.x += s.vx;
      s.y += s.vy;
      s.vy += 0.08;
      s.rot += s.vr;
      s.life -= 0.022;
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

    const base = Math.max(16, m.orb * 0.62);
    ctx.textAlign = "center";
    ctx.lineJoin = "round";
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i]!;
      f.y -= 0.7;
      f.life -= 0.016;
      if (f.life <= 0) {
        this.floaters.splice(i, 1);
        continue;
      }
      const pop = f.life > 0.86 ? 1 + ((f.life - 0.86) / 0.14) * 0.7 : 1;
      ctx.save();
      ctx.font = `800 ${Math.round(base * f.scale * pop)}px Trebuchet MS, sans-serif`;
      ctx.globalAlpha = Math.min(1, f.life * 1.6);
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(14, 8, 28, 0.75)";
      ctx.strokeText(f.text, f.x, f.y);
      ctx.shadowColor = f.color;
      ctx.shadowBlur = 14;
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
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
    for (let i = 0; i < 18; i++) {
      const x = ((i * 89 + now / 80) % (w + 40)) - 20;
      const y = (i * 47) % h;
      ctx.fillStyle = `rgba(255,255,255,${0.1 + (i % 3) * 0.06})`;
      ctx.beginPath();
      ctx.arc(x, y, i % 2 ? 1.2 : 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 16; i++) {
      const speed = 42 + (i % 5) * 16;
      const x = ((i * 97.3) % w) + Math.sin(now / 2400 + i * 1.7) * 22;
      const y = h + 20 - ((now / speed + i * 83) % (h + 40));
      const r = 1.4 + (i % 4) * 0.9;
      const a = 0.22 + (i % 3) * 0.1;
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
    const hinted =
      this.hint && (this.hint.from === index || this.hint.to === index);
    const sealed = isSealed(jar, cap);

    ctx.save();
    if (selected) ctx.translate(0, -(6 + Math.sin(now / 180) * 1.5));

    if (hinted) {
      ctx.strokeStyle = "rgba(228,194,122,0.85)";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      round(ctx, x - 6, y - 8, w + 12, h + 14, 18);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const topValue = jar[jar.length - 1];
    const tint =
      sealed && topValue !== undefined
        ? PALETTE[(orbColor(topValue) - 1) % PALETTE.length]!
        : null;

    const floor = ctx.createRadialGradient(x + w / 2, y + h, 1, x + w / 2, y + h, w * 0.85);
    floor.addColorStop(0, tint ? rgba(tint, 0.5) : selected ? "rgba(228,194,122,0.45)" : "rgba(180,160,255,0.28)");
    floor.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = floor;
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h, w * 0.85, w * 0.26, 0, 0, Math.PI * 2);
    ctx.fill();

    const glass = ctx.createLinearGradient(x, 0, x + w, 0);
    glass.addColorStop(0, "rgba(255,255,255,0.2)");
    glass.addColorStop(0.24, "rgba(255,255,255,0.07)");
    glass.addColorStop(0.7, "rgba(255,255,255,0.06)");
    glass.addColorStop(1, "rgba(255,255,255,0.16)");
    ctx.save();
    if (tint) {
      ctx.shadowColor = tint;
      ctx.shadowBlur = 14 + Math.sin(now / 320 + index) * 5;
    } else if (selected) {
      ctx.shadowColor = "#e4c27a";
      ctx.shadowBlur = 16;
    }
    ctx.fillStyle = glass;
    ctx.strokeStyle = selected
      ? "rgba(255,214,130,0.95)"
      : tint
        ? rgba(tint, 0.85)
        : "rgba(225,218,255,0.55)";
    ctx.lineWidth = selected ? 2.4 : tint ? 2 : 1.4;
    round(ctx, x, y + 10, w, h - 10, 16);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    if (tint) {
      ctx.fillStyle = rgba(tint, 0.14);
      round(ctx, x, y + 10, w, h - 10, 16);
      ctx.fill();
    }

    const flash = this.jarFlash.get(index);
    if (flash) {
      const a = 1 - (now - flash.start) / 650;
      if (a <= 0) this.jarFlash.delete(index);
      else {
        ctx.save();
        ctx.shadowColor = flash.color;
        ctx.shadowBlur = 34 * a;
        ctx.fillStyle = `rgba(255,255,255,${0.32 * a})`;
        ctx.strokeStyle = rgba(flash.color, a);
        ctx.lineWidth = 3;
        round(ctx, x - 2, y + 8, w + 4, h - 6, 18);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }

    ctx.strokeStyle = "rgba(255,255,255,0.26)";
    ctx.lineWidth = Math.max(2, w * 0.06);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x + w * 0.2, y + 28);
    ctx.lineTo(x + w * 0.2, y + h - 20);
    ctx.stroke();
    ctx.lineCap = "butt";

    ctx.beginPath();
    ctx.moveTo(x + 8, y + 18);
    ctx.lineTo(x + w - 8, y + 18);
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,0.14)";
    round(ctx, x + w * 0.18, y, w * 0.64, 16, 6);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.42)";
    ctx.stroke();

    if (sealed) {
      const dropAt = this.lidDrop.get(index);
      let off = 0;
      if (dropAt !== undefined) {
        const t = (now - dropAt) / 420;
        if (t >= 1) this.lidDrop.delete(index);
        else off = -30 * (1 - t) * (1 - t) * Math.abs(Math.cos(t * Math.PI * 2));
      }
      const lid = ctx.createLinearGradient(0, y - 2 + off, 0, y + 10 + off);
      lid.addColorStop(0, "#fff1b8");
      lid.addColorStop(1, "#d9a84a");
      ctx.save();
      ctx.shadowColor = "#ffd166";
      ctx.shadowBlur = 12;
      ctx.fillStyle = lid;
      round(ctx, x + w * 0.12, y - 2 + off, w * 0.76, 12, 4);
      ctx.fill();
      ctx.restore();
    }

    for (let n = 0; n < jar.length; n++) {
      if (this.hidden.has(`${index}:${n}`)) continue;
      const value = jar[n]!;
      const ox = x + w / 2;
      const oy = this.orbY({ i: index, x, y, w, h }, n, orb);
      const run = n >= jar.length - topRun(jar, false);
      this.drawOrb(ox, oy, value, orb, selected && run, now);
    }

    ctx.restore();
  }

  private drawOrb(
    x: number,
    y: number,
    value: number,
    r: number,
    glow = false,
    now = 0,
  ): void {
    const radius = Math.max(4, r);
    const ctx = this.ctx;
    const mystery = isMystery(value);
    const frozen = isFrozen(value);
    const hex = mystery ? "#d7d2c8" : PALETTE[(orbColor(value) - 1) % PALETTE.length]!;
    const coreR = Math.max(3, frozen ? radius * 0.78 : radius);

    ctx.save();
    ctx.shadowColor = frozen ? "#8fdfff" : hex;
    ctx.shadowBlur = glow ? 26 : frozen ? 18 : 16;
    const g = ctx.createRadialGradient(
      x - coreR * 0.25,
      y - coreR * 0.3,
      Math.max(0.2, coreR * 0.1),
      x,
      y,
      coreR,
    );
    g.addColorStop(0, mystery ? "#fff" : "#fff6");
    g.addColorStop(0.35, hex);
    g.addColorStop(1, shade(hex, mystery ? -10 : -26));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, coreR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (mystery && !frozen) {
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(x, y, radius * 0.42, 0.2, 2.2);
      ctx.stroke();
    }

    if (frozen) this.drawIceShell(x, y, radius, iceHits(value), now);

    ctx.fillStyle = "rgba(255,255,255,0.68)";
    ctx.beginPath();
    ctx.ellipse(x - radius * 0.28, y - radius * 0.34, Math.max(0.5, radius * 0.22), Math.max(0.5, radius * 0.12), -0.5, 0, Math.PI * 2);
    ctx.fill();
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

function round(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 1 || h <= 1) {
    ctx.beginPath();
    return;
  }
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `rgb(${r},${g},${b})`;
}
