// Shared pieces of the chorus (chorus_slam.ts): the per-chorus look (palette and energy), the
// slam of uppercase words into a row, and a cached 3D stage (camera, 3D line batch, TextPlanes).
import * as THREE from 'three';
import { W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { LIN, rgba } from '../engine/palette';
import { F, fitSize, font, glyphX, layout } from '../engine/type';
import type { Line, Word } from '../engine/lyrics';
import { clamp, ease, hash, lerp, prog, smoothstep } from '../engine/util';
import { TextPlane, type RGB } from './stack-kit';

export const upper = (s: string) => s.toLocaleUpperCase('de-DE');

/**
 * The look of one chorus (docs/TREATMENT_REVISED.MD, `command`): always the void, bone type,
 * crimson the only colour that glows. l1: clean. l2: crimson words glow, lines stack.
 * sparse (chorus 3 while the bass is out): mercury hairlines. l3: the type breaks the safe areas.
 * l4: maximal — glyphs scatter on the kicks, everything shakes harder.
 */
export interface Look {
  name: 'l1' | 'l2' | 'sparse' | 'l3' | 'l4';
  ink: string; inkLin: RGB; // type colour (css key) and its linear value
  /** 0.3 (sparse) … 1.8 (l4): scales shakes, zooms, overflows, crimson. */
  energy: number;
  /** Archivo weight for the shouts. */
  weight: number;
  /** Type overflow beyond the title-safe width (1 = fits). */
  over: number;
}

const mk = (name: Look['name'], ink: keyof typeof LIN, energy: number, weight: number, over: number): Look =>
  ({ name, ink, inkLin: LIN[ink], energy, weight, over });

export function look(name: Look['name']): Look {
  switch (name) {
    case 'l1': return mk('l1', 'bone', 1, 900, 1);
    case 'l2': return mk('l2', 'bone', 1.25, 900, 1.04);
    case 'sparse': return mk('sparse', 'mercury', 0.3, 300, 0.72);
    case 'l3': return mk('l3', 'bone', 1.5, 900, 1.16);
    case 'l4': return mk('l4', 'bone', 1.8, 900, 1.3);
  }
}

// ------------------------------------------------------------------ slam words

export interface SlamOpts {
  /** Centre of the row. */
  x?: number; y?: number;
  /** Fit width (px) before overflow; the size is fitted to the whole row so it does not jump as words land. */
  fit?: number;
  maxSize?: number;
  width?: number; // Archivo width % (62..125)
  weight?: number;
  tracking?: number;
  color?: string;
  alpha?: number;
  /** Scale a landing word starts from. */
  from?: number;
  /** Scatter glyphs by this many px (l4 on the kicks). */
  scatter?: number;
  /** Show words before they are sung (as ghosts at this alpha); 0 = only once sung. */
  ghost?: number;
  seed?: number;
}

export interface SlamWord { w: Word; x0: number; x1: number; text: string }
export interface SlamResult { size: number; base: number; ascent: number; words: SlamWord[]; family: string; x0: number; width: number }

/** Slam uppercase words into one centred row, each landing (scale from `from` → 1) at its start. */
export function slam(c: CanvasRenderingContext2D, words: Word[], t: number, o: SlamOpts = {}): SlamResult {
  const text = upper(words.map((w) => w.w).join(' '));
  const fam = F.archivo(o.width ?? 100, o.weight ?? 900);
  const tr = o.tracking ?? 0;
  const size = Math.min(o.maxSize ?? 560, fitSize(text, fam, o.fit ?? W * 0.9, 900, tr));
  const lay = layout(text, fam, size, tr);
  const x0 = (o.x ?? W / 2) - lay.width / 2;
  const cy = o.y ?? H / 2;
  const base = cy + lay.ascent * 0.36;
  const out: SlamWord[] = [];
  c.save();
  c.font = font(fam, size);
  c.letterSpacing = `${tr}px`;
  c.textBaseline = 'alphabetic';
  c.fillStyle = rgba(o.color ?? 'bone', 1);
  let ci = 0;
  words.forEach((w, wi) => {
    const up = upper(w.w);
    const n = Array.from(up).length;
    const xa = x0 + glyphX(text, ci, fam, size, tr), xb = x0 + glyphX(text, ci + n, fam, size, tr);
    ci += n + 1;
    out.push({ w, x0: xa, x1: xb, text: up });
    const k = prog(t, w.start - 0.03, w.start + 0.13, ease.outExpo);
    const ghost = o.ghost ?? 0;
    if (k <= 0 && ghost <= 0) return;
    c.save();
    c.globalAlpha = (o.alpha ?? 1) * (k > 0 ? smoothstep(0, 0.3, k) : ghost);
    const s = k > 0 ? lerp(o.from ?? 1.45, 1, k) : 1;
    const cx = (xa + xb) / 2;
    c.translate(cx, cy); c.scale(s, s); c.translate(-cx, -cy);
    if (o.scatter && k > 0) {
      const g = layout(up, fam, size, tr);
      for (const gl of g.glyphs) {
        const j = o.scatter;
        c.fillText(gl.ch, xa + gl.x + (hash(gl.i, wi, o.seed ?? 0, Math.floor(t * 8)) - 0.5) * j, base + (hash(gl.i, wi, 9, Math.floor(t * 8)) - 0.5) * j);
      }
    } else c.fillText(up, xa, base);
    c.restore();
  });
  c.restore();
  return { size, base, ascent: lay.ascent, words: out, family: fam, x0, width: lay.width };
}

/** Draw a box behind a slammed word (destination-over: under the type already drawn). */
export function boxBehind(c: CanvasRenderingContext2D, r: SlamResult, sw: SlamWord, color: string, pad: number) {
  c.save();
  c.globalCompositeOperation = 'destination-over';
  c.fillStyle = color;
  c.fillRect(sw.x0 - pad, r.base - r.ascent * 0.74 - pad, sw.x1 - sw.x0 + pad * 2, r.ascent * 0.74 + pad * 2);
  c.restore();
}

// ------------------------------------------------------------------ the 3D stage

/** A perspective camera, a 3D line batch and cached TextPlanes, rendered into the scene's target. */
export class Stage {
  scene = new THREE.Scene();
  cam = new THREE.PerspectiveCamera(60, W / H, 0.5, 4000);
  lines = new LineBatch(6000, { screen2D: false, worldWidth: true, blend: 'normal' });
  private planes = new Map<string, TextPlane>();
  private used: THREE.Object3D[] = [];

  /** A TextPlane for (text, family, capH) — created once, then reused. */
  plane(text: string, family: string, capH: number, o: { ax?: number; ay?: number; outline?: number } = {}) {
    const key = `${text}|${family}|${capH}|${o.ax ?? 0.5}|${o.ay ?? 0.5}`;
    let p = this.planes.get(key);
    if (!p) {
      p = new TextPlane(text, family, { capH, px: 200, ax: o.ax, ay: o.ay, outline: o.outline ?? 0 });
      this.planes.set(key, p);
    }
    return p;
  }
  /** Place an object for this frame (cleared by begin()). */
  add(o: THREE.Object3D) { this.scene.add(o); this.used.push(o); return o; }
  begin() {
    for (const o of this.used) this.scene.remove(o);
    this.used.length = 0;
    this.lines.clear();
  }
  render(r: THREE.WebGLRenderer, out: THREE.WebGLRenderTarget) {
    this.cam.updateMatrixWorld();
    this.cam.updateProjectionMatrix();
    r.setRenderTarget(out);
    r.render(this.scene, this.cam);
    this.lines.render(r, out, this.cam);
  }
  /** Project a world point to logical screen px (null behind the camera). */
  project(x: number, y: number, z: number) {
    const v = new THREE.Vector3(x, y, z).project(this.cam);
    if (v.z > 1) return null;
    return { x: (v.x * 0.5 + 0.5) * W, y: (0.5 - v.y * 0.5) * H };
  }
}

/** Clone a TextPlane's mesh (shares geometry + material, so karaoke state is shared too). */
export const cloneMesh = (p: TextPlane) => p.mesh.clone();

/** 0..1 progress through the words of a line (for TextPlane wipes). */
export function lineProg(l: Line | Word[], t: number) {
  const ws = Array.isArray(l) ? l : l.words;
  if (!ws.length) return 0;
  const a = ws[0]!.start, b = ws[ws.length - 1]!.end;
  return clamp((t - a) / Math.max(0.05, b - a));
}
