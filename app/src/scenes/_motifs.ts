// Shared motifs (docs/ENGINE.md): karaoke text, the target lock, the flock (the raven),
// the LIDAR terrain, and the mono telemetry labels. All are pure functions of time.
import * as THREE from 'three';
import { W, H } from '../engine/gl';
import { LIN, rgba } from '../engine/palette';
import { F, font, glyphX, layout } from '../engine/type';
import { Lyrics, type Line, type Word } from '../engine/lyrics';
import type { LineBatch } from '../engine/lines';
import { clamp, ease, fbm2, fract, hash, lerp, noise1, noise2, prog, smoothstep, TAU } from '../engine/util';

export type RGB = [number, number, number];
export const mulRGB = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];

// ------------------------------------------------------------------ karaoke

export interface KaraokeOpts {
  family: string;
  size: number;
  /** 'center' (default) | 'left' | 'right' */
  align?: CanvasTextAlign;
  sung?: string; // css colour of sung glyphs
  unsung?: string; // css colour of glyphs still to come
  tracking?: number;
  /** Fade the whole line in over this many seconds before its first word. */
  lead?: number;
}

/** Draw a lyric line with a per-glyph wipe (sung glyphs in `sung`, the rest in `unsung`). */
export function karaoke(c: CanvasRenderingContext2D, line: Line, t: number, x: number, y: number, o: KaraokeOpts) {
  const text = line.text;
  const L = layout(text, o.family, o.size, o.tracking ?? 0);
  const align = o.align ?? 'center';
  const x0 = align === 'center' ? x - L.width / 2 : align === 'right' ? x - L.width : x;
  const n = Lyrics.lineCharProgress(line, t);
  c.save();
  c.font = font(o.family, o.size);
  c.textAlign = 'left';
  c.textBaseline = 'alphabetic';
  c.letterSpacing = `${o.tracking ?? 0}px`;
  const k = Math.floor(n);
  const cut = glyphX(text, k, o.family, o.size, o.tracking ?? 0);
  c.fillStyle = o.unsung ?? rgba('bone', 0.28);
  c.fillText(text, x0, y);
  // the sung part, plus the partially sung glyph clipped at its fraction
  c.beginPath();
  const g = L.glyphs[k];
  c.rect(x0 - 20, y - L.ascent - 20, cut + (g ? g.w * (n - k) : 0) + 20, L.ascent + L.descent + 40);
  c.clip();
  c.fillStyle = o.sung ?? rgba('bone', 1);
  c.fillText(text, x0, y);
  c.restore();
  return { x0, width: L.width, ascent: L.ascent, descent: L.descent };
}

/** 0..1 visibility of a line: fades in `lead` s before it starts, out `tail` s after it ends. */
export const lineAlpha = (l: Line, t: number, lead = 0.25, tail = 0.35) =>
  Math.min(smoothstep(l.start - lead, l.start, t), 1 - smoothstep(l.end, l.end + tail, t));

/** The words of the lyric lines in a window. */
export const wordsIn = (ly: Lyrics, t0: number, t1: number): Word[] => ly.words.filter((w) => w.start >= t0 && w.start < t1);

// ------------------------------------------------------------------ the target lock

export interface LockOpts {
  /** 0 = searching (wide, loose brackets), 1 = locked (clamped tight, filled centre). */
  lock?: number;
  /** 0..1 beat phase for the heartbeat pulse. */
  beatPhase?: number;
  color?: string;
  alpha?: number;
  label?: string;
}

/** The crimson target lock: four rotating corner brackets that clamp down as `lock` rises. */
export function drawTargetLock(c: CanvasRenderingContext2D, x: number, y: number, r: number, t: number, o: LockOpts = {}) {
  const lock = clamp(o.lock ?? 0);
  const pulse = Math.pow(1 - fract(o.beatPhase ?? 0), 6);
  const col = o.color ?? rgba('crimson', 1);
  const rr = r * lerp(1.45, 1, ease.outCubic(lock)) * (1 + 0.06 * pulse);
  const rot = lerp(t * 0.9 + noise1(t * 0.7, 3) * 0.6, 0, ease.inOutCubic(lock)) + Math.PI / 4 * (1 - lock);
  c.save();
  c.globalAlpha *= o.alpha ?? 1;
  c.translate(x, y);
  c.strokeStyle = col;
  c.fillStyle = col;
  c.lineWidth = 2;
  c.lineCap = 'square';
  // brackets
  c.save();
  c.rotate(rot);
  const arm = rr * 0.42;
  for (let q = 0; q < 4; q++) {
    c.save();
    c.rotate((q * Math.PI) / 2);
    c.beginPath();
    c.moveTo(-rr, -rr + arm); c.lineTo(-rr, -rr); c.lineTo(-rr + arm, -rr);
    c.stroke();
    c.restore();
  }
  c.restore();
  // crosshair ticks (outside the brackets) and the centre dot
  c.lineWidth = 1.5;
  c.beginPath();
  const g0 = rr * 1.15, g1 = rr * 1.45;
  c.moveTo(-g1, 0); c.lineTo(-g0, 0); c.moveTo(g0, 0); c.lineTo(g1, 0);
  c.moveTo(0, -g1); c.lineTo(0, -g0); c.moveTo(0, g0); c.lineTo(0, g1);
  c.stroke();
  const d = lerp(2, 5, lock) * (1 + pulse * 0.8);
  c.beginPath(); c.arc(0, 0, d, 0, TAU); c.fill();
  if (lock > 0.5) {
    c.globalAlpha *= (lock - 0.5) * 2;
    c.lineWidth = 1;
    c.beginPath(); c.arc(0, 0, rr * 0.55, 0, TAU); c.stroke();
  }
  if (o.label) {
    c.font = font(F.mono(500), 13);
    c.letterSpacing = '2px';
    c.textBaseline = 'top';
    c.fillText(o.label, rr + 10, rr + 6);
  }
  c.restore();
}

// ------------------------------------------------------------------ the flock (the raven)

export interface FlockOpts {
  n: number;
  /** Wind speed multiplier (1 = gentle; the second pre-chorus blows harder). */
  wind?: number;
  /** Rectangles the flock parts around: [cx, cy, halfW, halfH]. */
  avoid?: [number, number, number, number][];
  /** Trail length in seconds (streak length). */
  trail?: number;
  color?: RGB;
  width?: number;
  alpha?: number;
  seed?: number;
}

/**
 * Stateless flock: every bird's position is a closed-form function of (id, t) — drifting with
 * the wind, weaving through curl-like noise, swept around the `avoid` rectangles — so any frame
 * can be rendered on its own. Each bird is drawn as a short streak from p(t - trail) to p(t).
 */
export function flock(batch: LineBatch, t: number, o: FlockOpts) {
  const wind = o.wind ?? 1;
  const trail = o.trail ?? 0.09;
  const col = o.color ?? LIN.bone;
  const seed = o.seed ?? 11;
  const pos = (i: number, tt: number) => {
    const h1 = hash(i, seed), h2 = hash(i, seed + 1), h3 = hash(i, seed + 2);
    const speed = (90 + 160 * h3) * wind;
    // wind blows left -> right with a slow gusting swell; birds wrap around the frame
    let x = (h1 * (W + 400) + speed * tt + 40 * Math.sin(tt * 0.6 + h2 * TAU)) % (W + 400) - 200;
    let y = h2 * (H + 200) - 100;
    // one shared wind field (so neighbours stream together): two octaves of noise over x, y and time
    y += 150 * noise2(x * 0.0016, y * 0.0012 + tt * 0.22 * wind, seed) + 45 * noise2(x * 0.005, y * 0.004 + tt * 0.7 * wind, seed + 4);
    x += 50 * noise2(y * 0.003, tt * 0.3, seed + 7);
    for (const [cx, cy, hw, hh] of o.avoid ?? []) {
      // streamlines part around an ellipse: birds inside it are swept out vertically, with a soft edge
      const ex = (x - cx) / (hw + 120), ey = (y - cy) / (hh + 70);
      const d = Math.hypot(ex, ey);
      if (d < 1.4) {
        const k = Math.pow(1 - smoothstep(0, 1.4, d), 0.7) * (hh + 90) * Math.sqrt(Math.max(0, 1 - ex * ex));
        y += (y < cy ? -1 : 1) * k;
      }
    }
    return { x, y };
  };
  for (let i = 0; i < o.n; i++) {
    const a = pos(i, t - trail), b = pos(i, t);
    if (Math.abs(a.x - b.x) > 300 || Math.abs(a.y - b.y) > 60) continue; // wrapped, or swept across a parting this frame
    const k = 0.35 + 0.65 * hash(i, seed + 3);
    batch.seg2(a.x, a.y, b.x, b.y, (o.width ?? 1.1) * (0.6 + k * 0.6), mulRGB(col, k), o.alpha ?? 0.8);
  }
}

// ------------------------------------------------------------------ LIDAR terrain

/** Terrain height (world units) at (x, z); `flat` 0..1 smooths it out to a plane. */
export const terrain = (x: number, z: number, flat = 0) =>
  lerp(38 * fbm2(x * 0.008, z * 0.008, 4, 5) + 16 * noise2(x * 0.03, z * 0.03, 9), 0, flat);

export interface CloudOpts {
  /** Camera travel along +z (world units). */
  camZ: number;
  camY: number;
  camX?: number;
  /** Look pitch (radians, negative = down) and roll. */
  pitch?: number;
  roll?: number;
  flat?: number;
  /** Grid spacing and extent. */
  step?: number;
  cols?: number;
  rows?: number;
  color?: RGB;
  alpha?: number;
  /** Width of each point (world units at 1 unit distance, perspective-scaled). */
  size?: number;
  /** World z of a LIDAR scan front: points near it light up. */
  scan?: number;
  scanColor?: RGB;
}

/** A perspective camera for the LIDAR views. */
export function lidarCamera(o: CloudOpts) {
  const cam = new THREE.PerspectiveCamera(62, W / H, 1, 6000);
  cam.position.set(o.camX ?? 0, o.camY, o.camZ);
  cam.rotation.order = 'YXZ';
  cam.rotation.set(o.pitch ?? -0.2, Math.PI, o.roll ?? 0); // looking down +z
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  return cam;
}

/**
 * The point cloud: a world-anchored grid of points (so it streams past as the camera moves),
 * each drawn as a dot (zero-length segment) in the batch (3D, worldWidth). Rows fade with
 * distance. Returns the camera to render the batch with.
 */
export function pointCloud(batch: LineBatch, o: CloudOpts) {
  const step = o.step ?? 26, cols = o.cols ?? 90, rows = o.rows ?? 110;
  const col = o.color ?? LIN.bone;
  const z0 = Math.floor(o.camZ / step) * step;
  const cx = Math.floor((o.camX ?? 0) / step) * step;
  for (let r = 1; r < rows; r++) {
    const z = z0 + r * step;
    const dz = z - o.camZ;
    // fade out with distance, and in close to the camera (near points would balloon)
    const fog = (1 - smoothstep(rows * step * 0.45, rows * step, dz)) * smoothstep(step * 1.5, step * 7, dz);
    if (fog <= 0.01) continue;
    for (let q = -cols / 2; q < cols / 2; q++) {
      const x = cx + q * step;
      const y = terrain(x, z, o.flat ?? 0);
      // intensity: brighter on crests (LIDAR returns), dim in hollows
      const k = (0.45 + 0.55 * smoothstep(-30, 40, y)) * fog;
      const sc = o.scan === undefined ? 0 : Math.exp(-Math.abs(z - o.scan) / 30);
      const cc = o.scanColor ?? col;
      batch.seg(x, y, z, x, y, z, (o.size ?? 1.4) * (1 + sc), lerp(col[0] * k, cc[0] * 2.2, sc), lerp(col[1] * k, cc[1] * 2.2, sc), lerp(col[2] * k, cc[2] * 2.2, sc), (o.alpha ?? 1) * clamp(fog * 1.4 + sc));
    }
  }
  return lidarCamera(o);
}

// ------------------------------------------------------------------ telemetry

/** Mono telemetry label (IBM Plex Mono, tracked caps). */
export function mono(c: CanvasRenderingContext2D, s: string, x: number, y: number, o: { size?: number; color?: string; align?: CanvasTextAlign; weight?: number; tracking?: number } = {}) {
  c.save();
  c.font = font(F.mono(o.weight ?? 400), o.size ?? 14);
  c.letterSpacing = `${o.tracking ?? 2}px`;
  c.textAlign = o.align ?? 'left';
  c.textBaseline = 'alphabetic';
  c.fillStyle = o.color ?? rgba('bone', 0.7);
  c.fillText(s, x, y);
  c.restore();
}

/** Seconds as a running timer: 00:00:12.48 */
export const clock = (s: number) => {
  const a = Math.max(0, s);
  const h = Math.floor(a / 3600), m = Math.floor(a / 60) % 60, sec = a % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${sec.toFixed(2).padStart(5, '0')}`;
};

/** The faint ash grid (40 px) that the boot sequence powers on; `k` 0..1 reveals it row by row. */
export function ashGrid(c: CanvasRenderingContext2D, k = 1, cell = 60, alpha = 1) {
  if (k <= 0) return;
  c.save();
  c.strokeStyle = rgba('ash', alpha);
  c.lineWidth = 1;
  c.beginPath();
  const cols = Math.ceil(W / cell), rows = Math.ceil(H / cell);
  for (let i = 0; i <= cols; i++) {
    const on = smoothstep(i / cols - 0.1, i / cols + 0.1, k * 1.2);
    if (on <= 0) continue;
    const x = Math.round(i * cell) + 0.5;
    c.moveTo(x, H / 2 - (H / 2) * on); c.lineTo(x, H / 2 + (H / 2) * on);
  }
  for (let j = 0; j <= rows; j++) {
    const on = smoothstep(j / rows - 0.1, j / rows + 0.1, k * 1.2);
    if (on <= 0) continue;
    const y = Math.round(j * cell) + 0.5;
    c.moveTo(W / 2 - (W / 2) * on, y); c.lineTo(W / 2 + (W / 2) * on, y);
  }
  c.stroke();
  c.restore();
}

/** Deterministic erratic target path (the one the reticle hunts): smooth noise, 0..1 in x and y. */
export const erratic = (t: number, seed = 1, speed = 0.35) => ({
  x: 0.5 + 0.34 * noise1(t * speed, seed) + 0.08 * noise1(t * speed * 3.1, seed + 5),
  y: 0.5 + 0.28 * noise1(t * speed, seed + 2) + 0.06 * noise1(t * speed * 2.7, seed + 9),
});

export { prog };
