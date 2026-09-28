// search: the four CCTV rooms (static wireframe geometry in world units, y up) and their cameras.
import { hash } from '../engine/util';
import type { CamPose } from './search-kit';

/** Segments as flat [ax, ay, az, bx, by, bz, ...] and a brightness per segment. */
export interface Room { name: string; segs: number[]; k: number[]; cam: CamPose; pan: number }

function room(name: string, cam: CamPose, pan: number) {
  const r: Room = { name, segs: [], k: [], cam, pan };
  const L = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, k = 1) => { r.segs.push(ax, ay, az, bx, by, bz); r.k.push(k); };
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, k = 1) => {
    for (const [ya, yb] of [[y0, y0], [y1, y1]] as const) {
      L(x0, ya, z0, x1, yb, z0, k); L(x1, ya, z0, x1, yb, z1, k); L(x1, ya, z1, x0, yb, z1, k); L(x0, ya, z1, x0, yb, z0, k);
    }
    L(x0, y0, z0, x0, y1, z0, k); L(x1, y0, z0, x1, y1, z0, k); L(x1, y0, z1, x1, y1, z1, k); L(x0, y0, z1, x0, y1, z1, k);
  };
  return { r, L, box };
}

/** U-Bahn platform: the edge, the rails, pillars receding, strip lights, a bench. */
function platform() {
  const { r, L, box } = room('CAM 01 · U-BAHN BAHNSTEIG 2', { x: 150, y: 190, z: -40, yaw: -0.2, pitch: -0.2, fov: 62 }, 0.12);
  L(0, 0, 0, 0, 0, 3000, 1.2); // platform edge
  L(-12, -60, 0, -12, -60, 3000, 0.5);
  for (const x of [-80, -140, -230, -290]) L(x, -110, 0, x, -110, 3000, 0.7); // rails
  L(400, 0, 0, 400, 0, 3000, 0.5); L(400, 0, 0, 400, 330, 0, 0.4); L(400, 330, 0, 400, 330, 3000, 0.5);
  for (let z = 150; z < 3000; z += 260) {
    box(200, 0, z, 236, 330, z + 36, 0.8);
    L(60, 318, z + 60, 180, 318, z + 60, 1.4); // strip light
  }
  box(270, 0, 420, 380, 44, 470, 0.7); // bench
  for (let z = 0; z < 3000; z += 90) L(0, 0, z, 20, 0, z, 0.35); // tactile strip
  L(-400, 330, 0, 400, 330, 0, 0.3);
  return r;
}

/** Stairwell, Hauseingang 14: steps going up to a door. */
function stairs() {
  const { r, L, box } = room('CAM 02 · HAUSEINGANG 14', { x: -40, y: 70, z: -60, yaw: 0.25, pitch: 0.28, fov: 66 }, 0.08);
  const w = 180;
  for (let s = 0; s < 14; s++) {
    const y = s * 34, z = 200 + s * 52;
    L(0, y, z, w, y, z, 1); L(0, y + 34, z, w, y + 34, z, 1);
    L(0, y, z, 0, y + 34, z, 0.6); L(w, y, z, w, y + 34, z, 0.6);
    L(0, y + 34, z, 0, y + 34, z + 52, 0.6); L(w, y + 34, z, w, y + 34, z + 52, 0.6);
  }
  // handrail
  for (let s = 0; s < 13; s++) L(w + 10, 120 + s * 34, 200 + s * 52, w + 10, 120 + (s + 1) * 34, 200 + (s + 1) * 52, 1.1);
  for (let s = 0; s < 14; s += 3) L(w + 10, s * 34, 200 + s * 52, w + 10, 120 + s * 34, 200 + s * 52, 0.6);
  // landing and door
  const yl = 14 * 34, zl = 200 + 14 * 52;
  L(-60, yl, zl, w + 60, yl, zl, 1); L(-60, yl, zl + 200, w + 60, yl, zl + 200, 0.6);
  box(20, yl, zl + 198, 160, yl + 260, zl + 204, 1.2);
  L(140, yl + 120, zl + 196, 150, yl + 120, zl + 196, 1.4);
  // walls
  L(-10, 0, 200, -10, yl, zl, 0.5); L(-10, 0, 200, -10, 600, 200, 0.4); L(-10, yl, zl, -10, yl + 300, zl, 0.4);
  L(-200, 0, 0, w + 200, 0, 0, 0.5); L(-200, 0, 0, -10, 0, 200, 0.5);
  // mailboxes on the wall
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) box(-12, 160 + j * 40, 30 + i * 36, -8, 190 + j * 40, 60 + i * 36, 0.45);
  return r;
}

/** Parkdeck C: pillars in a grid, beams, bay lines. */
function parking() {
  const { r, L, box } = room('CAM 03 · PARKDECK C · EBENE -2', { x: -420, y: 220, z: -80, yaw: 0.42, pitch: -0.16, fov: 70 }, 0.18);
  for (let i = -3; i <= 3; i++) for (let j = 0; j < 7; j++) {
    const x = i * 360, z = j * 420 + 200;
    box(x - 22, 0, z - 22, x + 22, 280, z + 22, 0.8);
  }
  for (let j = 0; j < 7; j++) L(-1200, 280, j * 420 + 200, 1200, 280, j * 420 + 200, 0.4);
  for (let i = -3; i <= 3; i++) L(i * 360, 280, 0, i * 360, 280, 3000, 0.35);
  for (let x = -1080; x <= 1080; x += 120) if (hash(x, 3) > 0.15) L(x, 0, 40, x, 0, 180, 0.5); // bays
  for (let j = 0; j < 7; j++) for (let i = -3; i < 3; i++) if (hash(i, j, 9) > 0.5) L(i * 360 + 120, 276, j * 420 + 400, i * 360 + 240, 276, j * 420 + 400, 1.4); // lights
  L(-1200, 0, 0, 1200, 0, 0, 0.3);
  // one parked car, empty
  box(160, 0, 620, 330, 70, 1020, 0.7); box(180, 70, 700, 310, 120, 920, 0.6);
  return r;
}

/** Kreuzung: road edges, zebra crossing, lamp posts, a façade. */
function crossing() {
  const { r, L, box } = room('CAM 04 · KREUZUNG ORANIENSTR.', { x: 0, y: 520, z: -300, yaw: -0.1, pitch: -0.42, fov: 60 }, 0.1);
  L(-300, 0, -200, -300, 0, 3000, 0.9); L(300, 0, -200, 300, 0, 3000, 0.9);
  L(-1400, 0, 900, -300, 0, 900, 0.9); L(300, 0, 900, 1400, 0, 900, 0.9);
  L(-1400, 0, 1500, -300, 0, 1500, 0.9); L(300, 0, 1500, 1400, 0, 1500, 0.9);
  for (let i = -5; i <= 5; i++) { const x = i * 50; L(x - 16, 0, 760, x + 16, 0, 760, 0.8); L(x + 16, 0, 760, x + 16, 0, 860, 0.8); L(x + 16, 0, 860, x - 16, 0, 860, 0.8); L(x - 16, 0, 860, x - 16, 0, 760, 0.8); }
  for (let z = 0; z < 3000; z += 160) L(0, 0, z, 0, 0, z + 80, 0.4);
  for (const [x, z] of [[-340, 400], [340, 700], [-340, 1700], [340, 2100]] as const) {
    L(x, 0, z, x, 380, z, 0.9); L(x, 380, z, x + (x < 0 ? 60 : -60), 380, z, 0.9);
    L(x + (x < 0 ? 50 : -50), 372, z, x + (x < 0 ? 70 : -70), 372, z, 1.5);
  }
  // façade on the far side
  box(-1400, 0, 1600, -320, 900, 1640, 0.4);
  for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) box(-1320 + i * 170, 120 + j * 200, 1598, -1240 + i * 170, 240 + j * 200, 1600, 0.45);
  return r;
}

export const ROOMS: Room[] = [platform(), stairs(), parking(), crossing()];
