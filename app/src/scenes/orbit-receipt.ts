// The thermal-printer receipt for "Du bezahlst": printed line by line out of a slot in 3D
// (the paper steps up as each line prints), stamped BEZAHLT in crimson, then torn off.
import * as THREE from 'three';
import { W, H, SCALE } from '../engine/gl';
import { LIN } from '../engine/palette';
import { F, font } from '../engine/type';
import { LineBatch } from '../engine/lines';

export interface RLine { l: string; r?: string; big?: boolean; bold?: boolean; rule?: boolean }

export const RECEIPT: RLine[] = [
  { l: 'CAFÉ ORBIT', big: true },
  { l: 'KASSE 03', r: 'TISCH 7' },
  { rule: true, l: '' },
  { l: '1× ESPRESSO', r: '2,40' },
  { l: '1× WASSER, STILL', r: '0,00' },
  { rule: true, l: '' },
  { l: 'SUMME EUR', r: '2,40', bold: true },
  { l: 'BEZAHLT  KARTE', r: '****7731' },
  { l: '' },
  { l: '' },
  { rule: true, l: '' },
  { l: 'BLICKE ERWIDERT', r: '0' },
  { l: 'ATEM ANGEHALTEN', r: '2×' },
  { rule: true, l: '' },
  { l: 'DANKE · AUF WIEDERSEHEN' },
];

const CW = 600; // canvas logical px
const PAD = 34, PITCH = 40, TOP = 40;
const CH = TOP + RECEIPT.length * PITCH + 30;
/** Baseline y (canvas px, from top) of receipt line i, and the paper cut after it. */
export const lineBottom = (i: number) => (i + 1) * PITCH + TOP + 10;

const VERT = /* glsl */ `precision highp float;
in vec3 position; in vec2 uv; uniform mat4 projectionMatrix; uniform mat4 modelViewMatrix;
out vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FRAG = /* glsl */ `precision highp float;
in vec2 vUv; out vec4 fragColor;
uniform sampler2D map; uniform sampler2D stampMap;
uniform float cut;      // printed fraction from the top (0..1)
uniform float stamp;    // stamp opacity
uniform float opacity;
uniform vec3 paper, ink, red;
void main() {
  float fromTop = 1.0 - vUv.y;
  if (fromTop > cut) discard;
  float inkA = texture(map, vUv).r;
  float st = texture(stampMap, vUv).r * stamp;
  // fresh thermal print is darkest right at the slot edge (a hairline of heat)
  float edge = smoothstep(0.012, 0.0, cut - fromTop);
  vec3 c = mix(paper, ink, inkA);
  c = mix(c, red, st * 0.92);
  c = mix(c, paper * 0.55, edge * 0.6);
  fragColor = vec4(c, 1.0) * opacity;
}`;

function drawBase() {
  const s = SCALE * 2;
  const cv = document.createElement('canvas');
  cv.width = CW * s; cv.height = CH * s;
  const c = cv.getContext('2d')!;
  c.scale(s, s);
  c.fillStyle = '#000'; c.fillRect(0, 0, CW, CH);
  c.fillStyle = '#fff';
  c.strokeStyle = '#fff';
  c.textBaseline = 'alphabetic';
  RECEIPT.forEach((ln, i) => {
    const y = TOP + (i + 1) * PITCH - 8;
    if (!ln.l && !ln.rule) return;
    if (ln.rule) {
      c.setLineDash([6, 6]); c.lineWidth = 2;
      c.beginPath(); c.moveTo(PAD, y - 12); c.lineTo(CW - PAD, y - 12); c.stroke();
      c.setLineDash([]);
      return;
    }
    const size = ln.big ? 38 : 24;
    c.font = font(F.mono(ln.big || ln.bold ? 700 : 500), size);
    c.letterSpacing = ln.big ? '8px' : '1px';
    if (ln.big || !ln.r && i === RECEIPT.length - 1) {
      c.textAlign = 'center';
      c.fillText(ln.l, CW / 2, y);
    } else {
      c.textAlign = 'left'; c.fillText(ln.l, PAD, y);
      if (ln.r) { c.textAlign = 'right'; c.fillText(ln.r, CW - PAD, y); }
    }
  });
  return cv;
}

function drawStamp() {
  const s = SCALE * 2;
  const cv = document.createElement('canvas');
  cv.width = CW * s; cv.height = CH * s;
  const c = cv.getContext('2d')!;
  c.scale(s, s);
  c.fillStyle = '#000'; c.fillRect(0, 0, CW, CH);
  c.translate(CW * 0.5, lineBottom(9) - 30);
  c.rotate(-0.16);
  c.strokeStyle = '#fff'; c.fillStyle = '#fff';
  c.lineWidth = 5;
  c.strokeRect(-150, -46, 300, 92);
  c.lineWidth = 2;
  c.strokeRect(-140, -36, 280, 72);
  c.font = font(F.archivo(125, 900), 50);
  c.letterSpacing = '6px';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText('BEZAHLT', 0, 3);
  return cv;
}

const tex = (cv: HTMLCanvasElement) => {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.NoColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = 8;
  return t;
};

export class Receipt {
  scene = new THREE.Scene();
  cam = new THREE.PerspectiveCamera(38, W / H, 0.1, 100);
  mesh: THREE.Mesh;
  mat: THREE.RawShaderMaterial;
  slot = new LineBatch(64, { screen2D: false, blend: 'add' });
  /** World size of the paper. */
  pw = 3.0;
  ph = 3.0 * (CH / CW);
  constructor() {
    this.mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: FRAG,
      uniforms: {
        map: { value: tex(drawBase()) }, stampMap: { value: tex(drawStamp()) }, cut: { value: 0 }, stamp: { value: 0 }, opacity: { value: 1 },
        paper: { value: new THREE.Vector3(...LIN.bone).multiplyScalar(0.6) }, ink: { value: new THREE.Vector3(...LIN.void) },
        red: { value: new THREE.Vector3(...LIN.crimson).multiplyScalar(1.5) },
      },
      transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    const g = new THREE.PlaneGeometry(this.pw, this.ph);
    g.translate(0, -this.ph / 2, 0); // origin at the top edge
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  /**
   * `printed`: lines printed (fractional while a line steps out). `stamp` 0..1. `tear` 0..1 the
   * paper ripped off and flying. `pose`: slot position/rotation in the receipt camera's space.
   */
  render(r: THREE.WebGLRenderer, out: THREE.WebGLRenderTarget, o: { printed: number; stamp: number; tear: number; opacity: number; slot: [number, number, number]; rot: [number, number, number]; camJitter?: [number, number] }) {
    const n = RECEIPT.length;
    // paper length out of the slot: steps a line at a time (B[k] = bottom of the first k lines)
    const B = (k: number) => (k <= 0 ? 0 : k >= n ? CH : lineBottom(k - 1));
    const k = Math.floor(Math.max(0, o.printed));
    const printedPx = o.printed >= n ? CH : B(k) + (B(k + 1) - B(k)) * (o.printed - k);
    const cut = Math.min(1, Math.max(0, printedPx / CH));
    const u = this.mat.uniforms;
    u.cut!.value = cut; u.stamp!.value = o.stamp; u.opacity!.value = o.opacity;
    const [sx, sy, sz] = o.slot;
    const m = this.mesh;
    m.rotation.set(o.rot[0], o.rot[1], o.rot[2], 'YXZ');
    // the printed length stands up out of the slot; the tear flings it up and away, tumbling
    const up = new THREE.Vector3(0, 1, 0).applyEuler(m.rotation);
    const len = cut * this.ph;
    const tr = o.tear;
    m.position.set(sx + up.x * len + tr * tr * 2.5 - tr * 0.6, sy + up.y * len + tr * 5.5 + tr * tr * 6, sz + up.z * len - tr * 2);
    if (tr > 0) m.rotation.set(o.rot[0] - tr * 1.1, o.rot[1] + tr * 0.9, o.rot[2] + tr * tr * 2.2, 'YXZ');
    const cj = o.camJitter ?? [0, 0];
    this.cam.position.set(cj[0], cj[1], 0);
    this.cam.lookAt(cj[0] * 0.5, cj[1] * 0.5, -10);
    this.cam.updateMatrixWorld(true);
    // the printer's slot: a mercury lip with a dark mouth
    const b = this.slot;
    b.clear();
    const rx = new THREE.Vector3(1, 0, 0).applyEuler(new THREE.Euler(o.rot[0], o.rot[1], o.rot[2], 'YXZ'));
    const hw = this.pw * 0.62;
    const merc = LIN.mercury;
    b.seg(sx - rx.x * hw, sy - rx.y * hw, sz - rx.z * hw, sx + rx.x * hw, sy + rx.y * hw, sz + rx.z * hw, 2.2, merc[0] * 0.9, merc[1] * 0.9, merc[2] * 0.9, o.opacity);
    b.seg(sx - rx.x * hw, sy - rx.y * hw - 0.06, sz - rx.z * hw, sx + rx.x * hw, sy + rx.y * hw - 0.06, sz + rx.z * hw, 1, merc[0] * 0.4, merc[1] * 0.4, merc[2] * 0.4, o.opacity);
    b.render(r, out, this.cam);
    r.setRenderTarget(out);
    r.render(this.scene, this.cam);
  }
}
