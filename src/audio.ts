let ctx: AudioContext | null = null;
let muted = false;

function ac(): AudioContext | null {
  if (muted) return null;
  if (!ctx) {
    const C = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!C) return null;
    ctx = new C();
  }
  return ctx;
}

export function setMuted(value: boolean): void {
  muted = value;
  if (value && ctx) void ctx.suspend();
  else if (ctx) void ctx.resume();
}

export function unlockAudio(): void {
  const c = ac();
  if (c?.state === "suspended") void c.resume();
}

function beep(freq: number, dur: number, type: OscillatorType, gain = 0.045): void {
  const c = ac();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(gain, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
  o.connect(g);
  g.connect(c.destination);
  o.start();
  o.stop(c.currentTime + dur);
}

export const sfx = {
  tap: () => beep(520, 0.06, "triangle", 0.03),
  pour: () => {
    beep(420, 0.09, "sine", 0.04);
    beep(640, 0.12, "triangle", 0.025);
  },
  error: () => beep(180, 0.14, "square", 0.03),
  /** `step` raises the pitch a semitone per combo level. */
  seal: (step = 0) => {
    const k = Math.pow(2, Math.min(12, step) / 12);
    beep(523 * k, 0.12, "sine", 0.045);
    setTimeout(() => beep(659 * k, 0.12, "sine", 0.04), 60);
    setTimeout(() => beep(784 * k, 0.22, "triangle", 0.04), 120);
  },
  win: () => {
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.16, "sine", 0.045), i * 95));
    setTimeout(() => {
      beep(1047, 0.42, "triangle", 0.045);
      beep(1319, 0.42, "sine", 0.03);
    }, 400);
    [1568, 2093, 1760, 2349].forEach((f, i) => setTimeout(() => beep(f, 0.08, "sine", 0.018), 560 + i * 70));
  },
  coin: () => beep(880, 0.1, "triangle", 0.03),
  crack: () => {
    beep(310, 0.08, "square", 0.025);
    beep(720, 0.1, "triangle", 0.03);
  },
  reveal: () => beep(990, 0.12, "sine", 0.035),
  combo: (n = 2) => {
    const k = Math.pow(2, Math.min(12, (n - 2) * 2) / 12);
    beep(660 * k, 0.08, "sine", 0.04);
    setTimeout(() => beep(880 * k, 0.1, "triangle", 0.04), 70);
    setTimeout(() => beep(1320 * k, 0.16, "sine", 0.03), 140);
  },
};
