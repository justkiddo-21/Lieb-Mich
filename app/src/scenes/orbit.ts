// orbit — "Inescapable Gravity", the first half of the tether sequence (docs/TREATMENT_REVISED.MD:
// `tether`, with the `apnea` freeze). A Lorenz attractor in 3D; the crimson spark (the target) is
// trapped on it, dragging a red line. A real perspective camera, a new angle on every downbeat
// (and on most words), always pushing in; the picture holds its breath while the cuts keep
// landing on the beat.
//
//  interlude  the attractor draws itself from 28 heads while the camera chases the spark like a
//             comet: tight chase → profile track → wide 3/4 → inside each wing's eye (the loops
//             circle the lens) → head-on → overhead spin → the frontal approach.
//  "Ich halt den Atem an"  the system clock brakes on "halt" and stops: spark, sparks, camera and
//             breath trace freeze mid-orbit (Δt 0.000, SYSTEM HOLD); the lens keeps cutting in on
//             the beats and words (frozen wide → CU on "Atem" → reverse → XCU on "an").
//  "Du bist schön so wunderschön"  time restarts with a jolt; "schön" is a violent crimson spike
//             (the wire jags like an EKG, the spark burns, shake); "wunderschön" rams the camera in
//             while the red line spreads across the whole attractor.
//  "Ich halt den Atem an" (2)  a hard stop on "halt", then a frozen moment shot from a ring of
//             cameras: a hard cut per beat round the frozen spark, each one closer.
//  "Du bezahlst"  a thermal receipt prints out of a slot in the foreground (ESPRESSO 2,40 …
//             BLICKE ERWIDERT 0), stamped BEZAHLT on the beat.
//  "und willst schon gehen"  the receipt is torn off, the attractor unravels in a spiral that
//             drags the camera round; on "gehen" the spark reaches escape velocity and the camera
//             chases it out into the void, ending top-down: the tether (telemetry) picks it up.
import * as THREE from 'three';
import { Scene, type Frame } from '../engine/scene';
import { Layer2D, W, H, clearRT } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { LIN, rgba } from '../engine/palette';
import { norm, type Line, type Word } from '../engine/lyrics';
import { clamp, ease, frameIdx, hash, lerp, noise1, prog, smoothstep } from '../engine/util';
import { drawTargetLock, mono } from './_motifs';
import { aim, breathTrace, Clock, Glow, hitEnv, lyricLog, project, shakeXY, sparkHead, sparkShed, v3, type Pose, type V3 } from './orbit-kit';
import { Receipt, RECEIPT } from './orbit-receipt';

const N = 14000; // attractor samples
const SIGMA = 10, RHO = 28, BETA = 8 / 3;
const K = 28; // strands the attractor draws itself with
const LS = Math.floor(N / K);
const RATE = 150; // samples per system second (the spark's speed on the curve)
const S0 = 1800; // the spark's start index
const EYE = Math.sqrt(BETA * (RHO - 1));

function wordOf(l: Line, s: string): Word {
  const q = norm(s);
  return l.words.find((w) => norm(w.w) === q) ?? l.words.find((w) => norm(w.w).includes(q)) ?? l.words[0]!;
}

interface Shot { t0: number; pose: (t: number, tau: number) => Pose; lock?: boolean; wide?: boolean; pred?: boolean; name: string }

export default class Orbit extends Scene {
  private L = new Layer2D();
  private wire = new LineBatch(N + 200, { screen2D: false, blend: 'max' }); // the attractor: no additive glare
  private batch = new LineBatch(3000, { screen2D: false, blend: 'add' }); // the crimson: glows
  private cam = new THREE.PerspectiveCamera(50, W / H, 0.05, 2000);
  private P = new Float32Array(N * 3); // world: (x, z - 25, y) of the Lorenz system
  private J = new Float32Array(N * 3); // per-sample jag direction
  private X = new Float32Array(N * 3); // transformed positions this frame
  private receipt!: Receipt;
  private glow = new Glow();
  private clock!: Clock;
  private shots: Shot[] = [];
  private nP: V3 = [0, 0, 1]; private nM: V3 = [0, 0, 1]; // wing plane normals
  private T = {
    A1: null as unknown as Line, S1: null as unknown as Line, A2: null as unknown as Line, B: null as unknown as Line,
    h1: 0, atem1: 0, an1: 0, du1: 0, schoen: 0, wunder: 0, wunderEnd: 0, ich2: 0, h2: 0, du2: 0,
    bez: 0, stamp: 0, willst: 0, tear: 0, gehen: 0, top: 0, db: [] as number[], beats: [] as number[],
  };

  override init() {
    // integrate once (RK4, fixed start): the same curve every run
    let x = 0.1, y = 0, z = 0;
    const d = (x: number, y: number, z: number) => [SIGMA * (y - x), x * (RHO - z) - y, x * y - BETA * z] as const;
    const h = 0.006;
    for (let i = -800; i < N; i++) {
      const k1 = d(x, y, z), k2 = d(x + h / 2 * k1[0], y + h / 2 * k1[1], z + h / 2 * k1[2]);
      const k3 = d(x + h / 2 * k2[0], y + h / 2 * k2[1], z + h / 2 * k2[2]), k4 = d(x + h * k3[0], y + h * k3[1], z + h * k3[2]);
      x += (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
      y += (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
      z += (h / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]);
      if (i >= 0) { this.P[i * 3] = x; this.P[i * 3 + 1] = z - 25; this.P[i * 3 + 2] = y; }
    }
    for (let i = 0; i < N; i++) for (let a = 0; a < 3; a++) this.J[i * 3 + a] = hash(i, a + 1) * 2 - 1;
    // wing plane normals (the loops circle the two fixed points)
    const cP: V3 = [EYE, RHO - 1 - 25, EYE], cM: V3 = [-EYE, RHO - 1 - 25, -EYE];
    let nP: V3 = [0, 0, 0], nM: V3 = [0, 0, 0];
    for (let i = 0; i < N - 1; i++) {
      const p: V3 = [this.P[i * 3]!, this.P[i * 3 + 1]!, this.P[i * 3 + 2]!], q: V3 = [this.P[i * 3 + 3]!, this.P[i * 3 + 4]!, this.P[i * 3 + 5]!];
      if (p[0] > 0) nP = v3.add(nP, v3.cross(v3.sub(p, cP), v3.sub(q, cP)));
      else nM = v3.add(nM, v3.cross(v3.sub(p, cM), v3.sub(q, cM)));
    }
    this.nP = v3.norm(nP); this.nM = v3.norm(nM);
    this.receipt = new Receipt();

    const ly = this.ctx.lyrics, au = this.ctx.audio, T = this.T;
    const { start, end } = this.ctx;
    const lines = ly.linesIn(start, end);
    const atems = lines.filter((l) => l.text.startsWith('Ich halt'));
    T.A1 = atems[0]!; T.A2 = atems[1] ?? atems[0]!;
    T.S1 = lines.find((l) => l.text.startsWith('Du bist'))!;
    T.B = lines.find((l) => l.text.startsWith('Du bezahlst'))!;
    T.h1 = wordOf(T.A1, 'halt').start; T.atem1 = wordOf(T.A1, 'Atem').start; T.an1 = wordOf(T.A1, 'an').start;
    T.du1 = T.S1.words[0]!.start; T.schoen = wordOf(T.S1, 'schön').start;
    const wu = wordOf(T.S1, 'wunderschön'); T.wunder = wu.start; T.wunderEnd = wu.end;
    T.ich2 = T.A2.words[0]!.start; T.h2 = wordOf(T.A2, 'halt').start;
    T.du2 = T.B.words[0]!.start; T.bez = wordOf(T.B, 'bezahlst').start; T.willst = wordOf(T.B, 'willst').start; T.gehen = wordOf(T.B, 'gehen').start;
    T.db = au.downbeats.filter((b) => b >= start - 0.01 && b < end);
    T.beats = au.beats.filter((b) => b >= start - 0.01 && b < end + 0.5);
    const beatAfter = (t: number) => T.beats.find((b) => b >= t - 0.02) ?? t;
    T.stamp = beatAfter(T.bez + 0.5);
    T.tear = beatAfter(T.willst + 0.3);
    T.top = beatAfter(T.gehen + 0.3);

    this.clock = new Clock(start, [
      [start, 1],
      [T.h1, 1], [T.h1 + 0.3, 0], // the brake on "halt"
      [T.du1, 0], [T.du1 + 0.02, 1.8], [T.du1 + 0.3, 1],
      [T.schoen, 1], [T.schoen + 0.02, 3.2], [T.schoen + 0.45, 1],
      [T.wunder, 1], [T.wunder + 0.02, 2.4], [T.wunder + 0.6, 1.1],
      [T.h2 - 0.02, 1.1], [T.h2, 0], // the hard stop
      [T.du2, 0], [T.du2 + 0.02, 1.6], [T.du2 + 0.3, 1],
      [T.gehen, 1], [T.gehen + 0.02, 2.4], [end + 1, 2.4],
    ]);
    this.buildShots();
  }

  // ---------------------------------------------------------------- the system
  private get tauEsc() { return this.clock.tau(this.T.gehen); }
  private idx(tau: number) { return S0 + RATE * tau; }
  /** Attractor sample i (fractional), transformed by the decay spiral `dec`. */
  private pt(i: number, dec: number): V3 {
    const a = clamp(Math.floor(i), 0, N - 2), u = clamp(i - a, 0, 1), P = this.P;
    const p: V3 = [lerp(P[a * 3]!, P[a * 3 + 3]!, u), lerp(P[a * 3 + 1]!, P[a * 3 + 4]!, u), lerp(P[a * 3 + 2]!, P[a * 3 + 5]!, u)];
    return dec > 0 ? this.unravel(p, i, dec) : p;
  }
  private unravel(p: V3, i: number, dec: number): V3 {
    // the orbit loses its hold: samples spiral outward about the vertical axis (later ones first)
    const a = dec * (0.25 + (i / N) * 1.8);
    const rr = 1 + a * a * 2.6;
    const ang = a * 2.6;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    return [(p[0] * ca - p[2] * sa) * rr, p[1] * (1 + a * 0.6) + a * a * 8, (p[0] * sa + p[2] * ca) * rr];
  }
  private dec(t: number) { return prog(t, this.T.willst, this.ctx.end + 0.2, ease.inQuad); }
  /** The spark at system time tau (on the curve; after "gehen" flung out along its tangent). */
  spark(tau: number, dec: number): V3 {
    const te = this.tauEsc;
    if (tau <= te) return this.pt(this.idx(tau), dec);
    const s = this.idx(te);
    const p0 = this.pt(s, dec), dir = v3.norm(v3.sub(p0, this.pt(s - 4, dec)));
    const dt = tau - te;
    const side = v3.norm(v3.cross(dir, [0, 1, 0]));
    return v3.add(v3.add(p0, v3.sc(dir, 30 * dt + 90 * dt * dt)), v3.sc(side, 6 * Math.sin(dt * 5) * dt));
  }
  private sparkDir(tau: number, dec: number, span = 0.12): V3 {
    return v3.norm(v3.sub(this.spark(tau, dec), this.spark(tau - span, dec)));
  }

  // ---------------------------------------------------------------- camera
  private buildShots() {
    const T = this.T, db = T.db, st = this.ctx.start;
    const D = (i: number) => db[i] ?? st + i * 1.78;
    const beat = (t: number) => T.beats.find((b) => b >= t - 0.02) ?? t;
    const beatsIn = (a: number, b: number) => T.beats.filter((x) => x > a + 0.05 && x < b - 0.05);
    const kz = (t: number) => 1 - 0.07 * this.ctx.audio.hit('kick', t, 0.09); // fov punch on kicks (frozen or not)
    const up: V3 = [0, 1, 0];
    const chase = (tau: number, dec: number, dist: number, lift: number, side = 0, fov = 55): Pose => {
      const p = this.spark(tau, dec), dir = this.sparkDir(tau, dec, 0.14);
      const sd = v3.norm(v3.cross(dir, up));
      return { p: v3.add(v3.add(v3.sub(p, v3.sc(dir, dist)), v3.sc(up, lift)), v3.sc(sd, side)), tg: v3.add(p, v3.sc(dir, 3)), roll: 0, fov };
    };
    const orbitCam = (ang: number, elev: number, r: number, tg: V3, fov: number, roll = 0): Pose => ({
      p: [tg[0] + Math.sin(ang) * Math.cos(elev) * r, tg[1] + Math.sin(elev) * r, tg[2] - Math.cos(ang) * Math.cos(elev) * r], tg, roll, fov,
    });
    const u = (t: number, a: number, b: number, e = ease.linear) => prog(t, a, b, e);
    const eyeP: V3 = [EYE, RHO - 1 - 25, EYE], eyeM: V3 = [-EYE, RHO - 1 - 25, -EYE];
    const S: Shot[] = [];
    // interlude — bar 1: the ignition, tight on the comet; beat 3: profile
    const b3 = beat(st + 0.8);
    S.push({ t0: st, name: 'chase', pred: true, pose: (t, tau) => chase(tau, 0, lerp(7, 4.2, u(t, st, b3)), 1.4, 0.8, 58 * kz(t)) });
    S.push({ t0: b3, name: 'profile', pred: true, pose: (t, tau) => chase(tau, 0, 1.5, 0.5, lerp(11, 8, u(t, b3, D(1))), 42 * kz(t)) });
    // bar 2: wide 3/4, the attractor drawing itself
    S.push({ t0: D(1), name: 'wide', wide: true, pose: (t) => orbitCam(0.75 + 0.22 * u(t, D(1), D(2)), 0.3, lerp(92, 70, u(t, D(1), D(2), ease.outCubic)), [0, 0, 0], 45 * kz(t)) });
    // bar 3: inside the eyes of the wings, the loops circling the lens
    const inEye = (c: V3, n: V3, t: number, a: number, b: number): Pose => {
      const k = u(t, a, b, ease.outCubic);
      const p = v3.add(c, v3.sc(n, lerp(-16, -9, k)));
      return { p, tg: v3.add(c, v3.sc(n, 10)), roll: lerp(0, 0.5, k) + 0.3 * noise1(t * 0.7, 3), fov: 78 * kz(t) };
    };
    const half3 = beat(D(2) + 0.85);
    S.push({ t0: D(2), name: 'eye+', pose: (t) => inEye(eyeP, this.nP, t, D(2), half3) });
    S.push({ t0: half3, name: 'eye-', pose: (t) => inEye(eyeM, this.nM, t, half3, D(3)) });
    // bar 4: head-on (the comet comes at us), then an overhead spin
    const half4 = beat(D(3) + 0.85);
    S.push({ t0: D(3), name: 'headon', pred: true, pose: (t, tau) => {
      const p = this.spark(tau + 0.07, 0), q = this.spark(tau, 0);
      const dir = v3.norm(v3.sub(p, q));
      return { p: v3.add(v3.add(q, v3.sc(dir, lerp(12, 7, u(t, D(3), half4)))), [0, 1.2, 0]), tg: q, roll: 0.2, fov: 50 * kz(t) };
    } });
    S.push({ t0: half4, name: 'overhead', wide: true, pose: (t) => ({ p: [0, lerp(78, 58, u(t, half4, D(4), ease.outCubic)), 0.01], tg: [0, 0, 0], roll: 0, fov: 50 * kz(t), up: [Math.sin(t * 1.3), 0, Math.cos(t * 1.3)] }) });
    // bar 5 → the first line: the frontal approach (the butterfly), pushing in towards the spark
    const tauH1 = this.clock.tau(T.h1 + 0.3);
    const approach = (t: number, tau: number): Pose => {
      const k = clamp((tau - this.clock.tau(D(4))) / Math.max(0.1, tauH1 - this.clock.tau(D(4))));
      const kk = ease.inOutQuad(k);
      const sp = this.spark(tau, 0);
      const tg = v3.lerp([0, 0, 0], sp, lerp(0.15, 0.55, kk));
      return { p: v3.add(tg, [lerp(8, 3, kk), lerp(4, 2, kk), lerp(-86, -44, kk)]), tg, roll: lerp(0, -0.06, kk), fov: 44 * kz(t) };
    };
    S.push({ t0: D(4), name: 'approach', wide: true, pose: (t, tau) => approach(t, tau) });
    // frozen: the lens keeps cutting on the beats and words while nothing in the frame moves
    const frozenAt = (ang: number, elev: number, dist: number, roll: number, fov: number) => (t: number, tau: number): Pose => {
      const sp = this.spark(tau, 0);
      const from = approach(T.h1, this.clock.tau(T.h1)).p;
      const base = Math.atan2(sp[0] - from[0], -(sp[2] - from[2]));
      return orbitCam(base + ang, elev, dist, sp, fov * kz(t), roll);
    };
    const fb = beatsIn(T.h1 + 0.3, T.du1);
    const fz: Shot[] = [
      { t0: fb[0] ?? T.h1 + 0.45, name: 'frozenWide', wide: true, lock: true, pose: frozenAt(0.9, 0.35, 40, 0, 44) },
      { t0: T.atem1, name: 'freezeCU', lock: true, pose: frozenAt(0.25, 0.1, 9, 0.04, 38) },
      { t0: beat(T.atem1 + 0.2), name: 'freezeRev', lock: true, pose: frozenAt(2.6, -0.15, 7, -0.08, 38) },
      { t0: T.an1, name: 'freezeXCU', lock: true, pose: frozenAt(0.1, 0.05, 4.2, -0.12, 34) },
    ];
    S.push(...fz.filter((s, i) => i === 0 || s.t0 > fz[i - 1]!.t0 + 0.1));
    // "Du bist schön": time restarts — a low side track; "schön": the spike; "wunderschön": ram in
    S.push({ t0: T.du1, name: 'restart', pred: true, pose: (t, tau) => chase(tau, 0, lerp(3, 1.5, u(t, T.du1, T.schoen)), -1.5, lerp(9, 6, u(t, T.du1, T.schoen)), 48 * kz(t)) });
    S.push({ t0: T.schoen, name: 'spike', pose: (t, tau) => {
      const sp = this.spark(tau, 0);
      return orbitCam(2.2 + 0.1 * u(t, T.schoen, T.wunder), 0.25, lerp(24, 18, u(t, T.schoen, T.wunder, ease.outCubic)), sp, 46 * kz(t), 0.1);
    } });
    S.push({ t0: T.wunder, name: 'ram', pose: (t, tau) => {
      const k = u(t, T.wunder, T.wunderEnd, ease.inCubic);
      const c = chase(tau, 0, lerp(34, 4, k), lerp(9, 1.2, k), lerp(-14, -1, k), lerp(55, 44, k) * kz(t));
      c.roll = 0.25 * Math.sin(t * 3.1) * (1 - k * 0.5);
      return c;
    } });
    // the gap: overhead, both wings, calm before the second hold
    const gap = db.find((x) => x > T.wunderEnd - 0.2) ?? T.wunderEnd;
    if (gap < T.ich2 - 0.3) S.push({ t0: gap, name: 'overhead2', wide: true, pose: (t, tau) => {
      const sp = this.spark(tau, 0);
      const tg = v3.lerp([0, 0, 0], sp, 0.3);
      return { p: [tg[0], tg[1] + lerp(70, 52, u(t, gap, T.ich2, ease.outCubic)), tg[2] + 0.01], tg, roll: 0, fov: 48 * kz(t), up: [Math.cos(0.8 + t * 0.2), 0, Math.sin(0.8 + t * 0.2)] };
    } });
    // second hold: a side medium, the hard stop on "halt", then the frozen moment from a ring of
    // cameras — a hard cut every beat, each closer
    S.push({ t0: T.ich2, name: 'side2', pose: (t, tau) => orbitCam(-0.6, 0.2, lerp(30, 24, u(t, T.ich2, T.h2)), this.spark(tau, 0), 44 * kz(t)) });
    const ring = [T.h2 + 0.02, ...beatsIn(T.h2 + 0.15, T.du2)];
    ring.forEach((t0, n) => {
      const ang = -0.6 + 0.95 * (n + 1) * (n % 2 ? -1 : 1) + n * 0.4, dist = Math.max(4.5, 20 - 3.6 * n), elev = [0.2, -0.3, 0.5, 0.05, -0.15, 0.3][n % 6]!;
      S.push({ t0, name: `ring${n}`, lock: true, pose: (t, tau) => {
        const k = u(t, t0, t0 + 0.45);
        return orbitCam(ang + 0.06 * k, elev, dist * (1 - 0.05 * k), this.spark(tau, 0), (40 - n * 1.5) * kz(t), (n % 2 ? 0.08 : -0.06));
      } });
    });
    // "Du bezahlst": the attractor right of frame, the receipt printing on the left
    S.push({ t0: T.du2, name: 'receipt', wide: true, pose: (t, tau) => {
      const k = u(t, T.du2, T.willst, ease.outCubic);
      const sp = this.spark(tau, 0);
      const tg = v3.lerp([0, 0, 0], sp, 0.4);
      return { p: v3.add(tg, [lerp(-30, -24, k), lerp(8, 5, k), lerp(-62, -48, k)]), tg: v3.add(tg, [-14, 0, 0]), roll: 0.03, fov: 44 * kz(t) };
    } });
    // "und willst": the spiral drags the camera round the spark, pushing in
    S.push({ t0: T.willst, name: 'spiral', wide: true, pose: (t, tau) => {
      const dec = this.dec(t);
      const sp = this.spark(tau, dec);
      const k = u(t, T.willst, T.gehen, ease.inQuad);
      const a = k * 4.2;
      const r = lerp(26, 9, k);
      return { p: v3.add(sp, [Math.sin(a) * r, lerp(10, 3, k), -Math.cos(a) * r]), tg: sp, roll: k * k * 2.4, fov: lerp(48, 60, k) };
    } });
    // "gehen": escape velocity — chase it out; the last beat, top-down over the void (→ tether)
    S.push({ t0: T.gehen, name: 'escape', pose: (t, tau) => chase(tau, this.dec(t), lerp(9, 5, u(t, T.gehen, T.top)), 2, 1.5, 62) });
    S.push({ t0: T.top, name: 'top', pose: (t, tau) => {
      const dec = this.dec(t);
      const sp = this.spark(tau, dec), dir = this.sparkDir(tau, dec, 0.1);
      return { p: v3.add(sp, [0, lerp(34, 22, u(t, T.top, this.ctx.end, ease.outCubic)), 0]), tg: sp, roll: 0, fov: 50, up: dir };
    } });
    this.shots = S.sort((a, b) => a.t0 - b.t0);
  }

  private shotAt(t: number) {
    let s = this.shots[0]!;
    for (const x of this.shots) if (x.t0 <= t) s = x;
    return s;
  }

  // ---------------------------------------------------------------- render
  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    const t = f.t, r = this.ctx.renderer, au = this.ctx.audio, T = this.T;
    const { start, end } = this.ctx;
    const tau = this.clock.tau(t);
    const rate = this.clock.rate(t);
    const frozen = rate < 0.02;
    const dec = this.dec(t);
    clearRT(r, out, LIN.void);

    const shot = this.shotAt(t);
    const pose = shot.pose(t, tau);
    // spikes: "schön", "wunderschön" (and the vocal on its long note)
    const spike = Math.max(hitEnv(t, T.schoen, 0.28), hitEnv(t, T.wunder, 0.22) * 0.9, t > T.wunder && t < T.wunderEnd ? 0.35 * au.env('vocal', t) : 0);
    const shake = shakeXY(t, spike * 1.2 + dec * 0.4, 26);
    const cam = aim(this.cam, pose);
    const cp: V3 = pose.p;

    // --- the attractor: strands drawing themselves, depth-cued, jagged on the spikes, unravelling
    const wb = this.wire, b = this.batch;
    wb.clear(); b.clear();
    const si = this.idx(Math.min(tau, this.tauEsc));
    const drawK = (k: number) => prog(tau, 0.4 + (k / K) * 3.6 + hash(k, 3) * 0.6, 2.0 + (k / K) * 3.6 + hash(k, 3) * 0.6, ease.inOutQuad);
    // the red line spreads over the attractor on "wunderschön", then recedes
    const spread = spreadAt(t, T.wunder, T.wunderEnd, T.ich2);
    const merc = LIN.mercury, cr = LIN.crimson;
    const jagA = spike * 1.3;
    const fi = frameIdx(t);
    const X = this.X, P = this.P, Jv = this.J;
    for (let i = 0; i < N; i++) {
      let x = P[i * 3]!, y = P[i * 3 + 1]!, z = P[i * 3 + 2]!;
      if (jagA > 0.01) {
        const h = hash(i, fi) * jagA;
        x += Jv[i * 3]! * h; y += Jv[i * 3 + 1]! * h; z += Jv[i * 3 + 2]! * h;
      }
      if (dec > 0) [x, y, z] = this.unravel([x, y, z], i, dec);
      X[i * 3] = x; X[i * 3 + 1] = y; X[i * 3 + 2] = z;
    }
    const fogL = shot.wide ? 150 : 70;
    for (let i = 1; i < N; i++) {
      const k = Math.floor(i / LS);
      const rev = drawK(k) * LS;
      const local = i - k * LS;
      const byspark = i >= S0 && i <= si;
      if (local > rev && !byspark) continue;
      const ax = X[i * 3 - 3]!, ay = X[i * 3 - 2]!, az = X[i * 3 - 1]!, bx = X[i * 3]!, by = X[i * 3 + 1]!, bz = X[i * 3 + 2]!;
      const dx = bx - cp[0], dy = by - cp[1], dz = bz - cp[2];
      const dd = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const fog = Math.exp(-dd / fogL) * smoothstep(0.4, 3, dd);
      if (fog < 0.01) continue;
      const kk = 0.5 * fog;
      // the head of each strand still drawing: a bone glint
      const head = local <= rev && rev < LS ? Math.exp(-(rev - local) / 6) : 0;
      const red = spread > 0 ? clamp(1 - Math.abs(i - si) / Math.max(1, spread)) : 0;
      const cR = lerp(merc[0] * kk, cr[0] * 0.75 * fog, red) + head * 0.55;
      const cG = lerp(merc[1] * kk, cr[1] * 0.75 * fog, red) + head * 0.53;
      const cB = lerp(merc[2] * kk, cr[2] * 0.75 * fog, red) + head * 0.5;
      wb.seg(ax, ay, az, bx, by, bz, 1 + head * 1.5 + spike * 0.6, cR, cG, cB, 1);
    }

    // --- the red line the spark drags, and the spark
    const tailN = 150;
    const tailSpan = lerp(1.1, 3.2, smoothstep(T.gehen, T.gehen + 0.3, t)); // system seconds of trail
    let prev = this.spark(tau - tailSpan, dec);
    for (let j = tailN - 1; j >= 0; j--) {
      const q = this.spark(tau - (j / tailN) * tailSpan, dec);
      const kk = Math.pow(1 - j / tailN, 1.6);
      const w = 1 + 3 * kk;
      wb.seg(prev[0], prev[1], prev[2], q[0], q[1], q[2], w, cr[0] * (0.35 + 2.4 * kk), cr[1] * (0.35 + 2.4 * kk), cr[2] * (0.35 + 2.4 * kk), 1);
      prev = q;
    }
    const sp = this.spark(tau, dec);
    sparkShed(b, tau, (tt) => this.spark(tt, dec), { rate: 70, life: 0.45, speed: 7, k: 1 + spike });
    sparkHead(b, sp, 1 + spike * 2.5, 1 + spike * 1.2);
    // the targeting system's prediction: a dashed bone path 0.6 s ahead of the spark (chase shots)
    if (shot.pred && t < T.gehen) {
      const bo = LIN.bone;
      let q0 = sp;
      for (let j = 1; j <= 48; j++) {
        const q1 = this.spark(tau + (j / 48) * 0.6, dec);
        const a = 0.55 * (1 - j / 48);
        if (j % 2 === 0) b.seg(q0[0], q0[1], q0[2], q1[0], q1[1], q1[2], 1.3, bo[0] * a, bo[1] * a, bo[2] * a, 1);
        q0 = q1;
      }
    }
    wb.render(r, out, cam);
    b.render(r, out, cam);
    // the burn: a crimson bloom that floods the frame on the spikes
    const gs = project(cam, sp);
    this.glow.begin();
    if (spike > 0.05 && !gs.behind) this.glow.add(gs.x, gs.y, 900 * (0.4 + spike), spike * 0.9);
    this.glow.draw(r, this.ctx.comp, out, 1.7);

    // --- the receipt ("Du bezahlst")
    if (t >= T.du2 - 0.05 && t < T.tear + 0.9) {
      const printed = clamp((t - T.du2) / 0.1 + 0.6, 0, RECEIPT.length); // a line every ~sixteenth
      const tear = prog(t, T.tear, T.tear + 0.75, ease.inQuad);
      const kick = hitEnv(t, T.stamp, 0.08);
      this.receipt.render(r, out, {
        printed, stamp: t >= T.stamp ? 1 : 0, tear, opacity: 1 - smoothstep(0.6, 1, tear),
        slot: [-3.9, -2.1, -9.5], rot: [-0.12, 0.42, 0.035], camJitter: [kick * 0.05 + noise1(t * 30, 2) * 0.004, noise1(t * 30, 5) * 0.004],
      });
    }

    // --- HUD
    const L = this.L, c = L.ctx;
    L.clear();
    const ps = project(cam, sp);
    if (shot.lock && !ps.behind) {
      drawTargetLock(c, ps.x, ps.y, shot.wide ? 30 : 46, t, { lock: frozen ? 1 : 0.5, beatPhase: f.beatPhase, label: frozen ? 'TARGET HELD' : 'TARGET' });
    } else if (t < (T.db[1] ?? start + 1.8) && !ps.behind) {
      // the first bar: the system acquires the spark (the lock clamps on the snares)
      const acq = prog(t, start + 0.1, (T.db[1] ?? start + 1.8) - 0.2, ease.inQuad);
      const sn = au.hit('snare', t, 0.1);
      drawTargetLock(c, ps.x, ps.y, 40 * (1 + 0.4 * (1 - sn)), t, { lock: acq, beatPhase: f.beatPhase, label: acq > 0.95 ? 'TARGET 01  LOCKED' : `ACQUIRING ${(acq * 100).toFixed(0).padStart(2, '0')}%` });
    }
    this.hud(c, t, tau, rate, spike, dec, ps);
    // lyrics: Plex Mono system log, lower left (lower right from the receipt on)
    const right = t >= T.du2 - 0.3;
    lyricLog(c, this.ctx.lyrics.linesIn(start, end), t, { x: right ? W - 150 : 150, y: H - 150, size: 44, align: right ? 'right' : 'left', glitch: spike * 0.5 });
    this.ctx.comp.draw(r, L.upload(), out, { mode: 'normal' });

    const cut = this.shots.some((s) => t - s.t0 >= 0 && t - s.t0 < 0.06 && s.t0 > start + 0.01);
    return {
      bloom: 0.85 + spike * 0.8, bloomThreshold: 0.92, bloomRadius: 0.8, halation: 0.45 + spike * 0.5, vignette: 0.55, grain: 0.05,
      ca: 1 + (cut ? 2 : 0) + 5 * spike + 4 * dec, shake, zoom: 1 + 0.04 * spike,
    };
  }

  private hud(c: CanvasRenderingContext2D, t: number, tau: number, rate: number, spike: number, dec: number, ps: { x: number; y: number }) {
    const T = this.T, { start } = this.ctx;
    const la = smoothstep(start, start + 0.4, t);
    const frozen = rate < 0.02;
    const esc = t >= T.gehen;
    const m = (s: string, x: number, y: number, col: string, o: { align?: CanvasTextAlign; size?: number; weight?: number } = {}) => mono(c, s, x, y, { size: o.size ?? 14, color: col, align: o.align, weight: o.weight });
    // top left: the system
    m('LORENZ  σ=10  ρ=28  β=8/3', 96, 92, rgba('mercury', 0.7 * la));
    const orbits = Math.floor((this.idx(Math.min(tau, this.tauEsc)) - S0) / 125);
    m(`ORBIT  ${String(orbits).padStart(4, '0')}`, 96, 116, rgba('mercury', 0.7 * la));
    m(esc ? 'ESCAPE VELOCITY  REACHED' : 'ESCAPE VELOCITY  NONE', 96, 140, rgba('crimson', la * (esc ? (Math.floor(t * 8) % 2 ? 1 : 0.4) : 0.9)), { weight: 600 });
    // top right: the clock
    m(`T+ ${clockStr(tau)}`, W - 96, 92, rgba('mercury', 0.7 * la), { align: 'right' });
    m(`Δt ×${rate.toFixed(3)}`, W - 96, 116, frozen ? rgba('crimson', 1) : rgba('mercury', 0.7 * la), { align: 'right', weight: frozen ? 600 : 400 });
    if (frozen) {
      const bx = W - 96 - 196, by = 132;
      c.fillStyle = rgba('crimson', 1);
      c.fillRect(bx, by, 196, 30);
      m('SYSTEM HOLD', W - 96 - 98, by + 21, rgba('void', 1), { align: 'center', weight: 700, size: 15 });
    }
    // bottom right: the breath monitor (flat while the breath is held)
    const holdStart = t >= T.h2 ? T.h2 : T.h1;
    const still = t >= T.h1 && t < T.du1 ? smoothstep(T.h1, T.h1 + 0.3, t) : t >= T.h2 && t < T.du2 ? 1 : 0;
    const apnea = still > 0.5 ? `APNEA ${(t - holdStart).toFixed(2)} S` : `RESP ${(14 + 6 * spike).toFixed(0)}/MIN`;
    const rcpt = t >= T.du2 - 0.3; // the lyric moves to the lower right under the receipt shot
    if (!rcpt) breathTrace(c, t, tau, W - 96 - 300, H - 200, 300, 64, { still, spike: spike * 1.2, alpha: la, label: apnea });
    // the escape: a heading readout next to the spark
    if (esc) {
      m(`V ${(30 + 180 * (t - T.gehen)).toFixed(1)} U/S`, ps.x + 40, ps.y - 30, rgba('bone', 0.85), { size: 13 });
      if (t >= T.top) m('TETHER ▸', ps.x + 40, ps.y - 10, rgba('crimson', 1), { size: 13, weight: 600 });
    }
    // the spike's alarm
    if (spike > 0.3) m('AMPLITUDE OUT OF RANGE', W / 2, 150, rgba('bone', clamp(spike * 1.4)), { align: 'center', weight: 600, size: 16 });
  }
}

/** Radius (in samples) of the red line's spread on "wunderschön". */
function spreadAt(t: number, a: number, b: number, c: number) {
  if (t < a) return 0;
  if (t < b) return lerp(0, 5200, ease.inCubic(clamp((t - a) / (b - a))));
  return lerp(5200, 0, ease.outCubic(clamp((t - b) / Math.max(0.1, c - b))));
}

const clockStr = (s: number) => {
  const a = Math.max(0, s);
  const m = Math.floor(a / 60) % 60, sec = a % 60;
  return `00:${String(m).padStart(2, '0')}:${sec.toFixed(2).padStart(5, '0')}`;
};
