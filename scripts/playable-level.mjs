// Picks a medium-difficulty layout for the HTML5 playable ad (same pour rules as src/engine.ts).
// Usage: node scripts/playable-level.mjs [colors=4] [empty=2] [tries=4000]
const COLORS = Number(process.argv[2] ?? 4);
const EMPTY = Number(process.argv[3] ?? 2);
const TRIES = Number(process.argv[4] ?? 4000);
const CAP = 4;

const key = (jars) => jars.map((j) => j.join("")).join("|");
const topRun = (j) => {
  let n = 0;
  for (let i = j.length - 1; i >= 0 && j[i] === j[j.length - 1]; i--) n++;
  return n;
};
const sealed = (j) => j.length === CAP && topRun(j) === CAP;
const solved = (jars) => jars.every((j) => j.length === 0 || sealed(j));

function amount(jars, a, b) {
  const s = jars[a], d = jars[b];
  if (a === b || !s.length || d.length >= CAP || sealed(s)) return 0;
  const run = topRun(s);
  const c = s[s.length - 1];
  if (d.length && d[d.length - 1] !== c) return 0;
  if (!d.length && run === s.length) return 0;
  return Math.min(run, CAP - d.length);
}

function moves(jars) {
  const out = [];
  for (let a = 0; a < jars.length; a++)
    for (let b = 0; b < jars.length; b++) {
      const n = amount(jars, a, b);
      if (!n) continue;
      const next = jars.map((j) => j.slice());
      for (let i = 0; i < n; i++) next[b].push(next[a].pop());
      out.push(next);
    }
  return out;
}

/** BFS over the full state graph: optimal length + share of reachable states that can no longer win. */
function analyse(start) {
  const seen = new Map([[key(start), { jars: start, d: 0, prev: [] }]]);
  const queue = [start];
  const goals = [];
  let optimal = -1;
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    const k0 = key(cur);
    const node = seen.get(k0);
    if (solved(cur)) {
      goals.push(k0);
      if (optimal < 0) optimal = node.d;
      continue;
    }
    for (const n of moves(cur)) {
      const k = key(n);
      let child = seen.get(k);
      if (!child) {
        child = { jars: n, d: node.d + 1, prev: [] };
        seen.set(k, child);
        queue.push(n);
      }
      child.prev.push(k0);
      if (seen.size > 60000) return null;
    }
  }
  if (optimal < 0) return null;
  const win = new Set(goals);
  const stack = [...goals];
  while (stack.length) {
    for (const p of seen.get(stack.pop()).prev) if (!win.has(p)) (win.add(p), stack.push(p));
  }
  const dead = 1 - win.size / seen.size;
  let deadDepth = Infinity;
  for (const [k, v] of seen) if (!win.has(k)) deadDepth = Math.min(deadDepth, v.d);
  let wins = 0;
  for (let t = 0; t < 400; t++) {
    let cur = start;
    for (let s = 0; s < 60 && !solved(cur); s++) {
      const opts = moves(cur);
      if (!opts.length) break;
      cur = opts[Math.floor(Math.random() * opts.length)];
    }
    if (solved(cur)) wins++;
  }
  return { optimal, states: seen.size, dead, deadDepth, random: wins / 400 };
}

function randomLayout() {
  const bag = [];
  for (let c = 1; c <= COLORS; c++) for (let i = 0; i < CAP; i++) bag.push(c);
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  const jars = [];
  for (let c = 0; c < COLORS; c++) jars.push(bag.slice(c * CAP, c * CAP + CAP));
  for (let e = 0; e < EMPTY; e++) jars.push([]);
  return jars;
}

const picks = [];
for (let t = 0; t < TRIES && picks.length < 8; t++) {
  const jars = randomLayout();
  if (jars.some((j) => j.length && topRun(j) >= 3)) continue;
  if (jars.some((j) => j.length && j[j.length - 1] === j[j.length - 2])) continue;
  const r = analyse(jars);
  if (!r) continue;
  // A first-time player must survive their first few guesses.
  if (r.deadDepth < 3) continue;
  if (r.optimal >= 10 && r.optimal <= 13 && r.dead >= 0.08 && r.dead <= 0.35 && r.random >= 0.15 && r.random <= 0.5) {
    picks.push({ jars, ...r });
  }
}
for (const p of picks) {
  console.log(JSON.stringify(p.jars), `optimal=${p.optimal} states=${p.states} dead=${(p.dead * 100).toFixed(0)}% deadAfter=${p.deadDepth} random=${(p.random * 100).toFixed(0)}%`);
}
if (!picks.length) console.log("no layout matched — loosen the filters");
