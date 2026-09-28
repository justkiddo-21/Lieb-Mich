// The chorus, one shot per sung line (docs/TREATMENT_REVISED.MD, `command`). Each bit draws one
// bar: a 3D stage (st), the type layer (c), the glow layer (g: drawn tinted > 1 so only crimson
// blooms) and a 2D line batch (l2). Bits read the look (lk) so each chorus escalates.
import { W, H } from '../engine/gl';
import type { LineBatch } from '../engine/lines';
import { LIN, rgba } from '../engine/palette';
import { F, fitSize, font, layout } from '../engine/type';
import type { AudioData } from '../engine/audio';
import type { Line, Word } from '../engine/lyrics';
import type { PostOverrides } from '../engine/scene';
import { clamp, ease, hash, lerp, prog, pulse, smoothstep, TAU } from '../engine/util';
import { drawTargetLock, karaoke, mono, mulRGB } from './_motifs';
import { boxBehind, lineProg, slam, upper, type Look, type Stage } from './chorus-kit';

export interface Bit {
  t: number;
  /** 0..1 through this line's bar, the bar's start/end, beat index within it (0..3+) and phase. */
  u: number; t0: number; t1: number; k: number; phase: number;
  line: Line; head: Word[]; tail: Word[];
  lk: Look; au: AudioData; kick: number; snare: number;
  c: CanvasRenderingContext2D; g: CanvasRenderingContext2D; st: Stage; l2: LineBatch;
  /** Which occurrence of this line text inside the chorus (0, 1). */
  occ: number;
  beatLen: number;
  /** The first line after a drop (chorus entry, the band's return): its words slam in from much closer. */
  first?: boolean;
  /** Set by shout(): the centre of the most recently sung word (the beat re-frames anchor on it). */
  focus?: [number, number];
}
/** A bit's post overrides, plus `zoomAt`: push the whole frame in about a point [x, y, zoom] (the zoom-through). */
export type BitOut = PostOverrides & { zoomAt?: [number, number, number] };
export type BitFn = (b: Bit) => BitOut | void;

const beatK = (b: Bit, i: number) => b.t0 + i * b.beatLen;

/** The shout: head words slammed across the title-safe width, kicks widen, snares condense. */
function shout(b: Bit, words: Word[], o: { y?: number; fit?: number; width?: number; weight?: number; color?: string; maxSize?: number; from?: number; halo?: boolean } = {}) {
  const width = o.width ?? clamp(lerp(92, 125, b.kick) - 28 * b.snare, 62, 125);
  const so = {
    y: o.y ?? H * 0.5, fit: (o.fit ?? W * 0.9) * b.lk.over, width, weight: o.weight ?? b.lk.weight,
    tracking: lerp(-2, 22, b.kick) * Math.min(1, b.lk.energy), color: o.color ?? b.lk.ink, maxSize: o.maxSize,
    scatter: b.lk.name === 'l4' ? b.kick * 46 : 0, from: o.from ?? (b.first ? 2.4 : lerp(1.2, 1.6, Math.min(1, b.lk.energy / 1.8))), seed: b.line.i,
  };
  // from chorus 2: echo copies thrown off by the kicks (stacked, fading)
  if (b.lk.energy > 1.1 && b.kick > 0.05) {
    for (let e = 1; e <= 3; e++) slam(b.c, words, b.t, { ...so, y: so.y - e * 26 * b.kick * b.lk.energy, alpha: 0.16 / e });
  }
  if (o.halo) { b.c.save(); b.c.shadowColor = rgba('void', 1); b.c.shadowBlur = 40; }
  const r = slam(b.c, words, b.t, so);
  if (o.halo) b.c.restore();
  for (const sw of r.words) if (b.t >= sw.w.start) b.focus = [(sw.x0 + sw.x1) / 2, r.base - r.ascent * 0.36];
  // from chorus 3: each landing word flares crimson for a moment
  if (b.lk.energy >= 1.5) for (const sw of r.words) {
    const a = b.t >= sw.w.start ? Math.pow(0.5, (b.t - sw.w.start) / 0.09) : 0;
    if (a > 0.02) glowText(b.g, sw.text, sw.x0, r.base, r.family, r.size, a);
  }
  return r;
}
const glowText = (g: CanvasRenderingContext2D, s: string, x: number, y: number, fam: string, size: number, a = 1) => {
  g.save(); g.font = font(fam, size); g.textBaseline = 'alphabetic'; g.fillStyle = rgba('crimson', a); g.fillText(s, x, y); g.restore();
};

// ------------------------------------------------------------------ Lieb mich wie ich bin: the tunnel
export const tunnel: BitFn = (b) => {
  const { st } = b;
  const D = 90;
  const jump = ease.outExpo(clamp(b.phase * 3));
  const z = -(b.k + jump) * D - b.u * 40;
  const roll = (b.k % 2 ? 1 : -1) * 0.16 * b.lk.energy * ease.outBack(clamp(b.phase * 4));
  st.cam.fov = 72;
  st.cam.position.set(0, 0, z);
  st.cam.rotation.set(0, 0, roll);
  const plane = st.plane('LIEB MICH', F.archivo(100, 900), 13);
  plane.set({ prog: lineProg(b.head, b.t), cSung: mulRGB(b.lk.inkLin, 0.42), cDim: mulRGB(LIN.mercury, 0.14), cDone: mulRGB(b.lk.inkLin, 0.42), fillDim: 0.5, aDim: 0 });
  const z0 = Math.floor(z / D) * D;
  for (let i = 0; i < 9; i++) {
    const rz = z0 - i * D;
    for (const [x, y, rx, ry] of [[-30, 0, 0, Math.PI / 2], [30, 0, 0, -Math.PI / 2], [0, -17, -Math.PI / 2, 0], [0, 17, Math.PI / 2, 0]] as const) {
      const m = st.add(plane.mesh.clone());
      m.position.set(x, y, rz);
      m.rotation.set(rx, ry, 0);
    }
    // the ring's frame: crimson, dimmer with distance
    const a = clamp(1 - i / 9);
    const cr = mulRGB(LIN.crimson, 1.2 + 2 * a * b.kick);
    const R = [[-30, -17], [30, -17], [30, 17], [-30, 17]];
    for (let q = 0; q < 4; q++) {
      const p = R[q]!, n = R[(q + 1) % 4]!;
      st.lines.seg(p[0]!, p[1]!, rz, n[0]!, n[1]!, rz, 0.25, cr[0], cr[1], cr[2], a);
    }
  }
  if (b.tail.length) {
    const r = shout(b, b.tail, { y: H * 0.5, fit: W * 0.62, maxSize: 260, halo: true });
    const last = r.words[r.words.length - 1]!;
    if (b.t >= last.w.start) glowText(b.g, last.text, last.x0, r.base, r.family, r.size, 0.9 * smoothstep(last.w.start, last.w.start + 0.1, b.t));
  }
  return { zoom: 1 + 0.05 * b.kick * b.lk.energy };
};

// ------------------------------------------------------------------ Lieb mich wie ich wär: the versions
const VERSIONS: [number, number][] = [[62, 300], [75, 500], [87.5, 700], [100, 900], [112.5, 700], [125, 900]];
export const versions: BitFn = (b) => {
  const { st } = b;
  // dolly in: one version passed per beat
  const z = 30 - (b.k + ease.outExpo(clamp(b.phase * 2.5))) * 46;
  st.cam.fov = 55;
  st.cam.position.set(Math.sin(b.u * 2) * 6, 2, z);
  st.cam.rotation.set(-0.03, 0.05 * Math.sin(b.u * 3), 0);
  VERSIONS.forEach(([w, wt], i) => {
    const p = st.plane('LIEB MICH', F.archivo(w, wt), 11);
    p.set({ prog: lineProg(b.head, b.t), cSung: mulRGB(b.lk.inkLin, i === 3 ? 0.8 : 0.35), cDim: mulRGB(LIN.mercury, 0.2), cDone: mulRGB(b.lk.inkLin, i === 3 ? 0.8 : 0.35), fillDim: 0.25, aDim: 0 });
    const m = st.add(p.mesh.clone());
    m.position.set((i % 2 ? 1 : -1) * 7 * (i % 3), (i - 2.5) * 2.4, -i * 46);
    m.rotation.set(0, (i % 2 ? -1 : 1) * 0.18, 0);
    const s = st.project((i % 2 ? 1 : -1) * 7 * (i % 3) - p.w / 2, (i - 2.5) * 2.4 + 8, -i * 46);
    if (s && s.x > 40 && s.x < W - 200 && s.y > 40 && s.y < H - 40)
      mono(b.c, `v${i + 1}.0  W${w} / ${wt}`, s.x, s.y, { size: 13, color: rgba('mercury', 0.8) });
  });
  mono(b.c, 'SELF (HYPOTHETICAL)  //  NOT FOUND', 72, H - 72, { size: 14, color: rgba('crimson', 0.9) });
  if (b.tail.length) {
    // "wie ich" shouts; "wär" is the subjunctive: a Cormorant italic whisper that glows
    const [wie, ich, waer] = b.tail;
    const r = shout(b, [wie!, ich!], { y: H * 0.8, fit: W * 0.45, maxSize: 180 });
    if (waer && b.t >= waer.start) {
      const a = smoothstep(waer.start, waer.start + 0.15, b.t);
      const fam = F.serif(400, true), size = r.size * 1.4;
      glowText(b.g, 'wär', r.x0 + r.width + 40, r.base, fam, size, a);
    }
  }
  return { zoom: 1 + 0.03 * b.kick };
};

// ------------------------------------------------------------------ Lieb mich wie du willst: the control panel
const SLIDERS = ['WIDTH', 'WEIGHT', 'TRACKING', 'SLANT'] as const;
export const panel: BitFn = (b) => {
  const over = b.occ > 0; // the second time: overdrive
  const willst = b.tail[b.tail.length - 1];
  // slider values: each beat one knob is dragged to a new value (the reticle does it)
  const val = (j: number) => {
    let v = 0.5;
    for (let i = 0; i <= b.k; i++) if (i % 4 === j || over) {
      const nv = hash(b.line.i, i, j) * (over ? 1.6 : 1) - (over ? 0.3 : 0);
      v = lerp(v, nv, i < b.k ? 1 : ease.outExpo(clamp(b.phase * 5)));
    }
    return v;
  };
  const vs = SLIDERS.map((_, j) => val(j));
  const gravity = willst && b.t >= willst.start; // "wie du willst": pulled apart vertically
  const width = gravity ? 62 : lerp(62, 125, clamp(vs[0]!));
  const weight = lerp(300, 900, clamp(vs[1]!));
  const stretch = gravity ? lerp(1, over ? 2.3 : 1.8, ease.outBack(prog(b.t, willst!.start, willst!.start + 0.25))) : 1;
  const slant = (vs[3]! - 0.5) * 0.5;
  const c = b.c;
  const cy = H * 0.42;
  c.save();
  c.translate(W / 2, cy);
  c.transform(1, 0, -slant, stretch, 0, 0);
  c.translate(-W / 2, -cy);
  slam(c, b.head, b.t, { y: cy, fit: W * 0.9 * b.lk.over, width, weight, tracking: lerp(-10, 50, clamp(vs[2]!)), color: b.lk.ink, from: 1.3, maxSize: 330 });
  c.restore();
  if (b.tail.length) shout(b, b.tail, { y: H * 0.14, fit: W * 0.5, maxSize: 90, weight: 700 });
  // the sliders
  const x0 = 420, x1 = W - 420;
  SLIDERS.forEach((name, j) => {
    const y = H - 250 + j * 46;
    const v = vs[j]!;
    const bad = v < 0 || v > 1;
    mono(c, name, x0 - 30, y + 5, { size: 13, align: 'right', color: rgba('mercury', 0.9) });
    c.fillStyle = rgba(bad ? 'crimson' : 'ash', 1);
    c.fillRect(x0, y, x1 - x0, 2);
    const kx = lerp(x0, x1, v);
    c.fillStyle = rgba('bone', 0.85);
    c.fillRect(kx - 5, y - 9, 10, 20);
    const txt = bad ? 'ERR' : name === 'WIDTH' ? `${width.toFixed(0)}` : name === 'WEIGHT' ? `${weight.toFixed(0)}` : name === 'TRACKING' ? `${lerp(-10, 50, v).toFixed(0)}` : `${(slant * 57).toFixed(0)}°`;
    mono(c, txt, x1 + 30, y + 5, { size: 13, color: rgba(bad ? 'crimson' : 'bone', 0.9) });
    if (b.k % 4 === j || over) drawTargetLock(b.g, kx, y + 1, 16, b.t, { lock: 1, beatPhase: b.phase, alpha: over ? 0.7 : 1 });
  });
  mono(c, over ? 'PARAMETERS OUT OF RANGE  //  ACCEPTED' : 'USER PREFERENCE  //  APPLIED', W / 2, H - 50, { size: 13, align: 'center', color: rgba(over ? 'crimson' : 'mercury', 0.9) });
  return { shake: gravity ? [0, 14 * pulse(b.t, willst!.start, 0.1) * b.lk.energy] : undefined };
};

// ------------------------------------------------------------------ Und noch viel mehr: doubling
export const multiply: BitFn = (b) => {
  const mehr = b.line.words[b.line.words.length - 1]!;
  const c = b.c;
  if (b.t < mehr.start) {
    shout(b, b.line.words.slice(0, -1), { fit: W * 0.7 });
    return;
  }
  const eighth = b.beatLen / 2;
  const n8 = Math.floor((b.t - mehr.start) / eighth);
  const k = Math.min(8, n8); // 1, 2, 4 … 256
  const cols = 2 ** Math.ceil(k / 2), rows = 2 ** Math.floor(k / 2);
  const push = lerp(1, 1.12, b.u); // pushing in, never out
  const cw = (W * push) / cols, ch = (H * push) / rows;
  const ox = (W - W * push) / 2, oy = (H - H * push) / 2;
  const fam = F.archivo(k > 5 ? 62 : 100, 900);
  const size = Math.min(ch * 0.8, fitSize('MEHR', fam, cw * 0.86, 600));
  c.save();
  c.font = font(fam, size);
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const cr = b.lk.energy > 1 ? 0.22 : 0.08;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const x = ox + (i + 0.5) * cw, y = oy + (j + 0.5) * ch;
    const hot = hash(i, j, b.line.i, k) < cr;
    (hot ? b.g : c).fillStyle = hot ? rgba('crimson', 1) : rgba(b.lk.ink, 0.9);
    if (hot) { b.g.font = c.font; b.g.textAlign = 'center'; b.g.textBaseline = 'middle'; }
    (hot ? b.g : c).fillText('MEHR', x, y + size * 0.04);
  }
  c.restore();
  mono(b.g, `COPIES ${String(cols * rows).padStart(4, '0')}`, 72, 72, { size: 14, color: rgba('crimson', 1) });
  return { zoom: 1 + 0.04 * b.kick };
};

// ------------------------------------------------------------------ Lieb mich weil du kannst: capability
export const kannst: BitFn = (b) => {
  shout(b, b.head, { y: H * 0.38, maxSize: 360 });
  const hot = b.tail[b.tail.length - 1];
  let zoom = 1;
  if (b.tail.length) {
    // the tail flips in like split-flap cards
    const c = b.c;
    const r = slam(c, b.tail, -1, { y: H * 0.72, fit: W * 0.62, weight: 800, width: 100, maxSize: 200 }); // measure only
    for (const sw of r.words) {
      if (b.t < sw.w.start) continue;
      const f = prog(b.t, sw.w.start, sw.w.start + 0.12, ease.outCubic);
      c.save();
      c.translate(0, r.base - r.ascent * 0.36);
      c.scale(1, Math.max(0.02, Math.abs(Math.cos((1 - f) * Math.PI * 0.5))));
      c.translate(0, -(r.base - r.ascent * 0.36));
      c.font = font(r.family, r.size);
      c.textBaseline = 'alphabetic';
      c.fillStyle = rgba(sw.w === hot ? 'bone' : b.lk.ink, 1);
      c.fillText(sw.text, sw.x0, r.base);
      if (sw.w === hot) boxBehind(c, r, sw, rgba('crimson', 1), 14);
      c.restore();
    }
    if (hot && b.t >= hot.start) {
      for (let i = 0; i < 3; i++) zoom += 0.1 * b.lk.energy * pulse(b.t, hot.start + (i * b.beatLen) / 2, 0.07);
    }
  }
  const checks = ['[x] FÄHIG', '[x] VERFÜGBAR', '[ ] FREIWILLIG'];
  checks.forEach((s, i) => { if (b.k >= i + 1 || b.u > 0.3 * (i + 1)) mono(b.c, s, 72, H - 150 + i * 26, { size: 14, color: rgba(i === 2 ? 'crimson' : 'mercury', 0.9) }); });
  return { zoom, shake: hot && b.t >= hot.start ? [(hash(Math.floor(b.t * 60), 1) - 0.5) * 30 * b.lk.energy * pulse(b.t, hot.start, 0.15), (hash(Math.floor(b.t * 60), 2) - 0.5) * 22 * b.lk.energy * pulse(b.t, hot.start, 0.15)] : undefined };
};

// ------------------------------------------------------------------ Lieb mich weil du musst: compulsion
export const musst: BitFn = (b) => {
  // letterbox bars clamp in on each beat, down to a slit
  const steps = b.k + ease.outBack(clamp(b.phase * 4));
  const slit = Math.max(150, H - steps * 230);
  const top = (H - slit) / 2;
  const c = b.c;
  const hot = b.tail[b.tail.length - 1];
  const r = shout(b, [...b.head, ...b.tail], { y: H / 2, fit: W * 0.92, width: 62, maxSize: slit * 0.95 });
  if (hot && b.t >= hot.start) {
    const sw = r.words[r.words.length - 1]!;
    glowText(b.g, sw.text, sw.x0, r.base, r.family, r.size, smoothstep(hot.start, hot.start + 0.06, b.t));
  }
  c.fillStyle = rgba('ash', 1);
  c.fillRect(0, 0, W, top); c.fillRect(0, H - top, W, top);
  b.g.fillStyle = rgba('crimson', 1);
  b.g.fillRect(0, top - 2, W, 2); b.g.fillRect(0, H - top, W, 2);
  mono(c, 'COMPLIANCE REQUIRED', W / 2, top - 24, { size: 14, align: 'center', color: rgba('crimson', 0.9) });
  mono(c, `APERTURE ${(slit / H * 100).toFixed(0)}%`, W / 2, H - top + 36, { size: 13, align: 'center', color: rgba('mercury', 0.8) });
  const hit = hot && b.t >= hot.start ? pulse(b.t, hot.start, 0.14) : 0;
  return { shake: [(hash(Math.floor(b.t * 60), 3) - 0.5) * 36 * hit * b.lk.energy, (hash(Math.floor(b.t * 60), 4) - 0.5) * 20 * hit * b.lk.energy] };
};

// ------------------------------------------------------------------ Von heut an bis zum Schluss: the timeline
const DAY0 = Date.UTC(2026, 8, 28);
const fmtDay = (d: number) => {
  if (d > 3e5) return '∞';
  const x = new Date(DAY0 + d * 86400000);
  return `${String(x.getUTCDate()).padStart(2, '0')}.${String(x.getUTCMonth() + 1).padStart(2, '0')}.${x.getUTCFullYear()}`;
};
export const timeline: BitFn = (b) => {
  const { st } = b;
  // racing down a runway of days, accelerating, always forward
  const z = -(Math.exp(b.u * 3.4) - 1) * 160;
  st.cam.fov = 70;
  st.cam.position.set(0, 3.2, z);
  st.cam.rotation.set(-0.06, 0, (b.k % 2 ? 1 : -1) * 0.05 * ease.outBack(clamp(b.phase * 4)));
  const zEnd = -(Math.exp(3.4) - 1) * 160 - 120;
  const days = (zz: number) => Math.floor(Math.pow(-zz / 10, 2.15));
  const far = Math.max(zEnd, z - 1100);
  for (const x of [-24, -12, 0, 12, 24]) {
    const k = x === 0 ? 0.75 : 0.35;
    st.lines.seg(x, 0, z + 5, x, 0, far, x === 0 ? 0.18 : 0.1, LIN.bone[0] * k, LIN.bone[1] * k, LIN.bone[2] * k, 1);
  }
  for (let zz = Math.floor(z / 10) * 10; zz > far; zz -= 10) {
    const big = Math.round(zz) % 50 === 0;
    const k = (big ? 0.7 : 0.3) * clamp(1 - (z - zz) / 1100);
    st.lines.seg(big ? -24 : -3, 0, zz, big ? 24 : 3, 0, zz, big ? 0.14 : 0.08, LIN.bone[0] * k, LIN.bone[1] * k, LIN.bone[2] * k, 1);
    if (big && zz < z - 12) {
      const p = st.project(25, 0.2, zz);
      const a = clamp(1 - (z - zz) / 700);
      if (p && a > 0.4) mono(b.c, fmtDay(days(zz)), p.x + 10, p.y, { size: 22 * a, weight: 500, color: rgba("bone", 0.9 * smoothstep(0.4, 0.6, a)) }); // far dates would pile up at the vanishing point
    }
  }
  // the end: a crimson point on the horizon, growing as it nears
  const cr = mulRGB(LIN.crimson, 4);
  st.lines.seg(0, 0.5, zEnd, 0, 0.5, zEnd, lerp(3, 14, b.u) + 3 * b.kick, cr[0], cr[1], cr[2], 1);
  const [von, heut, an, bis, zum, schluss] = b.line.words;
  if (von && heut && an) shout(b, [von, heut, an], { y: H * 0.2, fit: W * 0.55, maxSize: 170 });
  if (bis && zum && schluss) shout(b, [bis, zum, schluss], { y: H * 0.36, fit: W * 0.7, maxSize: 190 });
  mono(b.c, `TODAY  ${fmtDay(0)}`, 72, H - 96, { size: 14, color: rgba('mercury', 0.9) });
  mono(b.c, `UNTIL  ${fmtDay(days(z - 500))}`, 72, H - 72, { size: 14, color: rgba('crimson', 1) });
  return { zoom: 1 + 0.03 * b.kick };
};

// ------------------------------------------------------------------ Lieb mich wenn ich wein: the tears
export const wein: BitFn = (b) => {
  const c = b.c;
  const melt = lerp(1, 1.28, ease.inQuad(b.u));
  const cy = H * 0.34;
  c.save();
  c.translate(0, cy - 150); c.scale(1, melt); c.translate(0, -(cy - 150));
  const r = shout(b, b.head, { y: cy, maxSize: 340 });
  c.restore();
  // drips from every sung glyph of the shout
  const bone = mulRGB(LIN.bone, 0.55);
  for (const sw of r.words) {
    if (b.t < sw.w.start) continue;
    const g = layout(sw.text, r.family, r.size);
    for (const gl of g.glyphs) for (let q = 0; q < 3; q++) {
      const t0 = sw.w.start + 0.12 + hash(gl.i, q, sw.w.start) * 0.9;
      if (b.t < t0) continue;
      const x = sw.x0 + gl.x + gl.w * (0.2 + 0.6 * hash(gl.i, q, 3));
      const y0 = cy - 150 + (r.base - (cy - 150)) * melt;
      const len = 1100 * Math.pow(b.t - t0, 1.7) * (0.5 + hash(gl.i, q, 4));
      b.l2.seg2(x, y0 - 10, x, y0 + len, 2 + 4 * hash(gl.i, q, 5), bone, 0.8);
      b.l2.seg2(x, y0 + len, x, y0 + len + 6, 7, bone, 0.9); // the drop
    }
  }
  if (b.tail.length) shout(b, b.tail, { y: H * 0.84, fit: W * 0.55, maxSize: 150, weight: 700 });
  mono(b.c, 'OCULAR FLUID  //  DETECTED', W - 72, 72, { size: 13, align: 'right', color: rgba('mercury', 0.9) });
};

// ------------------------------------------------------------------ Lieb mich wenn ich lach: bouncing
export const lach: BitFn = (b) => {
  const c = b.c;
  const words = [...b.head, ...b.tail];
  const text = upper(words.map((w) => w.w).join(' '));
  const fam = F.archivo(110, b.lk.weight);
  const size = Math.min(300, fitSize(text, fam, W * 0.9 * b.lk.over, 600));
  const lay = layout(text, fam, size);
  const x0 = W / 2 - lay.width / 2, base = H * 0.55;
  c.save();
  c.font = font(fam, size);
  c.textBaseline = 'alphabetic';
  let ci = 0;
  const eighth = b.beatLen / 2;
  words.forEach((w) => {
    const n = Array.from(upper(w.w)).length;
    if (b.t >= w.start - 0.03) for (let i = ci; i < ci + n; i++) {
      const gl = lay.glyphs[i]!;
      const ph = (b.t - w.start) / eighth + i * 0.37;
      const hop = Math.abs(Math.sin(Math.PI * ph)) * 90 * Math.min(1.4, b.lk.energy) * Math.exp(-(b.t - w.start) * 0.4);
      const rot = Math.sin(ph * 1.7 + i) * 0.14 * b.lk.energy;
      c.save();
      c.translate(x0 + gl.x + gl.w / 2, base - hop);
      c.rotate(rot);
      c.fillStyle = rgba(b.lk.ink, 1);
      c.fillText(gl.ch, -gl.w / 2, 0);
      c.restore();
    }
    ci += n + 1;
  });
  c.restore();
  const laugh = b.tail[b.tail.length - 1];
  mono(b.g, laugh && b.t >= laugh.start ? 'AFFECT  +0.97  (UNVERIFIED)' : 'AFFECT  ——', 72, H - 72, { size: 14, color: rgba('crimson', 1) });
};

// ------------------------------------------------------------------ Bei Tag und Nacht: the clock
export const clock24: BitFn = (b) => {
  const c = b.c;
  const cx = W / 2, cy = H / 2, R = 400;
  // the hand whips half a day on each beat
  const ang = -Math.PI / 2 + Math.PI * (b.k + ease.outExpo(clamp(b.phase * 4)));
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * TAU - Math.PI / 2;
    const day = Math.cos(a - ang) > 0;
    const l = i % 4 === 0 ? 34 : 16;
    c.strokeStyle = rgba(day ? 'bone' : 'ash', day ? 0.75 : 1);
    c.lineWidth = i % 4 === 0 ? 3 : 1.5;
    c.beginPath(); c.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); c.lineTo(cx + Math.cos(a) * (R - l), cy + Math.sin(a) * (R - l)); c.stroke();
  }
  b.g.strokeStyle = rgba('crimson', 1);
  b.g.lineWidth = 3;
  b.g.beginPath(); b.g.moveTo(cx, cy); b.g.lineTo(cx + Math.cos(ang) * (R - 50), cy + Math.sin(ang) * (R - 50)); b.g.stroke();
  b.g.beginPath(); b.g.arc(cx + Math.cos(ang) * (R - 50), cy + Math.sin(ang) * (R - 50), 9, 0, TAU); b.g.fillStyle = rgba('crimson', 1); b.g.fill();
  const [bei, tag, und, nacht] = b.line.words;
  if (bei && tag) shout(b, [bei, tag], { y: cy - 90, fit: W * 0.42, maxSize: 190 });
  if (und && nacht) shout(b, [und, nacht], { y: cy + 150, fit: W * 0.5, maxSize: 190, color: 'mercury' });
  const days = Math.floor(Math.exp(b.u * 6.5));
  mono(c, `DAY ${String(days).padStart(4, '0')}`, cx, cy + R + 60, { size: 16, align: 'center', weight: 500, color: rgba('bone', 0.8) });
  return { zoom: 1 + 0.03 * b.kick };
};

// ------------------------------------------------------------------ Lieb mich einfach so: nothing
export const einfach: BitFn = (b) => {
  // the contrast beat: a small, quiet line, nothing else
  karaoke(b.c, b.line, b.t, W / 2, H / 2 + 14, { family: F.serif(400, true), size: 46, sung: rgba('bone', 0.95), unsung: rgba('bone', 0.2) });
  return { zoom: 1, shake: [0, 0], ca: 0.6, vignette: 0.6 };
};

// ------------------------------------------------------------------ Lieb doch was ich bin: the viewer
export const viewer: BitFn = (b) => {
  const lock = clamp((b.k + ease.outBack(clamp(b.phase * 4))) / 3.2);
  drawTargetLock(b.g, W / 2, H / 2, lerp(470, 330, lock), b.t, { lock, beatPhase: b.phase });
  if (b.head.length) {
    const lieb = upper(b.head.map((w) => w.w).join(' '));
    if (b.t >= b.head[0]!.start) mono(b.c, lieb, W / 2, H * 0.28, { size: 26, weight: 600, align: 'center', tracking: 10, color: rgba('bone', 0.9) });
  }
  if (b.tail.length) shout(b, b.tail, { y: H * 0.52, fit: W * 0.5, maxSize: 200 });
  const rows = ['SUBJECT  YOU', `MATCH  ${lerp(0.62, 1, lock).toFixed(2)}`, 'DO NOT LOOK AWAY'];
  rows.forEach((s, i) => mono(b.c, s, W / 2 + 520, H / 2 - 40 + i * 28, { size: 14, color: rgba(i === 2 ? 'crimson' : 'mercury', 0.9) }));
  return { zoom: 1 + 0.02 * b.kick };
};

// ------------------------------------------------------------------ Nur so macht Liebe sinn: the equation
export const equation: BitFn = (b) => {
  const [nur, so, macht, liebe, sinn] = b.line.words;
  if (nur && so && macht) shout(b, [nur, so, macht], { y: H * 0.26, fit: W * 0.5, maxSize: 140, weight: 700 });
  let eq = { x: W / 2, y: H * 0.6 };
  if (liebe && sinn) {
    const fam = F.archivo(100, b.lk.weight);
    const size = Math.min(300, fitSize('LIEBE = SINN', fam, W * 0.86 * b.lk.over, 600));
    const L = layout('LIEBE = SINN', fam, size);
    const x0 = W / 2 - L.width / 2, base = H * 0.6 + L.ascent * 0.36;
    const c = b.c;
    c.font = font(fam, size); c.textBaseline = 'alphabetic'; c.fillStyle = rgba(b.lk.ink, 1);
    const eqX = x0 + L.glyphs[6]!.x + L.glyphs[6]!.w / 2;
    eq = { x: eqX, y: base - L.ascent * 0.3 };
    if (b.t >= liebe.start - 0.03) c.fillText('LIEBE', x0, base);
    if (b.t >= sinn.start - 0.03) {
      c.fillText('SINN', x0 + L.glyphs[8]!.x, base);
      glowText(b.g, '=', x0 + L.glyphs[6]!.x, base, fam, size, 1);
    }
  }
  // the push-in through the "=" at the end of the bar
  const zin = prog(b.t, b.t1 - 0.4, b.t1, ease.inExpo);
  return { zoom: 1 + 0.03 * b.kick, zoomAt: zin > 0 ? [eq.x, eq.y, lerp(1, 40, zin)] : undefined };
};

export const BITS: Record<string, BitFn> = {
  'Lieb mich wie ich bin': tunnel,
  'Lieb mich wie ich wär': versions,
  'Lieb mich wie du willst': panel,
  'Und noch viel mehr': multiply,
  'Lieb mich weil du kannst': kannst,
  'Lieb mich weil du musst': musst,
  'Von heut an bis zum Schluss': timeline,
  'Lieb mich wenn ich wein': wein,
  'Lieb mich wenn ich lach': lach,
  'Bei Tag und Nacht': clock24,
  'Lieb mich einfach so': einfach,
  'Lieb doch was ich bin': viewer,
  'Nur so macht Liebe sinn': equation,
};

