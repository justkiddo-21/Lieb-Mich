// panther — the `hunt` plate (docs/TREATMENT_REVISED.MD), "Ich verzehr mich" → pre-chorus.
//
// A drone targeting camera over a LIDAR point-cloud land with an ash survey grid, hunting one
// crimson thermal signature that runs ahead along its trail and keeps glitching out of frame.
// Every sung line is a military UI tag riding on the target (typed Plex Mono caps). The camera only
// ever closes in: hard punch-in cuts on the kicks (range and focal length stepping), reset when the
// signature escapes. One shot per line, cut on the beat:
//  "Ich verzehr mich"          the plunge: straight down from altitude onto the land, pitching up
//                              onto the target (continues boot_seq's last frame).
//  "Wart schon so lange hier"  time-lapse on a tripod: a day every two beats, the sun sweeping the
//                              slopes, the signature only showing at night, the waiting clock racing.
//  "Wie ein Panther"           ground-level sprint: speed streaks, shake, the range closing per kick.
//  "auf der Fährte seines"     tracking over the crimson trail (die Fährte) burnt into the ground.
//  "Beutetieres"               freeze-frame: the world stops and the lens punches in on each kick
//                              onto the prey box.
//  "Ja ich verzehr mich"       thermal: the whole cloud burns crimson around the heat source.
//  "Und ich will doch nur lieben"  calm: the camera cranes up, still closing, no shake.
//  "Und noch in dieser Nacht"  night: sparse mercury returns, the signature the only light.
//  "An ihrer Seite liegen"     the land goes flat, the signature cools to a bone-white dot, the
//                              camera comes down beside it and rolls 90° to lie there.
import type * as THREE from 'three';
import { Scene, type Frame } from '../engine/scene';
import { Layer2D, W, H, clearRT } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { LIN, rgba } from '../engine/palette';
import type { Line, Word } from '../engine/lyrics';
import { clamp, ease, hash, lerp, noise1, prog, smoothstep, TAU } from '../engine/util';
import { drawTargetLock, mulRGB, terrain } from './_motifs';
import { Cam, brackets, kickCount, kicksIn, lastPulse, tag, typed, upper, v3, wrapRows, type Pose, type V3 } from './boot-kit';
import { land, type LandOpts } from './panther-land';

const trailX = (z: number) => 160 * noise1(z * 0.0011, 21) + 22 * noise1(z * 0.005, 22);
const SPEED = 900; // target speed, world units / s

type Kind = 'plunge' | 'wait' | 'sprint' | 'trail' | 'prey' | 'thermal' | 'rise' | 'night' | 'lie';
interface Shot { kind: Kind; t0: number; t1: number }

export default class Panther extends Scene {
  private L = new Layer2D();
  private ink = new LineBatch(40000, { screen2D: false, blend: 'max' });
  private glow = new LineBatch(14000, { screen2D: false, blend: 'add' });
  private C = new Cam(2, 20000);
  private lines: Line[] = [];
  private shots: Shot[] = [];
  private kicks: number[] = [];
  private glitches: number[] = [];
  private tBeute = 0; private tStop = 0; private seite!: Word;

  override init() {
    const ly = this.ctx.lyrics, au = this.ctx.audio;
    const g = (s: string) => ly.get(s);
    const verzehr = g('Ich verzehr mich'), wart = g('Wart schon so lange hier'), panther = g('Wie ein Panther');
    const ja = g('Ja ich verzehr mich'), lieben = g('Und ich will doch nur lieben'), nacht = g('Und noch in dieser Nacht'), liegen = g('An ihrer Seite liegen');
    this.lines = [verzehr, wart, panther, ja, lieben, nacht, liegen];
    this.seite = liegen.words[2]!;
    const beat = (t: number) => au.timeOfBeat(Math.floor(au.beatAt(t + 0.12)));
    const down = (t: number) => au.downbeats.filter((d) => d <= t + 0.12).pop() ?? t;
    const faehrte = panther.words.find((w) => w.w.startsWith('Fährte'))!;
    this.tBeute = panther.words[panther.words.length - 1]!.start;
    const cuts: [Kind, number][] = [
      ['plunge', this.ctx.start], ['wait', down(wart.start)], ['sprint', beat(panther.start)], ['trail', beat(faehrte.start)],
      ['prey', this.tBeute], ['thermal', down(ja.start)], ['rise', down(lieben.start)], ['night', beat(nacht.start)], ['lie', down(liegen.start)],
    ];
    this.shots = cuts.map(([kind, t0], i) => ({ kind, t0, t1: cuts[i + 1]?.[1] ?? this.ctx.end }));
    this.kicks = (au.onsets.kick ?? []).map((e) => e[0]);
    // the signature escapes on some kicks of the chase shots (hashed, so fixed)
    for (const s of this.shots) {
      if (s.kind !== 'sprint' && s.kind !== 'thermal' && s.kind !== 'night') continue;
      kicksIn(au, s.t0 + 0.2, s.t1 - 0.2).forEach((k, i) => { if (hash(i, Math.round(k * 10), 5) > 0.55) this.glitches.push(k); });
    }
    this.tStop = this.seite.start;
  }

  private shotAt(t: number) {
    let s = this.shots[0]!;
    for (const x of this.shots) if (t >= x.t0) s = x;
    return s;
  }

  /** Target travel along its trail (integrated speed: it slows to a stop on "Seite"). */
  private zT(t: number) {
    const lie = this.shots.find((s) => s.kind === 'lie')!.t0;
    if (t <= lie) return SPEED * (t - this.ctx.start);
    const T = Math.min(t, this.tStop) - lie, D = this.tStop - lie;
    return SPEED * (lie - this.ctx.start) + SPEED * (T - (T * T) / (2 * D)); // linear deceleration
  }
  private flat(t: number) {
    const n = this.shots.find((s) => s.kind === 'night')!, l = this.shots.find((s) => s.kind === 'lie')!;
    return lerp(0, 0.45, prog(t, n.t0, n.t1)) + 0.55 * prog(t, l.t0, l.t0 + 0.8, ease.inOutCubic);
  }
  private target(te: number): V3 {
    const z = this.zT(te), x = trailX(z), f = this.flat(te);
    return [x, terrain(x, z, f) + 9, z];
  }

  /** Glitch state at t: 0..1 (1 = the signature has jumped out of frame) and the escape direction. */
  private glitch(t: number) {
    for (const g of this.glitches) if (t >= g && t < g + 0.26) return { k: 1 - smoothstep(g + 0.16, g + 0.26, t), dir: hash(g * 100, 2) > 0.5 ? 1 : -1, up: hash(g * 100, 3) - 0.5, t0: g };
    return null;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    const t = f.t, r = this.ctx.renderer, au = this.ctx.audio;
    clearRT(r, out, LIN.void);
    const L = this.L, c = L.ctx;
    L.clear();
    this.ink.clear(); this.glow.clear();
    const s = this.shotAt(t);
    const u = prog(t, s.t0, s.t1);
    const te = s.kind === 'prey' ? this.tBeute : t; // "Beutetieres": the world freezes
    const T = this.target(te);
    const n = kickCount(au, s.t0 + 0.02, t); // punch-in steps within the shot
    const gl = this.glitch(t);
    const nAfter = (() => { let m = n; for (const g of this.glitches) if (g >= s.t0 && g <= t) m = kickCount(au, g + 0.02, t); return m; })(); // steps since the last escape
    const flat = this.flat(te);
    const ground = (x: number, z: number) => terrain(x, z, flat);
    const post = { bloom: 0.9, bloomThreshold: 0.9, bloomKnee: 0.08, vignette: 0.55, grain: 0.06, halation: 0.5, ca: 1, shake: [0, 0] as [number, number], zoom: 1 };
    const kick = au.hit('kick', t, 0.09);
    let pose: Pose;
    const lo: LandOpts = { step: 24, radius: 1500, grid: 4, gridK: 3.2, flat };
    let sig = 1; // signature visibility
    let sigCol: V3 = mulRGB(LIN.crimson, 1);
    let mode = 'FLIR  WHT-HOT';
    let trail = 0;

    switch (s.kind) {
      case 'plunge': {
        const k = ease.inQuart(u);
        const alt = lerp(1800, 110, k);
        const cz = T[2] - lerp(120, 620, ease.inOutCubic(u)), cx = T[0] + 50;
        const p: V3 = [cx, ground(cx, cz) + alt, cz];
        const aim = smoothstep(0.45, 0.97, u);
        const look = v3.lerp(v3.add(p, [0, -1000, 8]), T, aim);
        pose = { p, look, fov: 56 * Math.pow(0.9, n), roll: 0.4 * (1 - aim) };
        lo.radius = lerp(1800, 1400, aim); lo.step = alt > 500 ? 36 : 28; lo.far = lerp(3400, 2400, aim);
        lo.scan = (t - s.t0) * 2600 % 2400;
        mode = 'DESCENT';
        post.shake = [3 * kick * noise1(t * 70, 1), 3 * kick * noise1(t * 70, 2)];
        break;
      }
      case 'wait': {
        // tripod time-lapse: a day every two beats; a jump-cut push on every beat
        const T0 = this.target(s.t0);
        const bi = Math.floor(au.beatAt(t) - au.beatAt(s.t0) + 1e-3);
        const cz = T0[2] - 900 + bi * 70, cx = T0[0] - 180;
        const p: V3 = [cx, ground(cx, cz) + 120, cz];
        pose = { p, look: [T0[0] + 40, ground(T0[0], T0[2] + 400), T0[2] + 400], fov: 58 * Math.pow(0.92, bi) };
        const day = (t - s.t0) / (2 * (60 / au.bpm));
        const fd = day - Math.floor(day);
        // a daylight band sweeps across the land once a day: sunrise front, then sunset front
        const dir: [number, number] = [0.94, 0.34];
        const c0 = T0[0] * dir[0] + T0[2] * dir[1];
        const sweep = (k: number) => c0 - 1700 + 3600 * clamp(k);
        const bA = sweep(fd * 1.9 - 0.05), bB = sweep(fd * 1.9 - 0.75);
        lo.band = { dir, a: bB, b: bA, soft: 160, dark: 0.07 };
                const sun: V3 = [0, Math.sin(TAU * fd), 0];
        const ni = Math.floor(day + 0.25);
        const tx = T0[0] * dir[0] + (T0[2] + 600) * dir[1];
        const nightK = 1 - smoothstep(bB - 300, bB, tx) * (1 - smoothstep(bA, bA + 300, tx));
        sig = nightK * (hash(Math.floor(t * 18), 4) > 0.2 ? 1 : 0.2);
        const bz = T0[2] + 250 + 700 * hash(ni, 7), bx = T0[0] - 320 + 700 * hash(ni, 8);
        T[0] = bx; T[2] = bz; T[1] = ground(bx, bz) + 9;
        mode = 'TIMELAPSE  x1200';
        // the waiting clock (in the HUD block below)
        const hrs = (t - s.t0) * 1200 * 60;
        tag(c, 'WAITING', W - 96, 176, { size: 13, align: 'right', color: rgba('crimson', 1), weight: 600, tracking: 4 });
        const hh = Math.floor(hrs / 3600), mm = Math.floor(hrs / 60) % 60, ss = Math.floor(hrs) % 60;
        tag(c, `${String(hh).padStart(4, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`, W - 96, 210, { size: 26, align: 'right', color: rgba('bone', 0.9), weight: 500, tracking: 2 });
        tag(c, `DAY ${String(1 + Math.floor(day * 1)).padStart(3, '0')}   SUN ${(Math.asin(clamp(sun[1], -1, 1)) * 57.3).toFixed(0).padStart(3, ' ')}°`, W - 96, 236, { size: 13, align: 'right', color: rgba('mercury', 0.8) });
        break;
      }
      case 'sprint': {
        const d = 520 * Math.pow(0.8, nAfter);
        const cz = T[2] - d, cx = trailX(cz) + 26 * noise1(t * 2.1, 3);
        const p: V3 = [cx, ground(cx, cz) + 14 + 4 * noise1(t * 9, 4), cz];
        pose = { p, look: v3.lerp([cx, p[1] - 6, cz + 600], T, 0.55), fov: 74 * Math.pow(0.9, nAfter), roll: 0.09 * noise1(t * 1.6, 5) + 0.05 * kick * noise1(t * 40, 6) };
        lo.streak = [0, 0, SPEED * 0.04];
        lo.far = 2200;
        mode = 'PURSUIT';
        post.shake = [7 * (noise1(t * 31, 1) + kick * noise1(t * 90, 2)), 7 * (noise1(t * 29, 3) + kick * noise1(t * 90, 4))];
        post.ca = 1.4 + 2.5 * kick;
        break;
      }
      case 'trail': case 'prey': {
        const tt = s.kind === 'prey' ? this.tBeute : t;
        const s0 = this.shots.find((x) => x.kind === 'trail')!;
        const n2 = kickCount(au, s0.t0 + 0.02, Math.min(t, this.tBeute - 0.01));
        const d = 560 * Math.pow(0.85, n2);
        const cz = T[2] - d, cx = trailX(cz) + 190;
        const p: V3 = [cx, ground(cx, cz) + 80, cz];
        if (s.kind === 'trail') pose = { p, look: v3.lerp([cx - 60, p[1] - 40, cz + 500], T, 0.7), fov: 58 * Math.pow(0.9, n2), roll: -0.06 };
        else {
          // freeze: the lens punches in on each kick onto the prey box
          const np = kickCount(au, this.tBeute - 0.05, t);
          pose = { p, look: T, fov: 50 / Math.pow(2, np), roll: -0.06 };
          post.grain = 0;
          post.ca = 2.5 * lastPulse(kicksIn(au, this.tBeute - 0.05, s.t1), t, 0.07);
        }
        trail = 1;
        void tt;
        mode = s.kind === 'prey' ? 'FREEZE  //  ZOOM' : 'TRACK';
        break;
      }
      case 'thermal': {
        const d = 480 * Math.pow(0.84, nAfter);
        const cz = T[2] - d, cx = trailX(cz) - 70;
        const p: V3 = [cx, ground(cx, cz) + 34, cz];
        pose = { p, look: v3.lerp([cx, p[1] - 12, cz + 600], T, 0.65), fov: 64 * Math.pow(0.9, nAfter), roll: 0.05 * noise1(t * 2, 8) };
        lo.thermal = 1; lo.heat = T; lo.grid = 0; lo.streak = [0, 0, SPEED * 0.02];
        sigCol = mulRGB(LIN.ember, 3);
        mode = 'THERMAL';
        post.shake = [5 * kick * noise1(t * 80, 1), 5 * kick * noise1(t * 80, 2)];
        post.ca = 1.5 + 3 * kick;
        post.halation = 0.8;
        break;
      }
      case 'rise': {
        const k = ease.inOutCubic(u);
        const cz = T[2] - lerp(720, 380, k), cx = T[0] - lerp(60, 140, k);
        const p: V3 = [cx, ground(cx, cz) + lerp(24, 540, k), cz];
        pose = { p, look: T, fov: 50 - 8 * k };
        lo.thermal = 1 - prog(t, s.t0, s.t0 + 0.35);
        lo.heat = T;
        lo.scan = ((t - s.t0) * 900) % 2000;
        mode = 'HOLD  //  STABILISED';
        post.grain = 0.04; post.ca = 0.4;
        break;
      }
      case 'night': {
        const d = 460 * Math.pow(0.85, nAfter);
        const cz = T[2] - d, cx = trailX(cz) + 60;
        const p: V3 = [cx, ground(cx, cz) + 60, cz];
        pose = { p, look: v3.lerp([cx, p[1] - 20, cz + 600], T, 0.75), fov: 56 * Math.pow(0.9, nAfter) };
        lo.night = 1; lo.bright = 0.7; lo.gridK = 1.6;
        sigCol = mulRGB(LIN.crimson, 1.4);
        mode = 'NIGHT  //  IR  //  LUX 0.001';
        post.ca = 1 + 2 * kick;
        break;
      }
      case 'lie': {
        const k = prog(t, s.t0, this.seite.end, ease.inOutCubic);
        const off: V3 = [lerp(-260, -70, k), lerp(110, 5, k), lerp(-420, -30, k)];
        const p = v3.add(T, off);
        const roll = (Math.PI / 2) * prog(t, this.seite.start, this.seite.end + 0.2, ease.inOutCubic);
        pose = { p, look: v3.add(T, [0, 2, 0]), fov: lerp(52, 40, k), roll };
        lo.night = 0.6; lo.bright = 0.85; lo.gridK = 2.2;
        const cool = prog(t, s.t0 + 0.2, this.seite.start, ease.inOutCubic);
        sigCol = v3.lerp(mulRGB(LIN.crimson, 1.4), mulRGB(LIN.bone, 0.8), cool);
        mode = 'PROXIMITY  0.4 M';
        post.grain = 0.04; post.ca = 0.3;
        break;
      }
    }

    // the signature escaping: the camera whips after it (never quite in time)
    let Td: V3 = T;
    if (gl) {
      const esc: V3 = v3.add(T, [gl.dir * 900 * gl.k, 260 * gl.up * gl.k, 120 * gl.k]);
      Td = esc;
      pose.look = v3.lerp(pose.look, esc, 0.35 * gl.k);
      post.ca = 6;
    }
    this.C.set(pose);
    land(this.ink, this.glow, this.C, lo);

    // die Fährte: the crimson trail from under the camera to the target
    if (trail > 0) {
      const z0 = this.C.p[2] - 200, z1 = T[2];
      const fk = s.kind === 'trail' ? prog(t, s.t0, s.t0 + 0.4, ease.outCubic) : 1;
      let pp: V3 | null = null;
      for (let z = z0; z <= lerp(z0, z1, fk); z += 10) {
        const x = trailX(z), q: V3 = [x, ground(x, z) + 2, z];
        if (pp) this.glow.seg(pp[0], pp[1], pp[2], q[0], q[1], q[2], 2.2, LIN.crimson[0] * 2.2, LIN.crimson[1] * 2.2, LIN.crimson[2] * 2.2, 1);
        pp = q;
      }
      // paw-print marks along it every stride
      for (let z = Math.ceil(z0 / 90) * 90; z < z1 - 40; z += 90) {
        const x = trailX(z) + (Math.round(z / 90) % 2 ? 10 : -10), y = ground(x, z) + 2;
        this.glow.seg(x - 5, y, z, x + 5, y, z, 2.5, LIN.crimson[0] * 1.6, LIN.crimson[1] * 1.6, LIN.crimson[2] * 1.6, 1);
      }
    }

    // the thermal signature: a hot core, a blurred bloom, ghost copies when it glitches
    if (sig > 0) {
      const flick = 0.75 + 0.25 * noise1(t * 23, 9);
      const I = sig * flick;
      const cores: [V3, number][] = gl ? [[Td, 1], [v3.lerp(T, Td, 0.5), 0.45], [T, 0.2]] : [[Td, 1]];
      for (const [q, a] of cores) {
        for (const [w, k] of [[46, 0.12], [22, 0.3], [9, 1]] as const) {
          const e = I * a * k * 3.2;
          this.glow.seg(q[0], q[1], q[2], q[0], q[1], q[2], w, sigCol[0] * e, sigCol[1] * e, sigCol[2] * e, 1);
        }
        // horizontal smear (heat shimmer), only while it is hot and far
        if (s.kind !== 'prey' && s.kind !== 'lie') this.glow.seg(q[0] - 18, q[1], q[2], q[0] + 18, q[1], q[2], 5, sigCol[0] * I * a, sigCol[1] * I * a, sigCol[2] * I * a, 0.8);
      }
    }
    this.ink.render(r, out, this.C.cam);
    this.glow.render(r, out, this.C.cam);

    // ------------------------------------------------ 2D: target lock, lyric tag, drone HUD
    const q = this.C.proj(Td[0], Td[1], Td[2]);
    const onScreen = q.z > 2 && q.x > 40 && q.x < W - 40 && q.y > 40 && q.y < H - 40;
    const lockK = s.kind === 'prey' ? 1 : s.kind === 'lie' ? prog(t, this.seite.start - 0.4, this.seite.end, ease.inOutCubic) : clamp(0.2 + 0.2 * nAfter);
    if (onScreen && sig > 0.3 && !gl) {
      const rad = s.kind === 'prey' ? clamp(3000 / (this.C.cam.fov * Math.max(1, q.z / 400)), 30, 150) : clamp(9000 / q.z, 22, 70);
      drawTargetLock(c, q.x, q.y, rad, t, { lock: lockK, beatPhase: f.beatPhase, alpha: 0.95 });
      if (s.kind === 'prey') {
        // the prey box
        const bw = rad * 3.2, bh = rad * 2.2;
        c.save(); c.strokeStyle = rgba('crimson', 1); c.lineWidth = 2;
        brackets(c, q.x - bw / 2, q.y - bh / 2, bw, bh, 22);
        c.restore();
        tag(c, `PREY  //  BEUTETIER  //  ID 7F-3A`, q.x - bw / 2, q.y - bh / 2 - 12, { size: 14, color: rgba('crimson', 1), weight: 600, tracking: 3 });
        tag(c, `RNG ${(412 / Math.pow(2, kickCount(au, this.tBeute - 0.05, t))).toFixed(1)} M   CONF 0.99   ZOOM x${Math.pow(2, kickCount(au, this.tBeute - 0.05, t))}`, q.x - bw / 2, q.y + bh / 2 + 22, { size: 12, color: rgba('bone', 0.85) });
      }
    }
    // the line being sung (a line still being sung keeps its tag until it ends)
    let line = this.lines.filter((l) => l.start <= t).pop();
    const nextL = this.lines.find((l) => l.start > t);
    if (nextL && t >= nextL.start - 0.3 && (!line || t >= line.end)) line = nextL;
    if (!line && nextL && t >= nextL.start - 0.5) line = nextL;
    if (line && t < line.end + 1.2) {
      // anchor: the target (clamped into the safe area; an arrow when it has escaped the frame)
      const ax = onScreen ? q.x : clamp(q.z > 0 ? q.x : W / 2 + (gl ? gl.dir : 1) * W, 60, W - 60);
      const ay = onScreen ? q.y : clamp(q.z > 0 ? q.y : H / 2, 60, H - 60);
      const size = 34, adv = size * 0.6;
      const wrap = 22;
      const text = upper(line.text);
      const rw = wrapRows(text, wrap);
      const rows = rw.length;
      const bw = Math.max(26, ...rw.map((x) => x.s.length + 1)) * adv + 40, bh = rows * size * 1.25 + 60;
      const side = ax > W * 0.62 ? -1 : 1;
      let bx = side > 0 ? ax + 70 : ax - 70 - bw;
      let by = ay - bh - 50;
      if (s.kind === 'lie' || s.kind === 'prey') { bx = side > 0 ? ax + 110 : ax - 110 - bw; by = ay + 90; }
      bx = clamp(bx, 96, W - 96 - bw); by = clamp(by, 150, H - 110 - bh);
      const jit = gl ? (hash(Math.floor(t * 40), 11) - 0.5) * 14 : 0;
      bx += jit;
      c.save();
      c.fillStyle = rgba('void', 0.82);
      c.fillRect(bx, by, bw, bh);
      c.strokeStyle = rgba(gl ? 'crimson' : 'bone', gl ? 0.9 : 0.55); c.lineWidth = 1;
      brackets(c, bx, by, bw, bh, 14);
      // leader from the box to the target
      c.beginPath();
      const lx = side > 0 ? bx : bx + bw, lyy = by + bh;
      c.moveTo(lx, lyy); c.lineTo(lx - side * 30, lyy + 30 * Math.sign(ay - lyy || 1)); c.lineTo(ax, ay);
      c.strokeStyle = rgba('crimson', 0.85); c.stroke();
      c.restore();
      const rng = Math.max(0, v3.dot(v3.sub(T, this.C.p), this.C.f)) * 0.31;
      const hd = ((Math.atan2(this.C.f[0], this.C.f[2]) * 180) / Math.PI + 360) % 360;
      tag(c, `TGT-7F  //  RNG ${rng.toFixed(0).padStart(4, '0')} M  //  BRG ${hd.toFixed(0).padStart(3, '0')}°`, bx + 20, by + 26, { size: 12, color: rgba(gl ? 'crimson' : 'mercury', 0.9), tracking: 2 });
      typed(c, line, t, bx + 20, by + 26 + 20 + size * 0.9, { size, weight: 500, upper: true, wrap, lineGap: size * 1.25, dim: 0.14, tracking: 0 });
      if (!onScreen || gl) {
        tag(c, gl ? 'SIGNAL LOST  //  REACQUIRING' : 'TGT OUT OF FRAME', W / 2, H / 2 + 8, { size: 18, align: 'center', color: rgba('crimson', 1), weight: 600, tracking: 6 });
      }
    }
    // drone HUD: crosshair, frame, heading tape, telemetry
    c.save();
    c.strokeStyle = rgba('bone', 0.35); c.lineWidth = 1;
    c.beginPath();
    c.moveTo(W / 2 - 28, H / 2); c.lineTo(W / 2 - 10, H / 2); c.moveTo(W / 2 + 10, H / 2); c.lineTo(W / 2 + 28, H / 2);
    c.moveTo(W / 2, H / 2 - 28); c.lineTo(W / 2, H / 2 - 10); c.moveTo(W / 2, H / 2 + 10); c.lineTo(W / 2, H / 2 + 28);
    c.stroke();
    c.strokeStyle = rgba('mercury', 0.4);
    brackets(c, 72, 64, W - 144, H - 128, 30);
    // heading tape
    const hd = ((Math.atan2(this.C.f[0], this.C.f[2]) * 180) / Math.PI + 360) % 360;
    c.beginPath();
    for (let a = Math.floor(hd - 30); a <= hd + 30; a++) {
      if (a % 5) continue;
      const x = W / 2 + (a - hd) * 9;
      c.moveTo(x, 70); c.lineTo(x, a % 15 === 0 ? 84 : 78);
    }
    c.stroke();
    c.restore();
    for (let a = Math.ceil((hd - 30) / 15) * 15; a <= hd + 30; a += 15) tag(c, String(((a % 360) + 360) % 360).padStart(3, '0'), W / 2 + (a - hd) * 9, 102, { size: 11, align: 'center', color: rgba('mercury', 0.7), tracking: 1 });
    tag(c, 'LM-7  //  DRONE  //  ' + mode, 96, 110, { size: 13, color: rgba('mercury', 0.8) });
    tag(c, `ALT ${(Math.max(0, this.C.p[1] - ground(this.C.p[0], this.C.p[2])) * 0.31).toFixed(1).padStart(6, ' ')} M`, 96, 134, { size: 13, color: rgba('mercury', 0.7) });
    tag(c, `FOV ${this.C.cam.fov.toFixed(1)}°   ZOOM x${(56 / this.C.cam.fov).toFixed(1)}`, 96, 158, { size: 13, color: rgba('mercury', 0.7) });
    const rec = Math.floor(t * 2) % 2 === 0;
    tag(c, `${rec ? '●' : ' '} REC  ${t.toFixed(2)}`, W - 96, 110, { size: 13, align: 'right', color: rgba('crimson', 0.9), weight: 500 });
    tag(c, `LAT 52.5${String(Math.floor(this.C.p[2] * 7) % 10000).padStart(4, '0')}  LON 13.4${String(Math.floor(this.C.p[0] * 13 + 5000) % 10000).padStart(4, '0')}`, W - 96, 134, { size: 12, align: 'right', color: rgba('mercury', 0.6) });

    this.ctx.comp.draw(r, L.upload(), out, { mode: 'normal' });
    if (gl) post.shake = [post.shake[0] + 10 * gl.dir * gl.k, post.shake[1] + 4 * gl.k];
    return post;
  }
}
