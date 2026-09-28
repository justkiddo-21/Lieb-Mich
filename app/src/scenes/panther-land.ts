// panther's LIDAR land: a world-anchored grid of terrain returns (the shared `terrain()` height
// field, so it matches the search plate) around any camera pose, frustum-culled, drawn as crisp
// px-sized dots with an ash survey grid laid over the ground. Modes: a sun sweeping across the
// slopes (the time-lapse), thermal (heat ramp toward the target, crimson blooms), night (sparse
// mercury), and speed streaks (each return smeared back along the camera's velocity).
import { LIN } from '../engine/palette';
import type { LineBatch } from '../engine/lines';
import { clamp, hash, lerp, smoothstep } from '../engine/util';
import { mulRGB, terrain } from './_motifs';
import type { Cam, V3 } from './boot-kit';

export interface LandOpts {
  step?: number;
  /** Half-size of the gridded square (world units). */
  radius?: number;
  flat?: number;
  /** Overall brightness of the returns. */
  bright?: number;
  /** Unit vector toward the sun, and how much the sun shades the slopes (0 = flat lighting). */
  sun?: V3;
  sunK?: number;
  /** Ambient in sun mode (night floor). */
  ambient?: number;
  /** 0..1 thermal ramp; the heat source (the target). */
  thermal?: number;
  heat?: V3;
  /** 0..1 night: sparse, dim mercury. */
  night?: number;
  /** World-space smear per return (camera velocity x exposure), for speed streaks. */
  streak?: V3;
  /** Ash grid every n cells (0 = none) and its brightness. */
  grid?: number;
  gridK?: number;
  /** Distance from the camera of a scan front (lights up a band). */
  scan?: number;
  far?: number;
  /** Daylight band sweeping over the ground: lit where a < (x·dir) < b (soft edges), else `dark`. */
  band?: { dir: [number, number]; a: number; b: number; soft: number; dark: number };
}

const BONE = mulRGB(LIN.bone, 0.78);
const ASH = LIN.ash;

export function land(ink: LineBatch, glow: LineBatch, C: Cam, o: LandOpts = {}) {
  const step = o.step ?? 24, R = o.radius ?? 1500, flat = o.flat ?? 0;
  const far = o.far ?? R * 1.6;
  // centre the square ahead of the camera on the ground
  const fh = Math.hypot(C.f[0], C.f[2]);
  const ahead = fh > 0.2 ? R * 0.8 : 0;
  const cx0 = C.p[0] + (fh > 1e-3 ? (C.f[0] / fh) * ahead : 0), cz0 = C.p[2] + (fh > 1e-3 ? (C.f[2] / fh) * ahead : 0);
  const n = Math.ceil((2 * R) / step);
  const i0 = Math.floor((cx0 - R) / step), j0 = Math.floor((cz0 - R) / step);
  const hgt = new Float32Array((n + 1) * (n + 1)).fill(NaN);
  const sx = new Float32Array((n + 1) * (n + 1));
  const bright = o.bright ?? 1;
  const night = o.night ?? 0, thermal = o.thermal ?? 0;
  const grid = o.grid ?? 0;
  const tanX = Math.tan(((C.cam.fov * Math.PI) / 360)) * (C.cam.aspect) * 1.25, tanY = Math.tan((C.cam.fov * Math.PI) / 360) * 1.3;
  for (let j = 0; j <= n; j++) {
    const z = (j0 + j) * step;
    for (let i = 0; i <= n; i++) {
      const x = (i0 + i) * step;
      // cheap cull at mid height before evaluating the terrain
      const dx = x - C.p[0], dy = 5 - C.p[1], dz = z - C.p[2];
      const d = dx * C.f[0] + dy * C.f[1] + dz * C.f[2];
      if (d < 4 || d > far) continue;
      const lx = dx * C.r[0] + dy * C.r[1] + dz * C.r[2], ly = dx * C.u[0] + dy * C.u[1] + dz * C.u[2];
      const slack = 70 / d;
      if (Math.abs(lx / d) > tanX + slack || Math.abs(ly / d) > tanY + slack) continue;
      const y = terrain(x, z, flat);
      const k = j * (n + 1) + i;
      hgt[k] = y;
      sx[k] = d;
    }
  }
  const heat = o.heat;
  for (let j = 0; j <= n; j++) {
    const z = (j0 + j) * step;
    for (let i = 0; i <= n; i++) {
      const k = j * (n + 1) + i;
      const y = hgt[k]!;
      if (Number.isNaN(y)) continue;
      const x = (i0 + i) * step, d = sx[k]!;
      const rr = Math.hypot(x - cx0, z - cz0) / R; // round scan footprint, no square edge
      const fog = (1 - smoothstep(far * 0.45, far, d)) * smoothstep(step * 0.8, step * 4, d) * (1 - smoothstep(0.7, 1, rr));
      if (fog <= 0.01) continue;
      const h = hash(i0 + i, j0 + j);
      if (night > 0 && h < night * 0.55) continue; // night: sparse returns
      let e = (0.42 + 0.58 * smoothstep(-30, 42, y)) * fog * bright;
      if (o.sun && (o.sunK ?? 0) > 0) {
        const yx = terrain(x + step, z, flat), yz = terrain(x, z + step, flat);
        const nx = -(yx - y), nz = -(yz - y), ny = step;
        const nl = Math.hypot(nx, ny, nz);
        const lam = Math.max(0, (nx * o.sun[0] + ny * o.sun[1] + nz * o.sun[2]) / nl);
        e *= lerp(1, (o.ambient ?? 0.08) + 1.35 * lam, o.sunK!);
      }
      if (o.band) {
        const B = o.band, xs = x * B.dir[0] + z * B.dir[1];
        const lit = smoothstep(B.a - B.soft, B.a + B.soft, xs) * (1 - smoothstep(B.b - B.soft, B.b + B.soft, xs));
        e *= lerp(B.dark, 1.3, lit) + 0.9 * Math.exp(-Math.abs(xs - B.b) / 40) * lit; // a bright terminator edge
      }
      if (o.scan !== undefined) e += 1.2 * Math.exp(-Math.abs(d - o.scan) / 26) * fog;
      const w = clamp(1500 / d, 1.1, 3.4) * (1 + 0.25 * (h - 0.5));
      let rgb = mulRGB(BONE, e);
      let bloomy = false;
      if (thermal > 0) {
        // heat: crests warm, and a hot halo around the target
        let q = 0.25 + 0.55 * smoothstep(-20, 45, y);
        if (heat) q += 1.4 * Math.exp(-Math.hypot(x - heat[0], z - heat[2]) / 260);
        q *= fog;
        const cr = LIN.crimson, bl = LIN.blood;
        const hot = q < 0.5 ? mulRGB(bl, q * 2.6) : q < 1 ? [lerp(bl[0] * 1.3, cr[0] * 1.8, (q - 0.5) * 2), lerp(bl[1], cr[1], (q - 0.5) * 2), lerp(bl[2], cr[2], (q - 0.5) * 2)] as V3 : [cr[0] * (1.8 + 2 * (q - 1)), 0.05 + 0.4 * (q - 1), 0.04 + 0.2 * (q - 1)] as V3;
        rgb = [lerp(rgb[0], hot[0], thermal), lerp(rgb[1], hot[1], thermal), lerp(rgb[2], hot[2], thermal)];
        bloomy = thermal > 0.5;
      }
      if (night > 0) {
        const m = mulRGB(LIN.mercury, 0.55 * e);
        rgb = [lerp(rgb[0], m[0], night), lerp(rgb[1], m[1], night), lerp(rgb[2], m[2], night)];
      }
      const b = bloomy ? glow : ink;
      const sk = o.streak ? 1 - smoothstep(250, 1100, d) : 0;
      if (o.streak && sk > 0.02) {
        const s = o.streak;
        b.seg(x, y, z, x - s[0] * sk, y - s[1] * sk, z - s[2] * sk, w * 0.7, rgb[0] * 0.75, rgb[1] * 0.75, rgb[2] * 0.75, 1);
      } else b.seg(x, y, z, x, y, z, w, rgb[0], rgb[1], rgb[2], 1);
    }
  }
  // the ash survey grid, draped over the ground
  if (grid > 0) {
    const g = mulRGB(ASH, o.gridK ?? 3.5);
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      const k = j * (n + 1) + i, y = hgt[k]!;
      if (Number.isNaN(y)) continue;
      const x = (i0 + i) * step, z = (j0 + j) * step;
      const fog = (1 - smoothstep(far * 0.35, far * 0.9, sx[k]!)) * (1 - smoothstep(0.65, 0.95, Math.hypot(x - cx0, z - cz0) / R));
      if ((j0 + j) % grid === 0 && i < n && !Number.isNaN(hgt[k + 1]!)) ink.seg(x, y, z, x + step, hgt[k + 1]!, z, 1, g[0] * fog, g[1] * fog, g[2] * fog, 1);
      if ((i0 + i) % grid === 0 && j < n && !Number.isNaN(hgt[k + n + 1]!)) ink.seg(x, y, z, x, hgt[k + n + 1]!, z + step, 1, g[0] * fog, g[1] * fog, g[2] * fog, 1);
    }
  }
}
