// search — the 24-bar instrumental break (docs/TREATMENT.md "This recording's structure"; the
// revised treatment's rules). Nine shots cut on the downbeats (bar = 1.78 s):
//  bar 0      LOCK FAILED — the chorus's lock springs open; TARGET LOST glitches on the snare 8ths
//  bars 1–2   RADAR — a tilted 3D radar; the sweep lights contacts that are never her; the reticle
//             snaps to each one and stamps it NEG (GULL, LAMP, SIMILAR COAT)
//  bars 3–4   SONAR — each kick pings an empty city: the ring lights the building edges it
//             crosses, the A-scan shows no return
//  bars 5–6   CCTV — a quad split of four empty rooms; then one room per beat, ENHANCE ×2…×16
//  bars 7–8   THERMAL — a façade of 126 windows checked one by one (8ths, then 16ths, then the
//             machine loses patience and sweeps the rest): NEG, NEG, NEG
//  bars 9–12  HUNT RESUMED — the band is back: LIDAR land at speed, a new camera every two beats,
//             a crimson scan front on the synth lead each bar
//  bars 13–16 TRIANGULATION — whip-pans onto three cell towers, their range rings closing; the
//             last bar cranes down onto the intersection
//  bars 17–20 THE TRAIL — footprints in the point cloud, fresher every bar; the camera races low
//  bars 21–23 CLOSING IN — a punch-in on every beat toward a figure made of LIDAR returns; the
//             last bar clamps the lock on the snares: TARGET REACQUIRED (a modest flash into chorus 3)
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, W, H, clearRT } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { LIN, rgba } from '../engine/palette';
import { F, font } from '../engine/type';
import { clamp, ease, fract, hash, lerp, noise1, prog, smoothstep, springStep, TAU } from '../engine/util';
import { clock, drawTargetLock, erratic, mono, terrain } from './_motifs';
import { ASH, BONE, Cam, CRIM, MERC, kicks, lastIdx, lidar, mul, ring3, seg3, shakeOf, snares, springs } from './search-kit';
import { ROOMS } from './search-cctv';

const trailX = (z: number) => 150 * noise1(z * 0.0011, 31) + 20 * noise1(z * 0.006, 32);
const LOG = [
  'LOCK FAILED · SUBJECT OUT OF FRAME',
  'SWEEP 001 · 14 CONTACTS · 0 HER',
  'SWEEP 002 · 1 CONTACT · NEG (SIMILAR COAT)',
  'PING 01–03 · NO RETURN',
  'PING 04–09 · STREETS EMPTY',
  'CCTV 01–04 · 0 PERSONS',
  'ENHANCE ×2 ×4 ×8 ×16 · NOTHING',
  'THERMAL · BLOCK 14 · 126 UNITS',
  '126/126 NEG · SUBJECT NOT HOME',
  'HUNT RESUMED',
  'SECTOR 14 · CLEAR',
  'SECTOR 15 · CLEAR',
  'SECTOR 16 · FAINT RETURN 0.31',
  'TOWER A · 1.84 km',
  'TOWER B · 2.10 km',
  'TOWER C · 0.96 km',
  'FIX ±38 m',
  'TRAIL FOUND · 00:03:12 OLD',
  'TRAIL · 00:01:40 OLD',
  'TRAIL · 00:00:51 OLD',
  'TRAIL · 00:00:08 OLD',
  'DIST 612 m',
  'DIST 140 m',
  'TARGET REACQUIRED',
];
const MODES = ['LOCK', 'RADAR', 'RADAR', 'SONAR', 'SONAR', 'CCTV', 'CCTV', 'THERMAL', 'THERMAL', 'LIDAR', 'LIDAR', 'LIDAR', 'LIDAR',
  'TRIANGULATION', 'TRIANGULATION', 'TRIANGULATION', 'TRIANGULATION', 'TRAIL', 'TRAIL', 'TRAIL', 'TRAIL', 'PURSUIT', 'PURSUIT', 'LOCK'];

interface Blip { x: number; z: number; ang: number; label: string }

export default class Search extends Scene {
  private L = new Layer2D();
  private B = new LineBatch(40000, { blend: 'add' });
  private cam = new Cam();
  private D: number[] = []; // downbeats: D[0] = start … D[24] = end
  private beats: number[] = [];
  private kk: number[] = [];
  private sn: number[] = [];
  private blips: Blip[] = [];
  private order: number[] = []; // façade check order
  private post: PostOverrides = {};

  override init() {
    const au = this.ctx.audio, { start, end } = this.ctx;
    this.D = au.downbeats.filter((d) => d >= start - 0.05 && d < end - 0.3);
    if (Math.abs(this.D[0]! - start) > 0.05) this.D.unshift(start);
    const bl = (this.D[this.D.length - 1]! - this.D[0]!) / Math.max(1, this.D.length - 1);
    while (this.D.length < 25) this.D.push(this.D[this.D.length - 1]! + bl);
    this.D[24] = end;
    this.beats = au.beats.filter((b) => b >= start - 0.05 && b < end);
    this.kk = kicks(au, start, end, 0.3);
    this.sn = snares(au, start, end, 0.3);
    const labels = ['NEG 0.12 · GULL', 'NEG 0.04 · LAMP POST', 'NEG 0.31 · SIMILAR COAT', 'NEG 0.08 · DOG', 'NEG 0.02 · PLASTIC BAG', 'NEG 0.19 · WRONG WOMAN', 'NEG 0.06 · REFLECTION'];
    for (let i = 0; i < 22; i++) {
      const ang = hash(i, 3) * TAU, rad = 220 + 820 * hash(i, 4);
      this.blips.push({ x: Math.cos(ang) * rad, z: Math.sin(ang) * rad, ang, label: labels[i % labels.length]! });
    }
    const idx = Array.from({ length: 126 }, (_, i) => i);
    this.order = [...idx].sort((a, b) => hash(a, 71) - hash(b, 71)).slice(0, 16);
  }

  /** Bar index (0..23) and phase within the bar. */
  private barOf(t: number) {
    const i = clamp(lastIdx(this.D, t), 0, 23);
    return { i, u: clamp((t - this.D[i]!) / (this.D[i + 1]! - this.D[i]!)), t0: this.D[i]!, len: this.D[i + 1]! - this.D[i]! };
  }
  private hitK(t: number, hl = 0.1) { return this.ctx.audio.hit('kick', t, hl); }

  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    const t = f.t, r = this.ctx.renderer;
    clearRT(r, out, LIN.void);
    const L = this.L, c = L.ctx;
    L.clear();
    this.B.clear();
    this.post = {};
    const { i } = this.barOf(t);
    if (i === 0) this.shotLost(c, t);
    else if (i <= 2) this.shotRadar(c, t);
    else if (i <= 4) this.shotSonar(c, t);
    else if (i <= 6) this.shotCCTV(c, t, out);
    else if (i <= 8) this.shotThermal(c, t);
    else if (i <= 12) this.shotHunt(c, t);
    else if (i <= 16) this.shotTri(c, t);
    else if (i <= 20) this.shotTrail(c, t);
    else this.shotClose(c, t);
    if (i < 5 || i > 6) this.B.render(r, out);
    this.hud(c, t, i);
    this.ctx.comp.draw(r, L.upload(), out, { mode: 'normal' });
    return { bloom: 0.8, bloomThreshold: 0.95, bloomKnee: 0.12, vignette: 0.55, grain: 0.06, halation: 0.35, ca: 1.2, ...this.post };
  }

  // ------------------------------------------------------------------ bar 0: lock failed
  private shotLost(c: CanvasRenderingContext2D, t: number) {
    const t0 = this.D[0]!, t1 = this.D[1]!;
    const open = springStep(t - t0, 3.2, 0.3); // the brackets spring open
    const lock = clamp(1 - open);
    const R = 150 + 260 * open;
    const drift = prog(t, t0 + 0.3, t1, ease.inOutCubic);
    const x = W / 2 + 180 * noise1(t * 2.2, 3) * drift, y = H / 2 + 90 * noise1(t * 2.5, 7) * drift;
    drawTargetLock(c, x, y, R, t, { lock, beatPhase: 0, alpha: 0.9, label: lock > 0.5 ? 'LOCK' : 'LOCK FAILED' });
    // TARGET LOST, sliced and displaced on each snare
    const sn = this.sn.filter((s) => s >= t0 - 0.01 && s <= t);
    const g = sn.length ? Math.exp(-(t - sn[sn.length - 1]!) * 26) : 0;
    const txt = 'TARGET LOST';
    const size = 150;
    c.save();
    c.font = font(F.mono(600), size);
    c.letterSpacing = '6px';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const slices = 9;
    const reveal = smoothstep(t0 + 0.02, t0 + 0.1, t);
    for (let s = 0; s < slices; s++) {
      const sy = H / 2 - size * 0.45 + (s * size * 0.9) / slices;
      c.save();
      c.beginPath();
      c.rect(0, sy, W, (size * 0.9) / slices + 0.5);
      c.clip();
      const off = (hash(s, sn.length, 5) - 0.5) * 70 * g;
      c.fillStyle = rgba('crimson', reveal * (s % 3 === 1 ? 0.75 : 1));
      c.fillText(txt, W / 2 + off, H / 2);
      c.restore();
    }
    c.restore();
    mono(c, `LAST FIX 52.520391N 13.405671E · ${(t - t0 + 0.44).toFixed(2)} s AGO`, W / 2, H / 2 + 128, { size: 16, align: 'center', color: rgba('mercury', 0.7) });
    const k = this.hitK(t);
    this.post = { zoom: 1 + 0.05 * k, shake: shakeOf(t, 10 * k + 12 * g), ca: 1.5 + 5 * g };
  }

  // ------------------------------------------------------------------ bars 1–2: radar
  private shotRadar(c: CanvasRenderingContext2D, t: number) {
    const t0 = this.D[1]!, t1 = this.D[3]!, bar = this.D[2]! - this.D[1]!;
    const cam = this.cam;
    const push = springs(t, this.kk.filter((k) => k > t0 && k < t1), 1, 3, 0.55) + (t - t0) * 0.6;
    const dist = 2000 - 150 * push;
    const yaw = 0.35 * (t - t0) / (t1 - t0) - 0.2;
    cam.set({ x: Math.sin(yaw) * -dist * 0.55, y: dist * 0.8, z: -Math.cos(yaw) * dist * 0.55, yaw, pitch: -0.97, fov: 55 });
    const B = this.B;
    const R = 1100;
    for (let k = 1; k <= 4; k++) ring3(B, cam, 0, 0, 0, (R * k) / 4, 1.2, mul(ASH, k === 4 ? 2.5 : 1.8), 1, 120);
    for (let s = 0; s < 12; s++) { const a = (s / 12) * TAU; seg3(B, cam, 0, 0, 0, Math.cos(a) * R, 0, Math.sin(a) * R, 1, mul(ASH, 1.4), 1); }
    // faint range ticks
    for (let s = 0; s < 72; s++) { const a = (s / 72) * TAU, r0 = R * (s % 6 ? 0.985 : 0.96); seg3(B, cam, Math.cos(a) * r0, 0, Math.sin(a) * r0, Math.cos(a) * R, 0, Math.sin(a) * R, 1, mul(ASH, 2.6), 1); }
    // the sweep: one turn per bar, a fading crimson wedge
    const sweep = ((t - t0) / bar) * TAU;
    for (let q = 0; q < 46; q++) {
      const a = sweep - q * 0.016;
      const k = Math.pow(1 - q / 46, 2);
      seg3(B, cam, 0, 0, 0, Math.cos(a) * R, 0, Math.sin(a) * R, q === 0 ? 2.4 : 1.4, CRIM(q === 0 ? 2.2 : 0.9 * k), q === 0 ? 1 : k * 0.6);
    }
    // contacts: lit as the sweep passes; the reticle snaps to the freshest
    let best = -1, bestSince = 1e9;
    for (let b = 0; b < this.blips.length; b++) {
      const p = this.blips[b]!;
      const since = ((((sweep - p.ang) % TAU) + TAU) % TAU) / TAU * bar; // seconds since the sweep passed
      const turns = Math.floor((sweep - p.ang) / TAU);
      if (turns < 0) continue;
      const k = Math.exp(-since * 2.2);
      if (!cam.p(p.x, 0, p.z)) continue;
      c.fillStyle = rgba('bone', 0.2 + 0.75 * k);
      c.beginPath(); c.arc(cam.sx, cam.sy, 2 + 3 * k, 0, TAU); c.fill();
      if (k > 0.25) {
        c.strokeStyle = rgba('bone', 0.6 * k); c.lineWidth = 1;
        c.beginPath(); c.arc(cam.sx, cam.sy, 6 + 30 * (1 - k), 0, TAU); c.stroke();
      }
      if (since < bestSince && b % 3 === 0) { bestSince = since; best = b; }
    }
    // labels for every third contact (the ones the reticle checks), deadpan
    for (let b = 0; b < this.blips.length; b += 3) {
      const p = this.blips[b]!;
      const since = ((((sweep - p.ang) % TAU) + TAU) % TAU) / TAU * bar;
      if (Math.floor((sweep - p.ang) / TAU) < 0 || since > bar * 0.8) continue;
      if (!cam.p(p.x, 0, p.z)) continue;
      const a = clamp(since * 8) * (1 - smoothstep(bar * 0.5, bar * 0.8, since));
      mono(c, p.label, cam.sx + 14, cam.sy - 10, { size: 13, color: rgba('bone', 0.8 * a) });
    }
    if (best >= 0) {
      const p = this.blips[best]!;
      cam.p(p.x, 0, p.z);
      const snap = springStep(bestSince, 6, 0.5);
      drawTargetLock(c, cam.sx, cam.sy, lerp(80, 34, clamp(snap)), t, { lock: 0.35 * clamp(snap), alpha: 0.9, label: bestSince > 0.2 ? 'NEG' : 'CHECK' });
    }
    // range labels
    for (let k = 1; k <= 4; k++) if (cam.p(0, 0, (-R * k) / 4)) mono(c, `${k * 250} m`, cam.sx + 6, cam.sy - 6, { size: 12, color: rgba('ash', 1) });
    mono(c, `SWEEP ${String(1 + Math.floor((t - t0) / bar)).padStart(3, '0')} · 0 MATCH`, W / 2, H - 120, { size: 15, align: 'center', color: rgba('mercury', 0.75) });
    const k = this.hitK(t);
    this.post = { zoom: 1 + 0.025 * k, shake: shakeOf(t, 3 * k) };
  }

  // ------------------------------------------------------------------ bars 3–4: sonar pings over an empty city
  private shotSonar(c: CanvasRenderingContext2D, t: number) {
    const t0 = this.D[3]!, t1 = this.D[5]!;
    const pings = [t0, ...this.kk.filter((k) => k > t0 + 0.2 && k < t1)];
    const cam = this.cam;
    const push = springs(t, pings, 1, 3.2, 0.55);
    const cz = -300 + 150 * push + 140 * (t - t0);
    cam.set({ x: 20 * noise1(t * 0.7, 2), y: 330, z: cz, yaw: 0.05 * noise1(t * 0.5, 5), pitch: -0.4, roll: 0.02 * noise1(t, 9), fov: 64 });
    const B = this.B;
    const V = 1500; // ring speed (world/s)
    // ping origins: where the camera stood on the ground at the kick
    const orig = pings.map((p) => ({ t: p, x: 0, z: -300 + 150 * springs(p + 0.3, pings, 1, 3.2, 0.55) + 140 * (p - t0) + 300 }));
    const live = orig.filter((o) => o.t <= t && t - o.t < 1.6);
    const lit = (x: number, z: number) => {
      let v = 0;
      for (const o of live) {
        const d = Math.hypot(x - o.x, z - o.z), R = V * (t - o.t);
        if (d > R + 40) continue;
        const since = (R - d) / V;
        v = Math.max(v, Math.exp(-Math.max(0, since) * 4.5) * (d > R - 30 ? 1.8 : 1) * Math.exp(-(t - o.t) * 0.9));
      }
      return v;
    };
    // the rings themselves on the ground
    for (const o of live) {
      const R = V * (t - o.t), a = Math.exp(-(t - o.t) * 1.4);
      ring3(B, cam, o.x, 0, o.z, R, 2, CRIM(1.6), a, 140);
      ring3(B, cam, o.x, 0, o.z, R * 0.93, 1, CRIM(0.8), a * 0.5, 140);
    }
    // the city: blocks either side of the street, edges lit by the rings
    const cell = 220, street = 70;
    const zc = Math.floor(cz / cell);
    for (let j = zc - 1; j < zc + 16; j++) for (let ii = -5; ii <= 5; ii++) {
      if (ii === 0) continue; // the street the camera travels
      const x0 = ii * cell + (ii > 0 ? street - cell / 2 : -cell / 2 + 10), x1 = x0 + cell - street - 10;
      const z0 = j * cell + street / 2, z1 = z0 + cell - street;
      const h = 60 + 260 * hash(ii, j, 4);
      const corners = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]] as const;
      for (let q = 0; q < 4; q++) {
        const [ax, az] = corners[q]!, [bx, bz] = corners[(q + 1) % 4]!;
        for (let s = 0; s < 3; s++) {
          const u0 = s / 3, u1 = (s + 1) / 3;
          const px = lerp(ax, bx, (u0 + u1) / 2), pz = lerp(az, bz, (u0 + u1) / 2);
          const v = lit(px, pz);
          const k = 0.03 + 0.6 * v;
          if (k < 0.04) continue;
          const col = mul(BONE, Math.min(1, k));
          seg3(B, cam, lerp(ax, bx, u0), 0, lerp(az, bz, u0), lerp(ax, bx, u1), 0, lerp(az, bz, u1), 1.2, col, 1);
          if (v > 0.05) seg3(B, cam, lerp(ax, bx, u0), h, lerp(az, bz, u0), lerp(ax, bx, u1), h, lerp(az, bz, u1), 1, mul(BONE, 0.55 * v), 1);
        }
        const v = lit(ax, az);
        if (v > 0.05) seg3(B, cam, ax, 0, az, ax, h, az, 1, mul(BONE, 0.6 * v), 1);
      }
    }
    // A-scan: the return trace, nothing but the ground clutter
    const ax0 = W / 2 - 460, ay = H - 150, aw = 920;
    const last = live[live.length - 1];
    c.save();
    c.strokeStyle = rgba('ash', 1); c.lineWidth = 1;
    c.strokeRect(ax0, ay - 70, aw, 90);
    c.beginPath();
    for (let q = 0; q <= 230; q++) {
      const x = ax0 + (q / 230) * aw, d = (q / 230) * 2400;
      let v = 0;
      if (last) {
        const R = V * (t - last.t);
        if (d < R) v = (q < 6 ? 1 : 0.05 + 0.08 * Math.pow(noise1(d * 0.02, 3) * 0.5 + 0.5, 3)) * Math.exp(-(t - last.t) * 0.8);
      }
      const yy = ay - 6 - 58 * v;
      q === 0 ? c.moveTo(x, yy) : c.lineTo(x, yy);
    }
    c.strokeStyle = rgba('bone', 0.8); c.stroke();
    c.restore();
    mono(c, 'A-SCAN', ax0, ay - 80, { size: 12, color: rgba('mercury', 0.7) });
    const n = pings.filter((p) => p <= t).length;
    mono(c, `PING ${String(n).padStart(2, '0')} · RETURN 0.00 · NO SIGNATURE`, ax0 + aw, ay - 80, { size: 12, align: 'right', color: rgba('mercury', 0.7) });
    const k = this.hitK(t);
    this.post = { zoom: 1 + 0.03 * k, shake: shakeOf(t, 4 * k) };
  }

  // ------------------------------------------------------------------ bars 5–6: CCTV
  private shotCCTV(c: CanvasRenderingContext2D, t: number, out: THREE.WebGLRenderTarget) {
    const t0 = this.D[5]!, t6 = this.D[6]!, t1 = this.D[7]!;
    const r = this.ctx.renderer, B = this.B, cam = this.cam;
    const S = out.width / W;
    const quad = t < t6;
    const panels: { room: number; x: number; y: number; w: number; h: number; zoom: number }[] = [];
    if (quad) {
      const g = 8, pw = (W - 3 * g) / 2, ph = (H - 3 * g) / 2;
      for (let q = 0; q < 4; q++) panels.push({ room: q, x: g + (q % 2) * (pw + g), y: g + Math.floor(q / 2) * (ph + g), w: pw, h: ph, zoom: 1 + 0.04 * prog(t, t0, t6) });
    } else {
      const bt = this.beats.filter((b) => b >= t6 - 0.02 && b < t1);
      const bi = clamp(lastIdx(bt, t), 0, 3);
      const lt = t - (bt[bi] ?? t6);
      panels.push({ room: bi, x: 0, y: 0, w: W, h: H, zoom: Math.pow(2, bi) * (1 + 0.25 * ease.outCubic(clamp(lt / 0.4))) });
    }
    for (const p of panels) {
      const room = ROOMS[p.room]!;
      const pan = room.pan * Math.sin((t - t0) * 0.9 + p.room);
      cam.set({ ...room.cam, yaw: (room.cam.yaw ?? 0) + pan, fov: 2 * Math.atan(Math.tan(((room.cam.fov ?? 60) * Math.PI) / 360) / p.zoom) * 180 / Math.PI });
      cam.cx = p.x + p.w / 2; cam.cy = p.y + p.h / 2;
      cam.foc *= p.h / H;
      B.clear();
      const sg = room.segs;
      for (let s = 0; s < room.k.length; s++) {
        const k = room.k[s]!;
        seg3(B, cam, sg[s * 6]!, sg[s * 6 + 1]!, sg[s * 6 + 2]!, sg[s * 6 + 3]!, sg[s * 6 + 4]!, sg[s * 6 + 5]!, 1.2, mul(BONE, 0.42 * k), 1, 0.8, 2.2);
      }
      out.scissor.set(Math.round(p.x * S), Math.round((H - p.y - p.h) * S), Math.round(p.w * S), Math.round(p.h * S));
      out.scissorTest = true;
      B.render(r, out);
      out.scissorTest = false;
      cam.cx = W / 2; cam.cy = H / 2;
      // overlay: frame, label, timestamp, REC, the empty detection box
      c.save();
      c.beginPath(); c.rect(p.x, p.y, p.w, p.h); c.clip();
      c.fillStyle = rgba('bone', 0.016);
      for (let y = p.y + fract(t * 3) * 4; y < p.y + p.h; y += 4) c.fillRect(p.x, y, p.w, 1);
      c.strokeStyle = rgba('ash', 1); c.lineWidth = 2; c.strokeRect(p.x + 1, p.y + 1, p.w - 2, p.h - 2);
      const m = 22;
      mono(c, room.name, p.x + m, p.y + m + 12, { size: 14, color: rgba('bone', 0.8) });
      const ts = 11 * 3600 + 3 * 60 + 12 + (t - t0) + p.room * 0.37;
      mono(c, `2025-11-03  ${clock(ts).slice(0, 11)}`, p.x + p.w - m, p.y + m + 12, { size: 14, align: 'right', color: rgba('bone', 0.8) });
      if (Math.floor(t * 2) % 2 === 0) { c.fillStyle = rgba('crimson', 1); c.beginPath(); c.arc(p.x + m + 6, p.y + p.h - m - 5, 5, 0, TAU); c.fill(); }
      mono(c, 'REC', p.x + m + 18, p.y + p.h - m, { size: 13, color: rgba('crimson', 0.9) });
      mono(c, quad ? '0 PERSONS' : `ENHANCE ×${Math.pow(2, p.room + 1)} · NO MATCH`, p.x + p.w - m, p.y + p.h - m, { size: 14, align: 'right', weight: 600, color: rgba('crimson', 0.9) });
      // a detection box that searches and finds nothing
      const e = erratic(t + p.room * 7.3, 20 + p.room, 0.9);
      const bx = p.x + p.w * (0.2 + 0.6 * e.x), by = p.y + p.h * (0.25 + 0.5 * e.y), bw = p.w * 0.1, bh = p.h * 0.24;
      c.setLineDash([6, 5]); c.strokeStyle = rgba('mercury', 0.55); c.lineWidth = 1;
      c.strokeRect(bx - bw / 2, by - bh / 2, bw, bh);
      c.setLineDash([]);
      mono(c, 'P(HER) 0.00', bx - bw / 2, by - bh / 2 - 6, { size: 11, color: rgba('mercury', 0.6) });
      c.restore();
    }
    const k = this.hitK(t);
    this.post = { zoom: 1 + 0.02 * k, vignette: 0.7, grain: 0.09 };
  }

  // ------------------------------------------------------------------ bars 7–8: the thermal façade
  private shotThermal(c: CanvasRenderingContext2D, t: number) {
    const t0 = this.D[7]!, t8 = this.D[8]!, t1 = this.D[9]!;
    const bar = t8 - t0;
    const cam = this.cam, B = this.B;
    const push = springs(t, this.kk.filter((k) => k > t0 && k < t1), 1, 3.5, 0.55);
    cam.set({ x: -260 + 300 * prog(t, t0, t1), y: 260, z: -900 + 60 * push + 170 * (t - t0), yaw: 0.06, pitch: 0.36, fov: 58 });
    const COLS = 14, ROWS = 9, SX = 132, SY = 170, WW = 76, WH = 112, FZ = 900;
    const X0 = -((COLS - 1) * SX) / 2;
    // check times: 8 at 8ths (bar 7), 8 at 16ths (first half of bar 8), then a sweep of the other 110
    const tCheck = (n: number) => {
      const k = this.order.indexOf(n);
      if (k >= 0 && k < 8) return t0 + (k * bar) / 8;
      if (k >= 8) return t8 + ((k - 8) * bar) / 16;
      const row = Math.floor(n / COLS), col = n % COLS;
      return t8 + bar / 2 + ((row + col) / (ROWS + COLS - 2)) * bar * 0.46;
    };
    let cur = -1, curT = -1e9, nChecked = 0;
    // the building outline
    const x0 = X0 - SX * 0.8, x1 = -X0 + SX * 0.8, top = ROWS * SY + 120;
    seg3(B, cam, x0, 0, FZ, x1, 0, FZ, 1.4, mul(BONE, 0.3), 1); seg3(B, cam, x0, 0, FZ, x0, top, FZ, 1.4, mul(BONE, 0.3), 1);
    seg3(B, cam, x1, 0, FZ, x1, top, FZ, 1.4, mul(BONE, 0.3), 1); seg3(B, cam, x0, top, FZ, x1, top, FZ, 1.4, mul(BONE, 0.3), 1);
    for (let row = 0; row < ROWS; row++) seg3(B, cam, x0, row * SY + 60, FZ, x1, row * SY + 60, FZ, 1, mul(ASH, 1.3), 1);
    for (let n = 0; n < COLS * ROWS; n++) {
      const row = Math.floor(n / COLS), col = n % COLS;
      const wx = X0 + col * SX, wy = 130 + row * SY;
      const tc = tCheck(n);
      const age = t - tc;
      const checked = age >= 0;
      if (checked) nChecked++;
      if (checked && tc > curT) { curT = tc; cur = n; }
      const heat = checked ? Math.exp(-age * 5) : 0;
      // window frame
      const fr = checked ? mul(BONE, 0.2 + 0.5 * heat) : mul(ASH, 2.2);
      const hw = WW / 2, hh = WH / 2;
      seg3(B, cam, wx - hw, wy - hh, FZ, wx + hw, wy - hh, FZ, 1.2, fr, 1); seg3(B, cam, wx + hw, wy - hh, FZ, wx + hw, wy + hh, FZ, 1.2, fr, 1);
      seg3(B, cam, wx + hw, wy + hh, FZ, wx - hw, wy + hh, FZ, 1.2, fr, 1); seg3(B, cam, wx - hw, wy + hh, FZ, wx - hw, wy - hh, FZ, 1.2, fr, 1);
      // thermal scanlines inside: an ambient warmth per flat, blazing as it is checked
      const warm = 0.12 + 0.3 * hash(n, 5);
      const k = checked ? warm * 0.35 + heat * 1.6 : warm * 0.5 * smoothstep(t0 - 0.1, t0 + 0.4, t);
      if (k > 0.03) {
        const person = hash(n, 8) > 0.8; // someone home — not her
        for (let s = 1; s < 8; s++) {
          const yy = wy - hh + (s * WH) / 8;
          const blob = person ? Math.max(0, 1 - Math.hypot((s / 8 - 0.55) * 2.2, 0) ) : 0;
          const hotC = CRIM(0.5 + 1.8 * k + blob * 1.2 * (checked ? 1 : 0.4));
          seg3(B, cam, wx - hw + 6, yy, FZ - 1, wx + hw - 6, yy, FZ - 1, 1.1, hotC, clamp(k * (0.6 + blob)));
        }
      }
    }
    // labels: NEG stamps on the checked windows (canvas), the reticle hops to the current one
    c.save();
    for (let n = 0; n < COLS * ROWS; n++) {
      const tc = tCheck(n);
      if (t < tc) continue;
      const row = Math.floor(n / COLS), col = n % COLS;
      if (!cam.p(X0 + col * SX, 130 + row * SY, FZ)) continue;
      const age = t - tc;
      mono(c, 'NEG', cam.sx, cam.sy + 5, { size: Math.max(9, 13 * cam.k * 1.4), align: 'center', weight: 600, color: rgba('bone', age < 0.12 ? 1 : 0.42) });
    }
    c.restore();
    if (cur >= 0) {
      const row = Math.floor(cur / COLS), col = cur % COLS;
      if (cam.p(X0 + col * SX, 130 + row * SY, FZ)) {
        const age = t - curT;
        drawTargetLock(c, cam.sx, cam.sy, lerp(90, 46, ease.outCubic(clamp(age / 0.08))) * cam.k * 1.3, t, { lock: 0.6, alpha: 0.95 });
        const temp = 34.2 + 3 * hash(cur, 9);
        mono(c, `W-${String(1400 + cur).padStart(4, '0')} · ${temp.toFixed(1)}°C · NEG`, cam.sx + 60 * cam.k * 1.3, cam.sy - 50 * cam.k * 1.3, { size: 14, color: rgba('bone', 0.9) });
      }
    }
    mono(c, `THERMAL · BLOCK 14 · CHECKED ${String(nChecked).padStart(3, '0')}/126 · NEG ${String(nChecked).padStart(3, '0')}`, W / 2, H - 110, { size: 16, align: 'center', weight: 500, color: rgba('mercury', 0.8) });
    const k = this.hitK(t);
    this.post = { zoom: 1 + 0.03 * k, shake: shakeOf(t, 5 * k), halation: 0.5 };
  }

  // ------------------------------------------------------------------ shared LIDAR land for the hunt
  private land(c: CanvasRenderingContext2D, t: number, o: { scan?: number; scanDir?: [number, number]; scanR?: number; reach?: number; step?: number }) {
    lidar(this.B, this.cam, { step: o.step ?? 26, reach: o.reach ?? 1500, scanD: o.scan, scanDir: o.scanDir, scanR: o.scanR, size: 1.8, rows: 1 });
    void c; void t;
  }

  // ------------------------------------------------------------------ bars 9–12: the hunt resumes
  private shotHunt(c: CanvasRenderingContext2D, t: number) {
    const t0 = this.D[9]!, t1 = this.D[13]!;
    const bt = this.beats.filter((b) => b >= t0 - 0.02 && b < t1);
    const half = clamp(Math.floor(lastIdx(bt, t) / 2), 0, 7); // a new camera every two beats
    const lt = t - (bt[half * 2] ?? t0);
    const z = 1400 * (t - t0) + 30000;
    const x = trailX(z);
    const setups = [
      { dx: 0, h: 60, yaw: 0, pitch: -0.1, roll: 0, fov: 70 },
      { dx: -260, h: 420, yaw: 0.35, pitch: -0.55, roll: 0.05, fov: 56 },
      { dx: 90, h: 40, yaw: -0.25, pitch: -0.05, roll: -0.18, fov: 76 },
      { dx: 0, h: 900, yaw: 0, pitch: -1.2, roll: 0, fov: 50 },
    ];
    const s = setups[half % 4]!;
    const ground = terrain(x + s.dx, z, 0);
    this.cam.set({ x: x + s.dx, y: ground + s.h + 12 * noise1(t * 3, 4), z, yaw: s.yaw + 0.04 * noise1(t * 1.7, 6), pitch: s.pitch, roll: s.roll + 0.03 * noise1(t * 2.1, 8), fov: s.fov - 6 * ease.outCubic(clamp(lt / 0.9)) });
    // one scan front per bar (on the synth lead)
    const { t0: b0, len } = this.barOf(t);
    const scan = z + 150 + prog(t, b0, b0 + len * 0.75, ease.outCubic) * 2200;
    this.land(c, t, { scan, scanDir: [0, 1], reach: s.h > 800 ? 1300 : 1600 });
    // the hunted trail ahead, crimson
    for (let q = 0; q < 60; q++) {
      const za = z + 40 + q * 36, zb = za + 36;
      seg3(this.B, this.cam, trailX(za), terrain(trailX(za), za) + 3, za, trailX(zb), terrain(trailX(zb), zb) + 3, zb, 2.5, CRIM(1.8), clamp(1 - q / 60));
    }
    // HUNT RESUMED slams on the first downbeat
    const slam = t - t0;
    if (slam < 1.1) {
      const a = slam < 0.8 ? 1 : 1 - (slam - 0.8) / 0.3;
      const sc = 1 + 0.6 * Math.exp(-slam * 18);
      c.save();
      c.translate(W / 2, H / 2); c.scale(sc, sc);
      c.font = font(F.mono(700), 120); c.letterSpacing = '8px'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = rgba('crimson', a);
      c.fillText('HUNT RESUMED', 0, 0);
      c.restore();
    }
    const vel = 212 + 18 * noise1(t, 3);
    mono(c, `VEL ${vel.toFixed(0)} km/h · HDG ${String(Math.round(71 + 40 * noise1(t * 0.3, 5))).padStart(3, '0')}° · SECTOR ${14 + Math.floor((t - t0) / len)}/96`, W / 2, H - 110, { size: 15, align: 'center', color: rgba('mercury', 0.75) });
    const k = this.hitK(t);
    this.post = { zoom: 1 + 0.045 * k, shake: shakeOf(t, 7 * k + 16 * Math.exp(-lt * 12)), ca: 1.6 + 3 * Math.exp(-lt * 10) };
  }

  // ------------------------------------------------------------------ bars 13–16: triangulation
  private shotTri(c: CanvasRenderingContext2D, t: number) {
    const t0 = this.D[13]!, t1 = this.D[17]!;
    const { i: bi, t0: b0 } = this.barOf(t);
    const k4 = bi - 13; // 0..3
    const z = 1100 * (t - t0) + 90000;
    const x = trailX(z);
    const fix = { x: x + 600, z: z + 2600 };
    const towers = [
      { x: fix.x - 1500, z: fix.z + 700, r: 1650, name: 'A' },
      { x: fix.x + 1300, z: fix.z + 900, r: 1590, name: 'B' },
      { x: fix.x + 200, z: fix.z - 1000, r: 1020, name: 'C' },
    ];
    const cam = this.cam;
    const lt = t - b0;
    if (k4 < 3) {
      // whip: the yaw swings to the next tower on the downbeat (a fast spring, overshoot)
      const aim = (tw: { x: number; z: number }) => Math.atan2(tw.x - x, tw.z - z);
      const prev = k4 === 0 ? 0 : aim(towers[k4 - 1]!), next = aim(towers[k4]!);
      const w = springStep(lt, 2.6, 0.55);
      const yaw = lerp(prev, next, w);
      cam.set({ x, y: terrain(x, z) + 90, z, yaw, pitch: 0.02, roll: -0.12 * (w - 1) * Math.sign(next - prev), fov: 64 - 10 * ease.outCubic(clamp(lt / 1.5)) });
    } else {
      // crane down onto the intersection
      const u = ease.inOutCubic(clamp(lt / 1.6));
      cam.set({ x: lerp(x, fix.x, u * 0.8), y: lerp(1900, 1100, u) + terrain(fix.x, fix.z), z: lerp(z - 600, fix.z - 900, u), yaw: 0, pitch: lerp(-0.7, -1.05, u), fov: 58 });
    }
    this.land(c, t, { reach: k4 < 3 ? 2200 : 2400, step: k4 < 3 ? 30 : 34, scanR: (t - b0) * 2400 });
    const B = this.B;
    for (let q = 0; q < 3; q++) {
      const tw = towers[q]!;
      const on = k4 >= q;
      if (!on) continue;
      const gy = terrain(tw.x, tw.z);
      // the mast: a crimson beam, and a range ring that shrinks to its true radius
      seg3(B, cam, tw.x, gy, tw.z, tw.x, gy + 700, tw.z, 5, CRIM(2.4), 1, 1.5, 8);
      for (let s = 0; s < 6; s++) seg3(B, cam, tw.x - 40, gy + 560 + s * 24, tw.z, tw.x + 40, gy + 560 + s * 24, tw.z, 2, CRIM(1.4), 0.8, 1, 4);
      const since = t - (this.D[13 + q] ?? t0);
      const rr = tw.r * (1 + 1.2 * Math.exp(-since * 1.6));
      ring3(B, cam, tw.x, gy + 8, tw.z, rr, 4, CRIM(1.5), 0.9, 160);
      if (cam.p(tw.x, gy + 720, tw.z) && cam.on(0)) mono(c, `TOWER ${tw.name} · ${(tw.r / 900).toFixed(2)} km`, cam.sx + 12, cam.sy, { size: 15, weight: 600, color: rgba('crimson', 1) });
    }
    const err = [1400, 412, 160, 38][k4]! * (1 + 0.5 * Math.exp(-lt * 3));
    if (k4 === 3 && cam.p(fix.x, terrain(fix.x, fix.z), fix.z)) {
      drawTargetLock(c, cam.sx, cam.sy, 70, t, { lock: 0.5, alpha: 0.9, label: `FIX ±${err.toFixed(0)} m` });
    }
    mono(c, `TRIANGULATING · ${k4 + 1}/3 TOWERS · ERR ±${err.toFixed(0)} m`, W / 2, H - 110, { size: 15, align: 'center', color: rgba('mercury', 0.8) });
    const k = this.hitK(t);
    this.post = { zoom: 1 + 0.04 * k, shake: shakeOf(t, 6 * k + (k4 < 3 ? 14 * Math.exp(-lt * 9) : 0)), ca: 1.5 + 4 * Math.exp(-lt * 8) };
  }

  // ------------------------------------------------------------------ bars 17–20: the trail
  private shotTrail(c: CanvasRenderingContext2D, t: number) {
    const t0 = this.D[17]!;
    const { i: bi, t0: b0, len } = this.barOf(t);
    const k4 = bi - 17;
    const lt = t - b0;
    const z = 1700 * (t - t0) + 150000;
    const x = trailX(z);
    const setups = [
      { dx: -70, h: 45, yaw: 0.05, roll: 0.06, pitch: -0.14, fov: 72 },
      { dx: 120, h: 28, yaw: -0.12, roll: -0.12, pitch: -0.1, fov: 78 },
      { dx: -30, h: 150, yaw: 0.02, roll: 0.0, pitch: -0.34, fov: 60 },
      { dx: 40, h: 18, yaw: -0.04, roll: 0.2, pitch: -0.06, fov: 84 },
    ];
    const s = setups[k4]!;
    const cam = this.cam;
    cam.set({ x: x + s.dx, y: terrain(x + s.dx, z) + s.h + 6 * noise1(t * 5, 2), z, yaw: s.yaw + 0.03 * noise1(t * 2, 3), pitch: s.pitch, roll: s.roll + 0.02 * noise1(t * 3, 4), fov: s.fov - 8 * ease.outCubic(clamp(lt / len)) });
    const scan = z + 100 + prog(t, b0, b0 + len * 0.6, ease.outCubic) * 1900;
    this.land(c, t, { scan, scanDir: [0, 1], reach: 1400, step: 24 });
    // footprints: a pair of marks each "step", alternating sides; fresher (brighter) further ahead
    const B = this.B;
    const stepL = 70;
    const s0 = Math.floor((z - 40) / stepL);
    for (let q = s0; q < s0 + 34; q++) {
      const zz = q * stepL, side = q % 2 ? 1 : -1;
      const xx = trailX(zz) + side * 14;
      const gy = terrain(xx, zz) + 2;
      const fresh = 0.35 + 0.65 * clamp((zz - z) / 2000) * (0.4 + 0.6 * k4 / 3);
      seg3(B, cam, xx, gy, zz - 7, xx, gy, zz + 7, 6, CRIM(0.8 + 1.8 * fresh), 0.9, 1.5, 7);
      seg3(B, cam, xx - 2, gy, zz + 9, xx + 2, gy, zz + 9, 6, CRIM(0.6 + 1.4 * fresh), 0.8, 1.2, 6);
    }
    const age = [192, 100, 51, 8][k4]! - 6 * lt;
    mono(c, `TRAIL · ${clock(Math.max(1, age)).slice(3, 8)} OLD · DIST ${Math.round(1840 - 300 * (bi - 17 + lt / len))} m`, W / 2, H - 110, { size: 15, align: 'center', color: rgba('mercury', 0.8) });
    // the reticle rides the trail ahead, tightening bar by bar
    if (cam.p(trailX(z + 900), terrain(trailX(z + 900), z + 900), z + 900)) drawTargetLock(c, cam.sx, cam.sy, lerp(120, 60, k4 / 3), t, { lock: 0.2 + 0.15 * k4, alpha: 0.85, label: 'TRAIL' });
    const k = this.hitK(t);
    this.post = { zoom: 1 + 0.05 * k, shake: shakeOf(t, 7 * k + 16 * Math.exp(-lt * 12)), ca: 1.6 + 3 * Math.exp(-lt * 10) };
  }

  // ------------------------------------------------------------------ bars 21–23: closing in, reacquired
  private shotClose(c: CanvasRenderingContext2D, t: number) {
    const t0 = this.D[21]!, tl = this.D[23]!, end = this.ctx.end;
    const bt = this.beats.filter((b) => b >= t0 - 0.02 && b < end);
    const bi = clamp(lastIdx(bt, t), 0, bt.length - 1);
    const lt = t - (bt[bi] ?? t0);
    const tz = 220000; // the target stands here
    const tx = trailX(tz), ty = terrain(tx, tz);
    // a punch-in on every beat (the camera jumps closer; never back)
    const n = Math.min(bi, 8);
    const dist = t < tl ? 1000 * Math.pow(0.87, n) * (1 - 0.05 * ease.outCubic(clamp(lt / 0.44))) : 340 * (1 - 0.14 * prog(t, tl, end, ease.inOutCubic));
    const z = tz - dist;
    const side = (n % 2 ? 1 : -1) * 30 * (t < tl ? 1 : 0.2);
    const cam = this.cam;
    const cx = lerp(trailX(z), tx, 0.6) + side;
    const cy = terrain(cx, z) + 70 + dist * 0.05;
    const yaw = Math.atan2(tx - cx, tz - z);
    cam.set({ x: cx, y: cy, z, yaw, pitch: Math.atan2(ty + 95 - cy, dist), roll: (n % 2 ? 0.05 : -0.05) * (t < tl ? 1 : 0), fov: t < tl ? 60 : lerp(56, 50, prog(t, tl, end, ease.inOutCubic)) });
    this.land(c, t, { reach: 1200, step: 22, scanR: fract((t - t0) / 0.889) * 1400 });
    // the figure: LIDAR returns on a standing body (seen from behind), bone with a crimson core
    const B = this.B;
    for (let q = 0; q < 900; q++) {
      const v = hash(q, 1), a = hash(q, 2) * TAU;
      let px = 0, py = 0, pz = 0;
      if (v < 0.12) { const r = 11; px = Math.cos(a) * r * Math.sqrt(hash(q, 3)); pz = Math.sin(a) * r * Math.sqrt(hash(q, 3)); py = 158 + 22 * hash(q, 4); } // head
      else if (v < 0.62) { const yy = 88 + 64 * hash(q, 4); const r = 17 + 5 * Math.sin((yy - 88) / 64 * Math.PI); px = Math.cos(a) * r; pz = Math.sin(a) * r * 0.6; py = yy; } // torso
      else if (v < 0.86) { const leg = hash(q, 5) < 0.5 ? -1 : 1; py = 88 * hash(q, 4); px = leg * 8 + Math.cos(a) * 6; pz = Math.sin(a) * 5; } // legs
      else { const arm = hash(q, 5) < 0.5 ? -1 : 1; py = 90 + 58 * hash(q, 4); px = arm * (24 + 3 * (1 - (py - 90) / 58)) + Math.cos(a) * 3; pz = Math.sin(a) * 3; } // arms
      const flick = hash(q, Math.floor(t * 24)) > 0.15 ? 1 : 0;
      if (!cam.p(tx + px, ty + py, tz + pz)) continue;
      const core = Math.exp(-Math.hypot(px, py - 120, pz) / 40);
      const w = clamp(1.6 * cam.k, 1, 4);
      const col = [lerp(BONE[0], LIN.crimson[0] * 2.2, core), lerp(BONE[1], LIN.crimson[1] * 2.2, core), lerp(BONE[2], LIN.crimson[2] * 2.2, core)];
      B.seg(cam.sx, cam.sy, 0, cam.sx, cam.sy, 0, w, col[0]!, col[1]!, col[2]!, 0.85 * flick);
    }
    // the lock: loose until the last bar, then clamped on the snares, locked on the last beat
    cam.p(tx, ty + 95, tz);
    const sx = cam.sx, sy = cam.sy;
    const lastSn = this.sn.filter((s) => s >= tl - 0.02 && s < end);
    let lock = 0.15 + 0.05 * n;
    if (t >= tl) {
      lock = 0.45;
      for (const s of lastSn) if (t >= s) lock += 0.28 * springStep(t - s, 7, 0.4);
      const lastBeat = bt[bt.length - 1] ?? end - 0.44;
      if (t >= lastBeat) lock = 1;
    }
    const R = lerp(95, 62, clamp(lock)) * cam.k;
    const locked = lock >= 1;
    drawTargetLock(c, sx, sy, R, t, { lock: clamp(lock), alpha: 1, label: locked ? 'LOCK' : 'ACQUIRING' });
    if (locked) {
      const since = t - (bt[bt.length - 1] ?? end);
      const sc = 1 + 0.4 * Math.exp(-since * 20);
      c.save();
      c.translate(W / 2, H - 200); c.scale(sc, sc);
      c.font = font(F.mono(700), 72); c.letterSpacing = '6px'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = rgba('crimson', 1);
      c.fillText('TARGET REACQUIRED', 0, 0);
      c.restore();
    }
    const dm = Math.max(4, Math.round(t < tl ? 612 * Math.pow(0.78, n) * (1 - 0.1 * lt) : 16 * (1 - prog(t, tl, end) * 0.6)));
    mono(c, `DIST ${String(dm).padStart(3, '0')} m · 36.9°C · GAIT MATCH ${Math.min(0.99, 0.62 + 0.035 * n + (locked ? 0.3 : 0)).toFixed(2)}`, W / 2, H - 110, { size: 15, align: 'center', color: rgba(locked ? 'crimson' : 'mercury', 0.85) });
    const k = this.hitK(t);
    this.post = {
      zoom: 1 + 0.05 * k + (t < tl ? 0.03 * Math.exp(-lt * 10) : 0), shake: shakeOf(t, 8 * k + 14 * Math.exp(-lt * 12)),
      ca: 1.5 + 3 * Math.exp(-lt * 10), flash: 0.035 * smoothstep(end - 0.1, end, t), bloom: locked ? 1.1 : 0.8,
    };
  }

  // ------------------------------------------------------------------ the running HUD
  private hud(c: CanvasRenderingContext2D, t: number, bar: number) {
    const { start } = this.ctx;
    const cctv = bar === 5 || bar === 6;
    const lost = bar < 23;
    const blink = Math.floor((t - start) * 3) % 2 === 0;
    if (!cctv) mono(c, lost ? 'TARGET LOST' : 'TARGET REACQUIRED', 72, 92, { size: 16, weight: 600, color: rgba('crimson', lost ? (blink ? 1 : 0.35) : 1) });
    if (!cctv) mono(c, `SEARCH ${clock(t - start)}`, 72, 116, { size: 13, color: rgba('mercury', 0.6) });
    if (!cctv) mono(c, `MODE ${String(bar + 1).padStart(2, '0')} · ${MODES[bar]}`, W - 72, 92, { size: 13, align: 'right', weight: 600, color: rgba('mercury', 0.75) });
    if (!cctv) mono(c, `BAR ${String(bar + 1).padStart(2, '0')}/24`, W - 72, 114, { size: 13, align: 'right', color: rgba('mercury', 0.5) });
    // the search log: the last entries, the newest typing in
    const n = bar + 1;
    for (let q = 0; q < 5; q++) {
      const e = n - 1 - q;
      if (e < 0) break;
      let s = `${clock(this.D[e]! - start).slice(3)}  ${LOG[e]}`;
      if (q === 0) s = s.slice(0, Math.floor(prog(t, this.D[e]!, this.D[e]! + 0.35) * s.length));
      mono(c, s, 72, H - 72 - q * 20, { size: 12, color: rgba(q === 0 ? 'bone' : 'mercury', q === 0 ? 0.8 : 0.5 - q * 0.08) });
    }
  }
}
