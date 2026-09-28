// flatline — "End of Trace" (docs/TREATMENT_REVISED.MD outro). The crimson point the climax
// collapsed into is the write head of a heart monitor, dead centre; the paper runs left.
//  the final heavy hits  each one is a heartbeat: a QRS spike on the trace and, full screen,
//                        LIEB — then MICH — then LIEB — then MICH (crimson, the last and hottest);
//                        the snares between them are the trace's aftershocks
//  between them          the line lies flat, HR ---
//  the final chord       all geometry (the words, the trace, the grid, the readouts) collapses
//                        into the single dot in the centre; the dot shrinks; total black
//  then                  a single caret blinks in Plex Mono and types TARGET LOST. END OF TRACE.
//                        — and the cut to black.
import type * as THREE from 'three';
import { Scene, type Frame } from '../engine/scene';
import { Layer2D, W, H, clearRT } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { LIN, rgba } from '../engine/palette';
import { F, fitSize, font, measure } from '../engine/type';
import { clamp, ease, lerp, prog, smoothstep, springStep } from '../engine/util';
import { mono } from './_motifs';
import { BONE, shakeOf } from './search-kit';

const Y = H / 2;
const SPEED = 640; // px/s: the paper under the write head
const MSG = 'TARGET LOST. END OF TRACE.';

/** One heartbeat (P-QRS-T) at u seconds after the beat. */
function ecg(u: number) {
  if (u < -0.1 || u > 0.4) return 0;
  const g = (m: number, s: number, a: number) => a * Math.exp(-((u - m) ** 2) / (2 * s * s));
  return g(-0.06, 0.018, 0.1) + g(0.0, 0.007, -0.16) + g(0.02, 0.008, 1) + g(0.045, 0.01, -0.42) + g(0.22, 0.04, 0.2);
}

interface Hit { t: number; amp: number; word: string | null }

export default class Flatline extends Scene {
  private L = new Layer2D();
  private LC = new Layer2D();
  private trace = new LineBatch(6000, { blend: 'add' });
  private hits: Hit[] = [];
  private tChord = 0; private tCollapse = 0; private tGone = 0; private tCaret = 0; private tType = 0; private tCut = 0;

  override init() {
    const { audio: au, start, end } = this.ctx;
    // the final hits: kicks and snares while the drums still play (the tail is bleed)
    const ev = [...au.events('kick', start, end), ...au.events('snare', start, end)]
      .filter(([t, s]) => s > 0.4 && au.env('drums', t + 0.03) > 0.2)
      .map(([t]) => t).sort((a, b) => a - b)
      .filter((t, i, a) => i === 0 || t - a[i - 1]! > 0.08);
    // the loud ones (on the beat grid's strong hits) carry the words, alternating LIEB / MICH
    let n = 0;
    this.hits = ev.map((t, i) => {
      const beatish = Math.abs(au.beatAt(t) - Math.round(au.beatAt(t))) < 0.12;
      const strong = i === 0 || beatish;
      const word = strong ? (n++ % 2 === 0 ? 'LIEB' : 'MICH') : null;
      return { t, amp: strong ? 1 : 0.45, word };
    });
    const last = this.hits[this.hits.length - 1]?.t ?? start + 2;
    this.tChord = last;
    this.tCollapse = last + 0.22;
    this.tGone = this.tCollapse + 1.35;
    this.tCut = end - 0.1;
    this.tType = Math.min(this.tGone + 0.9, this.tCut - 1.75);
    this.tCaret = this.tType - 0.6;
  }

  private level(tt: number) {
    let v = 0;
    for (const h of this.hits) v += h.amp * ecg(tt - h.t);
    return v;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    const t = f.t, r = this.ctx.renderer, { start } = this.ctx;
    clearRT(r, out, LIN.void);
    if (t >= this.tCut) return { fade: 1 };
    const L = this.L, c = L.ctx, LC = this.LC, cc = LC.ctx;
    L.clear();
    let hot = false;
    const col = prog(t, this.tCollapse, this.tCollapse + 0.55, ease.inExpo);
    const shrink = prog(t, this.tCollapse + 0.55, this.tGone, ease.outCubic);
    const sq = lerp(1, 0.004, col), sc = lerp(1, 0.004, Math.pow(col, 0.7));
    const hits = this.hits.filter((h) => h.t <= t);
    const nW = hits.filter((h) => h.word).length;
    // the camera: a step in on every word (never back)
    const push = 1 + 0.025 * nW;

    const whPre = [...hits].reverse().find((h) => h.word);
    if (col < 1 && whPre?.word === 'MICH') { LC.clear(); hot = true; }
    if (col < 1) {
      for (const g of [c, cc]) { g.save(); g.translate(W / 2, H / 2); g.scale(sc * push, sq * push); g.translate(-W / 2, -H / 2); }
      // the monitor grid (ash), faint
      c.strokeStyle = rgba('ash', 1); c.lineWidth = 1;
      for (let x = (W / 2) % 80 - ((t - start) * SPEED) % 80; x < W; x += 80) { c.beginPath(); c.moveTo(x, Y - 320); c.lineTo(x, Y + 320); c.stroke(); }
      for (let y = Y - 320; y <= Y + 320; y += 80) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
      // the words: full screen, one per heavy hit
      const wh = [...hits].reverse().find((h) => h.word);
      if (wh) {
        const age = t - wh.t;
        const hot = wh === this.hits.filter((h) => h.word).slice(-1)[0];
        const fam = F.archivo(125, 900);
        const size = Math.min(900, fitSize(wh.word!, fam, W * 0.94, 1000));
        const tw = measure(wh.word!, fam, size);
        const a = hot ? 1 : lerp(1, 0.2, smoothstep(0.1, 0.4, age));
        const s = 0.93 + 0.07 * springStep(age, 5, 0.35);
        const g = wh.word === 'MICH' ? cc : c;
        g.save();
        g.translate(W / 2, Y); g.scale(s, s);
        g.font = font(fam, size);
        g.fillStyle = wh.word === 'MICH' ? rgba('crimson', a) : rgba('bone', a * 0.9);
        g.fillText(wh.word!, -tw / 2, size * 0.715 / 2);
        g.restore();
      }
      // readouts
      const recent = hits.filter((h) => h.word).slice(-2);
      const flat = hits.length && t - hits[hits.length - 1]!.t > 0.5;
      const hr = recent.length === 2 ? Math.round(60 / Math.max(0.3, recent[1]!.t - recent[0]!.t)) : hits.length ? 135 : 0;
      mono(c, 'LEAD II · 25 mm/s', 72, 88, { size: 13, color: rgba('mercury', 0.6) });
      mono(c, 'HR', 72, 124, { size: 13, color: rgba('mercury', 0.6) });
      mono(c, flat || !hits.length ? '---' : String(hr).padStart(3, '0'), 110, 128, { size: 34, weight: 500, color: rgba(flat ? 'crimson' : 'bone', 0.9) });
      mono(c, `SUBJECT: SIE · TRACE ${(t - start).toFixed(2)} s`, W - 72, 88, { size: 13, align: 'right', color: rgba('mercury', 0.6) });
      for (const g of [c, cc]) g.restore();
    }
    // the caret and the last line
    if (t >= this.tCaret) {
      const size = 30, fam = F.mono(400);
      const x0 = W / 2 - measure(MSG, fam, size, 3) / 2;
      const n = clamp(Math.floor((t - this.tType) / 0.05), 0, MSG.length);
      const typed = t >= this.tType ? MSG.slice(0, n) : '';
      mono(c, typed, x0, Y + 11, { size, color: rgba('bone', 0.9), tracking: 3 });
      const cx = x0 + (typed ? measure(typed, fam, size, 3) + 6 : 0);
      const typing = t >= this.tType && n < MSG.length;
      if (typing || Math.floor((t - this.tCaret) / 0.5) % 2 === 0) { c.fillStyle = rgba('bone', 0.9); c.fillRect(cx, Y - 20, 15, 34); }
    }
    this.ctx.comp.draw(r, L.upload(), out, { mode: 'normal' });
    if (hot) this.ctx.comp.draw(r, LC.upload(), out, { mode: 'normal', tint: [1.8, 1.8, 1.8] });

    // the trace and the write head (GL: the head blooms)
    const B = this.trace;
    B.clear();
    const head = W / 2;
    if (t < this.tGone) {
      if (col < 1) {
        let px = 0, py = 0;
        for (let x = -20; x <= head; x += 3) {
          const tt = t - (head - x) / SPEED;
          const v = tt < start ? 0 : this.level(tt);
          const X = W / 2 + (x - W / 2) * sc * push, Yp = Y + (-230 * v) * sq * push;
          if (x > -20) B.seg(px, py, 0, X, Yp, 0, 2.2, LIN.crimson[0] * 1.6, LIN.crimson[1] * 1.6, LIN.crimson[2] * 1.6, clamp(1 - (head - x) / W * 1.2));
          px = X; py = Yp;
        }
      }
      const v = this.level(t);
      const hy = Y - 230 * v * sq * push;
      const rad = lerp(9, 0.6, shrink) * (1 + 0.6 * v);
      const k = (3 + 3 * v) * (1 - 0.7 * shrink);
      B.seg(head, hy, 0, head, hy, 0, rad * 2, LIN.crimson[0] * k, LIN.crimson[1] * k, LIN.crimson[2] * k, 1 - smoothstep(0.85, 1, shrink));
      if (col < 0.5) B.seg(head, hy, 0, head, hy, 0, 3, BONE[0], BONE[1], BONE[2], 0.8);
      B.render(r, out);
    }
    const last = hits[hits.length - 1];
    const kick = last ? Math.exp(-(t - last.t) * 10) * last.amp : 0;
    return {
      bloom: 0.9, bloomThreshold: 0.95, bloomKnee: 0.12, halation: 0.2, vignette: 0.5, grain: 0.06 * (t < this.tGone ? 1 : 0.6),
      ca: 1.5 + 5 * kick + 4 * col * (1 - shrink), shake: shakeOf(t, 18 * kick * (1 - col)),
    };
  }
}
