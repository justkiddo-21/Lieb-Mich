# Engine guide (for scene authors)

The video is a web app (`app/`, TypeScript + three.js, run with bun + Vite) that renders the "Lieb Mich" timeline deterministically at 1920×1080 (or 4K with `?scale=2`). The same code drives the live preview and the offline 60 fps export.

## Running things

- Dev server: `cd app && bunx vite --port 5173`. Preview: http://localhost:5173/?t=23.0 (space = play/pause, ←/→ = ±1 s, shift = ±5 s, `,`/`.` = ±1 frame, `[`/`]` = previous/next timeline entry).
- Stills (the main way to check your work): `cd app && bun scripts/render.ts stills --t 12.5,13.0 --only panther --out ../out/wip/panther`
- Contact sheet: `bun scripts/render.ts sheet --from 1.5 --to 9 --n 16 --cols 4 --only chorus1 --out ../out/wip/sheet.png`
- Typecheck just your files: `bunx tsc --noEmit -p tsconfig.json 2>&1 | grep scenes/yourscene`.
- 4K: add `--scale 2` to any mode. Check your scene at both scales: downscaled, the 4K frame should look like the 1080p one, only sharper.

## Data

- `lyrics` (`src/engine/lyrics.ts`): `lines[]` with `text,start,end,words[]`, each word `{w,start,end}` (word-level, aligned to the vocal). Find lines by content, never hard-code times: `const l = this.ctx.lyrics.get('Ich verzehr mich')` → `l.words[0].start`. 
- `audio` (`src/engine/audio.ts`): `beats[]`, `downbeats[]`, `sections[]`, `events('kick'|'snare'|'hat'|'vocal', t0, t1)`.

## Writing a scene

One file `app/src/scenes/<name>.ts`, default-exporting a class extending `Scene` (`src/engine/scene.ts`).

Rules:
- **Deterministic**: output must be a pure function of `f.t`. Never use `Math.random()`.
- Transitions: Hard cuts on downbeats are the default. For custom crossfades, set `handlesTransition = true` and composite `f.under`.
- Post overrides you can return: `exposure, bloom, bloomThreshold, halation, ca, grain, vignette, shake:[x,y], zoom, invert, flash, fade, frame, paper, hud` (see `app/src/engine/post.ts`).
- Performance: aim for < 25 ms/frame. Use `LineBatch` for heavy geometry.

## Palette (Procedural Gothic)

Colours are **linear**; values > ~0.85 bloom. 
- **C_VOID** `#050505`: Background, pitch black. The abyss.
- **C_ASH** `#1F1F1F`: Background UI, subtle grid lines, radar sweeps.
- **C_BONE** `#F2F0E9`: Crisp, harsh white for primary lyrics and main geometry. Must stay crisp, never blooming.
- **C_CRIMSON** `#D91424`: Our signal color. The heartbeat, the target lock, the spark. Glows aggressively.
- **C_MERCURY** `#A3A8B5`: Metallic, slightly glowing accent tone for specific "blade-like" vectors.

## Typography

- **Archivo** (grotesk with width axis 62–125 and weights 300–900): The primal shout. Used for "LIEB MICH" and heavy hits. Animate width and weight for expression (condense under pressure, expand on kicks).
- **IBM Plex Mono**: The machinery of obsession. Timestamps, coordinates, heart rates, tracking IDs. Keeps typewriter quotes.
- **Cormorant Garamond** (italic): Romantic devotion. Used for verses. Crisp, elegant, classical.
- **Single-stroke fonts** (`stroke.ts`): Used for tracing out paths, vectors, and LIDAR annotations.

## Shared Motifs (`app/src/scenes/_motifs.ts`)

- **The Target Lock**: `drawTargetLock(c, x, y, radius, t, { lock, beatPhase, label })` — A rotating, clamping geometric lock in `C_CRIMSON` (Canvas2D) that pulses on the beat; `lock` 0 = searching, 1 = clamped.
- **Boid Flock (The Raven)**: `flock(batch, t, { n, wind, avoid, trail })` — A stateless flock (every bird's position is a closed-form function of its id and `t`) streaming through one shared wind field and parting around the `avoid` rectangles, drawn as streaks into a `LineBatch`.
- **LIDAR Point Cloud**: `pointCloud(batch, { camZ, camY, camX, pitch, roll, flat, scan })` — A world-anchored grid of terrain points (`terrain(x, z, flat)`) streaming past a perspective camera, with an optional scan front; returns the camera to render the 3D `LineBatch` with. Used by `panther` and `search`.
- Also in `_motifs.ts`: `karaoke()` (per-glyph sung/unsung wipe of a lyric line), `mono()` (telemetry labels), `ashGrid()`, `clock()`, `erratic()` (the hunted path).
