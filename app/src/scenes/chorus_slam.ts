// chorus_slam — the chorus, `command` in docs/TREATMENT_REVISED.MD. One shot per sung line (one bar
// each), from chorus-bits.ts, on the void; on top of every shot: a one-frame crimson flash on the
// downbeat, the target-lock brackets slamming in from the corners on the snares to crush the words,
// and heavy shake on the kicks. params.level: 1 = chorus 1; 2 = chorus 2; 3 = choruses 3 + 4 (the
// entry spans both): mercury hairlines while the bass is out, then the type breaks the safe areas;
// from chorus 4 (l4) maximal.
import type * as THREE from 'three';
import { Scene, type Frame } from '../engine/scene';
import { FSPass, Layer2D, W, H, clearRT, makeRT } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { LIN, rgba } from '../engine/palette';
import type { Line } from '../engine/lyrics';
import { clamp, ease, hash, lerp, smoothstep } from '../engine/util';
import { mono, mulRGB } from './_motifs';
import { look, Stage, type Look } from './chorus-kit';
import { BITS, type Bit, type BitOut } from './chorus-bits';

const SAFE = 0.9;

/** Shots whose flat type is re-framed with a hard punch-in crop on every beat. */
const REFRAME = new Set(['Lieb mich weil du kannst', 'Lieb mich weil du musst', 'Lieb mich wenn ich wein', 'Lieb mich wenn ich lach', 'Bei Tag und Nacht']);

// the codec tearing: horizontal bands slip sideways with a split of the channels, on the hardest
// hits; a faint scanline grid rises on the snares
const TEAR = /* glsl */ `
uniform sampler2D src; uniform float amt, seed, snare;
void main() {
  float bands = 38.0 + 60.0 * hash11(seed);
  float band = floor(vUv.y * bands);
  float h = hash12(vec2(band, seed));
  float on = step(1.0 - 0.55 * amt, h);
  vec2 uv = vUv + vec2((hash12(vec2(band, seed + 7.0)) - 0.5) * 0.16 * amt * on, 0.0);
  float sp = 0.006 * amt * on;
  vec3 c = vec3(texture(src, uv + vec2(sp, 0.0)).r, texture(src, uv).g, texture(src, uv - vec2(sp, 0.0)).b);
  c += vec3(0.018) * snare * step(0.5, fract(FRAG_PX.y / 4.0));
  fragColor = vec4(c, 1.0);
}`;

export default class ChorusSlam extends Scene {
  private L = new Layer2D();
  private G = new Layer2D(); // crimson glow: composited tinted > 1 so it blooms
  private B = new Layer2D(); // the frame's own UI (brackets, safe areas): never re-framed
  private rt = makeRT();
  private tear = new FSPass(TEAR, { src: { value: null }, amt: { value: 0 }, seed: { value: 0 }, snare: { value: 0 } });
  private st = new Stage();
  private l2 = new LineBatch(3000, { blend: 'normal' });
  private lines: Line[] = [];
  private occ: number[] = [];
  private bassBack = Infinity;
  private ch4 = Infinity;

  override init() {
    const { lyrics: ly, audio: au, start, end } = this.ctx;
    this.lines = ly.lines.filter((l) => l.start >= start - 0.3 && l.start < end);
    // which repeat of its text each line is, within its chorus (14 lines)
    this.occ = this.lines.map((l, i) => this.lines.slice(Math.floor(i / 14) * 14, i).filter((x) => x.text === l.text).length);
    if ((this.ctx.params.level ?? 1) >= 3) {
      for (let t = start + 4; t < end; t += 0.05) {
        let on = true;
        for (let s = 0; s < 0.6; s += 0.05) if (au.env('bass', t + s) < 0.35) { on = false; break; }
        if (on) { this.bassBack = au.downbeats.reduce((b, d) => (Math.abs(d - t) < Math.abs(b - t) ? d : b)); break; }
      }
      this.ch4 = au.sections.find((s) => s.name === 'chorus4')?.start ?? Infinity;
    }
  }

  private look(t: number): Look {
    const lv = this.ctx.params.level ?? 1;
    if (lv === 1) return look('l1');
    if (lv === 2) return look('l2');
    if (t < this.bassBack) return look('sparse');
    return look(t < this.ch4 ? 'l3' : 'l4');
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    const t = f.t, r = this.ctx.renderer, au = this.ctx.audio;
    const lk = this.look(t);
    const sparse = lk.name === 'sparse';
    const beatLen = 60 / au.bpm;
    const kick = au.hit('kick', t, 0.1), snare = au.hit('snare', t, 0.08);

    // the current line's bar
    let li = -1;
    for (let i = 0; i < this.lines.length; i++) if (this.lines[i]!.start - 0.1 <= t) li = i;
    const line = this.lines[Math.max(0, li)]!;
    const t0 = li < 0 ? this.ctx.start : Math.max(this.ctx.start, au.timeOfBeat(Math.round(au.beatAt(line.start))) - 0.001);
    const t1 = this.lines[li + 1] ? au.timeOfBeat(Math.round(au.beatAt(this.lines[li + 1]!.start))) : this.ctx.end;
    const kf = (t - t0) / beatLen;
    const k = Math.max(0, Math.floor(kf)), phase = kf - k;
    const isLieb = line.words[0]!.w === 'Lieb';
    const head = isLieb ? line.words.slice(0, 2) : [];
    const tail = isLieb ? line.words.slice(2) : line.words;

    // the one-frame crimson flash on the downbeat (never in the quiet shots)
    const db = au.timeOfBeat(Math.floor(au.beatAt(t) / 4) * 4);
    const quiet = sparse || line.text === 'Lieb mich einfach so';
    const flashFrame = !quiet && t - db >= 0 && t - db < 1 / 60 && Math.abs(au.barAt(t) - Math.round(au.barAt(t))) < 0.02;
    // the drop: out of the pre-chorus's black (and where the band returns in chorus 3, and into
    // chorus 4) the first frames are an assault — two frames of blinding crimson, a full tear, a
    // violent shake, the first word slamming in from far too close
    const entryT = [this.ctx.start, this.bassBack, this.ch4].filter((x) => x <= t).reduce((a, x) => Math.max(a, x), -Infinity);
    const entry = !sparse && t - entryT < 0.6 ? Math.pow(0.5, (t - entryT) / 0.08) : 0;
    const entryFlash = !sparse && t - entryT >= 0 && t - entryT < 2 / 60;
    const rt = this.rt;
    clearRT(r, rt, entryFlash ? mulRGB(LIN.crimson, 1.25) : flashFrame ? mulRGB(LIN.crimson, 1.6) : LIN.void);

    const L = this.L, G = this.G, c = L.ctx, g = G.ctx, bc = this.B.ctx;
    L.clear(); G.clear(); this.B.clear();
    this.st.begin();
    this.l2.clear();
    const bit: Bit = {
      t, u: clamp((t - t0) / Math.max(0.1, t1 - t0)), t0, t1, k, phase, line, head: head.length ? head : line.words.slice(0, 0), tail,
      lk, au, kick, snare, c, g, st: this.st, l2: this.l2, occ: this.occ[Math.max(0, li)] ?? 0, beatLen,
      first: t0 - entryT < 0.3 && t - entryT < 1.2,
    };
    const fn = BITS[line.text];
    const o: BitOut = (fn ? fn(bit) : undefined) ?? {};

    // the target lock: four brackets from the corners, snapping inward on each snare of the bar
    if (!quiet) {
      const sn = au.events('snare', t0, t).length;
      const lastSn = au.events('snare', t0, t).at(-1)?.[0] ?? t0;
      const step = Math.min(3, sn) - 1 + ease.outBack(clamp((t - lastSn) / 0.12));
      const inset = lerp(26, 150, clamp(Math.max(0, step) / 3)) * Math.min(1.3, lk.energy);
      const arm = 120;
      bc.save();
      bc.strokeStyle = rgba('crimson', 1);
      bc.lineWidth = 5 + 9 * snare * Math.min(1.4, lk.energy); // thicker on impact
      bc.lineCap = 'square';
      for (const [x, y, sx, sy] of [[inset, inset, 1, 1], [W - inset, inset, -1, 1], [inset, H - inset, 1, -1], [W - inset, H - inset, -1, -1]] as const) {
        bc.beginPath(); bc.moveTo(x + sx * arm, y); bc.lineTo(x, y); bc.lineTo(x, y + sy * arm); bc.stroke();
      }
      bc.restore();
    }
    // the safe areas, flickering, once the type breaks them
    if (lk.name === 'l3' || lk.name === 'l4') {
      const fl = hash(Math.floor(t * 24), 3) > 0.3 ? 1 : 0;
      const mx = (W * (1 - SAFE)) / 2, my = (H * (1 - SAFE)) / 2;
      bc.save();
      bc.globalAlpha = fl * 0.8;
      bc.strokeStyle = rgba('mercury', 0.6);
      bc.lineWidth = 1;
      bc.strokeRect(mx, my, W - 2 * mx, H - 2 * my);
      bc.restore();
      mono(bc, 'TITLE SAFE 90%  //  BREACHED', mx + 8, my - 8, { size: 12, color: rgba('crimson', fl) });
    }
    if (sparse) mono(bc, 'LOW SIGNAL  //  BASS 0.00', W / 2, H - 40, { size: 12, align: 'center', color: rgba('crimson', 0.7) });

    // composite: 3D stage, line batch, type, glow (tinted > 1: only crimson blooms), frame UI
    this.st.render(r, rt);
    this.l2.render(r, rt);
    // the push-in about a point (zoom-through), or a hard punch-in crop on each beat (the cut)
    let za = o.zoomAt;
    if (!za && REFRAME.has(line.text) && k > 0) {
      const Z = 1 + [0, 0.38, 0.72, 0.16][k % 4]! * Math.min(1.2, lk.energy);
      // the fixed point of the crop: the word just sung (it stays put on screen, so it stays legible)
      const [fx, fy] = bit.focus ?? [W * lerp(0.35, 0.65, hash(line.i, k, 1)), H * lerp(0.4, 0.6, hash(line.i, k, 2))];
      za = [fx, fy, Z];
    }
    const xf = za ? (() => {
      const s = 1 / za[2]!, px = za[0]! / W, py = 1 - za[1]! / H;
      return { scale: [s, s] as [number, number], offset: [(px - 0.5) * (1 - s), (py - 0.5) * (1 - s)] as [number, number] };
    })() : {};
    this.ctx.comp.draw(r, L.upload(), rt, { mode: 'normal', ...xf });
    this.ctx.comp.draw(r, G.upload(), rt, { mode: 'normal', tint: [2.6, 2.6, 2.6], ...xf });
    this.ctx.comp.draw(r, this.B.upload(), rt, { mode: 'normal', tint: [2.2, 2.2, 2.2] });

    // the tear: on the hardest kicks and on each cut into a new line, stronger each chorus
    const hard = clamp((kick - 0.72) * 3.5) * 0.55 + Math.pow(0.5, (t - t0) / 0.035) * 0.7;
    const amt = quiet ? 0 : clamp(hard * Math.min(1.6, lk.energy) * 0.8 + entry);
    this.tear.u.src!.value = rt.texture;
    this.tear.u.amt!.value = amt;
    this.tear.u.seed!.value = Math.floor(t * 60) % 997;
    this.tear.u.snare!.value = quiet ? 0 : snare;
    this.tear.render(r, out);

    // heavy shake on the kicks (a new direction per kick)
    const kn = au.events('kick', t - 0.5, t + 1e-3).length + Math.floor(t * 2);
    const shakeK = quiet ? 0 : kick * 16 * lk.energy + 46 * entry;
    const shake: [number, number] = o.shake ?? [(hash(kn, 1) - 0.5) * 2 * shakeK, (hash(kn, 2) - 0.5) * 2 * shakeK];
    return {
      // bone stays crisp (below the threshold); only the tinted crimson glow layer blooms
      bloom: 0.8, bloomThreshold: 1.1, bloomKnee: 0.12, halation: 0.2, vignette: 0.4, grain: 0.07,
      ca: quiet ? 0.8 : 1.4 + 3 * kick * lk.energy,
      zoom: o.zoom ?? 1 + 0.03 * kick * lk.energy,
      shake,
      ...(o.vignette !== undefined ? { vignette: o.vignette } : {}),
      ...(o.ca !== undefined ? { ca: o.ca } : {}),
      exposure: 1 + 0.15 * smoothstep(0.6, 1, kick) * (quiet ? 0 : 1) + 0.2 * entry,
    };
  }
}
