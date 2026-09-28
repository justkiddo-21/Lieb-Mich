// raven — "The Maelstrom" (docs/TREATMENT_REVISED.MD). "Sanft singt der Rabe im Wind".
//  beat 1  the rigid grid of the previous plate bends into a gravity well and twists: the lines
//          tear loose into hairlines and the vortex spins up
//  beat 2  hard snap: the camera is dragged onto the vortex axis, looking down the funnel —
//          tens of thousands of hairline vectors spiral into a black eye with a crimson rim
//  "Sanft" the lyric, dead centre in Cormorant italic, perfectly still while the storm turns;
//          the camera is pulled in a step on every beat (never out), rolled by the kicks
//  "Rabe"  (the downbeat) the storm beats once like a pair of wings; the system tags the song
//  "Wind"  the spin races, and on the last beat the camera is sucked through the throat into
//          pitch black as the chorus hits
// params.wind: 1 = pre-chorus 1; 1.8 = pre-chorus 2: a storm — faster, crimson shear, the disc
// torn into shards at "Rabe", crimson discharges on the snares, harder shakes.
import type * as THREE from 'three';
import { Scene, type Frame } from '../engine/scene';
import { Layer2D, W, H, clearRT } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { LIN, rgba } from '../engine/palette';
import { F } from '../engine/type';
import type { Line } from '../engine/lyrics';
import { clamp, ease, fract, hash, lerp, noise1, noise2, prog, smoothstep, TAU } from '../engine/util';
import { karaoke, mono } from './_motifs';
import { BONE, Cam, MERC, kicks, shakeOf, snares, springs } from './search-kit';

const RMAX = 1500, RMIN = 46;
const LAM = Math.log(RMAX / RMIN);
/** Funnel depth (world z) at radius r: a gravity well, deep enough to read as a tunnel. */
const depth = (r: number) => 820 * Math.log(RMAX / r);
const Z_THROAT = depth(RMIN);

export default class Raven extends Scene {
  private L = new Layer2D();
  private lines = new LineBatch(44000, { blend: 'add' });
  private cam = new Cam();
  private line!: Line;
  private beats: number[] = [];
  private downs: number[] = [];
  private kk: number[] = [];
  private sn: number[] = [];
  private tRabe = 0; private tWind = 0; private tPlunge = 0; private tSnap = 0;

  override init() {
    const { lyrics: ly, audio: au, start, end } = this.ctx;
    const l = ly.linesIn(start, end).find((x) => x.text.startsWith('Sanft'));
    if (!l) throw new Error('raven: no "Sanft singt" line in window');
    this.line = l;
    this.beats = au.beats.filter((b) => b >= start - 0.02 && b < end - 0.02);
    this.downs = au.downbeats.filter((d) => d > start + 0.1 && d < end - 0.1);
    this.kk = kicks(au, start, end, 0.4);
    this.sn = snares(au, start, end, 0.4);
    const rabe = l.words.find((w) => w.w.startsWith('Rabe'))!;
    this.tRabe = this.downs.length ? this.downs[0]! : rabe.start;
    this.tWind = l.words[l.words.length - 1]!.start;
    this.tSnap = this.beats[1] ?? start + 0.44;
    this.tPlunge = this.beats[this.beats.length - 1] ?? end - 0.44;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    const t = f.t, r = this.ctx.renderer, { start, end } = this.ctx;
    const wind = this.ctx.params.wind ?? 1;
    const storm = clamp((wind - 1) / 0.8);
    clearRT(r, out, LIN.void);
    const L = this.L, c = L.ctx;
    L.clear();
    const B = this.lines;
    B.clear();

    // ---------------------------------------------------------------- camera
    // pulled in a step on every beat (spring), creeping between; the plunge through the throat on the last beat
    const plunge = prog(t, this.tPlunge, end - 0.03, ease.inExpo);
    // the snap: dragged over the rim into the funnel on beat 2
    const snap = springs(t, [this.tSnap], 1, 2.8, 0.4);
    const steps = springs(t, this.beats.slice(2), 1, 3.4, 0.5);
    const camZ = -900 + 780 * snap + 190 * steps + 90 * (t - start) + plunge * (Z_THROAT + 600);
    const kickRoll = this.kk.reduce((s, k, i) => s + (k <= t ? (i % 2 ? -1 : 1) * (0.06 + 0.14 * storm) * Math.exp(-(t - k) * 8) * Math.sin(Math.min(1, (t - k) * 20) * 1.6) : 0), 0);
    const roll = -(0.22 + 0.3 * storm) * (t - start) - 1.2 * plunge + kickRoll;
    const yaw = 0.025 * noise1(t * 1.3, 4) * (1 + storm * 2);
    const pitch = 0.025 * noise1(t * 1.1, 8) * (1 + storm * 2);
    this.cam.set({ x: 0, y: 0, z: camZ, yaw, pitch, roll, fov: 64 + 20 * plunge });
    const cam = this.cam;

    // ---------------------------------------------------------------- the grid tearing into the well
    const g0 = prog(t, start, this.tSnap + 0.35); // 0..1: well deepens, twist grows
    const gridA = 1 - smoothstep(0.35, 1, g0);
    if (gridA > 0.01) this.grid(cam, g0, gridA, storm);

    // ---------------------------------------------------------------- the vortex
    const spin = 0.75 * (1 + 0.45 * storm); // angular speed at the rim (rad/s); w(r) = spin (RMAX/r)^AE
    const rate = 0.1 + 0.05 * wind; // inward travel (fraction of the log range / s)
    const AE = 0.62;
    const K = spin / (AE * LAM * rate);
    const n = Math.round((12000 + 1500 * storm) * smoothstep(start - 0.05, this.tSnap + 0.1, t));
    const trail = 0.1 + 0.015 * storm;
    // Rabe: one wingbeat of the storm (the two arms fold toward the camera and back, like wings)
    const wb = t - this.tRabe;
    const flap = wb < 0 ? 0 : Math.sin(clamp(wb / 0.7) * Math.PI) * (wb < 0.12 ? ease.outCubic(wb / 0.12) : 1);
    // raven 2: the disc tears into shards at Rabe
    const tear = storm * smoothstep(this.tRabe - 0.02, this.tRabe + 0.3, t);
    // the lyric's parting (screen space)
    const tw = 500, th = 60;
    const lyA = smoothstep(this.line.start - 0.4, this.line.start, t);
    const bone = BONE, merc = MERC;
    const drift = t * 0.4;
    const hot = 1.5 + 1.5 * this.ctx.audio.hit('kick', t, 0.12) + 2 * plunge;
    const fogFar = 2600;
    for (let i = 0; i < n; i++) {
      const h1 = hash(i, 17), h2 = hash(i, 29), h3 = hash(i, 41), h4 = hash(i, 53);
      const u = fract(h1 + rate * t + 0.35 * plunge);
      const u0 = u - rate * trail;
      if (u0 < 0) continue;
      // fade in at the rim, out at the throat (the wrap is invisible)
      const life = smoothstep(0, 0.06, u0) * (1 - smoothstep(0.93, 1, u));
      if (life < 0.02) continue;
      // two spiral arms (70%) and a diffuse halo (30%)
      const arm = h4 < 0.7 ? (h4 < 0.35 ? 0 : Math.PI) + (h2 - 0.5) * (h2 - 0.5) * 4 * Math.sign(h2 - 0.5) * 1.2 : h2 * TAU;
      const wing = h4 < 0.7 ? (h4 < 0.35 ? 1 : -1) * flap * 0.75 : 0;
      const th0 = arm + wing;
      // the accretion rim: streaks near the throat run hot crimson
      const inner = smoothstep(0.72, 0.9, u);
      const kind = h3 < 0.02 + 0.1 * storm ? 2 : h3 < 0.18 ? 1 : 0;
      const wobA = 0.04 + 0.08 * storm;
      const a0 = th0 + K * Math.exp(AE * LAM * u0), a1 = th0 + K * Math.exp(AE * LAM * u);
      const pieces = Math.min(5, 1 + Math.floor(Math.abs(a1 - a0) / 0.16));
      let px = 0, py = 0, pk = 0, ok = false;
      for (let q = 0; q <= pieces; q++) {
        const uu = lerp(u0, u, q / pieces);
        let rr = RMAX * Math.exp(-LAM * uu);
        const ang = lerp(a0, a1, q / pieces);
        rr *= 1 + wobA * noise2(ang * 1.3 + h3 * 9, drift + uu * 3, 3);
        // raven 2 after Rabe: the storm tears into shards — rotating sectors drop out, the rest are flung
        if (tear > 0) {
          const sec = Math.floor((((ang - (t - this.tRabe) * 1.7) % TAU) + TAU) % TAU / (TAU / 11));
          const ring = Math.floor(uu * 5);
          if (hash(sec, ring, 77) < 0.42 * tear) { ok = false; continue; }
          rr *= 1 + tear * 0.3 * (hash(sec, ring, 78) - 0.5);
        }
        const x = Math.cos(ang) * rr, y = Math.sin(ang) * rr;
        let z = depth(rr) + (40 + 90 * storm) * noise2(ang * 2, drift * 2 + h1 * 5, 7);
        // the wingbeat: the arms' outer reaches fold toward the camera
        z -= flap * 900 * Math.pow(Math.abs(Math.cos(ang)), 2) * (1 - uu);
        if (!cam.p(x, y, z)) { ok = false; continue; }
        const sx = cam.sx, sy = cam.sy, k = cam.k;
        if (ok && Math.abs(sx - px) < 500 && Math.abs(sy - py) < 500) {
          const fog = 1 - smoothstep(fogFar * 0.4, fogFar, cam.d);
          const ex = (sx - W / 2) / (tw + 80), ey = (sy - H / 2 - 30) / (th + 62);
          const part = 1 - lyA * (1 - smoothstep(0.8, 1.35, Math.hypot(ex, ey)));
          const hotK = kind === 2 ? 1 : inner * (0.5 + 0.5 * hash(i, 61));
          const base = kind === 1 ? merc : bone;
          const al = life * fog * part * lerp(kind === 1 ? 0.5 : 0.3 - 0.1 * storm, 0.85, hotK) * (1 - 0.35 * storm * inner);
          if (al > 0.01) {
            const w = clamp(1.2 * (k + pk) * 0.5, 0.55, 1.8);
            const cr = LIN.crimson[0] * hot, cg = LIN.crimson[1] * hot, cb = LIN.crimson[2] * hot;
            B.seg(px, py, 0, sx, sy, 0, w, lerp(base[0], cr, hotK), lerp(base[1], cg, hotK), lerp(base[2], cb, hotK), al);
          }
        }
        px = sx; py = sy; pk = k; ok = true;
      }
    }
    // raven 2: crimson discharges on the snares (radial jagged bolts from the rim to the eye)
    if (storm > 0) {
      for (let si = 0; si < this.sn.length; si++) {
        const age = t - this.sn[si]!;
        if (age < 0 || age > 0.25) continue;
        const a = Math.exp(-age * 16);
        for (let bI = 0; bI < 2; bI++) {
          const base = hash(si, bI, 3) * TAU;
          let px = 0, py = 0, ok = false;
          for (let q = 0; q <= 14; q++) {
            const rr = RMAX * Math.exp(-LAM * 0.92 * (q / 14));
            const ang = base + (hash(si, bI, q) - 0.5) * 0.18 + K * 0.02 * q;
            if (!cam.p(Math.cos(ang) * rr, Math.sin(ang) * rr, depth(rr))) { ok = false; continue; }
            if (ok) B.seg(px, py, 0, cam.sx, cam.sy, 0, 1.6, LIN.crimson[0] * 3, LIN.crimson[1] * 3, LIN.crimson[2] * 3, a);
            px = cam.sx; py = cam.sy; ok = true;
          }
        }
      }
    }
    B.render(r, out);

    // ---------------------------------------------------------------- lyric + telemetry
    const size = 86, Y = H / 2 + 26;
    const fadeOut = 1 - smoothstep(end - 0.16, end - 0.04, t);
    c.save();
    c.globalAlpha = lyA * fadeOut;
    karaoke(c, this.line, t, W / 2, Y, { family: F.serif(400, true), size, sung: rgba('bone', 0.96), unsung: rgba('bone', 0.26) });
    c.restore();
    this.hud(c, t, spin, camZ, storm, plunge, flap);
    this.ctx.comp.draw(r, L.upload(), out, { mode: 'normal' });

    const kick = this.ctx.audio.hit('kick', t, 0.1);
    return {
      bloom: 0.8, bloomThreshold: 0.95, bloomKnee: 0.12, vignette: 0.6, grain: 0.06, halation: 0.35 + 0.3 * storm,
      ca: 1.2 + 1.5 * storm + 5 * plunge,
      shake: shakeOf(t, (4 + 10 * storm) * kick + 14 * plunge * (1 - plunge)),
      zoom: 1 + 0.018 * kick,
    };
  }

  /** The previous plate's rigid grid, bending into the well and twisting as it tears. */
  private grid(cam: Cam, g: number, alpha: number, storm: number) {
    const B = this.lines;
    const well = ease.inCubic(g), twist = 2.6 * ease.inQuad(g);
    const cell = 60;
    const nx = 17, ny = 10;
    const pt = (gx: number, gy: number) => {
      const rr = Math.max(RMIN, Math.hypot(gx, gy));
      const ph = Math.atan2(gy, gx) + twist * Math.pow(RMAX / rr, 0.55) * 0.35;
      const shrink = 1 - 0.35 * well * Math.pow((RMIN * 6) / (rr + RMIN * 6), 0.5);
      return [Math.cos(ph) * rr * shrink, Math.sin(ph) * rr * shrink, depth(rr) * well * 0.9] as const;
    };
    const col = storm > 0 ? MERC : BONE;
    const line = (x0: number, y0: number, x1: number, y1: number, a: number) => {
      const N = 16;
      let px = 0, py = 0, ok = false;
      for (let q = 0; q <= N; q++) {
        const p = pt(lerp(x0, x1, q / N), lerp(y0, y1, q / N));
        if (!cam.p(p[0], p[1], p[2])) { ok = false; continue; }
        // lines tear: pieces drop out as the twist grows
        const torn = hash(Math.round(x0), Math.round(y0), q) < g * 1.1 - 0.15;
        if (ok && !torn) B.seg(px, py, 0, cam.sx, cam.sy, 0, 1, col[0], col[1], col[2], a);
        px = cam.sx; py = cam.sy; ok = true;
      }
    };
    // raven 2 comes from the map: irregular street blocks instead of a regular grid
    for (let i = -nx; i <= nx; i++) {
      const x = storm > 0 ? i * cell * 1.6 + (hash(i, 3) - 0.5) * 50 : i * cell;
      line(x, -ny * cell * 1.2, x, ny * cell * 1.2, alpha * (storm > 0 ? 0.45 : 0.3));
    }
    for (let j = -ny; j <= ny; j++) {
      const y = storm > 0 ? j * cell * 1.6 + (hash(j, 7) - 0.5) * 50 : j * cell;
      line(-nx * cell * 1.2, y, nx * cell * 1.2, y, alpha * (storm > 0 ? 0.45 : 0.3));
    }
    if (storm > 0) {
      // the subject's path from the map (bone, angular), sucked in with the grid
      let x = -700, y = 260;
      for (let s = 0; s < 14; s++) {
        const h = Math.floor(hash(s, 91) * 4);
        const nx2 = x + (h === 0 ? 150 : h === 2 ? 120 : 0), ny2 = y + (h === 1 ? -140 : h === 3 ? 100 : 0);
        line(x, y, nx2, ny2, alpha * 0.9);
        x = nx2; y = ny2;
      }
    }
  }

  private hud(c: CanvasRenderingContext2D, t: number, spin: number, camZ: number, storm: number, plunge: number, flap: number) {
    const { start, end } = this.ctx;
    const a = smoothstep(start + 0.1, start + 0.4, t) * (1 - smoothstep(end - 0.2, end - 0.05, t));
    if (a <= 0) return;
    const m = rgba('mercury', 0.62 * a), dim = rgba('mercury', 0.38 * a);
    const desc = Math.max(0, camZ + 980);
    const omega = spin * Math.exp(desc / 700) * (1 + plunge * 9);
    const windMs = (storm > 0 ? 28.4 : 4.2) * (1 + 0.1 * noise1(t * 3, 2)) + plunge * 60;
    mono(c, 'MAELSTROM', 72, 88, { size: 13, weight: 600, color: m });
    mono(c, `Ω ${omega.toFixed(2).padStart(5, '0')} rad/s`, 72, 110, { size: 13, color: dim });
    mono(c, `WIND ${windMs.toFixed(1).padStart(4, '0')} m/s${storm > 0 ? `  GUST ${(windMs * 1.6).toFixed(0)}` : ''}`, 72, 130, { size: 13, color: dim });
    mono(c, `DESCENT ${String(Math.round(desc)).padStart(4, '0')} m`, W - 72, 88, { size: 13, align: 'right', color: m });
    const toH = Math.max(0, Z_THROAT - 400 - camZ);
    mono(c, `EVENT HORIZON ${String(Math.round(toH)).padStart(4, '0')} m`, W - 72, 110, { size: 13, align: 'right', color: plunge > 0 ? rgba('crimson', a) : dim });
    // Rabe: the system tags the song
    const tag = smoothstep(this.tRabe, this.tRabe + 0.08, t) * (1 - smoothstep(this.tWind + 0.2, this.tWind + 0.4, t));
    if (tag > 0) {
      const typed = Math.floor(prog(t, this.tRabe, this.tRabe + 0.35) * 60);
      const s = storm > 0 ? 'CORVUS CORAX · SONG DETECTED · SANFT 0.07 · STRUCTURE FAILING' : 'CORVUS CORAX · SONG DETECTED · SANFT 0.93';
      mono(c, s.slice(0, typed), W / 2, H / 2 + 104, { size: 13, align: 'center', color: rgba(storm > 0 ? 'crimson' : 'mercury', 0.8 * tag) });
      // a brief lock around the lyric on the wingbeat
      if (flap > 0.02) {
        c.save();
        c.strokeStyle = rgba('crimson', 0.85 * Math.min(1, flap * 2) * tag);
        c.lineWidth = 2;
        const bw = 560 + 40 * (1 - flap), bh = 78 + 20 * (1 - flap), cx = W / 2, cy = H / 2 - 4, arm = 26;
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
          c.beginPath();
          c.moveTo(cx + sx * bw, cy + sy * (bh - arm)); c.lineTo(cx + sx * bw, cy + sy * bh); c.lineTo(cx + sx * (bw - arm), cy + sy * bh);
          c.stroke();
        }
        c.restore();
      }
    }
    if (plunge > 0.05) mono(c, 'EVENT HORIZON CROSSED', W / 2, H / 2 + 104, { size: 13, weight: 600, align: 'center', color: rgba('crimson', a * Math.min(1, plunge * 3)) });
    mono(c, `T+${(t - start).toFixed(2)}`, 72, H - 72, { size: 12, color: dim });
  }
}
