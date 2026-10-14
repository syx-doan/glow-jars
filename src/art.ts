/**
 * Static artwork for the board. Everything here is painted once into an offscreen sprite and then
 * blitted, so the detailed 3D look costs one drawImage per frame instead of gradients and blurs.
 */

export type Sprite = { image: CanvasImageSource; w: number; h: number; ox: number; oy: number };
export type Face = "open" | "happy" | "blink" | "sleep" | "cold";

export const MYSTERY_HEX = "#d8d3e8";
const INK = "#2a1636";
const TAU = Math.PI * 2;

/* ---------- color ---------- */

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1, 7), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

export function rgba(hex: string, a: number): string {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

function mix(a: string, b: string, t: number): string {
  const x = rgb(a);
  const y = rgb(b);
  const c = (i: number) => Math.round(x[i]! + (y[i]! - x[i]!) * t).toString(16).padStart(2, "0");
  return `#${c(0)}${c(1)}${c(2)}`;
}

export const lighten = (hex: string, t: number) => mix(hex, "#ffffff", t);
export const darken = (hex: string, t: number) => mix(hex, "#000000", t);

/* ---------- shapes ---------- */

export function rimRy(w: number): number {
  return Math.max(3, w * 0.1);
}

function bottomRadius(w: number, h: number): number {
  return Math.max(4, Math.min(w * 0.42, (h - 12) / 2));
}

/** Jar body: open cylinder from the rim line (y + 12) down to a rounded, bubbly bottom. */
export function jarPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const top = y + 12;
  const rb = bottomRadius(w, h);
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.arcTo(x, y + h, x + w, y + h, rb);
  ctx.arcTo(x + w, y + h, x + w, top, rb);
  ctx.lineTo(x + w, top);
  ctx.closePath();
}

/** Same outline without the top edge, so the rim ellipse reads as the opening. */
function jarOutline(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const top = y + 12;
  const rb = bottomRadius(w, h);
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.arcTo(x, y + h, x + w, y + h, rb);
  ctx.arcTo(x + w, y + h, x + w, top, rb);
  ctx.lineTo(x + w, top);
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
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

/** Four-point twinkle ✦. */
function sparklePath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  const k = r * 0.14;
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.quadraticCurveTo(cx + k, cy - k, cx + r, cy);
  ctx.quadraticCurveTo(cx + k, cy + k, cx, cy + r);
  ctx.quadraticCurveTo(cx - k, cy + k, cx - r, cy);
  ctx.quadraticCurveTo(cx - k, cy - k, cx, cy - r);
  ctx.closePath();
}

function star5Path(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    const rr = k % 2 ? r * 0.45 : r;
    ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  ctx.closePath();
}

function heartPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy + s * 0.75);
  ctx.bezierCurveTo(cx - s * 1.25, cy - s * 0.05, cx - s * 0.6, cy - s * 1.05, cx, cy - s * 0.42);
  ctx.bezierCurveTo(cx + s * 0.6, cy - s * 1.05, cx + s * 1.25, cy - s * 0.05, cx, cy + s * 0.75);
  ctx.closePath();
}

/* ---------- sprite baking ---------- */

/** Paints into an offscreen canvas at `dpr`, then swaps in a GPU-resident ImageBitmap when ready. */
export function bake(
  w: number,
  h: number,
  dpr: number,
  ox: number,
  oy: number,
  paint: (ctx: CanvasRenderingContext2D) => void,
): Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(w * dpr));
  canvas.height = Math.max(1, Math.ceil(h * dpr));
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  paint(ctx);
  const sprite: Sprite = { image: canvas, w: canvas.width / dpr, h: canvas.height / dpr, ox, oy };
  if (typeof createImageBitmap === "function") {
    createImageBitmap(canvas).then(
      (bmp) => {
        sprite.image = bmp;
      },
      () => undefined,
    );
  }
  return sprite;
}

export function freeSprite(sprite: Sprite): void {
  if (typeof ImageBitmap !== "undefined" && sprite.image instanceof ImageBitmap) sprite.image.close();
}

/* ---------- orbs ---------- */

function paintFace(ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number, face: Face): void {
  const ex = R * 0.32;
  const ey = cy + R * 0.04;
  const er = Math.max(0.9, R * 0.11);
  ctx.save();
  ctx.fillStyle = "rgba(255,105,150,0.42)";
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + s * R * 0.56, cy + R * 0.3, R * 0.15, R * 0.085, 0, 0, TAU);
    ctx.fill();
  }
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(1, R * 0.075);
  for (const s of [-1, 1]) {
    const x = cx + s * ex;
    ctx.beginPath();
    if (face === "happy") {
      ctx.arc(x, ey + er * 0.55, er * 1.15, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
    } else if (face === "blink" || face === "sleep") {
      ctx.arc(x, ey - er * 0.5, er * 1.1, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
    } else {
      ctx.arc(x, ey, er, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(x - er * 0.32, ey - er * 0.36, er * 0.42, 0, TAU);
      ctx.fill();
      ctx.fillStyle = INK;
    }
  }
  const my = cy + R * 0.25;
  ctx.beginPath();
  if (face === "happy") {
    ctx.arc(cx, my - R * 0.05, R * 0.15, 0, Math.PI);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#ff8fae";
    ctx.beginPath();
    ctx.ellipse(cx, my + R * 0.05, R * 0.07, R * 0.035, 0, 0, TAU);
    ctx.fill();
  } else if (face === "sleep") {
    ctx.arc(cx, my, Math.max(0.8, R * 0.05), 0, TAU);
    ctx.stroke();
  } else if (face === "cold") {
    ctx.moveTo(cx - R * 0.13, my);
    ctx.quadraticCurveTo(cx - R * 0.065, my - R * 0.07, cx, my);
    ctx.quadraticCurveTo(cx + R * 0.065, my + R * 0.07, cx + R * 0.13, my);
    ctx.stroke();
  } else {
    ctx.arc(cx, my - R * 0.07, R * 0.11, Math.PI * 0.2, Math.PI * 0.8);
    ctx.stroke();
  }
  ctx.restore();
}

/** Small specular used live on frozen orbs, above the animated ice shell. */
export function paintHighlight(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  ctx.fillStyle = "rgba(255,255,255,0.68)";
  ctx.beginPath();
  ctx.ellipse(x - radius * 0.28, y - radius * 0.34, Math.max(0.5, radius * 0.22), Math.max(0.5, radius * 0.12), -0.5, 0, TAU);
  ctx.fill();
}

export type OrbLook = { mystery: boolean; frozen: boolean; glow: boolean; face: Face | null };

/** Glossy candy sphere: deep shade, bounce light from below, rim light, soft specular, face. */
export function orbSprite(hex: string, radius: number, look: OrbLook, dpr: number): Sprite {
  const blur = look.glow ? 11 : look.frozen ? 7 : 5;
  const half = radius + blur * 1.6 + 3;
  return bake(half * 2, half * 2, dpr, half, half, (ctx) => {
    const cx = half;
    const cy = half;
    const R = Math.max(3, look.frozen ? radius * 0.78 : radius);

    ctx.save();
    ctx.shadowColor = look.frozen ? "#8fdfff" : look.glow ? lighten(hex, 0.3) : hex;
    ctx.shadowBlur = blur * dpr;
    const body = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.42, R * 0.04, cx, cy, R * 1.02);
    body.addColorStop(0, lighten(hex, 0.78));
    body.addColorStop(0.3, lighten(hex, 0.22));
    body.addColorStop(0.68, hex);
    body.addColorStop(1, darken(hex, 0.4));
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.clip();
    const bounce = ctx.createRadialGradient(cx, cy + R * 0.8, 0, cx, cy + R * 0.8, R * 0.75);
    bounce.addColorStop(0, rgba(lighten(hex, 0.6), 0.6));
    bounce.addColorStop(1, rgba(hex, 0));
    ctx.fillStyle = bounce;
    ctx.fillRect(cx - R, cy, R * 2, R);
    ctx.restore();

    ctx.strokeStyle = rgba(lighten(hex, 0.7), 0.5);
    ctx.lineWidth = Math.max(0.8, R * 0.07);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.86, Math.PI * 0.2, Math.PI * 0.8);
    ctx.stroke();

    if (look.face) paintFace(ctx, cx, cy, R, look.face);

    ctx.save();
    ctx.translate(cx - R * 0.36, cy - R * 0.46);
    ctx.rotate(-0.6);
    ctx.scale(1, 0.56);
    const spec = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 0.36);
    spec.addColorStop(0, "rgba(255,255,255,0.92)");
    spec.addColorStop(0.6, "rgba(255,255,255,0.42)");
    spec.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = spec;
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.36, 0, TAU);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.beginPath();
    ctx.arc(cx + R * 0.06, cy - R * 0.62, Math.max(0.6, R * 0.06), 0, TAU);
    ctx.fill();

    if (look.glow) {
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      sparklePath(ctx, cx + R * 0.55, cy - R * 0.58, R * 0.32);
      ctx.fill();
    }
  });
}

/* ---------- jars ---------- */

/** Behind the orbs: ground shadow, colored floor glow, dark interior, back half of the rim. */
export function jarBackSprite(w: number, h: number, tint: string | null, selected: boolean, dpr: number): Sprite {
  const P = Math.max(14, w * 0.45);
  return bake(w + P * 2, h + P * 2, dpr, P, P, (ctx) => {
    ctx.translate(P, P);
    ctx.fillStyle = "rgba(0,0,0,0.32)";
    ctx.beginPath();
    ctx.ellipse(w / 2, h + 2, w * 0.5, w * 0.1, 0, 0, TAU);
    ctx.fill();

    const floor = ctx.createRadialGradient(w / 2, h, 1, w / 2, h, w * 0.85);
    floor.addColorStop(0, tint ? rgba(tint, 0.5) : selected ? "rgba(228,194,122,0.42)" : "rgba(170,150,255,0.24)");
    floor.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = floor;
    ctx.beginPath();
    ctx.ellipse(w / 2, h, w * 0.85, w * 0.26, 0, 0, TAU);
    ctx.fill();

    const inner = ctx.createLinearGradient(0, 12, 0, h);
    inner.addColorStop(0, "rgba(16,12,34,0.42)");
    inner.addColorStop(1, tint ? rgba(tint, 0.24) : "rgba(120,100,220,0.16)");
    jarPath(ctx, 0, 0, w, h);
    ctx.fillStyle = inner;
    ctx.fill();

    const ry = rimRy(w);
    ctx.fillStyle = "rgba(12,8,28,0.6)";
    ctx.beginPath();
    ctx.ellipse(w / 2, 12, w / 2 - 1.5, ry, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.ellipse(w / 2, 12, w / 2 - 1.5, ry, 0, Math.PI, TAU);
    ctx.stroke();
  });
}

/** In front of the orbs: glass sheen, outline, highlight streaks, front half of the rim. */
export function jarFrontSprite(w: number, h: number, tint: string | null, selected: boolean, dpr: number): Sprite {
  const P = 4;
  return bake(w + P * 2, h + P * 2, dpr, P, P, (ctx) => {
    ctx.translate(P, P);
    const top = 12;
    const ry = rimRy(w);
    const rb = bottomRadius(w, h);

    const sheen = ctx.createLinearGradient(0, 0, w, 0);
    sheen.addColorStop(0, "rgba(255,255,255,0.22)");
    sheen.addColorStop(0.2, "rgba(255,255,255,0.06)");
    sheen.addColorStop(0.55, "rgba(255,255,255,0)");
    sheen.addColorStop(0.82, "rgba(255,255,255,0.05)");
    sheen.addColorStop(1, "rgba(255,255,255,0.18)");
    jarPath(ctx, 0, 0, w, h);
    ctx.fillStyle = sheen;
    ctx.fill();
    if (tint) {
      ctx.fillStyle = rgba(tint, 0.1);
      ctx.fill();
    }

    ctx.lineJoin = "round";
    jarOutline(ctx, 2.2, 1.5, w - 4.4, h - 3.7);
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.lineWidth = 1;
    ctx.stroke();

    jarOutline(ctx, 0, 0, w, h);
    ctx.strokeStyle = selected ? "rgba(255,214,130,0.95)" : tint ? rgba(lighten(tint, 0.35), 0.95) : "rgba(230,224,255,0.62)";
    ctx.lineWidth = selected ? 2.4 : tint ? 2.2 : 1.6;
    ctx.stroke();

    const hx = w * 0.17;
    const y0 = top + ry + 6;
    const y1 = Math.max(y0 + 4, h - rb * 0.55);
    const streak = ctx.createLinearGradient(0, y0, 0, y1);
    streak.addColorStop(0, "rgba(255,255,255,0.6)");
    streak.addColorStop(1, "rgba(255,255,255,0.08)");
    ctx.strokeStyle = streak;
    ctx.lineWidth = Math.max(2.5, w * 0.075);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(hx, y0);
    ctx.lineTo(hx, y1);
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.beginPath();
    ctx.arc(hx, Math.min(h - 6, y1 + w * 0.09), Math.max(1.2, w * 0.035), 0, TAU);
    ctx.fill();

    ctx.strokeStyle = "rgba(255,255,255,0.2)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(w * 0.86, y0 + 4);
    ctx.lineTo(w * 0.86, top + (h - top) * 0.45);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = Math.max(1.5, w * 0.035);
    ctx.beginPath();
    ctx.arc(w / 2, h - rb, Math.max(2, rb - w * 0.08), Math.PI * 0.2, Math.PI * 0.55);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255,255,255,0.78)";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.ellipse(w / 2, top, w / 2 - 1.5, ry, 0, 0, Math.PI);
    ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,0.9)";
    sparklePath(ctx, w * 0.3, y0 + 4, Math.max(2.5, w * 0.065));
    ctx.fill();
  });
}

/** Soft glow hugging the outside of the jar; drawn with a pulsing alpha. */
export function haloSprite(w: number, h: number, color: string, dpr: number): Sprite {
  const P = 22;
  return bake(w + P * 2, h + P * 2, dpr, P, P, (ctx) => {
    ctx.translate(P, P);
    ctx.shadowColor = color;
    ctx.shadowBlur = 16 * dpr;
    jarPath(ctx, 0, 0, w, h);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.globalCompositeOperation = "destination-out";
    jarPath(ctx, 0, 0, w, h);
    ctx.fill();
  });
}

/** Rounded lid in the jar's color with a gold knob and a star sticker. */
export function lidSprite(w: number, tint: string, dpr: number): Sprite {
  const P = 14 + w * 0.15;
  return bake(w + P * 2, 20 + P * 2, dpr, P, P, (ctx) => {
    ctx.translate(P, P);
    const ry = rimRy(w) * 0.95;
    const lx = -w * 0.05;
    const lw = w * 1.1;
    const by = 2;
    const bh = 12;

    ctx.save();
    ctx.shadowColor = rgba(tint, 0.8);
    ctx.shadowBlur = 8 * dpr;
    const band = ctx.createLinearGradient(0, by, 0, by + bh);
    band.addColorStop(0, lighten(tint, 0.45));
    band.addColorStop(0.5, tint);
    band.addColorStop(1, darken(tint, 0.22));
    ctx.fillStyle = band;
    roundRect(ctx, lx, by, lw, bh, 5);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = rgba(darken(tint, 0.35), 0.8);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    roundRect(ctx, lx + 3, by + 2, lw - 6, 3, 1.5);
    ctx.fill();

    const dome = ctx.createRadialGradient(w / 2 - lw * 0.15, by - ry * 0.4, 1, w / 2, by, lw / 2);
    dome.addColorStop(0, lighten(tint, 0.7));
    dome.addColorStop(1, lighten(tint, 0.25));
    ctx.fillStyle = dome;
    ctx.beginPath();
    ctx.ellipse(w / 2, by, lw / 2, ry, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = rgba(darken(tint, 0.25), 0.7);
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.beginPath();
    ctx.ellipse(w / 2 - lw * 0.18, by - ry * 0.25, lw * 0.16, ry * 0.32, 0, 0, TAU);
    ctx.fill();

    const kr = Math.max(2.5, w * 0.075);
    const ky = by - ry * 0.35 - kr * 0.6;
    const knob = ctx.createRadialGradient(w / 2 - kr * 0.35, ky - kr * 0.4, 0.5, w / 2, ky, kr);
    knob.addColorStop(0, "#fff6cf");
    knob.addColorStop(0.5, "#f2b84b");
    knob.addColorStop(1, "#c98a2a");
    ctx.fillStyle = knob;
    ctx.beginPath();
    ctx.arc(w / 2, ky, kr, 0, TAU);
    ctx.fill();

    ctx.fillStyle = "rgba(255,255,255,0.92)";
    star5Path(ctx, w / 2, by + bh / 2 + 0.5, Math.max(2.5, bh * 0.32));
    ctx.fill();
  });
}

/* ---------- effect sprites (fixed size, scaled on draw) ---------- */

export function starSprite(color: string): Sprite {
  return bake(32, 32, 2, 16, 16, (ctx) => {
    const glow = ctx.createRadialGradient(16, 16, 0, 16, 16, 12);
    glow.addColorStop(0, rgba(color, 0.5));
    glow.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 32, 32);
    const core = ctx.createRadialGradient(16, 16, 0, 16, 16, 15);
    core.addColorStop(0, "#ffffff");
    core.addColorStop(0.35, lighten(color, 0.5));
    core.addColorStop(1, color);
    ctx.fillStyle = core;
    sparklePath(ctx, 16, 16, 15);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(16, 16, 2.2, 0, TAU);
    ctx.fill();
  });
}

export function heartSprite(color: string): Sprite {
  return bake(32, 32, 2, 16, 16, (ctx) => {
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    const fill = ctx.createRadialGradient(12, 11, 1, 16, 16, 14);
    fill.addColorStop(0, lighten(color, 0.6));
    fill.addColorStop(0.5, color);
    fill.addColorStop(1, darken(color, 0.15));
    ctx.fillStyle = fill;
    heartPath(ctx, 16, 17, 10);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.beginPath();
    ctx.ellipse(11.5, 12, 2.6, 1.6, -0.6, 0, TAU);
    ctx.fill();
  });
}

/** Vertical light column rising from a freshly sealed jar. */
export function beamSprite(color: string): Sprite {
  return bake(40, 160, 2, 0, 0, (ctx) => {
    const col = ctx.createLinearGradient(0, 160, 0, 0);
    col.addColorStop(0, rgba(color, 0.85));
    col.addColorStop(0.5, rgba(color, 0.35));
    col.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = col;
    ctx.fillRect(0, 0, 40, 160);
    const core = ctx.createLinearGradient(0, 160, 0, 0);
    core.addColorStop(0, "rgba(255,255,255,0.9)");
    core.addColorStop(0.8, "rgba(255,255,255,0)");
    ctx.fillStyle = core;
    ctx.fillRect(15, 0, 10, 160);
    ctx.globalCompositeOperation = "destination-in";
    const mask = ctx.createLinearGradient(0, 0, 40, 0);
    mask.addColorStop(0, "rgba(0,0,0,0)");
    mask.addColorStop(0.5, "rgba(0,0,0,1)");
    mask.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = mask;
    ctx.fillRect(0, 0, 40, 160);
  });
}
