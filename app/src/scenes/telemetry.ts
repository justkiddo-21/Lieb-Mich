// telemetry — "Every Step", the second half of the tether sequence (docs/TREATMENT_REVISED.MD:
// `tether`). Top-down over the void: the crimson spark that escaped the attractor is the pen — it
// cursive-writes every sung line in the single-stroke script (each point written when the voice
// reaches it), hot crimson ink cooling to bone, and loops into knots between the lines, so the
// lines pile up (on stacked planes, each crossing the last) into an obsessive web. The camera is
// tethered to it on a tight underdamped spring: it lags, whips and overshoots, and rolls to read
// each line as it is written.
//
//  "Ja doch ich folg Dir"   the spark streaks in from the attractor; TETHER ENGAGED.
//  "Ich folg auf Schritt und Tritt"   the words "Schritt" and "Tritt" are logged as GPS fixes
//                     (boxed, coordinates, ±0.3 M) with a punch-in on each.
//  "Keine Ahnung wo du hinwillst"   the tether snaps: the camera tumbles out of control and falls
//                     through the web's planes, the spark a crimson glint in the distance, an error
//                     log scrolling (ZIEL UNBEKANNT, RETRY 3/3…).
//  "Doch da komm ich mit"   the camera slams back in on "Doch" (TETHER RE-ACQUIRED) and pushes in a
//                     step on every word.
//  "Ja und ich folg Dir"   surveillance cuts on every beat: CAM 01–04, oblique, low 3/4, tight top,
//                     high oblique, the writing seen in perspective.
//  "Ich will doch nur lieben"   "lieben" is written in crimson and filed (ABSICHT: NUR LIEBEN); the
//                     next transit knots three times round it.
//  "Und noch in dieser Nacht"   night falls: the web goes dark, only the spark and the fresh ink
//                     burn; the clock reaches 00:00:00 on "Nacht".
//  "An deiner Seite liegen"   a bone point (him) closes in beside the spark and the camera dives
//                     onto the two of them: DISTANCE 0.00 M.
import * as THREE from 'three';
import { Scene, type Frame } from '../engine/scene';
import { Layer2D, W, H, clearRT } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { LIN, rgba } from '../engine/palette';
import { norm, type Line, type Word } from '../engine/lyrics';
import { clamp, ease, hash, lerp, noise1, prog, smoothstep, TAU } from '../engine/util';
import { drawTargetLock, mono } from './_motifs';
import { aim, Glow, hitEnv, lyricLog, project, rotAxis, shakeXY, sparkHead, sparkShed, v3, type Pose, type V3 } from './orbit-kit';
import { buildPath, HOP, INK, LOOP, type Layout, type PenPath } from './telemetry-path';

const EM = 170; // script size (world units)
const LAYER = -90; // each line's plane sits this far below the last
const LAT0 = 52.520071, LON0 = 13.40495;

function wordOf(l: Line, s: string): Word {
  const q = norm(s);
  return l.words.find((w) => norm(w.w) === q) ?? l.words[0]!;
}

// the spring kernel (underdamped: the camera lags, whips and overshoots)
const TAPS = 26, DS = 0.011;
const KER: number[] = (() => {
  const a = 13, b = 19;
  const k = Array.from({ length: TAPS }, (_, i) => { const s = (i + 0.5) * DS; return Math.exp(-a * s) * Math.sin(b * s + 0.35); });
  const sum = k.reduce((x, y) => x + y, 0);
  return k.map((x) => x / sum);
})();

interface Shot { t0: number; name: string; label?: string; pose: (t: number) => Pose }

export default class Telemetry extends Scene {
  private L = new Layer2D();
  private batch = new LineBatch(6000, { screen2D: false, blend: 'add' }); // glow: spark, pings, floor
  private ink = new LineBatch(24000, { screen2D: false, blend: 'max' }); // the written web (no beading at joints)
  private cam = new THREE.PerspectiveCamera(40, W / H, 1, 40000);
  private path!: PenPath;
  private glow = new Glow();
  private lines: Line[] = [];
  private shots: Shot[] = [];
  private T = {
    brk: 0, slam: 0, schritt: null as unknown as Word, tritt: null as unknown as Word, lieben: null as unknown as Word,
    nacht: 0, seite: 0, liegen: 0, db: [] as number[], beats: [] as number[], wordsL3: [] as Word[],
  };

  override init() {
    const ly = this.ctx.lyrics, au = this.ctx.audio, T = this.T;
    const { start, end } = this.ctx;
    this.lines = ly.linesIn(start, end).filter((l) => l.start >= start - 0.2);
    const Lk = (s: string) => this.lines.find((l) => l.text.startsWith(s))!;
    const l1 = Lk('Ich folg'), l2 = Lk('Keine'), l3 = Lk('Doch da'), l5 = Lk('Ich will'), l6 = Lk('Und noch'), l7 = Lk('An deiner');
    T.schritt = wordOf(l1, 'Schritt'); T.tritt = wordOf(l1, 'Tritt');
    T.brk = l2.words[0]!.start; T.slam = l3.words[0]!.start; T.wordsL3 = l3.words;
    T.lieben = wordOf(l5, 'lieben');
    T.nacht = wordOf(l6, 'Nacht').start; T.seite = wordOf(l7, 'Seite').start; T.liegen = wordOf(l7, 'liegen').start;
    T.db = au.downbeats.filter((b) => b >= start - 0.01 && b < end);
    T.beats = au.beats.filter((b) => b >= start - 0.01 && b < end + 0.5);

    // the layout: each line starts a little past the last one's end and runs back across it
    const lays: Layout[] = this.lines.map((_, k) => {
      const th = -0.18 + k * (Math.PI + 0.62) * (k % 2 ? 1 : 1);
      return { em: EM, theta: th, layer: k * LAYER, off: [-EM * 0.4, EM * (0.9 + 0.3 * hash(k, 2))] };
    });
    this.path = buildPath(this.lines, lays, { t0: start - 0.6, from: [-300, 0, 2600] });
    this.buildShots();
  }

  // ---------------------------------------------------------------- tether
  /** The tether point: the pen through the spring (lags, whips, overshoots). */
  private tether(t: number): V3 {
    let x = 0, y = 0, z = 0;
    for (let i = 0; i < TAPS; i++) {
      const p = this.path.pen(t - (i + 0.5) * DS);
      x += p[0] * KER[i]!; y += p[1] * KER[i]!; z += p[2] * KER[i]!;
    }
    return [x, y, z];
  }
  /** Index of the line being written (or approached) at t. */
  private lineIdx(t: number) {
    let k = 0;
    const P = this.path;
    for (let i = 0; i < P.lines.length; i++) if (t >= P.t[Math.max(0, P.lines[i]!.i0 - 1)]! - 0.3) k = i;
    return k;
  }
  /** Camera heading: the current line's baseline, whipping to the next line's on its transit. */
  private heading(t: number) {
    const P = this.path, k = this.lineIdx(t);
    const cur = P.lines[k]!.theta, prev = P.lines[Math.max(0, k - 1)]!.theta;
    const t0 = P.t[Math.max(0, P.lines[k]!.i0 - 1)]! - 0.3;
    let d = cur - prev;
    d = ((d + Math.PI) % TAU + TAU) % TAU - Math.PI; // shortest way round
    return prev + d * ease.outExpo(clamp((t - t0) / 0.26));
  }
  private top(t: number, alt: number, fov = 40, rollAdd = 0): Pose {
    const c = this.tether(t), th = this.heading(t) + rollAdd;
    return { p: [c[0], c[1] + alt, c[2]], tg: c, roll: 0, fov, up: [Math.sin(th), 0, -Math.cos(th)] };
  }
  /** Oblique: from the reader's side of the line (page-down), `az` swings round, `el` elevation. */
  private oblique(t: number, dist: number, el: number, az: number, fov = 42): Pose {
    const c = this.tether(t), th = this.heading(t) + az;
    const n: V3 = [-Math.sin(th), 0, Math.cos(th)];
    return { p: [c[0] + n[0] * dist * Math.cos(el), c[1] + dist * Math.sin(el), c[2] + n[2] * dist * Math.cos(el)], tg: c, roll: 0, fov };
  }

  private buildShots() {
    const T = this.T, st = this.ctx.start, end = this.ctx.end;
    const D = (i: number) => T.db[i] ?? st + i * 1.78;
    const beatsIn = (a: number, b: number) => T.beats.filter((x) => x >= a - 0.02 && x < b - 0.05);
    const kick = (t: number) => 1 - 0.06 * this.ctx.audio.hit('kick', t, 0.09);
    const u = (t: number, a: number, b: number, e = ease.linear) => prog(t, a, b, e);
    const S: Shot[] = [];
    // bar 1: engage, top-down (the orbit ends top-down on the escaping spark)
    S.push({ t0: st, name: 'engage', label: 'CAM 00  ·  TOP', pose: (t) => this.top(t, lerp(2300, 1900, u(t, st, D(1), ease.outCubic)) * kick(t)) });
    // bar 2: Schritt und Tritt — punch-ins on the fixes
    S.push({ t0: D(1), name: 'steps', label: 'CAM 00  ·  TOP', pose: (t) => {
      const p = 1 - 0.16 * (hitEnv(t, T.schritt.start, 0.2) + hitEnv(t, T.tritt.start, 0.2));
      return this.top(t, lerp(1900, 1650, u(t, D(1), T.brk)) * p * kick(t));
    } });
    // the break: tumble
    const brkPose = this.top(T.brk, 1650);
    S.push({ t0: T.brk, name: 'tumble', label: 'CAM ??  ·  NO SIGNAL', pose: (t) => this.tumble(t, brkPose) });
    // the slam (rush in over the last 0.14 s before "Doch"), then push in a step per word
    const close = (t: number) => {
      let steps = 0;
      for (const w of T.wordsL3) steps += ease.outExpo(clamp((t - w.start) / 0.12));
      return this.top(t, 1350 * Math.pow(0.9, steps) * kick(t));
    };
    S.push({ t0: T.slam - 0.14, name: 'slam', label: 'CAM 00  ·  TOP', pose: (t) => {
      const a = this.tumble(t, brkPose), b = close(T.slam);
      const k = ease.inExpo(u(t, T.slam - 0.14, T.slam));
      return { p: v3.lerp(a.p, b.p, k), tg: v3.lerp(a.tg, b.tg, k), roll: 0, fov: lerp(a.fov, b.fov, k), up: v3.norm(v3.lerp(a.up!, b.up!, k)) };
    } });
    S.push({ t0: T.slam, name: 'close', label: 'CAM 00  ·  TOP', pose: close });
    // bar 5: "Ja und ich folg Dir" — surveillance cuts on every beat
    const cams: [string, (t: number, a: number) => Pose][] = [
      ['CAM 01  ·  OBLIQUE 38°', (t, a) => this.oblique(t, lerp(1900, 1650, u(t, a, a + 0.45)), 0.66, 0.25)],
      ['CAM 02  ·  LOW 3/4', (t, a) => this.oblique(t, lerp(1250, 1100, u(t, a, a + 0.45)), 0.3, -0.7, 46)],
      ['CAM 03  ·  TOP', (t, a) => this.top(t, lerp(1100, 980, u(t, a, a + 0.45)), 40, 0.12)],
      ['CAM 04  ·  HIGH OBLIQUE', (t, a) => this.oblique(t, lerp(1500, 1300, u(t, a, a + 0.45)), 1.0, 0.9)],
    ];
    beatsIn(D(4), D(5)).forEach((b, i) => {
      const [label, f] = cams[i % cams.length]!;
      S.push({ t0: b, name: `cam${i}`, label, pose: (t) => { const p = f(t, b); p.fov *= kick(t); return p; } });
    });
    // bar 6: "Ich will doch nur lieben" — a high oblique pushing in; "lieben": a hard cut to top, close
    S.push({ t0: D(5), name: 'will', label: 'CAM 01  ·  OBLIQUE 52°', pose: (t) => this.oblique(t, lerp(1900, 1350, u(t, D(5), T.lieben.start, ease.inOutQuad)) * kick(t), 0.9, 0.15) });
    S.push({ t0: T.lieben.start, name: 'lieben', label: 'CAM 00  ·  TOP', pose: (t) => this.top(t, lerp(1050, 950, u(t, T.lieben.start, T.lieben.end + 0.3)) * (1 - 0.12 * hitEnv(t, T.lieben.start, 0.25)) * kick(t)) });
    // bar 7: night — top, slow roll drift, pushing in
    const nightT0 = Math.max(D(6), T.lieben.end);
    S.push({ t0: nightT0, name: 'night', label: 'CAM 00  ·  NIGHT', pose: (t) => this.top(t, lerp(1700, 1250, u(t, nightT0, T.seite, ease.inOutQuad)) * kick(t), 40, 0.25 * u(t, nightT0, T.seite, ease.inOutQuad)) });
    // "An deiner Seite liegen": the dive
    S.push({ t0: T.seite, name: 'dive', label: 'CAM 00  ·  DESCENT', pose: (t) => {
      const k = u(t, T.seite, end, ease.inCubic);
      const p = this.top(t, Math.exp(lerp(Math.log(1250), Math.log(330), k)), lerp(40, 34, k), 0.25 - 0.4 * k);
      const him = this.him(t);
      if (him) { const mid = v3.lerp(p.tg, him, 0.5 * ease.outCubic(u(t, T.seite, T.liegen))); p.p = v3.add(p.p, v3.sub(mid, p.tg)); p.tg = mid; }
      return p;
    } });
    this.shots = S.sort((a, b) => a.t0 - b.t0);
  }

  /**
   * The tumble: cut loose, the camera spins round the web on a chaotic orbit (flung wider and
   * wider), rolling, its aim swinging off the spark so it only catches glimpses of it.
   */
  private tumble(t: number, from: Pose): Pose {
    const s = Math.max(0, t - this.T.brk);
    const F = this.path.pen(t);
    const R = 1250 + 1100 * s + 450 * s * s;
    const th0 = this.heading(this.T.brk);
    const az = th0 + 3.6 * s + 0.9 * Math.sin(2.7 * s);
    const el = 1.05 + 0.55 * Math.sin(2.2 * s + 1.2) - 0.25 * s;
    const p: V3 = [F[0] + Math.cos(az) * Math.cos(el) * R, F[1] + Math.sin(el) * R, F[2] + Math.sin(az) * Math.cos(el) * R];
    // the aim swings off the spark and back (glimpses)
    const off = 1400 * Math.pow(Math.abs(Math.sin(1.9 * s + 0.4)), 0.7) * Math.min(1, s * 4);
    const oa = 5.1 * s + 1.3;
    const tg: V3 = [F[0] + Math.cos(oa) * off, F[1] - 200 * Math.sin(3 * s), F[2] + Math.sin(oa) * off];
    const k = ease.outCubic(Math.min(1, s / 0.12)); // the first frames still carry the tethered pose
    return {
      p: v3.lerp(from.p, p, k), tg: v3.lerp(from.tg, tg, k), roll: (3.2 * s + 0.7 * Math.sin(5 * s)) * k,
      fov: 50 + 10 * Math.sin(s * 4), up: from.up && k < 1 ? v3.norm(v3.lerp(from.up, [0, 1, 0], k)) : [0, 1, 0],
    };
  }

  private shotAt(t: number) {
    let s = this.shots[0]!;
    for (const x of this.shots) if (x.t0 <= t) s = x;
    return s;
  }

  // ---------------------------------------------------------------- render
  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    const t = f.t, r = this.ctx.renderer, au = this.ctx.audio, T = this.T, P = this.path;
    const { start, end } = this.ctx;
    clearRT(r, out, LIN.void);
    const shot = this.shotAt(t);
    const pose = shot.pose(t);
    const cam = aim(this.cam, pose);
    const tumbling = shot.name === 'tumble' || shot.name === 'slam';
    const slamHit = hitEnv(t, T.slam, 0.22);
    const night = smoothstep(P.t[P.lines[this.lines.findIndex((l) => l.text.startsWith('Und noch'))]!.i0]! - 0.1, T.nacht, t);
    const lieK = hitEnv(t, T.lieben.start, 0.3);

    const b = this.batch, ib = this.ink;
    b.clear(); ib.clear();
    const bo = LIN.bone, cr = LIN.crimson;
    // the floor: a faint world-anchored dot grid far below (motion reference, parallax)
    const c0 = this.tether(t);
    const G = 190, FY = -1100, gr = 22;
    const gx = Math.round(c0[0] / G), gz = Math.round(c0[2] / G);
    const ga = 0.11 * (1 - night * 0.8);
    for (let i = -gr; i <= gr; i++) for (let j = -gr; j <= gr; j++) {
      const x = (gx + i) * G, z = (gz + j) * G;
      const e = 1 - smoothstep(gr * 0.6, gr, Math.hypot(i, j));
      if (e <= 0) continue;
      b.seg(x, FY, z, x, FY, z, 2.2, bo[0] * ga * e, bo[1] * ga * e, bo[2] * ga * e, 1);
    }
    // the web: every sample written so far
    const iNow = P.at(t);
    const kNow = this.lineIdx(t);
    const lieLine = this.lines.findIndex((l) => l.text.startsWith('Ich will'));
    const lieW = P.lines[lieLine]?.words.find((w) => w.start === T.lieben.start);
    for (let i = 1; i <= iNow + 1 && i < P.n; i++) {
      let ax = P.x[i - 1]!, ay = P.y[i - 1]!, az = P.z[i - 1]!;
      let bx = P.x[i]!, by = P.y[i]!, bz = P.z[i]!;
      const ti = P.t[i]!;
      if (ti > t) {
        // the segment being written: clip it at the pen
        const u = clamp((t - P.t[i - 1]!) / (ti - P.t[i - 1]!));
        bx = lerp(ax, bx, u); by = lerp(ay, by, u); bz = lerp(az, bz, u);
        if (u <= 0) break;
      }
      const kind = P.kind[i]!, li = P.li[i]!;
      const age = t - Math.min(ti, t);
      const current = li === kNow;
      let k: number, w: number;
      if (kind === INK) { k = current ? 0.74 : 0.36; w = current ? 2.3 : 1.5; }
      else if (kind === LOOP) { k = 0.3; w = 1.2; }
      else { k = 0.07; w = 1; }
      k *= lerp(1, current || age < 0.6 ? 0.9 : 0.1, night);
      // hot ink: crimson right behind the pen, cooling to bone
      const hot = Math.exp(-age / 0.09);
      const isLie = lieW && li === lieLine && ti >= lieW.start - 0.01;
      const entry = li === -2 ? 0.75 * (1 - smoothstep(0, 2.5, age)) : 0; // the red line dragged out of the orbit
      const red = isLie ? 1 : Math.max(hot, entry);
      const rr = lerp(bo[0] * k, cr[0] * (1.4 + 2 * hot), red), gg = lerp(bo[1] * k, cr[1] * (1.4 + 2 * hot), red), bb = lerp(bo[2] * k, cr[2] * (1.4 + 2 * hot), red);
      ib.seg(ax, ay, az, bx, by, bz, w + hot * 1.5 + (isLie ? 0.8 : 0), rr, gg, bb, 1);
      void ax; void ay; void az;
      ax = bx; ay = by; az = bz;
    }
    // the last beat: a clean tracking grid comes up under the two of them (the maelstrom bends it)
    const gridK = smoothstep(T.liegen + 0.15, this.ctx.end - 0.08, t);
    if (gridK > 0) {
      const Lz = P.lines[P.lines.length - 1]!, c1 = this.tether(t);
      const S = 26, R = 34, gy = Lz.layer - 2;
      const ox = Math.round(v3.dot(c1, Lz.u) / S), oz = Math.round(v3.dot(c1, Lz.n) / S);
      const at = (i: number, j: number): V3 => [Lz.u[0] * i * S + Lz.n[0] * j * S, gy, Lz.u[2] * i * S + Lz.n[2] * j * S];
      const gc = 0.2 * gridK;
      for (let i = -R; i <= R; i++) {
        const a = at(ox + i, oz - R), bb = at(ox + i, oz + R), a2 = at(ox - R, oz + i), b2 = at(ox + R, oz + i);
        ib.seg(a[0], a[1], a[2], bb[0], bb[1], bb[2], 1, bo[0] * gc, bo[1] * gc, bo[2] * gc, 1);
        ib.seg(a2[0], a2[1], a2[2], b2[0], b2[1], b2[2], 1, bo[0] * gc, bo[1] * gc, bo[2] * gc, 1);
      }
    }
    // radar pings from the spark on the downbeats
    const sp = P.pen(t);
    // the spark twitches while the pen rests between words (it never stops moving)
    const tw: V3 = [noise1(t * 9, 1) * 14, 0, noise1(t * 9, 2) * 14];
    const spk = v3.add(sp, tw);
    for (const d of T.db) {
      const a = t - d;
      if (a < 0 || a > 0.9) continue;
      const R = 80 + 1400 * ease.outCubic(a / 0.9), fade = (1 - a / 0.9) * 0.35 * (1 - night * 0.5);
      const N = 72;
      for (let j = 0; j < N; j++) {
        const q0 = (j / N) * TAU, q1 = ((j + 0.6) / N) * TAU;
        b.seg(spk[0] + Math.cos(q0) * R, spk[1], spk[2] + Math.sin(q0) * R, spk[0] + Math.cos(q1) * R, spk[1], spk[2] + Math.sin(q1) * R, 1.4, cr[0] * fade * 2, cr[1] * fade * 2, cr[2] * fade * 2, 1);
      }
    }
    // him: a bone point closing in beside her ("An deiner Seite liegen")
    const him = this.him(t);
    if (him) {
      b.seg(him[0], him[1], him[2], him[0], him[1], him[2], 12, bo[0] * 0.75, bo[1] * 0.75, bo[2] * 0.75, 1);
      b.seg(him[0], him[1], him[2], him[0], him[1], him[2], 26, bo[0] * 0.08, bo[1] * 0.08, bo[2] * 0.08, 1);
    }
    sparkShed(b, t, (tt) => P.pen(tt), { rate: 90, life: 0.4, speed: 260, streak: 0.03, k: 1 });
    sparkHead(b, spk, 1.2 + lieK * 2 + slamHit * 2, 1 + lieK + slamHit * 0.8);
    ib.render(r, out, cam);
    b.render(r, out, cam);
    const gp = project(cam, spk);
    const gk = Math.max(slamHit, lieK);
    this.glow.begin();
    if (gk > 0.03 && !gp.behind) this.glow.add(gp.x, gp.y, 800 * (0.4 + gk), gk * 0.9);
    this.glow.draw(r, this.ctx.comp, out, 1.7);

    // ---------------------------------------------------------------- HUD
    const L = this.L, c = L.ctx;
    L.clear();
    const ps = project(cam, spk);
    const pc = project(cam, this.tether(t));
    this.hud(c, t, f, shot, ps, pc, cam, tumbling, night, him);
    lyricLog(c, this.lines, t, { x: 150, y: H - 130, size: 38, glitch: tumbling ? 0.35 : 0 });
    this.ctx.comp.draw(r, L.upload(), out, { mode: 'normal' });

    const cut = this.shots.some((s) => t - s.t0 >= 0 && t - s.t0 < 0.06 && s.t0 > start + 0.01);
    const whip = clamp(v3.len(v3.sub(this.tether(t), this.tether(t - 0.03))) / 90);
    return {
      bloom: 0.8 + slamHit * 0.8 + lieK * 0.5, bloomThreshold: 0.92, halation: 0.45 + slamHit * 0.5, vignette: 0.55, grain: 0.05,
      ca: 1 + (cut ? 2 : 0) + 3 * whip + (tumbling ? 2.5 : 0) + 4 * slamHit,
      shake: shakeXY(t, slamHit * 1.4 + lieK * 0.6 + (tumbling ? 0.35 : 0), 26),
      zoom: 1 + 0.05 * slamHit,
    };
  }

  private him(t: number): V3 | null {
    const T = this.T;
    if (t < T.seite - 0.3) return null;
    const P = this.path, L = P.lines[P.lines.length - 1]!;
    // he rides the tether (smoothed), closing from three lines away to lie right beside her
    const k = ease.outCubic(prog(t, T.seite - 0.3, T.liegen + 0.15));
    const side = lerp(EM * 3, EM * 0.2, k);
    const c = v3.lerp(this.tether(t), P.pen(t), 0.7 * k); // closing in: he matches her step for step
    return v3.add(c, v3.add(v3.sc(L.n, side), v3.sc(L.u, -EM * 0.12 * k)));
  }

  private hud(c: CanvasRenderingContext2D, t: number, f: Frame, shot: Shot, ps: ReturnType<typeof project>, pc: ReturnType<typeof project>, cam: THREE.PerspectiveCamera, tumbling: boolean, night: number, him: V3 | null) {
    const T = this.T, P = this.path, au = this.ctx.audio;
    const m = (s: string, x: number, y: number, col: string, o: { align?: CanvasTextAlign; size?: number; weight?: number } = {}) => mono(c, s, x, y, { size: o.size ?? 14, color: col, align: o.align, weight: o.weight });
    const engaged = !tumbling;
    const blink = Math.floor(t * 8) % 2 === 0;
    // the tether: a crimson line from the lens's aim to the spark; it snaps on "Keine"
    if (!ps.behind && !pc.behind) {
      if (engaged) {
        c.strokeStyle = rgba('crimson', 0.85);
        c.lineWidth = 1.5;
        c.beginPath(); c.moveTo(W / 2, H / 2); c.lineTo(ps.x, ps.y); c.stroke();
      }
    }
    if (t >= T.brk && t < T.brk + 0.5) {
      // the snap: two recoiling ends
      const k = ease.outCubic(prog(t, T.brk, T.brk + 0.5));
      c.strokeStyle = rgba('crimson', 1 - k);
      c.lineWidth = 2;
      for (const sgn of [-1, 1]) {
        c.beginPath();
        for (let i = 0; i <= 20; i++) {
          const u = i / 20;
          const x = W / 2 + sgn * u * 420 * (1 - k * 0.7), y = H / 2 + Math.sin(u * 14 + t * 60) * 40 * u * (1 - k) + sgn * u * u * 160 * k;
          if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
        }
        c.stroke();
      }
    }
    // the lock on the spark: clamps on the snares
    if (!ps.behind && ps.x > -100 && ps.x < W + 100 && ps.y > -100 && ps.y < H + 100) {
      if (engaged) {
        const sn = au.hit('snare', t, 0.1);
        const R = 30 * (1 + 0.5 * (1 - sn)) * (him ? 1.6 : 1);
        drawTargetLock(c, ps.x, ps.y, R, t, { lock: 1, beatPhase: f.beatPhase, label: him ? 'TARGET + 1' : 'TARGET' });
      } else if (blink) {
        drawTargetLock(c, ps.x, ps.y, 22, t, { lock: 0, beatPhase: f.beatPhase, label: 'ACQUIRING' });
      }
    }
    // GPS fixes on "Schritt" and "Tritt", the file on "lieben" (world-anchored boxes)
    const fixes: [Word, string, string][] = [
      [T.schritt, 'SCHRITT', ''], [T.tritt, 'TRITT', ''], [T.lieben, 'LIEBEN', 'ABSICHT: NUR LIEBEN'],
    ];
    for (const [w, lab, note] of fixes) {
      if (t < w.start || t > w.start + 2.4 || tumbling) continue;
      const pl = P.lines.find((l) => l.line === this.lines.find((x) => x.words.includes(w)));
      const wb = pl?.words.find((x) => x.start === w.start);
      if (!pl || !wb) continue;
      const k = P.lines.indexOf(pl);
      const pad = 22;
      const q = [P.onLine(k, wb.x0 - pad, wb.y0 - pad), P.onLine(k, wb.x1 + pad, wb.y0 - pad), P.onLine(k, wb.x1 + pad, wb.y1 + pad), P.onLine(k, wb.x0 - pad, wb.y1 + pad)].map((v) => project(cam, v));
      if (q.some((v) => v.behind)) continue;
      const a = 1 - smoothstep(w.start + 1.9, w.start + 2.4, t);
      const snap = ease.outExpo(prog(t, w.start, w.start + 0.12));
      c.save();
      c.globalAlpha = a;
      c.strokeStyle = rgba('crimson', 1);
      c.lineWidth = 1.5;
      const cx = q.reduce((s, v) => s + v.x, 0) / 4, cy = q.reduce((s, v) => s + v.y, 0) / 4;
      c.beginPath();
      q.forEach((v, i) => { const x = cx + (v.x - cx) * lerp(1.8, 1, snap), y = cy + (v.y - cy) * lerp(1.8, 1, snap); if (i === 0) c.moveTo(x, y); else c.lineTo(x, y); });
      c.closePath(); c.stroke();
      const top = q.reduce((s, v) => (v.y < s.y ? v : s), q[0]!);
      const gp = P.pen(w.start);
      const lat = LAT0 - gp[2] * 1.1e-6, lon = LON0 + gp[0] * 1.7e-6;
      c.beginPath(); c.moveTo(top.x, top.y); c.lineTo(top.x + 30, top.y - 30); c.lineTo(top.x + 70, top.y - 30); c.stroke();
      m(lab, top.x + 78, top.y - 36, rgba('crimson', 1), { size: 16, weight: 700 });
      m(note || `${lat.toFixed(6)}N  ${lon.toFixed(6)}E  ±0.3 M`, top.x + 78, top.y - 16, rgba('bone', 0.85), { size: 13 });
      c.restore();
    }
    // top-left: the tether readout
    const lag = v3.len(v3.sub(P.pen(t), this.tether(t)));
    const rows: [string, string, string?][] = tumbling
      ? [['TETHER', 'LOST', 'crimson'], ['SIGNAL', `${Math.max(0, 12 - Math.floor((t - T.brk) * 6))}%`], ['HEADING', '———'], ['TARGET', 'UNKNOWN', 'crimson']]
      : [['TETHER', t < T.slam + 1 && t >= T.slam ? 'RE-ACQUIRED' : 'ENGAGED', 'crimson'], ['LAG', `${(lag / 1000).toFixed(3)} S`], ['DIST', `${him ? Math.max(0, (v3.len(v3.sub(him, this.tether(t))) - EM * 0.2) / 100).toFixed(2) : (lag / 100).toFixed(2)} M`], ['STEPS', String(P.at(t)).padStart(5, '0')]];
    rows.forEach(([a, v, col], i) => {
      m(a, 96, 92 + i * 24, rgba('mercury', 0.6));
      m(v, 220, 92 + i * 24, col ? rgba(col, col === 'crimson' && tumbling && !blink ? 0.4 : 1) : rgba('bone', 0.85), { weight: col ? 600 : 400 });
    });
    // top-right: shot tag and the clock (midnight on "Nacht")
    m(shot.name === 'night' && night < 0.05 ? 'CAM 00  ·  TOP' : shot.label ?? '', W - 96, 92, rgba('mercury', 0.7), { align: 'right' });
    const toMid = T.nacht - t;
    const clk = toMid > 0 ? 24 * 3600 - toMid : toMid * -1;
    const hh = Math.floor(clk / 3600) % 24, mm = Math.floor(clk / 60) % 60, ss = clk % 60;
    const cs = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${ss.toFixed(2).padStart(5, '0')}`;
    m(cs, W - 96, 116, night > 0.5 ? rgba('crimson', 1) : rgba('mercury', 0.7), { align: 'right', weight: night > 0.5 ? 600 : 400 });
    if (night > 0.05) m('NACHT', W - 96, 140, rgba('crimson', night), { align: 'right', weight: 700 });
    // the tumble's error log
    if (tumbling) {
      const log = ['ERR 0x0F  TETHER SNAP', 'ERR 0x11  HEADING UNDEFINED', 'WARN      SIGNAL 12%', 'ERR 0x13  ZIEL UNBEKANNT', 'ERR 0x13  ZIEL UNBEKANNT', 'RETRY     1/3', 'RETRY     2/3', 'RETRY     3/3', 'OVERRIDE  MANUAL', 'LOCK      …'];
      const n = Math.min(log.length, Math.floor((t - T.brk) / 0.16) + 1);
      for (let i = 0; i < n; i++) m(log[i]!, 96, 250 + i * 22, rgba(i === n - 1 ? 'crimson' : 'bone', i === n - 1 ? 1 : 0.55), { size: 14, weight: i === n - 1 ? 600 : 400 });
    }
    if (t >= T.slam && t < T.slam + 0.6) {
      const a = 1 - smoothstep(T.slam + 0.35, T.slam + 0.6, t);
      c.fillStyle = rgba('crimson', a);
      c.fillRect(W / 2 - 170, 150, 340, 36);
      m('TETHER RE-ACQUIRED', W / 2, 175, rgba('void', a), { align: 'center', weight: 700, size: 17 });
    }
    if (him && t > T.liegen - 0.1) m('POSITION  AN DEINER SEITE', W / 2, 180, rgba('bone', smoothstep(T.liegen - 0.1, T.liegen + 0.1, t)), { align: 'center', weight: 600, size: 16 });
    void hash; void INK; void HOP; void LOOP;
  }
}
