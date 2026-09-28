// boot_seq — the `apnea` plate (docs/TREATMENT_REVISED.MD), 0 → "Ich verzehr mich".
//
// One razor-thin 1 px bone oscilloscope trace in 3D, written by a crimson write head (the heartbeat
// is the only thing that glows), shot as macro coverage of the instrument and cut on the beat:
//  intro   the head strikes on the first downbeat and draws the line; the drum fill boots the
//          system (a hard cut on every hit, a calibration read-out each); then one idea per bar:
//          the scope (breathing, an EKG complex on every kick), a grazing run along the timebase
//          ruler, the lens iris opening in f-stops on the kicks, the focus target hunting and
//          locking, the history waterfall, the boot log, a one-beat montage, AWAITING SUBJECT.
//  "Ich halt den Atem an"   HOLD: the line is flat and nothing moves at all (no grain, no drift);
//          only the lyric types itself out under the line and the apnea counter runs.
//  "Sie ist schön wunderschön"   the line trembles, then on "schön" spikes into a jagged clipping
//          waveform with crimson halation and shake; "wunderschön" cuts on every kick between
//          3D angles while BEAUTY saturates past the top of its scale.
//  "Ich halt den Atem an" (2)   HOLD again, tighter: the jagged residue frozen, a letterbox slit.
//  "Wird sie bleiben oder gehen"   the camera rushes along the trace in depth to where it forks
//          into BLEIBEN / GEHEN (the leave branch flatlines), whips across on "oder", jumps onto the
//          other branch on "gehen", and on the last beat pitches straight down onto the LIDAR land
//          (panther's opening plunge).
import type * as THREE from 'three';
import { Scene, type Frame } from '../engine/scene';
import { Layer2D, W, H, clearRT } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { LIN, rgba } from '../engine/palette';
import type { Line, Word } from '../engine/lyrics';
import { clamp, ease, hash, lerp, noise1, prog, smoothstep, springStep, TAU } from '../engine/util';
import { drawTargetLock, mulRGB, terrain, type RGB } from './_motifs';
import { Cam, brackets, kicksIn, lastIndex, lastPulse, springs, tag, typed, v3, type Pose, type V3 } from './boot-kit';

const XH = 560; // world x of the write head (the newest sample)
const V = 620; // scroll speed: world units per second of trace
const CLIP = 470; // the scope clips here (flat tops when saturated)
const BONE = mulRGB(LIN.bone, 0.8); // crisp, below the bloom threshold
const MERC = LIN.mercury;
const ASH = mulRGB(LIN.ash, 3.2);

type Look = 'front' | 'oblique' | 'graze' | 'endon' | 'low' | 'fall' | 'focus' | 'slit';
interface Shot { t0: number; t1: number; look: Look; a: number; b: number; punch?: number; x?: 'iris' | 'star' | 'log' | 'fill' | 'await' }

const FILL_LABELS = ['CH1 ....... 1 mV/DIV', 'TIMEBASE .. 444 MS/DIV', 'TRIGGER ... KICK', 'OPTICS .... OK', 'THERMAL ... OK', 'PULSE ..... OK', 'LIDAR ..... OK', 'SUBJECT ... NONE', 'CALIBRATED'];
const LOG = ['SUBJECT PROFILE ..... LOADED', 'PATIENCE ............ UNBOUNDED', 'RESTRAINT ........... NOT FOUND', 'HEART RATE .......... 64 -> 91'];

/** EKG complex (P, Q, R, S, T) for d seconds after a beat. */
function qrs(d: number) {
  if (d < -0.2 || d > 0.3) return 0;
  const g = (m: number, s: number) => Math.exp(-((d - m) / s) * ((d - m) / s));
  return 0.1 * g(-0.11, 0.025) - 0.14 * g(-0.018, 0.007) + g(0, 0.008) - 0.3 * g(0.02, 0.009) + 0.22 * g(0.16, 0.04);
}
/** Jagged heavy-tailed noise: piecewise linear between hashed knots. */
function jag(x: number, seed: number) {
  const i = Math.floor(x), f = x - i;
  const k = (j: number) => { const h = hash(j, seed) * 2 - 1; return Math.sign(h) * Math.pow(Math.abs(h), 1.8); };
  return lerp(k(i), k(i + 1), f);
}

export default class BootSeq extends Scene {
  private L = new Layer2D();
  private ink = new LineBatch(26000, { screen2D: false, blend: 'max' });
  private glow = new LineBatch(9000, { screen2D: false, blend: 'add' });
  private C = new Cam(1, 40000);
  private h1!: Line; private sch!: Line; private h2!: Line; private wird!: Line;
  private schoen!: Word; private wunder!: Word; private bleiben!: Word; private oder!: Word; private gehen!: Word;
  private kicks: number[] = [];
  private snares: number[] = [];
  private fill: number[] = [];
  private D: number[] = [];
  private shots: Shot[] = [];
  private tSpike3d = 0; private tDecay = 0; private tPlunge = 0;

  override init() {
    const ly = this.ctx.lyrics, au = this.ctx.audio;
    this.h1 = ly.get('Ich halt den Atem an', 0);
    this.sch = ly.get('Sie ist schön');
    this.h2 = ly.get('Ich halt den Atem an', 1);
    this.wird = ly.get('Wird sie bleiben');
    this.schoen = this.sch.words[2]!;
    this.wunder = this.sch.words[3]!;
    this.bleiben = this.wird.words[2]!; this.oder = this.wird.words[3]!; this.gehen = this.wird.words[4]!;
    this.kicks = (au.onsets.kick ?? []).map((e) => e[0]);
    this.snares = (au.onsets.snare ?? []).map((e) => e[0]);
    const D = (this.D = au.downbeats.filter((d) => d < this.ctx.end + 0.01));
    const db = (t: number) => D.find((d) => d >= t - 0.12) ?? t; // first downbeat at/after t
    // the drum fill that boots the system: the dense run of hits before the groove settles
    this.fill = kicksIn(au, D[0]! + 0.3, D[2]! - 0.5);
    this.tSpike3d = db(this.wunder.start);
    this.tDecay = db(this.sch.end - 0.35);
    this.tPlunge = D.filter((d) => d < this.ctx.end - 0.2).pop()!;

    const S: Shot[] = [];
    const add = (t0: number, t1: number, look: Look, a: number, b: number, extra: Partial<Shot> = {}) => { if (t1 > t0) S.push({ t0, t1, look, a, b, ...extra }); };
    add(0, D[0]!, 'front', 0, 0.02);
    add(D[0]!, this.fill[0] ?? D[1]!, 'front', 0.02, 0.1);
    // the fill: a hard cut on every hit, pushing in a little further each time
    const cyc: Look[] = ['oblique', 'graze', 'endon', 'front', 'low', 'graze', 'oblique', 'endon', 'front'];
    this.fill.forEach((k, i) => add(k, this.fill[i + 1] ?? D[2]!, cyc[i % cyc.length]!, 0.2 + i * 0.05, 0.28 + i * 0.05, { x: 'fill' }));
    add(D[2]!, D[3]!, 'front', 0.15, 0.45, { punch: 0.05 });
    add(D[3]!, D[4]!, 'graze', 0, 0.75, { punch: 0.05 });
    add(D[4]!, D[5]!, 'endon', 0, 1, { x: 'iris' });
    add(D[5]!, D[6]!, 'focus', 0, 0.6, { x: 'star', punch: 0.04 });
    add(D[6]!, D[7]!, 'fall', 0, 0.8, { punch: 0.04 });
    add(D[7]!, D[8]!, 'front', 0.35, 0.7, { x: 'log', punch: 0.05 });
    // montage: one beat each, tighter every time
    const mont: Look[] = ['graze', 'endon', 'fall', 'low'];
    const b8 = Math.round(au.beatAt(D[8]!));
    for (let k = 0; k < 4; k++) add(au.timeOfBeat(b8 + k), k === 3 ? D[9]! : au.timeOfBeat(b8 + k + 1), mont[k]!, 0.5 + k * 0.1, 0.62 + k * 0.1);
    add(D[9]!, this.h1.start, 'front', 0.5, 0.85, { x: 'await', punch: 0.05 });
    add(this.h1.start, this.schoen.start, 'front', 0.55, 0.58);
    add(this.schoen.start, this.tSpike3d, 'front', 0.75, 0.9);
    // "wunderschön": a new angle on every kick
    const wk = kicksIn(au, this.tSpike3d, this.tDecay);
    const wl: Look[] = ['graze', 'low', 'endon', 'oblique', 'fall', 'graze'];
    wk.forEach((k, i) => add(i === 0 ? this.tSpike3d : k, wk[i + 1] ?? this.tDecay, wl[i % wl.length]!, 0.45 + 0.05 * i, 0.6 + 0.05 * i));
    add(this.tDecay, this.h2.start, 'front', 0.7, 0.85, { punch: 0.03 });
    add(this.h2.start, this.wird.start, 'slit', 0, 0.06);
    this.shots = S;
  }

  // ------------------------------------------------------------------ the signal

  /** Effective (display) time: frozen through the HOLDs. */
  private te(t: number) {
    if (t >= this.h1.start && t < this.schoen.start) return this.h1.start;
    if (t >= this.h2.start && t < this.wird.start) return this.h2.start;
    return t;
  }

  /** The recorded signal at time tau (world units). */
  private sig(tau: number) {
    if (tau < this.D[0]!) return 0;
    if (tau >= this.h1.start && tau < this.schoen.start) return 0; // the held breath: nothing recorded
    const breath = (smoothstep(4.3, 9, tau) * 55 + smoothstep(13.6, 18, tau) * 45) * Math.sin((TAU * tau) / 3.555) * (tau < this.h1.start ? 1 : 0.3);
    let ekg = 0;
    const amp = tau < 4.1 ? 120 : lerp(170, 250, smoothstep(13.6, 18.4, tau));
    const ks = this.kicks;
    let lo = 0, hi = ks.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (ks[m]! < tau - 0.3) lo = m + 1; else hi = m; }
    for (let i = lo; i < ks.length && ks[i]! < tau + 0.2; i++) ekg += qrs(tau - ks[i]!);
    let chaos = 0;
    if (tau >= this.schoen.start) {
      const a = tau < this.wunder.start ? 230 : tau < this.sch.end ? 420 : lerp(420, 0, smoothstep(this.sch.end, this.sch.end + 0.4, tau));
      chaos = a * jag(tau * 95, 7) + 0.4 * a * jag(tau * 23, 9);
    }
    return breath + amp * ekg * (tau >= this.schoen.start ? 0.5 : 1) + chaos;
  }

  /** Whole-line vibration (not recorded: the scope itself shaking), frozen with te. */
  private vib(u: number, te: number, t: number) {
    const s = this.schoen.start;
    let a = 0;
    if (te >= this.sch.start && te < s) a = 3.5 * smoothstep(this.sch.start, s, te) * noise1(u * 0.09 + t * 30, 3); // trembling
    if (te >= s) {
      const k = te < this.wunder.start ? 110 : te < this.sch.end ? 170 : lerp(170, 0, smoothstep(this.sch.end, this.sch.end + 0.5, te));
      a += k * jag(u / 11 + Math.floor(te * 40) * 17.3, 21);
    }
    return a;
  }

  /** Trace height u world units behind the head, at display time te. */
  private y(u: number, te: number, t: number) {
    if (t >= this.h1.start && t < this.schoen.start) return t >= this.sch.start ? this.vib(u, t, t) : 0; // HOLD 1: a perfect flat line
    return clamp(this.sig(te - u / V) + this.vib(u, te, t), -CLIP, CLIP);
  }

  // ------------------------------------------------------------------ cameras

  private pose(look: Look, k: number): Pose {
    const L = (a: V3, b: V3) => v3.lerp(a, b, k);
    switch (look) {
      case 'front': return { p: [lerp(0, 260, k), 0, lerp(2350, 1150, k)], look: [lerp(0, 260, k), 0, 0], fov: 30 };
      case 'oblique': return { p: L([-1150, 430, 1500], [-150, 160, 700]), look: [XH - 350, 0, 0], fov: 34, roll: -0.07 };
      case 'graze': return { p: [lerp(-2700, -700, k), 58, 150], look: [XH + 60, -20, -10], fov: 38, roll: 0.05 };
      case 'endon': return { p: [lerp(XH + 1600, XH + 260, k), 34, 80], look: [XH - 1600, -10, 0], fov: 42, roll: -0.04 };
      case 'low': return { p: L([XH - 700, -720, 820], [XH - 350, -330, 420]), look: [XH - 380, 60, 0], fov: 38, roll: 0.16 };
      case 'fall': return { p: L([-500, 760, 1650], [120, 420, 820]), look: [XH - 450, -60, -560], fov: 36, roll: -0.03 };
      case 'focus': return { p: [XH - 180, 30, lerp(1500, 820, k)], look: [XH - 180, 0, 0], fov: 30 };
      case 'slit': return { p: [lerp(XH - 360, XH - 330, k), 0, lerp(600, 540, k)], look: [lerp(XH - 360, XH - 330, k), 0, 0], fov: 30 };
    }
  }

  private shotAt(t: number) {
    let s = this.shots[0]!;
    for (const x of this.shots) if (t >= x.t0) s = x;
    return s;
  }

  // ------------------------------------------------------------------ drawing

  private trace(te: number, t: number, glowK: number, uMax = 3300, step = 2) {
    const ink = this.ink, glow = this.glow;
    const on = prog(t, this.D[0]!, this.D[0]! + 0.5, ease.outExpo); // the head strikes and draws the line out
    const uEnd = t < this.D[0]! ? 0 : lerp(0, uMax, on);
    let px = XH, py = this.y(0, te, t);
    for (let u = step; u <= uEnd; u += step) {
      const x = XH - u, yy = this.y(u, te, t);
      ink.seg(px, py, 0, x, yy, 0, 1.0, BONE[0], BONE[1], BONE[2], 1);
      const a = Math.max(Math.abs(py), Math.abs(yy));
      const g = smoothstep(70, 330, a) * glowK;
      if (g > 0.02) glow.seg(px, py, 0, x, yy, 0, 5, LIN.crimson[0] * 2.4 * g, LIN.crimson[1] * 2.4 * g, LIN.crimson[2] * 2.4 * g, 0.55);
      px = x; py = yy;
    }
  }

  private head(t: number, te: number) {
    if (t < 0.3) return;
    const beat = lastPulse(this.kicks, te, 0.09);
    const a = t < this.D[0]! ? 0.35 + 0.35 * Math.sin(t * 9) : 1;
    const y0 = this.y(0, te, t);
    const i = (1.8 + 4 * beat) * a;
    this.glow.seg(XH, y0, 0, XH, y0, 0, 7 + 5 * beat, LIN.crimson[0] * i, LIN.crimson[1] * i, LIN.crimson[2] * i, 1);
    this.glow.seg(XH, y0, 0, XH, y0, 0, 2.5, 1.2 * a, 0.35 * a, 0.3 * a, 1);
  }

  private graticule(alpha = 1) {
    if (alpha <= 0) return;
    const g = this.ink, c = mulRGB(ASH, alpha);
    for (let x = XH + 1000; x >= -2800; x -= 100) g.seg(x, -500, 0, x, 500, 0, 1, c[0], c[1], c[2], 1);
    for (let y = -500; y <= 500; y += 100) g.seg(-2800, y, 0, XH + 1000, y, 0, 1, c[0], c[1], c[2], y === 0 ? 0.5 : 1);
  }

  /** Timebase ruler under the line: a tick every 50 units, labelled every 250 (seconds back). */
  private ruler(c: CanvasRenderingContext2D, alpha: number) {
    const m = mulRGB(MERC, 0.55 * alpha);
    for (let u = 0; u <= 3000; u += 50) {
      const x = XH - u, big = u % 250 === 0;
      this.ink.seg(x, -540, 0, x, big ? -585 : -560, 0, 1, m[0], m[1], m[2], 1);
      if (big && u > 0) {
        const q = this.C.proj(x, -610, 0);
        if (q.z > 50 && q.x > 40 && q.x < W - 40 && q.y < H - 40) {
          const s = clamp(11 * (1400 / q.z), 9, 30);
          tag(c, `-${(u / V).toFixed(2)} S`, q.x, q.y + s, { size: s, align: 'center', color: rgba('mercury', 0.7 * alpha), tracking: 1 });
        }
      }
    }
    this.ink.seg(XH - 3000, -540, 0, XH, -540, 0, 1, m[0], m[1], m[2], 1);
  }

  /** The waterfall: past traces stacked back in depth, fading. */
  private waterfall(te: number, t: number) {
    for (let r = 1; r <= 9; r++) {
      const z = -r * 130, dt = r * 0.42, k = Math.pow(1 - r / 10, 1.5);
      const col = mulRGB(r < 2 ? BONE : MERC, 0.7 * k);
      let px = XH, py = this.y(0, te - dt, t);
      for (let u = 5; u <= 2600; u += 5) {
        const yy = this.y(u, te - dt, t);
        this.ink.seg(px, py, z, XH - u, yy, z, 1, col[0], col[1], col[2], 1);
        px = XH - u; py = yy;
      }
    }
  }

  /** The lens iris in front of the head, seen end-on: blades tangent to the aperture circle. */
  private iris(c: CanvasRenderingContext2D, t: number, s0: number, s1: number) {
    const ks = kicksIn(this.ctx.audio, s0, s1);
    const stops = ['22', '16', '11', '8', '5.6', '4', '2.8', '2', '1.4'];
    const n = lastIndex(ks, t) + 1; // f-stop step
    const sp = springs(ks, t, 6, 0.4);
    const open = clamp(sp / Math.max(1, ks.length));
    const a = lerp(26, 400, ease.inQuad(open));
    const xI = XH + 240, N = 9, R = 520;
    const rot = 0.9 * open + 0.05 * Math.sin(t * 2);
    const m = mulRGB(MERC, 0.75);
    // the aperture polygon, and each blade's curved edge sweeping out from its vertex to the ring
    const av = a / Math.cos(Math.PI / N);
    for (let i = 0; i < N; i++) {
      const p0 = (i / N) * TAU + rot, p1 = ((i + 1) / N) * TAU + rot;
      this.ink.seg(xI, Math.sin(p0) * av, Math.cos(p0) * av, xI, Math.sin(p1) * av, Math.cos(p1) * av, 1, m[0], m[1], m[2], 1);
      let py = Math.sin(p0) * av, pz = Math.cos(p0) * av;
      for (let j = 1; j <= 18; j++) {
        const s = j / 18, rr = lerp(av, R, s), an = p0 + s * lerp(1.3, 0.5, open);
        const yy = Math.sin(an) * rr, zz = Math.cos(an) * rr;
        this.ink.seg(xI, py, pz, xI, yy, zz, 1, m[0] * 0.8, m[1] * 0.8, m[2] * 0.8, 1);
        py = yy; pz = zz;
      }
    }
    // housing rings (lens elements the camera flies through)
    for (const [dx, rr, k] of [[0, R, 0.7], [380, 640, 0.4], [820, 760, 0.25], [-300, 460, 0.3]] as const) {
      const col = mulRGB(MERC, k);
      let py: number = rr, pz = 0;
      for (let j = 1; j <= 120; j++) {
        const th = (j / 120) * TAU, yy = Math.cos(th) * rr, zz = Math.sin(th) * rr;
        this.ink.seg(xI + dx, py, pz, xI + dx, yy, zz, 1, col[0], col[1], col[2], 1);
        py = yy; pz = zz;
      }
    }
    const stop = stops[Math.min(stops.length - 1, n)]!;
    tag(c, `APERTURE  f/${stop}`, W / 2, H - 176, { size: 16, align: 'center', color: rgba('bone', 0.85), weight: 500, tracking: 3 });
    tag(c, `IRIS ${String(Math.round(open * 100)).padStart(3, '0')}%   EXPOSURE ${(open * 12 - 6).toFixed(1)} EV`, W / 2, H - 150, { size: 12, align: 'center', color: rgba('mercury', 0.75) });
  }

  /** The focus target (a Siemens star at the head): defocused, hunting on the kicks, locking. */
  private star(c: CanvasRenderingContext2D, t: number, s0: number, s1: number) {
    const ks = kicksIn(this.ctx.audio, s0, s1);
    let d = 1 - prog(t, s0, s0 + 0.3);
    for (const k of ks) if (t >= k) d = Math.abs(Math.exp(-(t - k) * 5) * Math.sin((t - k) * 22 + 1.2)) * 0.9;
    const locked = t > (ks[ks.length - 1] ?? s1) + 0.3;
    if (locked) d = 0;
    const w = 1 + 16 * d, al = 1 / (1 + 7 * d);
    const cx = XH, cy = 0;
    const col = mulRGB(MERC, 0.85);
    for (let i = 0; i < 36; i++) {
      const th = (i / 36) * TAU;
      this.ink.seg(cx + Math.cos(th) * 30, cy + Math.sin(th) * 30, 1, cx + Math.cos(th) * 260, cy + Math.sin(th) * 260, 1, w, col[0], col[1], col[2], al * 0.8);
    }
    for (const r of [90, 170, 260]) {
      for (let j = 0; j < 90; j++) {
        const a0 = (j / 90) * TAU, a1 = ((j + 1) / 90) * TAU;
        this.ink.seg(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, 1, cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, 1, w, col[0], col[1], col[2], al);
      }
    }
    const q = this.C.proj(cx, 0, 0), r = this.C.proj(cx + 260, 0, 0).x - q.x;
    const lock = locked ? 1 : 0.15 + (0.5 * springs(this.snares.filter((s) => s >= s0 && s < s1), t, 7, 0.35)) / 2;
    drawTargetLock(c, q.x, q.y, r * 0.3, t, { lock: clamp(lock), beatPhase: this.ctx.audio.beatAt(t) % 1, alpha: 0.95, label: locked ? 'FOCUS LOCK' : 'FOCUS' });
    tag(c, locked ? 'FOCUS  3.20 M  // LOCKED' : `FOCUS  ${(3.2 + d * 9 * Math.sin(t * 7)).toFixed(2)} M`, q.x, q.y + r * 1.6 + 30, { size: 14, align: 'center', color: rgba(locked ? 'bone' : 'mercury', 0.85), weight: 500 });
  }

  // ------------------------------------------------------------------ fork (Wird sie bleiben oder gehen)

  private forkRender(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    const t0 = this.wird.start;
    // tree: trunk to F0, then three levels of forks (stay = up-left, leave = down-right)
    const F0: V3 = [0, 0, -1500];
    type B = { a: V3; d: V3; len: number; p: number; stay: boolean; depth: number; path: string };
    const br: B[] = [];
    const grow = (a: V3, p: number, depth: number, path: string, spread: number) => {
      if (depth > 3) return;
      const len = [0, 1500, 1300, 1100][depth]!;
      for (const stay of [true, false]) {
        const d = v3.norm([stay ? -spread : spread, 0, -1]);
        const b: B = { a, d, len, p: p * (stay ? 0.82 : 0.18), stay, depth, path: path + (stay ? 'S' : 'L') };
        br.push(b);
        grow(v3.add(a, v3.sc(d, len)), b.p, depth + 1, b.path, spread * 0.75);
      }
    };
    grow(F0, 1, 1, '', 0.62);
    // the camera's path: along the trunk, then the chosen lineage (stay, and from "gehen" leave)
    const leave = t >= this.gehen.start;
    const lineage = leave ? 'LSS' : 'SSS';
    const pathPt = (s: number): V3 => {
      if (s < 2100) return [0, 0, 600 - s];
      let rest = s - 2100, a = F0;
      for (let dpt = 1; dpt <= 3; dpt++) {
        const b = br.find((x) => x.depth === dpt && x.path === lineage.slice(0, dpt))!;
        if (rest < b.len || dpt === 3) return v3.add(a, v3.sc(b.d, Math.min(rest, b.len)));
        rest -= b.len; a = v3.add(a, v3.sc(b.d, b.len));
      }
      return a;
    };
    const ks = kicksIn(au, t0, this.ctx.end);
    const od = this.oder.start, ge = this.gehen.start;
    const dist = (t < od ? 300 + 1150 * ((t - t0) / (od - t0)) : t < ge ? 1450 + 350 * ((t - od) / (ge - od)) : 2350 + 900 * (t - ge)) + 110 * springs(ks, t, 5, 0.5);
    let p = v3.add(pathPt(dist), [0, 260, 0]);
    let look = v3.lerp([0, -260, -2300], v3.add(pathPt(dist + 1500), [0, -120, 0]), smoothstep(1500, 2000, dist));
    let roll = 0.04 * Math.sin(t * 3);
    // "oder": whip across to look at the other branch
    const whip = t >= this.oder.start && !leave ? prog(t, this.oder.start, this.oder.start + 0.14, ease.outExpo) : 0;
    if (whip > 0) {
      const lb = br.find((x) => x.path === 'L')!;
      look = v3.lerp(look, v3.add(lb.a, v3.sc(lb.d, 900)), whip * 0.8);
      roll += 0.22 * whip;
    }
    // the last beat: pitch straight down and dive at the land
    const dive = prog(t, this.tPlunge, this.ctx.end, ease.inOutCubic);
    if (dive > 0) {
      const down: V3 = v3.add(p, [0, -2000, -1]);
      look = v3.lerp(look, down, ease.outExpo(clamp(dive * 1.6)));
      p = v3.add(p, [0, -900 * ease.inCubic(dive), -300 * dive]);
    }
    this.C.set({ p, look, roll, fov: 44 + 8 * dive });

    // draw the trunk (the past, written) and the branches (predictions)
    const tr = (s: number, stayish: boolean, dead: number) => {
      // trace displacement at path length s: EKG on the kicks scrolling outward from the head
      const tau = t - s / (V * 1.4);
      let e = 0;
      for (const k of this.kicks) if (Math.abs(tau - k) < 0.3) e += qrs(tau - k);
      const breath = 40 * Math.sin((TAU * tau) / 3.555);
      return (stayish ? 1 : 0.06) * (190 * e + breath) * (1 - dead);
    };
    const drawPath = (a: V3, d: V3, len: number, s0: number, stayish: boolean, col: RGB, glowK: number, dead: number) => {
      let pp = v3.add(a, [0, tr(s0, stayish, dead), 0]);
      for (let s = 6; s <= len; s += 6) {
        const q = v3.add(v3.add(a, v3.sc(d, s)), [0, tr(s0 + s, stayish, dead), 0]);
        const nearK = smoothstep(150, 650, this.C.proj(q[0], q[1], q[2]).z); // no giant spikes in the lens
        if (nearK <= 0) { pp = q; continue; }
        this.ink.seg(pp[0], pp[1], pp[2], q[0], q[1], q[2], 1, col[0] * nearK, col[1] * nearK, col[2] * nearK, 1);
        const gk = glowK * nearK;
        if (gk > 0 && Math.abs(q[1] - (a[1] + d[1] * s)) > 60) this.glow.seg(pp[0], pp[1], pp[2], q[0], q[1], q[2], 4, LIN.crimson[0] * 2 * gk, LIN.crimson[1] * 2 * gk, LIN.crimson[2] * 2 * gk, 0.5);
        pp = q;
      }
    };
    drawPath([0, 0, 600], [0, 0, -1], 2100, 0, true, BONE, 0.6, 0);
    const reveal = prog(t, this.bleiben.start - 0.1, this.bleiben.start + 0.5, ease.outCubic);
    for (const b of br) {
      const k = clamp(reveal * 3 - (b.depth - 1));
      if (k <= 0) continue;
      const onPath = lineage.startsWith(b.path);
      const col = mulRGB(onPath ? BONE : b.stay ? MERC : mulRGB(MERC, 0.5), (onPath ? 1 : 0.6 / b.depth) * k);
      const sBase = 2100 + [0, 0, 1500, 2800][b.depth]!;
      const dead = b.path.includes('L') ? 0.5 : 0;
      drawPath(b.a, b.d, b.len * k, sBase, b.stay || b.path === lineage.slice(0, b.depth), col, onPath ? 0.6 : 0, dead);
    }
    // fork nodes: crimson rings where the future splits
    for (const b of br.filter((x) => x.stay)) {
      const k = clamp(reveal * 3 - (b.depth - 1));
      if (k <= 0) continue;
      const rr = b.depth === 1 ? 70 : 34, gi = (b.depth === 1 ? 1.6 : 0.9) * k;
      let pq: V3 = [b.a[0] + rr, b.a[1], b.a[2]];
      for (let j = 1; j <= 40; j++) {
        const an = (j / 40) * TAU, q: V3 = [b.a[0] + Math.cos(an) * rr, b.a[1], b.a[2] + Math.sin(an) * rr];
        this.glow.seg(pq[0], pq[1], pq[2], q[0], q[1], q[2], 1.5, LIN.crimson[0] * gi, LIN.crimson[1] * gi, LIN.crimson[2] * gi, 1);
        pq = q;
      }
    }
    // the write head rides ahead of the camera
    const hp = v3.add(pathPt(dist + 700), [0, tr(dist + 700, !leave, 0), 0]);
    const beat = lastPulse(this.kicks, t, 0.09);
    const hi = 2 + 4 * beat;
    this.glow.seg(hp[0], hp[1], hp[2], hp[0], hp[1], hp[2], 8 + 6 * beat, LIN.crimson[0] * hi, LIN.crimson[1] * hi, LIN.crimson[2] * hi, 1);

    // the land below, seen as the camera pitches down
    if (dive > 0) {
      const g0 = -2400, cx = Math.round(p[0] / 40) * 40, cz = Math.round(p[2] / 40) * 40;
      const col = mulRGB(BONE, 0.55 * smoothstep(0, 0.5, dive));
      for (let i = -34; i <= 34; i++) for (let j = -34; j <= 34; j++) {
        const x = cx + i * 40, z = cz + j * 40;
        const yy = g0 + terrain(x * 0.5, z * 0.5) * 3;
        const k = 0.45 + 0.55 * smoothstep(-60, 90, yy - g0);
        this.ink.seg(x, yy, z, x, yy, z, 2.2, col[0] * k, col[1] * k, col[2] * k, 1);
      }
    }

    // labels at the first fork (and the probability products further out)
    for (const b of br) {
      const k = clamp(reveal * 3 - (b.depth - 1));
      if (k <= 0.3) continue;
      const at = v3.add(b.a, v3.sc(b.d, b.depth === 1 ? 260 : 180));
      const q = this.C.proj(at[0], at[1] + (b.stay ? 70 : -70), at[2]);
      if (q.z < 60 || q.x < 30 || q.x > W - 30 || q.y < 30 || q.y > H - 200) continue;
      const s = b.depth === 1 ? clamp(20 * (1300 / q.z), 18, 40) : clamp(14 * (1300 / q.z), 10, 22);
      let label = b.p.toFixed(2);
      let col = rgba('mercury', 0.8 * k);
      if (b.depth === 1) {
        const recompute = t >= this.oder.start ? prog(t, this.oder.start, this.gehen.start + 0.3) : 0;
        const jit = recompute > 0 && recompute < 1 ? (hash(Math.floor(t * 20), 3) - 0.5) * 0.3 : 0;
        const pStay = lerp(0.82, 0.5, ease.inOutCubic(recompute)) + jit;
        const pv = b.stay ? pStay : 1 - pStay;
        const name = b.stay ? (t >= this.bleiben.start ? 'BLEIBEN' : '') : t >= this.gehen.start ? 'GEHEN' : '?????';
        label = `${name}  p ${pv.toFixed(2)}`;
        col = rgba(b.stay ? 'bone' : t >= this.gehen.start ? 'crimson' : 'mercury', k);
      }
      tag(c, label, q.x, q.y, { size: s, align: b.stay ? 'right' : 'left', color: col, weight: b.depth === 1 ? 500 : 400, tracking: 2 });
    }
    if (t >= this.gehen.start) tag(c, 'BRANCH  L  //  SIGNAL: FLAT', 96, 150, { size: 14, color: rgba('crimson', 0.9), weight: 500 });
  }

  // ------------------------------------------------------------------ render

  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    const t = f.t, r = this.ctx.renderer, au = this.ctx.audio;
    clearRT(r, out, LIN.void);
    const L = this.L, c = L.ctx;
    L.clear();
    this.ink.clear(); this.glow.clear();
    const te = this.te(t);
    const hold1 = t >= this.h1.start && t < this.sch.start;
    const hold2 = t >= this.h2.start && t < this.wird.start;
    const hold = hold1 || hold2;
    const spiking = t >= this.schoen.start && t < this.h2.start;
    const fork = t >= this.wird.start;
    const post = { bloom: 0.8, bloomThreshold: 0.9, bloomKnee: 0.08, vignette: 0.5, grain: 0.05, halation: 0.45, ca: 0.6, shake: [0, 0] as [number, number], zoom: 1, flash: 0 };

    if (fork) {
      this.forkRender(c, t);
    } else {
      const s = this.shotAt(t);
      const u = prog(t, s.t0, s.t1);
      const ks = s.punch ? kicksIn(au, s.t0, s.t1) : [];
      const k = lerp(s.a, s.b, hold ? u : ease.outCubic(u)) + (s.punch ?? 0) * springs(ks, t, 5, 0.42);
      this.C.set(this.pose(s.look, clamp(k, 0, 1.25)));
      const glowK = spiking ? 1 : 0.35;
      const flatLook = s.look === 'front' || s.look === 'slit' || s.look === 'focus';
      this.graticule(flatLook ? prog(t, 4.3, 5.2) * (hold ? 0.6 : 1) : 0.55 * prog(t, 2, 3));
      if (s.look === 'fall') this.waterfall(te, t);
      this.trace(te, t, glowK, s.look === 'front' || s.look === 'slit' ? 2600 : 3300, s.look === 'endon' || s.look === 'graze' ? 3 : 2);
      this.head(t, te);
      if (s.look === 'graze' || s.x === 'fill') this.ruler(c, s.look === 'graze' ? 1 : 0.5);
      if (s.x === 'iris') this.iris(c, t, s.t0, s.t1);
      if (s.x === 'star') this.star(c, t, s.t0, s.t1);

      // the fill: one calibration read-out per hit, next to the head
      if (s.x === 'fill') {
        const i = lastIndex(this.fill, t);
        const q = this.C.proj(XH, 0, 0);
        const lx = clamp(q.x + 40, 96, W - 520), ly2 = clamp(q.y - 60, 140, H - 200);
        if (i >= 0) {
          tag(c, FILL_LABELS[i % FILL_LABELS.length]!, lx, ly2, { size: 22, color: rgba('bone', 0.9), weight: 500, tracking: 3 });
          tag(c, `BOOT ${String(i + 1).padStart(2, '0')}/${String(this.fill.length).padStart(2, '0')}`, lx, ly2 + 28, { size: 12, color: rgba('crimson', 1), tracking: 3 });
        }
      }
      if (s.x === 'log') {
        const bt = au.timeOfBeat(Math.round(au.beatAt(s.t0)));
        LOG.forEach((line, i) => {
          const t1 = bt + i * (60 / au.bpm);
          if (t < t1) return;
          const n = Math.floor(line.length * prog(t, t1, t1 + 0.22));
          tag(c, line.slice(0, n), W / 2 - 330, H / 2 + 150 + i * 30, { size: 17, color: rgba(i === 2 ? 'crimson' : 'bone', i === 2 ? 1 : 0.8), weight: 500, tracking: 2 });
        });
      }
      if (s.x === 'await') {
        const on = Math.floor((t - s.t0) * 3.4) % 2 === 0;
        tag(c, on ? 'AWAITING SUBJECT_' : 'AWAITING SUBJECT', W / 2, H / 2 + 170, { size: 20, align: 'center', color: rgba('crimson', 1), weight: 500, tracking: 6 });
      }
      // "wunderschön": the lock clamps onto the tallest spike
      if (t >= this.wunder.start && t < this.h2.start) {
        let best = 0, bu = 0;
        for (let uu = 0; uu < 1800; uu += 12) { const yy = Math.abs(this.y(uu, te, t)); if (yy > best) { best = yy; bu = uu; } }
        const q = this.C.proj(XH - bu, this.y(bu, te, t), 0);
        if (q.z > 0 && q.x > 60 && q.x < W - 60 && q.y > 60 && q.y < H - 60) {
          const lk = prog(t, this.wunder.start, this.wunder.start + 0.5, ease.outExpo);
          drawTargetLock(c, q.x, q.y, 44, t, { lock: lk, beatPhase: f.beatPhase, label: 'SUBJECT', alpha: t < this.sch.end + 0.3 ? 1 : 0.5 });
        }
      }
    }

    // ------------------------------------------------ overlay: HUD, BEAUTY, lyrics
    if (hold2) {
      // tighter: the frame closes to a slit around the frozen line
      const k = prog(t, this.h2.start, this.h2.start + 0.5, ease.outExpo);
      const band = lerp(540, 250, k);
      c.fillStyle = rgba('void', 1);
      c.fillRect(0, 0, W, H / 2 - band + 40);
      c.fillRect(0, H / 2 + band - 40 + 90, W, H);
      c.strokeStyle = rgba('crimson', 0.8); c.lineWidth = 1;
      brackets(c, 96, H / 2 - band + 40, W - 192, 2 * band + 10, 24);
    }
    const tt = hold ? te : t; // telemetry freezes in the holds
    const hr = Math.round(lerp(64, 91, smoothstep(13.6, 18.4, tt)) + lerp(0, 60, smoothstep(this.schoen.start, this.wunder.end, tt)));
    const hudA = smoothstep(0.4, 1.4, t);
    tag(c, 'LM-7  //  APNEA MONITOR  //  CH1', 96, 96, { size: 13, color: rgba('mercury', 0.7 * hudA) });
    tag(c, `T+ ${tt.toFixed(2).padStart(6, '0')} S`, W - 96, 96, { size: 13, align: 'right', color: rgba('mercury', 0.7 * hudA) });
    if (t > 4) tag(c, `HR ${hr} BPM   RESP ${hold || spiking ? '00' : '12'}/MIN`, W - 96, 120, { size: 13, align: 'right', color: rgba(hr > 100 ? 'crimson' : 'mercury', 0.75) });
    if (hold) {
      const hs = hold1 ? this.h1.start : this.h2.start;
      tag(c, '■ HOLD', 96, 124, { size: 15, color: rgba('crimson', 1), weight: 600, tracking: 4 });
      const sec = t - hs;
      tag(c, `APNEA  00:${String(Math.floor(sec)).padStart(2, '0')}.${String(Math.floor((sec % 1) * 100)).padStart(2, '0')}`, 96, 150, { size: 15, color: rgba('bone', 0.85), weight: 500, tracking: 3 });
      if (hold2) tag(c, 'HOLD 2/2  //  TIGHTER', 96, 176, { size: 12, color: rgba('mercury', 0.7) });
    }
    // BEAUTY, deadpan, saturating on "wunderschön"
    if (t >= this.sch.start && t < this.h2.start) {
      const b = t < this.schoen.start ? lerp(0.61, 0.74, prog(t, this.sch.start, this.schoen.start))
        : t < this.wunder.start ? lerp(0.93, 0.998, prog(t, this.schoen.start, this.wunder.start, ease.outCubic))
          : 1 + Math.pow(prog(t, this.wunder.start, this.sch.end), 2.2) * 98;
      const over = b > 1;
      const x = 96, y = H - 150, w = 360;
      c.save();
      c.strokeStyle = rgba('mercury', 0.6); c.lineWidth = 1;
      c.strokeRect(x + 0.5, y + 0.5, w, 10);
      c.fillStyle = rgba(over ? 'crimson' : 'bone', over ? 1 : 0.85);
      const fillW = over ? w + Math.min(W - 2 * x - w, (b - 1) * 30) : w * b;
      c.fillRect(x + 2, y + 2, fillW - 3, 7);
      c.restore();
      const val = over ? (b > 9.99 ? 'ERR  >SCALE' : b.toFixed(3)) : b.toFixed(3);
      tag(c, `BEAUTY  ${val}`, x, y - 12, { size: 15, color: rgba(over ? 'crimson' : 'bone', 0.95), weight: 500, tracking: 3 });
      if (over) tag(c, 'CLIPPING  //  SENSOR SATURATED', x, y + 34, { size: 12, color: rgba('crimson', 0.9) });
    }
    // the lyric, typed in Plex Mono under the line
    const ly = this.ctx.lyrics;
    for (const l of [this.h1, this.sch, this.h2, this.wird]) {
      const vis = t >= l.start - 0.05 && t < (l === this.wird ? this.ctx.end + 1 : l.end + 0.9);
      if (!vis) continue;
      const next = ly.lines[l.i + 1];
      if (next && t >= next.start - 0.05 && l !== this.wird) continue;
      const a = l === this.wird ? 1 : 1 - smoothstep(l.end + 0.5, l.end + 0.9, t);
      const y = fork ? H - 170 : H / 2 + 175;
      typed(c, l, t, W / 2, y, { size: spiking && l === this.sch ? 50 : 44, align: 'center', weight: 500, alpha: a, dim: 0, tracking: 1, plate: 18 });
    }

    this.ink.render(r, out, this.C.cam);
    this.glow.render(r, out, this.C.cam);
    this.ctx.comp.draw(r, L.upload(), out, { mode: 'normal' });

    // post: absolute stillness in the holds, violence in the spikes
    if (hold) { post.grain = 0; post.ca = 0; post.halation = 0.2; }
    if (spiking) {
      const a = t < this.wunder.start ? 9 : t < this.sch.end ? 16 : lerp(14, 2, smoothstep(this.sch.end, this.h2.start, t));
      const kick = au.hit('kick', t, 0.08);
      post.shake = [a * (noise1(t * 43, 1) + 0.8 * kick * noise1(t * 90, 4)), a * (noise1(t * 47, 2) + 0.8 * kick * noise1(t * 90, 6))];
      post.ca = 1.5 + 3 * kick;
      post.halation = 0.9;
      post.zoom = 1 + 0.03 * springStep(t - this.schoen.start, 3, 0.3) * (t < this.tSpike3d ? 1 : 0);
    }
    if (fork) { post.ca = 1 + 2 * au.hit('kick', t, 0.1); post.shake = [4 * au.hit('kick', t) * noise1(t * 60, 3), 4 * au.hit('kick', t) * noise1(t * 60, 5)]; }
    return post;
  }
}
