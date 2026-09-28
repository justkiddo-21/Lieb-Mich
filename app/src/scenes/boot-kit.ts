// Shared helpers for boot_seq (the apnea plate) and panther (the hunt plate): a pinhole camera
// with an explicit basis (so any pose, including straight down and rolled, is well defined) that
// also projects points to screen px for the 2D overlay; typed Plex Mono karaoke with row wrapping;
// kick-counted springs for stateless punch-ins. Everything is a pure function of time.
import * as THREE from 'three';
import { W, H } from '../engine/gl';
import { rgba } from '../engine/palette';
import { F, font } from '../engine/type';
import type { Line } from '../engine/lyrics';
import type { AudioData } from '../engine/audio';
import { clamp, lerp, springStep } from '../engine/util';

export type V3 = [number, number, number];
export const v3 = {
  add: (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  sc: (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k],
  dot: (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  norm: (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  lerp: (a: V3, b: V3, k: number): V3 => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)],
};

export interface Pose {
  p: V3;
  look: V3;
  /** Roll about the view axis (radians, positive = clockwise on screen). */
  roll?: number;
  /** Vertical field of view (degrees). */
  fov?: number;
}

/** A perspective camera posed from (position, look-at, roll, fov), with a matching CPU projection. */
export class Cam {
  cam = new THREE.PerspectiveCamera(40, W / H, 1, 30000);
  p: V3 = [0, 0, 0];
  f: V3 = [0, 0, -1];
  r: V3 = [1, 0, 0];
  u: V3 = [0, 1, 0];
  /** px per unit of (lateral / depth) at the screen centre. */
  k = 1;
  private m = new THREE.Matrix4();
  constructor(near = 1, far = 30000) { this.cam.near = near; this.cam.far = far; }
  set(o: Pose) {
    const f = v3.norm(v3.sub(o.look, o.p));
    const up0: V3 = Math.abs(f[1]) > 0.995 ? [0, 0, 1] : [0, 1, 0];
    let r = v3.norm(v3.cross(f, up0));
    let u = v3.cross(r, f);
    const a = o.roll ?? 0;
    if (a) {
      const c = Math.cos(a), s = Math.sin(a);
      const r2: V3 = [r[0] * c - u[0] * s, r[1] * c - u[1] * s, r[2] * c - u[2] * s];
      u = [r[0] * s + u[0] * c, r[1] * s + u[1] * c, r[2] * s + u[2] * c];
      r = r2;
    }
    this.p = o.p; this.f = f; this.r = r; this.u = u;
    const fov = o.fov ?? 40;
    this.k = H / 2 / Math.tan((fov * Math.PI) / 360);
    const cam = this.cam;
    cam.fov = fov;
    cam.aspect = W / H;
    this.m.makeBasis(new THREE.Vector3(...r), new THREE.Vector3(...u), new THREE.Vector3(-f[0], -f[1], -f[2]));
    cam.quaternion.setFromRotationMatrix(this.m);
    cam.position.set(...o.p);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    return this;
  }
  /** Screen px (x right, y down) of a world point; `z` = depth along the view axis (<= near: behind). */
  proj(x: number, y: number, z: number) {
    const dx = x - this.p[0], dy = y - this.p[1], dz = z - this.p[2];
    const d = dx * this.f[0] + dy * this.f[1] + dz * this.f[2];
    const sx = dx * this.r[0] + dy * this.r[1] + dz * this.r[2];
    const sy = dx * this.u[0] + dy * this.u[1] + dz * this.u[2];
    const iz = d > 1e-3 ? 1 / d : 0;
    return { x: W / 2 + sx * this.k * iz, y: H / 2 - sy * this.k * iz, z: d };
  }
  /** Is a point inside the view frustum (with a margin in NDC units)? */
  sees(x: number, y: number, z: number, margin = 0.1) {
    const q = this.proj(x, y, z);
    return q.z > this.cam.near && q.x > -W * margin && q.x < W * (1 + margin) && q.y > -H * margin && q.y < H * (1 + margin);
  }
}

// ------------------------------------------------------------------ time helpers

/** Kick onsets in [t0, t1). */
export const kicksIn = (au: AudioData, t0: number, t1: number) => au.events('kick', t0, t1).map((e) => e[0]);

/** Number of kicks in [t0, t] (a stepped counter for punch-ins). */
export const kickCount = (au: AudioData, t0: number, t: number) => au.events('kick', t0, t + 1e-6).length;

/** Sum of damped spring steps, one per event time before t (stateless punch-ins that overshoot). */
export function springs(times: number[], t: number, freq = 5, damping = 0.45) {
  let s = 0;
  for (const e of times) if (t >= e) s += springStep(t - e, freq, damping);
  return s;
}

/** Decaying pulse from the most recent event before t. */
export function lastPulse(times: number[], t: number, hl = 0.1) {
  let v = 0;
  for (const e of times) if (t >= e) v = Math.max(v, Math.pow(0.5, (t - e) / hl));
  return v;
}

/** Index of the last event at or before t (-1 if none). */
export function lastIndex(times: number[], t: number) {
  let k = -1;
  for (let i = 0; i < times.length; i++) if (times[i]! <= t) k = i;
  return k;
}

// ------------------------------------------------------------------ typed karaoke (Plex Mono)

/** Uppercase without changing the string length (German ß stays one glyph). */
export const upper = (s: string) => Array.from(s).map((ch) => (ch === 'ß' ? 'ẞ' : ch.toUpperCase())).join('');

/** Break text into rows at spaces, at most `maxChars` per row; returns rows with their char offset. */
export function wrapRows(text: string, maxChars: number) {
  const words = text.split(' ');
  const rows: { s: string; off: number }[] = [];
  let cur = '', off = 0, pos = 0;
  for (const w of words) {
    if (cur && cur.length + 1 + w.length > maxChars) { rows.push({ s: cur, off }); cur = ''; }
    if (!cur) { cur = w; off = pos; } else cur += ' ' + w;
    pos += w.length + 1;
  }
  if (cur) rows.push({ s: cur, off });
  return rows;
}

export interface TypedOpts {
  size: number;
  align?: 'left' | 'center' | 'right';
  weight?: number;
  /** Row wrap width in characters (default: no wrap). */
  wrap?: number;
  lineGap?: number;
  /** Opacity of the not-yet-sung characters (0 hides them: pure typing). */
  dim?: number;
  color?: string;
  cursor?: boolean;
  /** Cursor colour. */
  cursorColor?: string;
  upper?: boolean;
  alpha?: number;
  tracking?: number;
  /** Fill a void plate behind the rows (padding in px) so lines crossing the text never cut it. */
  plate?: number;
  plateAlpha?: number;
}

/**
 * A lyric line typed out in IBM Plex Mono: every character appears when it is sung (never ahead of
 * the voice: each word types over the first 60% of its sung time), unsung characters optionally shown dim, a crimson block
 * cursor after the last typed character. Returns the laid-out box (x0, y of first baseline, width,
 * rows, char advance) for attaching brackets and leaders.
 */
export function typed(c: CanvasRenderingContext2D, line: Line, t: number, x: number, y: number, o: TypedOpts) {
  const text = o.upper ? upper(line.text) : line.text;
  const fam = F.mono(o.weight ?? 400);
  c.save();
  c.font = font(fam, o.size);
  const tr = o.tracking ?? 0;
  c.letterSpacing = `${tr}px`;
  const adv = c.measureText('M').width + tr;
  const rows = o.wrap ? wrapRows(text, o.wrap) : [{ s: text, off: 0 }];
  const gap = o.lineGap ?? o.size * 1.3;
  const widest = Math.max(...rows.map((r) => r.s.length)) * adv - tr;
  const x0 = o.align === 'center' ? x - widest / 2 : o.align === 'right' ? x - widest : x;
  // each word types out over the first 60% of its sung time: never ahead of the voice, and a held
  // last word ("liegen…") is complete before a cut can land in its tail
  let n = 0;
  for (const w of line.words) {
    const p = clamp((t - w.start) / Math.max(0.05, (w.end - w.start) * 0.6));
    n += Math.floor(p * w.w.length + 1e-4);
    if (p < 1) break;
    n += 1; // the space
  }
  n = Math.min(n, text.length);
  c.globalAlpha *= o.alpha ?? 1;
  c.textAlign = 'left';
  c.textBaseline = 'alphabetic';
  const col = o.color ?? rgba('bone', 1);
  if (o.plate !== undefined) {
    const pd = o.plate;
    c.fillStyle = rgba('void', o.plateAlpha ?? 0.92);
    c.fillRect(x0 - pd, y - o.size * 0.82 - pd * 0.6, widest + adv + pd * 2, (rows.length - 1) * gap + o.size * 1.1 + pd * 1.2);
  }
  let cx = -1, cy = 0;
  rows.forEach((r, i) => {
    const yy = y + i * gap;
    const k = clamp(n - r.off, 0, r.s.length);
    if ((o.dim ?? 0) > 0 && k < r.s.length) {
      c.fillStyle = rgba('bone', o.dim!);
      c.fillText(r.s.slice(k), x0 + k * adv, yy);
    }
    if (k > 0) {
      c.fillStyle = col;
      c.fillText(r.s.slice(0, k), x0, yy);
    }
    if (n >= r.off && n <= r.off + r.s.length) { cx = x0 + k * adv; cy = yy; }
  });
  if (o.cursor !== false && cx >= 0 && n < text.length + 1) {
    const blink = n >= text.length ? (Math.floor(t * 3) % 2 === 0 ? 1 : 0) : 1;
    c.fillStyle = o.cursorColor ?? rgba('crimson', 1);
    c.globalAlpha *= blink;
    c.fillRect(cx + 2, cy - o.size * 0.74, adv * 0.62, o.size * 0.86);
  }
  c.restore();
  return { x0, y, width: widest, rows: rows.length, gap, adv, n, len: text.length };
}

/** Small mono label (Plex Mono caps). */
export function tag(c: CanvasRenderingContext2D, s: string, x: number, y: number, o: { size?: number; color?: string; align?: CanvasTextAlign; weight?: number; tracking?: number; alpha?: number } = {}) {
  c.save();
  c.globalAlpha *= o.alpha ?? 1;
  c.font = font(F.mono(o.weight ?? 400), o.size ?? 13);
  c.letterSpacing = `${o.tracking ?? 2}px`;
  c.textAlign = o.align ?? 'left';
  c.textBaseline = 'alphabetic';
  c.fillStyle = o.color ?? rgba('mercury', 0.8);
  c.fillText(s, x, y);
  c.restore();
}

/** Corner brackets of a box (x, y, w, h) with arm length `a`. */
export function brackets(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, a: number) {
  c.beginPath();
  c.moveTo(x, y + a); c.lineTo(x, y); c.lineTo(x + a, y);
  c.moveTo(x + w - a, y); c.lineTo(x + w, y); c.lineTo(x + w, y + a);
  c.moveTo(x + w, y + h - a); c.lineTo(x + w, y + h); c.lineTo(x + w - a, y + h);
  c.moveTo(x + a, y + h); c.lineTo(x, y + h); c.lineTo(x, y + h - a);
  c.stroke();
}
