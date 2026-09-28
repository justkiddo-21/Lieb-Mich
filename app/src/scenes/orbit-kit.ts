// Shared kit for the tether sequence (orbit → telemetry): a pinhole camera helper, world →
// screen projection for Canvas2D labels, a stateless time-warp clock (freezes, brakes, surges),
// the Plex Mono karaoke used for the stalking verses, and the crimson spark as 3D LineBatch
// glow. Everything is a pure function of time.
import * as THREE from 'three';
import { Layer2D, W, H, type Compositor } from '../engine/gl';
import type { LineBatch } from '../engine/lines';
import { LIN, rgba } from '../engine/palette';
import { F, font } from '../engine/type';
import { Lyrics, type Line } from '../engine/lyrics';
import { clamp, hash, lerp, noise1, smoothstep, TAU } from '../engine/util';

export type V3 = [number, number, number];
export type RGB = [number, number, number];

export const v3 = {
  add: (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  sc: (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k],
  len: (a: V3) => Math.hypot(a[0], a[1], a[2]),
  norm: (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  lerp: (a: V3, b: V3, k: number): V3 => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)],
  cross: (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  dot: (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
};

/** Rodrigues rotation of v about unit axis k by angle a. */
export const rotAxis = (v: V3, k: V3, a: number): V3 => {
  const c = Math.cos(a), s = Math.sin(a), kv = v3.dot(k, v), x = v3.cross(k, v);
  return [v[0] * c + x[0] * s + k[0] * kv * (1 - c), v[1] * c + x[1] * s + k[1] * kv * (1 - c), v[2] * c + x[2] * s + k[2] * kv * (1 - c)];
};

/** A camera pose: position, look-at target, roll (radians), vertical fov (degrees), and world up. */
export interface Pose { p: V3; tg: V3; roll: number; fov: number; up?: V3 }

export const mixPose = (a: Pose, b: Pose, k: number): Pose => ({
  p: v3.lerp(a.p, b.p, k), tg: v3.lerp(a.tg, b.tg, k), roll: lerp(a.roll, b.roll, k), fov: lerp(a.fov, b.fov, k),
  up: a.up && b.up ? v3.norm(v3.lerp(a.up, b.up, k)) : a.up ?? b.up,
});

/** Aim a perspective camera at a pose. */
export function aim(cam: THREE.PerspectiveCamera, o: Pose) {
  cam.fov = o.fov;
  cam.aspect = W / H;
  cam.position.set(...o.p);
  cam.up.set(...(o.up ?? [0, 1, 0]));
  cam.lookAt(o.tg[0], o.tg[1], o.tg[2]);
  if (o.roll) cam.rotateZ(o.roll);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
  cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
  return cam;
}

const _v = new THREE.Vector3();
/** World → screen px (logical 1920x1080). `z` > 1 or `behind` means not visible. */
export function project(cam: THREE.PerspectiveCamera, p: V3) {
  _v.set(p[0], p[1], p[2]).applyMatrix4(cam.matrixWorldInverse);
  const behind = _v.z > -1e-3;
  const depth = -_v.z;
  _v.applyMatrix4(cam.projectionMatrix);
  return { x: (_v.x * 0.5 + 0.5) * W, y: (0.5 - _v.y * 0.5) * H, depth, behind };
}

/** Pixels per world unit at a given view depth. */
export const pxPerUnit = (cam: THREE.PerspectiveCamera, depth: number) => (H / 2) / (Math.tan((cam.fov * Math.PI) / 360) * Math.max(1e-3, depth));

// ------------------------------------------------------------------ time warp

/**
 * A system clock whose rate is piecewise linear in song time (rate keys [t, rate]); tau(t) is the
 * exact integral, so freezes (rate 0), brakes and surges stay stateless. Before the first key the
 * rate is the first key's rate.
 */
export class Clock {
  private acc: number[] = [];
  constructor(public t0: number, public keys: [number, number][]) {
    let a = 0;
    this.acc.push(0);
    for (let i = 1; i < keys.length; i++) {
      const [ta, ra] = keys[i - 1]!, [tb, rb] = keys[i]!;
      a += ((ra + rb) / 2) * (tb - ta);
      this.acc.push(a);
    }
  }
  rate(t: number) {
    const k = this.keys;
    if (t <= k[0]![0]) return k[0]![1];
    for (let i = 1; i < k.length; i++) {
      if (t <= k[i]![0]) {
        const u = (t - k[i - 1]![0]) / Math.max(1e-6, k[i]![0] - k[i - 1]![0]);
        return lerp(k[i - 1]![1], k[i]![1], u);
      }
    }
    return k[k.length - 1]![1];
  }
  /** System time elapsed since t0. */
  tau(t: number) {
    const k = this.keys;
    const base = (x: number): number => {
      if (x <= k[0]![0]) return (x - k[0]![0]) * k[0]![1];
      for (let i = 1; i < k.length; i++) {
        if (x <= k[i]![0]) {
          const ta = k[i - 1]![0], ra = k[i - 1]![1];
          const r = this.rate(x);
          return this.acc[i - 1]! + ((ra + r) / 2) * (x - ta);
        }
      }
      const last = k[k.length - 1]!;
      return this.acc[k.length - 1]! + (x - last[0]) * last[1];
    };
    return base(t) - base(this.t0);
  }
}

// ------------------------------------------------------------------ the verses in Plex Mono

/** Uppercase clone of a line (same char counts for German: no ß in these lines). */
export function upper(l: Line): Line {
  return { ...l, text: l.text.toUpperCase(), words: l.words.map((w) => ({ ...w, w: w.w.toUpperCase() })) };
}

export interface MonoLyricOpts {
  x: number;
  y: number;
  size?: number;
  align?: CanvasTextAlign;
  alpha?: number;
  /** Prefix a mercury log timestamp and a crimson caret. */
  stamp?: boolean;
  /** Per-frame glitch 0..1: horizontal slice jitter. */
  glitch?: number;
  sung?: string;
  unsung?: string;
}

/**
 * The stalking verses as Plex Mono system-log lines: uppercase, tracked, per-glyph karaoke
 * wipe (bone sung, ash-grey unsung), a crimson caret riding the wipe.
 */
export function monoLyric(c: CanvasRenderingContext2D, line: Line, t: number, o: MonoLyricOpts) {
  const L = upper(line);
  const size = o.size ?? 44;
  const fam = F.mono(500);
  const trk = size * 0.06;
  c.save();
  c.globalAlpha *= o.alpha ?? 1;
  const g = o.glitch ?? 0;
  if (g > 0) c.translate(Math.round((hash(Math.round(t * 30), 3) - 0.5) * 40 * g), 0);
  const r = monoWipe(c, L, t, o.x, o.y, fam, size, trk, o.align ?? 'left', o.sung ?? rgba('bone', 1), o.unsung ?? rgba('bone', 0.22));
  if (o.stamp !== false) {
    c.font = font(F.mono(400), 15);
    c.letterSpacing = '2px';
    c.fillStyle = rgba('mercury', 0.75);
    c.textAlign = 'left';
    c.fillText(`[${line.start.toFixed(2).padStart(6, '0')}]`, r.x0, o.y - size - 14);
    // caret at the end of the sung part
    const on = t >= line.start && t < line.end + 0.3;
    if (on && Math.floor(t * 4) % 2 === 0) {
      c.fillStyle = rgba('crimson', 1);
      c.fillRect(r.x0 + r.width + 10, o.y - size * 0.72, size * 0.5, size * 0.78);
    }
  }
  c.restore();
  return r;
}

const advCache = new Map<string, number>();
/**
 * Karaoke wipe for a monospaced face: every glyph has the same advance, so the sung extent is
 * just chars × (advance + tracking) — no per-glyph layout (cheap enough to run every frame).
 */
function monoWipe(c: CanvasRenderingContext2D, line: Line, t: number, x: number, y: number, fam: string, size: number, trk: number, align: CanvasTextAlign, sung: string, unsung: string) {
  const text = line.text;
  const key = `${fam}|${size.toFixed(2)}`;
  let adv = advCache.get(key);
  c.save();
  c.font = font(fam, size);
  c.letterSpacing = '0px';
  if (adv === undefined) { adv = c.measureText('M').width; advCache.set(key, adv); }
  const n = Array.from(text).length;
  const step = adv + trk;
  const width = n * adv + Math.max(0, n - 1) * trk;
  const x0 = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x;
  c.letterSpacing = `${trk}px`;
  c.textAlign = 'left';
  c.textBaseline = 'alphabetic';
  c.fillStyle = unsung;
  c.fillText(text, x0, y);
  const k = Lyrics.lineCharProgress(line, t);
  if (k > 0) {
    c.beginPath();
    c.rect(x0 - 20, y - size * 1.2, Math.floor(k) * step + (k % 1) * adv + 20, size * 1.6);
    c.clip();
    c.fillStyle = sung;
    c.fillText(text, x0, y);
  }
  c.restore();
  return { x0, width };
}

/**
 * The lyric log: the newest line at (x, y), older lines pushed up a row each (snapping up as the
 * next line comes in) and dimmed, so outgoing and incoming lines never overlap.
 */
export function lyricLog(c: CanvasRenderingContext2D, lines: Line[], t: number, o: MonoLyricOpts & { rows?: number; pitch?: number; lead?: number; tail?: number }) {
  const lead = o.lead ?? 0.3, tail = o.tail ?? 0.5, pitch = o.pitch ?? (o.size ?? 44) * 2.1, rows = o.rows ?? 2;
  const vis = lines.filter((l) => t > l.start - lead && t < l.end + tail + 1.5).sort((a, b) => a.start - b.start);
  for (let i = 0; i < vis.length; i++) {
    const l = vis[i]!;
    // how far this line has been pushed up by the lines after it
    let up = 0;
    for (let j = i + 1; j < vis.length; j++) up += smoothstep(vis[j]!.start - lead, vis[j]!.start - lead + 0.14, t);
    if (up >= rows) continue;
    const aIn = smoothstep(l.start - lead, l.start - lead + 0.12, t);
    const aOut = 1 - smoothstep(l.end + tail, l.end + tail + 0.3, t);
    const a = aIn * aOut * (up > 0 ? lerp(1, 0.32, clamp(up)) * (1 - clamp(up - 1)) : 1);
    if (a <= 0.01) continue;
    monoLyric(c, l, t, { ...o, y: o.y - up * pitch, alpha: (o.alpha ?? 1) * a, stamp: up < 0.5 && o.stamp !== false, size: (o.size ?? 44) * (1 - 0.25 * clamp(up)) });
  }
}

// ------------------------------------------------------------------ the spark (3D)

/** Crimson spark head in a 3D LineBatch (px widths): hot core, glow shells. `k` scales intensity. */
export function sparkHead(b: LineBatch, p: V3, k = 1, size = 1) {
  const [x, y, z] = p;
  const cr = LIN.crimson, em = LIN.ember;
  b.seg(x, y, z, x, y, z, 34 * size, cr[0] * 0.35 * k, cr[1] * 0.35 * k, cr[2] * 0.35 * k, 0.5);
  b.seg(x, y, z, x, y, z, 14 * size, cr[0] * 2.2 * k, cr[1] * 2.2 * k, cr[2] * 2.2 * k, 0.9);
  b.seg(x, y, z, x, y, z, 6 * size, em[0] * 4 * k, em[1] * 3 * k, em[2] * 3 * k, 1);
}

/**
 * A smooth crimson burn in screen space: radial gradients on a quarter-res canvas, composited
 * additively with an HDR gain so it blooms (only crimson is allowed to).
 */
export class Glow {
  layer = new Layer2D(W, H, 0.5);
  private n = 0;
  begin() { this.layer.clear(); this.n = 0; }
  add(x: number, y: number, r: number, a: number) {
    if (a <= 0.003 || r <= 1) return;
    const c = this.layer.ctx;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(217,20,36,${clamp(a)})`);
    g.addColorStop(0.2, `rgba(217,20,36,${clamp(a * 0.6)})`);
    g.addColorStop(0.5, `rgba(217,20,36,${clamp(a * 0.22)})`);
    g.addColorStop(0.8, `rgba(217,20,36,${clamp(a * 0.05)})`);
    g.addColorStop(1, 'rgba(217,20,36,0)');
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
    this.n++;
  }
  draw(r: THREE.WebGLRenderer, comp: Compositor, out: THREE.WebGLRenderTarget, gain = 2.2) {
    if (this.n === 0) return;
    comp.draw(r, this.layer.upload(), out, { mode: 'add', tint: [gain, gain, gain] });
  }
}

/** A soft crimson burn around p: stacked discs approximate a radial falloff (bloom does the rest). */
export function burn(b: LineBatch, p: V3, radiusPx: number, k: number) {
  const cr = LIN.crimson;
  const n = 9;
  for (let i = 1; i <= n; i++) {
    const w = radiusPx * 2 * Math.pow(i / n, 1.6);
    const a = (0.16 * k) / (0.6 + i * 0.25);
    b.seg(p[0], p[1], p[2], p[0], p[1], p[2], w, cr[0] * a * 3, cr[1] * a * 3, cr[2] * a * 3, 1);
  }
}

/**
 * Stateless sparks shed by a moving head: particle i is born at tau_i on the head's path `at(tau)`,
 * flies off with a hashed velocity and drag, and is drawn as a streak over `streak` s of its
 * flight (so a frozen clock leaves frozen streaks: a freeze-frame, not dots).
 */
export function sparkShed(b: LineBatch, tau: number, at: (tau: number) => V3, o: { rate?: number; life?: number; speed?: number; streak?: number; k?: number; seed?: number } = {}) {
  const rate = o.rate ?? 60, life = o.life ?? 0.5, speed = o.speed ?? 6, streak = o.streak ?? 0.035, seed = o.seed ?? 5;
  const cr = LIN.crimson;
  const i1 = Math.floor(tau * rate), i0 = Math.ceil((tau - life) * rate);
  for (let i = i0; i <= i1; i++) {
    const tb = i / rate;
    const age = tau - tb;
    if (age < 0 || age > life) continue;
    const h1 = hash(i, seed), h2 = hash(i, seed + 1), h3 = hash(i, seed + 2);
    // random direction on the sphere
    const th = h1 * TAU, cz = h2 * 2 - 1, sz = Math.sqrt(1 - cz * cz);
    const sp = speed * (0.3 + h3);
    const d: V3 = [Math.cos(th) * sz * sp, cz * sp, Math.sin(th) * sz * sp];
    const o0 = at(tb);
    const fly = (a: number) => (1 - Math.exp(-a * 5)) / 5; // drag
    const pa = v3.add(o0, v3.sc(d, fly(Math.max(0, age - streak))));
    const pb = v3.add(o0, v3.sc(d, fly(age)));
    const fade = Math.pow(1 - age / life, 1.5) * (o.k ?? 1);
    b.seg(pa[0], pa[1], pa[2], pb[0], pb[1], pb[2], 1.6, cr[0] * 2.5 * fade, cr[1] * 2.5 * fade, cr[2] * 2.5 * fade, 1);
  }
}

// ------------------------------------------------------------------ misc

/** Deterministic camera shake offset (px) from a 0..1 amount. */
export const shakeXY = (t: number, amt: number, px = 22): [number, number] =>
  amt <= 0 ? [0, 0] : [noise1(t * 43, 71) * px * amt, noise1(t * 41, 73) * px * amt];

/** 1 right at t0, springing down over `dur` (a hard hit envelope). */
export const hitEnv = (t: number, t0: number, dur = 0.35) => (t < t0 || t > t0 + dur * 4 ? 0 : Math.exp(-(t - t0) / dur * 3));

/** The breath monitor (apnea callback): a thin bone trace in a box; `still` 0..1 flattens it, `spike` jags it. */
export function breathTrace(c: CanvasRenderingContext2D, t: number, tau: number, x: number, y: number, w: number, h: number, o: { still: number; spike: number; alpha?: number; label?: string }) {
  c.save();
  c.globalAlpha *= o.alpha ?? 1;
  c.strokeStyle = rgba('bone', 0.9);
  c.lineWidth = 1.25;
  c.beginPath();
  const n = 120;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const s = tau - (1 - u) * 1.6; // the trace scrolls with the system clock: it stops when time stops
    let v = Math.sin(s * TAU * 0.9) * 0.35 + noise1(s * 7, 4) * 0.12;
    v *= 1 - o.still;
    const jag = o.spike * (hash(Math.floor(u * 60), Math.floor(t * 30)) * 2 - 1) * smoothstep(0.55, 1, u);
    v += jag * 1.6;
    const px = x + u * w, py = y + h / 2 - clamp(v, -1.4, 1.4) * h * 0.4;
    if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
  }
  c.stroke();
  if (o.label) {
    c.font = font(F.mono(400), 13);
    c.letterSpacing = '2px';
    c.fillStyle = rgba('mercury', 0.8);
    c.fillText(o.label, x, y - 8);
  }
  c.restore();
}
