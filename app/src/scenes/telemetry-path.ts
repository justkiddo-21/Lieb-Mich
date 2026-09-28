// The tether's pen path: the lyric lines laid out in the single-stroke script (stroke.ts) on
// stacked planes of the void, each point stamped with the song time the vocal reaches it, joined by
// looping transits (the knots) between lines. The spark is the pen: pen(t) is a lookup.
import { strokeText, type StrokeText } from '../engine/stroke';
import type { Line } from '../engine/lyrics';
import { clamp, hash, lerp, TAU } from '../engine/util';
import type { V3 } from './orbit-kit';

/** Sample kinds: ink (a letter stroke), hop (pen-up travel between strokes), loop (a transit). */
export const INK = 0, HOP = 1, LOOP = 2;

export interface PenLine {
  line: Line;
  st: StrokeText;
  /** Baseline origin (world), baseline direction u, page-down direction n (in the plane y = layer). */
  o: V3; u: V3; n: V3; theta: number; layer: number;
  /** Sample index range in the path. */
  i0: number; i1: number;
  /** Per-word ink extents in text coords (x0, y0, x1, y1) and times. */
  words: { x0: number; y0: number; x1: number; y1: number; start: number; end: number; w: string }[];
}

export class PenPath {
  t: number[] = [];
  x: number[] = []; y: number[] = []; z: number[] = [];
  kind: number[] = [];
  /** Which line each sample belongs to (-1 for transits). */
  li: number[] = [];
  lines: PenLine[] = [];

  push(t: number, p: V3, kind: number, li: number) {
    const n = this.t.length;
    // times must be strictly increasing for the lookup
    const tt = n > 0 ? Math.max(t, this.t[n - 1]! + 1e-4) : t;
    this.t.push(tt); this.x.push(p[0]); this.y.push(p[1]); this.z.push(p[2]); this.kind.push(kind); this.li.push(li);
  }
  get n() { return this.t.length; }

  /** Index of the last sample at or before t. */
  at(t: number) {
    const T = this.t;
    if (t <= T[0]!) return 0;
    let lo = 0, hi = T.length - 1;
    if (t >= T[hi]!) return hi;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m]! <= t) lo = m; else hi = m; }
    return lo;
  }
  /** The pen at time t (interpolated). */
  pen(t: number): V3 {
    const i = this.at(t), j = Math.min(this.n - 1, i + 1);
    const u = j === i ? 0 : clamp((t - this.t[i]!) / (this.t[j]! - this.t[i]!));
    return [lerp(this.x[i]!, this.x[j]!, u), lerp(this.y[i]!, this.y[j]!, u), lerp(this.z[i]!, this.z[j]!, u)];
  }
  /** World position of text coords (x right, y down) on line k. */
  onLine(k: number, x: number, y: number): V3 {
    const L = this.lines[k]!;
    return [L.o[0] + L.u[0] * x + L.n[0] * y, L.layer, L.o[2] + L.u[2] * x + L.n[2] * y];
  }
}

/** Char → [start, end] times from the word timings (spaces are instantaneous). */
function charTimes(l: Line): [number, number][] {
  const out: [number, number][] = [];
  const text = Array.from(l.text);
  let wi = 0, ci = 0;
  let last = l.start;
  while (ci < text.length) {
    const w = l.words[wi];
    if (!w) { out.push([last, last]); ci++; continue; }
    const wc = Array.from(w.w);
    // skip spaces between words
    if (text[ci] === ' ') { out.push([last, w.start]); ci++; continue; }
    const n = wc.length;
    for (let j = 0; j < n && ci < text.length; j++, ci++) out.push([w.start + ((w.end - w.start) * j) / n, w.start + ((w.end - w.start) * (j + 1)) / n]);
    last = w.end;
    wi++;
  }
  return out;
}

export interface Layout { em: number; theta: number; layer: number; /** offset of this line's start from the previous line's end, in its own (u, n) frame */ off: [number, number] }

/**
 * Build the path. `entry`: [t, point] the spark streaks in from before the first line.
 * `layouts[k]` places line k relative to the end of line k-1 (line 0 at the origin).
 */
export function buildPath(lines: Line[], layouts: Layout[], entry: { t0: number; from: V3 }): PenPath {
  const P = new PenPath();
  let end: V3 = [0, 0, 0];
  let endT = entry.t0;
  lines.forEach((line, k) => {
    const lay = layouts[k]!;
    const st = strokeText(line.text, 'script', lay.em, 0);
    const u: V3 = [Math.cos(lay.theta), 0, Math.sin(lay.theta)];
    const n: V3 = [-Math.sin(lay.theta), 0, Math.cos(lay.theta)];
    // the first stroke's start sits at `off` from the previous line's end
    const f = st.strokes[0]?.[0] ?? { x: 0, y: 0 };
    const s0: V3 = k === 0 ? [0, lay.layer, 0] : [end[0] + u[0] * lay.off[0] + n[0] * lay.off[1], lay.layer, end[2] + u[2] * lay.off[0] + n[2] * lay.off[1]];
    const o: V3 = [s0[0] - u[0] * f.x - n[0] * f.y, lay.layer, s0[2] - u[2] * f.x - n[2] * f.y];
    const ct = charTimes(line);
    const pl: PenLine = { line, st, o, u, n, theta: lay.theta, layer: lay.layer, i0: 0, i1: 0, words: [] };
    const W = (x: number, y: number): V3 => [o[0] + u[0] * x + n[0] * y, lay.layer, o[2] + u[2] * x + n[2] * y];
    const tOf = (s: number, j: number) => {
      const c = st.charOf[s]!;
      const [a, b] = st.charRange[c]!;
      const [t0, t1] = ct[c] ?? [line.end, line.end];
      const L = st.startLen[s]! + st.lens[s]![j]!;
      return t0 + (t1 - t0) * clamp((L - a) / Math.max(1e-3, b - a));
    };
    // transit from the previous end (a loop, a knot) — or the entry streak before line 0
    const tStart = tOf(0, 0);
    const from = k === 0 ? entry.from : end;
    const t0 = k === 0 ? entry.t0 : endT;
    const gap = tStart - t0;
    if (gap > 0.04) {
      const m = Math.max(12, Math.round(gap * 220));
      const loops = k === 0 ? 1 : 1 + Math.round(hash(k, 7) * 1.4);
      const R = (k === 0 ? 420 : 260 + 200 * hash(k, 8)) * (gap > 0.3 ? 1.2 : 1);
      const ph = hash(k, 9) * TAU, dirs = hash(k, 10) > 0.5 ? 1 : -1;
      for (let j = 1; j < m; j++) {
        const a = j / m;
        const e = a * a * (3 - 2 * a);
        const env = Math.sin(Math.PI * a);
        const ang = ph + dirs * TAU * loops * a;
        const p: V3 = [lerp(from[0], s0[0], e) + Math.cos(ang) * R * env, lerp(from[1], s0[1], e), lerp(from[2], s0[2], e) + Math.sin(ang) * R * env];
        P.push(lerp(t0, tStart, a), p, LOOP, k === 0 ? -2 : -1); // -2: the entry streak
      }
    }
    pl.i0 = P.n;
    // strokes smoothed (Catmull-Rom, SUB points per span): the fonts' polylines are coarse up close
    const SUB = 4;
    st.strokes.forEach((pts, s) => {
      const n = pts.length;
      P.push(tOf(s, 0), W(pts[0]!.x, pts[0]!.y), HOP, k);
      for (let j = 0; j < n - 1; j++) {
        const p0 = pts[Math.max(0, j - 1)]!, p1 = pts[j]!, p2 = pts[j + 1]!, p3 = pts[Math.min(n - 1, j + 2)]!;
        const ta = tOf(s, j), tb = tOf(s, j + 1);
        for (let q = 1; q <= SUB; q++) {
          const a = q / SUB, a2 = a * a, a3 = a2 * a;
          const x = 0.5 * (2 * p1.x + (-p0.x + p2.x) * a + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * a2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * a3);
          const y = 0.5 * (2 * p1.y + (-p0.y + p2.y) * a + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * a2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * a3);
          P.push(lerp(ta, tb, a), W(x, y), INK, k);
        }
      }
    });
    pl.i1 = P.n;
    // word extents (for the target boxes)
    let ci = 0;
    const chars = Array.from(line.text);
    for (const w of line.words) {
      while (chars[ci] === ' ') ci++;
      const c0 = ci, c1 = ci + Array.from(w.w).length;
      ci = c1;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      st.strokes.forEach((pts, s) => {
        const c = st.charOf[s]!;
        if (c < c0 || c >= c1) return;
        for (const q of pts) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
      });
      if (x0 < Infinity) pl.words.push({ x0, y0, x1, y1, start: w.start, end: w.end, w: w.w });
    }
    P.lines.push(pl);
    end = [P.x[P.n - 1]!, P.y[P.n - 1]!, P.z[P.n - 1]!];
    endT = P.t[P.n - 1]!;
  });
  return P;
}
