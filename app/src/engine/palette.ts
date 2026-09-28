import { hexToLinear } from './util';

// Procedural Gothic: void, ash, bone, one signal colour (crimson) and a metallic accent
// (mercury) — see docs/ENGINE.md. The older engine names (ink, signal, blood, …) are kept
// as aliases so the engine's own overlays and GLSL constants keep working.
export const HEX = {
  void: '#050505', // background, pitch black: the abyss
  ash: '#1F1F1F', // background UI, subtle grid lines, radar sweeps
  bone: '#F2F0E9', // crisp white: primary lyrics and main geometry (keep below bloom)
  crimson: '#D91424', // the signal: heartbeat, target lock, the spark (glows)
  mercury: '#A3A8B5', // metallic accent for blade-like vectors
  // aliases / supporting tones
  ink: '#050505', // = void
  ink2: '#101011', // raised black (panels)
  graphite: '#5E5B57', // dim lines, secondary text
  signal: '#D91424', // = crimson
  ember: '#FF5A4E', // hot crimson core / highlights
  blood: '#6E0A12', // deep crimson for shadows of the signal
  acid: '#D8FF3C', // unused (kept for the GLSL constant set)
} as const;

export type PaletteKey = keyof typeof HEX;

/** Linear RGB triplets for GL uniforms. */
export const LIN: Record<PaletteKey, [number, number, number]> = Object.fromEntries(
  Object.entries(HEX).map(([k, v]) => [k, hexToLinear(v)]),
) as Record<PaletteKey, [number, number, number]>;

/** CSS rgba() for Canvas2D. */
export function rgba(key: PaletteKey | string, a = 1): string {
  const hex = (HEX as Record<string, string>)[key] ?? key;
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
