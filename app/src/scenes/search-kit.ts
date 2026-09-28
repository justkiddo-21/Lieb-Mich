// Shared helpers for search / raven / climax / flatline: a small CPU perspective projector (so
// scenes can whip the camera in yaw, do screen-space partings and draw into a 2D LineBatch with
// perspective-scaled widths), beat-grid springs, and a yaw-free LIDAR terrain grid.
import { W, H } from '../engine/gl';
import type { LineBatch } from '../engine/lines';
import { LIN } from '../engine/palette';
import type { AudioData } from '../engine/audio';
import { clamp, smoothstep, springStep, TAU } from '../engine/util';
import { terrain, type RGB } from './_motifs';

/** Bone kept under the bloom threshold (the revised treatment: bone never glows). */
export const BONE: RGB = [LIN.bone[0] * 0.84, LIN.bone[1] * 0.84, LIN.bone[2] * 0.84];
export const MERC: RGB = [LIN.mercury[0] * 0.9, LIN.mercury[1] * 0.9, LIN.mercury[2] * 0.9];
export const ASH: RGB = [LIN.ash[0] * 2.2, LIN.ash[1] * 2.2, LIN.ash[2] * 2.2];
export const CRIM = (k = 1): RGB => [LIN.crimson[0] * k, LIN.crimson[1] * k, LIN.crimson[2] * k];
export const mul = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];

export interface CamPose { x: number; y: number; z: number; yaw?: number; pitch?: number; roll?: number; fov?: number }

/**
 * Perspective projector. World: y up. yaw 0 looks down +z; positive pitch looks up. Screen: logical
 * px, y down. After `p()`, `sx, sy` are the screen point, `d` its depth, `k` = px per world unit there.
 */
export class Cam {
  x = 0; y = 0; z = 0;
  private rx = 1; private ry = 0; private rz = 0;
  private ux = 0; private uy = 1; private uz = 0;
  /** Forward vector. */
  fx = 0; fy = 0; fz = 1;
  foc = 1;
  near = 4;
  sx = 0; sy = 0; d = 0; k = 0;
  cx = W / 2; cy = H / 2;
  set(o: CamPose) {
    this.x = o.x; this.y = o.y; this.z = o.z;
    const yaw = o.yaw ?? 0, pitch = o.pitch ?? 0, roll = o.roll ?? 0;
    const cp = Math.cos(pitch), sp = Math.sin(pitch), cyw = Math.cos(yaw), syw = Math.sin(yaw);
    this.fx = syw * cp; this.fy = sp; this.fz = cyw * cp;
    let rx = cyw, ry = 0, rz = -syw;
    // up = f x r
    let ux = this.fy * rz - this.fz * ry, uy = this.fz * rx - this.fx * rz, uz = this.fx * ry - this.fy * rx;
    const cr = Math.cos(roll), sr = Math.sin(roll);
    const rx2 = rx * cr + ux * sr, ry2 = ry * cr + uy * sr, rz2 = rz * cr + uz * sr;
    ux = ux * cr - rx * sr; uy = uy * cr - ry * sr; uz = uz * cr - rz * sr;
    rx = rx2; ry = ry2; rz = rz2;
    this.rx = rx; this.ry = ry; this.rz = rz; this.ux = ux; this.uy = uy; this.uz = uz;
    this.foc = (H / 2) / Math.tan(((o.fov ?? 60) * Math.PI) / 360);
    return this;
  }
  /** Project; false when behind the near plane. */
  p(x: number, y: number, z: number) {
    const dx = x - this.x, dy = y - this.y, dz = z - this.z;
    const d = dx * this.fx + dy * this.fy + dz * this.fz;
    this.d = d;
    if (d < this.near) return false;
    const k = this.foc / d;
    this.k = k;
    this.sx = this.cx + (dx * this.rx + dy * this.ry + dz * this.rz) * k;
    this.sy = this.cy - (dx * this.ux + dy * this.uy + dz * this.uz) * k;
    return true;
  }
  /** On screen (with a margin)? Call after p(). */
  on(m = 60) { return this.sx > -m && this.sx < W + m && this.sy > -m && this.sy < H + m; }
}

/** A 3D segment through the projector into a 2D batch. Width in world units (min `minW` px). */
export function seg3(b: LineBatch, cam: Cam, ax: number, ay: number, az: number, bx: number, by: number, bz: number, w: number, c: RGB, a: number, minW = 0.8, maxW = 60) {
  if (!cam.p(ax, ay, az)) return;
  const x0 = cam.sx, y0 = cam.sy, k0 = cam.k;
  if (!cam.p(bx, by, bz)) return;
  const ww = clamp(w * (k0 + cam.k) * 0.5, minW, maxW);
  b.seg(x0, y0, 0, cam.sx, cam.sy, 0, ww, c[0], c[1], c[2], a);
}

/** Sum of damped spring steps, one per event time before t (each step has height `h`). */
export function springs(t: number, times: number[], h = 1, freq = 5, damp = 0.45) {
  let v = 0;
  for (const ti of times) { if (ti > t) break; v += h * springStep(t - ti, freq, damp); }
  return v;
}

/** Index of the last time <= t (-1 if none). `times` ascending. */
export function lastIdx(times: number[], t: number) {
  let lo = 0, hi = times.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (times[m]! <= t) lo = m + 1; else hi = m; }
  return lo - 1;
}

/** Strong kicks (strength > s) in [t0, t1). */
export const kicks = (au: AudioData, t0: number, t1: number, s = 0.3) => au.events('kick', t0, t1).filter((e) => e[1] > s).map((e) => e[0]);
export const snares = (au: AudioData, t0: number, t1: number, s = 0.3) => au.events('snare', t0, t1).filter((e) => e[1] > s).map((e) => e[0]);

/** Shake vector from a decaying hit (deterministic jitter). */
export const shakeOf = (t: number, amp: number): [number, number] => [Math.sin(t * 91.7) * amp, Math.cos(t * 77.3) * amp * 0.8];

export interface LidarOpts {
  step?: number;
  /** Half extent of the grid (world units) around the look point. */
  reach?: number;
  flat?: number;
  color?: RGB;
  alpha?: number;
  size?: number;
  /** World distance (from the camera, along the ground) of a scan ring front; lights points near it. */
  scanR?: number;
  scanColor?: RGB;
  /** Linear scan front: points whose (x,z)·dir ≈ scanD light up. */
  scanDir?: [number, number];
  scanD?: number;
  fog?: number;
  /** Extra height displacement. */
  lift?: (x: number, z: number) => number;
  /** Ash contour lines joining the returns along each row (0 = none). */
  rows?: number;
}

/** LIDAR terrain returns around the camera's view (works at any yaw): dots, brighter on crests. */
export function lidar(b: LineBatch, cam: Cam, o: LidarOpts = {}) {
  const step = o.step ?? 26, reach = o.reach ?? 1500;
  const col = o.color ?? BONE, sc = o.scanColor ?? CRIM(2.4);
  const fog = o.fog ?? reach * 1.2;
  // centre the grid ahead of the camera
  const hx = cam.fx, hz = cam.fz;
  const hl = Math.hypot(hx, hz) || 1;
  const cx = cam.x + (hx / hl) * reach * 0.85, cz = cam.z + (hz / hl) * reach * 0.85;
  const i0 = Math.floor((cx - reach) / step), i1 = Math.ceil((cx + reach) / step);
  const j0 = Math.floor((cz - reach) / step), j1 = Math.ceil((cz + reach) / step);
  const size = o.size ?? 1.5, al = o.alpha ?? 1;
  const rows = o.rows ?? 0;
  for (let j = j0; j <= j1; j++) {
    const z = j * step;
    let pv = false, px = 0, py = 0, pf = 0;
    for (let i = i0; i <= i1; i++) {
      const x = i * step;
      const y = terrain(x, z, o.flat ?? 0) + (o.lift ? o.lift(x, z) : 0);
      if (!cam.p(x, y, z)) { pv = false; continue; }
      const d = cam.d;
      const f = (1 - smoothstep(fog * 0.35, fog, d)) * smoothstep(step * 1.2, step * 5, d);
      if (rows > 0 && pv && f > 0.02 && j % 2 === 0) {
        const ff = Math.min(f, pf) * rows;
        if (Math.abs(cam.sx - px) < 300) b.seg(px, py, 0, cam.sx, cam.sy, 0, 1, ASH[0] * 3, ASH[1] * 3, ASH[2] * 3, ff);
      }
      pv = true; px = cam.sx; py = cam.sy; pf = f;
      if (!cam.on(10)) continue;
      if (f < 0.02) continue;
      const k = (0.4 + 0.6 * smoothstep(-30, 40, y)) * f;
      let s = 0;
      if (o.scanR !== undefined) s = Math.exp(-Math.abs(Math.hypot(x - cam.x, z - cam.z) - o.scanR) / 26);
      if (o.scanD !== undefined && o.scanDir) s = Math.max(s, Math.exp(-Math.abs(x * o.scanDir[0] + z * o.scanDir[1] - o.scanD) / 24));
      const w = clamp(size * cam.k, 0.9, 5) * (1 + s * 0.6);
      const r = col[0] * k * (1 - s) + sc[0] * s, g = col[1] * k * (1 - s) + sc[1] * s, bl = col[2] * k * (1 - s) + sc[2] * s;
      b.seg(cam.sx, cam.sy, 0, cam.sx, cam.sy, 0, w, r, g, bl, al * clamp(f * 1.3 + s));
    }
  }
}

/** Ring (circle in the XZ plane at height y) through the projector. */
export function ring3(b: LineBatch, cam: Cam, cx: number, y: number, cz: number, r: number, w: number, c: RGB, a: number, n = 72, a0 = 0, a1 = TAU) {
  for (let i = 0; i < n; i++) {
    const u0 = a0 + ((a1 - a0) * i) / n, u1 = a0 + ((a1 - a0) * (i + 1)) / n;
    seg3(b, cam, cx + Math.cos(u0) * r, y, cz + Math.sin(u0) * r, cx + Math.cos(u1) * r, y, cz + Math.sin(u1) * r, w, c, a);
  }
}
