// climax — the last "Nur so macht Liebe sinn" (docs/TREATMENT.md; the revised treatment's rules).
// One word per slam, each filling the frame in Archivo and inflating through its weights
// (300 → 500 → 700 → 900) as it is sung; the camera punches in on every kick, never out; brackets
// slam inward from the corners on the snares, trying to crush the word.
//  NUR    bone on the void            SO     crimson, wide open
//  MACHT  condensed to width 62 under pressure
//  LIEBE  the downbeat: the frame turns crimson, the word cut out of it in void; on the next beat
//         it inverts back (one luminance swing, well under 3 flashes a second)
//  SINN   held as an outline; through it, on 16th notes, everything the video has shown flashes
//         past (LIDAR land, the attractor, the map path, the radar, the maelstrom, the thermal
//         façade, CCTV, the trace) — then it all collapses into a single crimson point.
// A mono transcript at the bottom keeps the sung line legible.
import type * as THREE from 'three';
import { Scene, type Frame } from '../engine/scene';
import { Layer2D, W, H, clearRT } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { LIN, rgba } from '../engine/palette';
import { ARCHIVO_WEIGHTS, F, fitSize, font, measure } from '../engine/type';
import type { Line, Word } from '../engine/lyrics';
import { clamp, ease, hash, lerp, noise1, prog, smoothstep, springStep, TAU } from '../engine/util';
import { mono, terrain } from './_motifs';
import { Cam, kicks, lastIdx, shakeOf, snares, springs } from './search-kit';

const up = (s: string) => s.toLocaleUpperCase('de-DE');

interface Slam { w: Word; text: string; width: number; size: number; t0: number; t1: number }

export default class Climax extends Scene {
  private L = new Layer2D(); // bone / void / mono
  private LC = new Layer2D(); // crimson, composited hot (the only colour that blooms)
  private dot = new LineBatch(64, { blend: 'add' });
  private cam = new Cam();
  private line!: Line;
  private slams: Slam[] = [];
  private beats: number[] = [];
  private kk: number[] = [];
  private sn: number[] = [];
  private lorenz: number[] = [];
  private tCollapse = 0;
  private tDown = 0;

  override init() {
    const { lyrics: ly, audio: au, start, end } = this.ctx;
    const all = ly.find('Nur so macht Liebe sinn');
    this.line = all[all.length - 1]!;
    const ws = this.line.words;
    this.slams = ws.map((w, i) => {
      const text = up(w.w);
      const width = text === 'MACHT' ? 62 : text === 'SO' ? 125 : text === 'SINN' ? 112 : 100;
      const fam = F.archivo(width, 900);
      const size = Math.min(text.length <= 2 ? 980 : 900, fitSize(text, fam, W * 0.9, 1000));
      return { w, text, width, size, t0: w.start - 0.02, t1: i + 1 < ws.length ? ws[i + 1]!.start - 0.02 : end };
    });
    this.beats = au.beats.filter((b) => b >= start - 0.05 && b < end);
    this.kk = kicks(au, start - 0.05, end, 0.4);
    this.sn = snares(au, start - 0.05, end, 0.4);
    this.tDown = au.downbeats.find((d) => d > start + 0.5 && d < end) ?? ws[3]!.start;
    this.tCollapse = this.beats[this.beats.length - 1] ?? end - 0.44;
    // the attractor (a Lorenz orbit), integrated once
    let x = 0.1, y = 0, z = 0;
    for (let i = 0; i < 2600; i++) {
      const h = 0.008;
      const dx = 10 * (y - x), dy = x * (28 - z) - y, dz = x * y - (8 / 3) * z;
      x += dx * h; y += dy * h; z += dz * h;
      if (i > 100) this.lorenz.push(x, y, z - 25);
    }
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    const t = f.t, r = this.ctx.renderer, { end } = this.ctx;
    clearRT(r, out, LIN.void);
    const L = this.L, c = L.ctx, LC = this.LC, cc = LC.ctx;
    L.clear();
    const col = prog(t, this.tCollapse, end - 0.06, ease.inQuart);
    const si = clamp(lastIdx(this.slams.map((s) => s.t0), t), 0, this.slams.length - 1);
    const S = this.slams[si]!;
    const lt = t - S.t0;
    // camera: punched in on every kick (the steps stay), the word itself pushing in slowly
    const punch = springs(t, this.kk, 1, 4, 0.45);
    const push = (1 + 0.012 * punch) * (1 + 0.05 * clamp(lt / 0.8));
    const sq = lerp(1, 0.02, col), sc = lerp(1, 0.0015, col);
    const invertX = S.text === 'LIEBE' && t >= this.tDown - 0.02 && t < (this.beats.find((b) => b > this.tDown + 0.2) ?? S.t1);
    const hotWord = S.text === 'SO' || (S.text === 'LIEBE' && !invertX);
    if (hotWord) LC.clear();
    for (const g of [c, cc]) {
      g.save();
      g.translate(W / 2, H / 2);
      g.scale(sc * push, sc * sq * push);
      g.translate(-W / 2, -H / 2);
    }

    const invert = invertX;
    if (S.text === 'SINN' && t < S.t1) this.recap(c, c, t, S);
    if (invert) { c.fillStyle = rgba('crimson', 1); c.fillRect(-W, -H, W * 3, H * 3); }
    // the word, inflating through the weights while it is sung
    const wProg = clamp(lt / Math.max(0.2, (S.w.end - S.w.start) * 0.7));
    const wt = ARCHIVO_WEIGHTS[Math.min(3, Math.floor(wProg * 4))]!;
    const fam = F.archivo(S.width + 6 * this.ctx.audio.hit('kick', t, 0.08), wt);
    const slam = 0.9 + 0.1 * springStep(lt, 5, 0.38);
    const tw = measure(S.text, fam, S.size);
    const g = hotWord ? cc : c;
    g.save();
    g.translate(W / 2, H / 2);
    g.scale(slam, slam);
    g.font = font(fam, S.size);
    g.textBaseline = 'alphabetic';
    const cap = S.size * 0.715;
    if (S.text === 'SINN') {
      g.lineWidth = 5; g.strokeStyle = rgba('bone', 0.95); g.lineJoin = 'miter';
      g.strokeText(S.text, -tw / 2, cap / 2);
      g.fillStyle = rgba('void', 0.55); g.fillText(S.text, -tw / 2, cap / 2);
      g.strokeText(S.text, -tw / 2, cap / 2);
    } else {
      g.fillStyle = invert ? rgba('void', 1) : S.text === 'SO' || S.text === 'LIEBE' ? rgba('crimson', 1) : rgba('bone', 1);
      g.fillText(S.text, -tw / 2, cap / 2);
    }
    g.restore();
    // brackets slam in from the corners on the snares
    const n = this.sn.filter((s) => s <= t).length;
    const k = springs(t, this.sn, 1, 6, 0.4);
    const bw = lerp(W * 0.49, tw * 0.5 * slam + 40, clamp(k / Math.max(1, n + 0.5) * 0.55 + 0.35 * clamp(n / 6)));
    const bh = lerp(H * 0.48, cap * 0.5 + 60, clamp(0.3 + 0.1 * n));
    const bc = c;
    bc.strokeStyle = invert ? rgba('void', 1) : rgba('crimson', 1);
    bc.lineWidth = 6;
    const arm = 90;
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      bc.beginPath();
      bc.moveTo(W / 2 + sx * bw, H / 2 + sy * (bh - arm)); bc.lineTo(W / 2 + sx * bw, H / 2 + sy * bh); bc.lineTo(W / 2 + sx * (bw - arm), H / 2 + sy * bh);
      bc.stroke();
    }
    for (const g2 of [c, cc]) g2.restore();

    // the transcript (legibility), mono, bottom
    if (col < 0.2) {
      let x = W / 2 - measure('NUR SO MACHT LIEBE SINN', F.mono(500), 22, 4) / 2;
      for (const s of this.slams) {
        const sung = t >= s.t0, cur = s === S;
        const txt = s.text + ' ';
        mono(c, txt, x, H - 70, { size: 22, weight: 500, tracking: 4, color: invert ? rgba('void', sung ? 1 : 0.4) : cur ? rgba('crimson', 1) : rgba('bone', sung ? 0.75 : 0.22) });
        x += measure(txt, F.mono(500), 22, 4) + 4;
      }
      mono(c, `WT ${wt} · WDTH ${S.width}`, W - 72, 72, { size: 13, align: 'right', color: invert ? rgba('void', 0.8) : rgba('mercury', 0.6) });
    }
    this.ctx.comp.draw(r, L.upload(), out, { mode: 'normal' });
    if (hotWord) this.ctx.comp.draw(r, LC.upload(), out, { mode: 'normal', tint: [1.7, 1.7, 1.7] });
    // the point it all collapses into
    if (col > 0.05) {
      this.dot.clear();
      const k2 = smoothstep(0.05, 0.9, col);
      this.dot.seg(W / 2, H / 2, 0, W / 2, H / 2, 0, lerp(2, 12, k2), LIN.crimson[0] * 3.5, LIN.crimson[1] * 3.5, LIN.crimson[2] * 3.5, k2);
      this.dot.render(r, out);
    }
    const kick = this.ctx.audio.hit('kick', t, 0.09);
    return { bloom: 0.9, bloomThreshold: 0.95, bloomKnee: 0.12, halation: 0.2, vignette: 0.45, grain: 0.07, ca: 2 + 4 * kick + 6 * col, shake: shakeOf(t, 16 * kick * (1 - col)) };
  }

  /** SINN: on each 16th a different plate of the video flashes past behind/through the word. */
  private recap(c: CanvasRenderingContext2D, cc: CanvasRenderingContext2D, t: number, S: Slam) {
    const b0 = this.beats.find((b) => b >= S.t0 - 0.05) ?? S.t0;
    const step = (60 / this.ctx.audio.bpm) / 4;
    const k = Math.floor((t - b0) / step);
    if (k < 0) return;
    const u = (t - b0) / step - k;
    const m = k % 8;
    const cam = this.cam;
    c.save(); cc.save();
    c.lineWidth = 1.5; cc.lineWidth = 2;
    const a = 0.9 - 0.4 * u;
    if (m === 0) {
      // LIDAR land
      cam.set({ x: 0, y: 120, z: t * 900, yaw: 0.1, pitch: -0.25, fov: 70 });
      c.fillStyle = rgba('bone', a * 0.8);
      for (let j = 1; j < 40; j++) for (let i = -30; i < 30; i++) {
        const x = i * 40, z = Math.floor(t * 900 / 40) * 40 + j * 40;
        if (cam.p(x, terrain(x, z), z)) c.fillRect(cam.sx - 1.5, cam.sy - 1.5, 3, 3);
      }
    } else if (m === 1) {
      // the attractor
      const P = this.lorenz, rot = t * 3;
      c.strokeStyle = rgba('mercury', a); c.beginPath();
      for (let i = 0; i < P.length; i += 3) {
        const x = P[i]! * Math.cos(rot) - P[i + 1]! * Math.sin(rot), y = P[i + 2]!;
        const sx = W / 2 + x * 22, sy = H / 2 - y * 20;
        i === 0 ? c.moveTo(sx, sy) : c.lineTo(sx, sy);
      }
      c.stroke();
    } else if (m === 2) {
      // the map: the angular path, the reticle a beat behind
      c.strokeStyle = rgba('ash', 1);
      for (let x = 0; x < W; x += 80) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
      for (let y = 0; y < H; y += 80) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
      c.strokeStyle = rgba('bone', a); c.lineWidth = 3; c.beginPath();
      let x = 160, y = 800; c.moveTo(x, y);
      for (let s = 0; s < 18; s++) { const d = Math.floor(hash(s, 4) * 3); if (d === 0) x += 120; else if (d === 1) y -= 90; else y += 60; c.lineTo(x, y); }
      c.stroke();
      cc.strokeStyle = rgba('crimson', a); cc.strokeRect(x - 40, y - 40, 80, 80);
    } else if (m === 3) {
      // the radar
      c.strokeStyle = rgba('ash', 1);
      for (let q = 1; q <= 5; q++) { c.beginPath(); c.arc(W / 2, H / 2, q * 110, 0, TAU); c.stroke(); }
      cc.strokeStyle = rgba('crimson', a); cc.lineWidth = 4;
      const sw = t * 9; cc.beginPath(); cc.moveTo(W / 2, H / 2); cc.lineTo(W / 2 + Math.cos(sw) * 560, H / 2 + Math.sin(sw) * 560); cc.stroke();
    } else if (m === 4) {
      // the maelstrom
      c.strokeStyle = rgba('bone', a * 0.5);
      for (let q = 0; q < 260; q++) {
        const th = hash(q, 1) * TAU, rr = 40 + 900 * hash(q, 2) ** 1.5;
        const a0 = th + 3 / (rr / 200 + 0.3) + t * 4;
        c.beginPath(); c.arc(W / 2, H / 2, rr, a0, a0 + 0.3); c.stroke();
      }
    } else if (m === 5) {
      // the thermal façade
      for (let i = 0; i < 14; i++) for (let j = 0; j < 7; j++) {
        const x = 150 + i * 118, y = 90 + j * 140;
        c.strokeStyle = rgba('ash', 1); c.strokeRect(x, y, 80, 100);
        if (hash(i, j, 3) > 0.6) { cc.fillStyle = rgba('crimson', a * 0.3); cc.fillRect(x + 4, y + 4, 72, 92); }
      }
    } else if (m === 6) {
      // CCTV: four empty frames
      c.strokeStyle = rgba('bone', a * 0.6);
      for (let q = 0; q < 4; q++) {
        const x = 20 + (q % 2) * 950, y = 20 + Math.floor(q / 2) * 530;
        c.strokeRect(x, y, 930, 510);
        c.beginPath(); c.moveTo(x + 465, y + 200); c.lineTo(x, y + 510); c.moveTo(x + 465, y + 200); c.lineTo(x + 930, y + 510); c.stroke();
      }
      cc.fillStyle = rgba('crimson', a); for (let q = 0; q < 4; q++) { cc.beginPath(); cc.arc(50 + (q % 2) * 950, 490 + Math.floor(q / 2) * 530, 8, 0, TAU); cc.fill(); }
    } else {
      // the trace
      cc.strokeStyle = rgba('crimson', a); cc.lineWidth = 3; cc.beginPath();
      for (let x = 0; x <= W; x += 6) {
        const p = ((x / W) * 3) % 1;
        const v = Math.exp(-((p - 0.5) ** 2) / 0.0008) - 0.3 * Math.exp(-((p - 0.53) ** 2) / 0.0006);
        const y = H / 2 - 300 * v + 3 * noise1(x * 0.1, 2);
        x === 0 ? cc.moveTo(x, y) : cc.lineTo(x, y);
      }
      cc.stroke();
    }
    c.restore(); cc.restore();
  }
}
