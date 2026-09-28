# Engine guide (for scene authors)

The video is a web app (`app/`, TypeScript + three.js, run with bun + Vite) that renders any song time `t` deterministically at 1920×1080 (or at 2× that, 3840×2160, with `?scale=2`). The same code drives the live preview and the offline 60 fps export.

## Running things

- Dev server: `cd app && bunx vite --port 5173`. Preview: http://localhost:5173/?t=23.0 (space = play/pause, ←/→ = ±1 s, shift = ±5 s, `,`/`.` = ±1 frame, `[`/`]` = previous/next timeline entry).
- Stills (the main way to check your work): `cd app && bun scripts/render.ts stills --t 12.5,13.0,14.2 --only command --out ../out/wip/command`
- Contact sheet: `bun scripts/render.ts sheet --from 1.5 --to 9 --n 16 --cols 4 --only command --out ../out/wip/sheet.png`
- `--only a,b` loads only those timeline entries. 
- 4K: add `--scale 2` to any mode. Check your scene at both scales: downscaled, the 4K frame should look like the 1080p one, only sharper.

## Data

- `lyrics` (`src/engine/lyrics.ts`): `lines[]` with `text,start,end,words[]`, each word `{w,start,end}` (word-level, aligned to the vocal). Find lines by content, never hard-code times: `const l = this.ctx.lyrics.get('Ich halt den Atem an')` → `l.words[0].start`. 
- `audio` (`src/engine/audio.ts`): `beats[]`, `downbeats[]`, `sections[]`, `events('kick'|'snare'|'hat'|'vocal', t0, t1)`, `hit(kind, t, halfLife)` for decaying pulses.

## Writing a scene

One file `app/src/scenes/<name>.ts`, default-exporting a class extending `Scene` (`src/engine/scene.ts`).

Rules:
- **Deterministic**: output must be a pure function of `f.t` (and seeded randomness: `mulberry32(seed)`). Never use `Math.random()`.
- Transitions: Hard cuts on downbeats are the default. For custom transitions set `handlesTransition = true` and composite `f.under`.
- **Post Overrides (CRITICAL FOR DRAMA):** You can return: `exposure, bloom, bloomThreshold, halation, ca, grain, vignette, flash, shake:[x,y], zoom, invert`. 
  - *Note:* Use `shake` heavily on kicks in the `command` plate. Use `flash` for the 1-frame Crimson strobes.
- Performance: aim for < 25 ms/frame. Use `LineBatch` for heavy geometry.

## Palette (Procedural Gothic)

Colours are **linear**; values > ~0.85 bloom. 
- **C_VOID** `#050505`: Background, pitch black. The abyss.
- **C_ASH** `#1F1F1F`: Background UI, subtle grid lines, radar sweeps.
- **C_BONE** `#F2F0E9`: Crisp, harsh white for primary lyrics and main geometry. Must stay crisp, never blooming. Keep values under 0.8 to prevent glow.
- **C_CRIMSON** `#D91424`: Our signal color. The heartbeat, the target lock. This is allowed to exceed 1.0 to trigger intense bloom and halation.
- **C_MERCURY** `#A3A8B5`: Metallic, slightly glowing accent tone for data streams.

## Typography

- **Archivo** (Width 62–125, Weight 300–900): The primal shout. Used for "LIEB MICH". Animate width and weight for expression (condense under pressure, expand on kicks).
- **IBM Plex Mono**: The machinery of obsession. Timestamps, coordinates, tracking IDs.
- **Cormorant Garamond** (italic): The obsession. Used for the Raven verse. Crisp, elegant.
- **Single-stroke fonts** (`stroke.ts`): Used for tracing out paths and the Tether vector. `strokeText(text, font, size, tracking, kern)`.

## Shared Motifs (`app/src/scenes/_motifs.ts`)

- **The Target Lock**: `drawTargetLock(ctx, x, y, radius, thickness, clampProgress)` — A 4-bracket UI element in `C_CRIMSON`. Animate `clampProgress` (0 to 1) on the snare hits to make it violently snap shut around the text.
- **Boid Flock (The Maelstrom)**: `updateBoids(f.t, f.dt, count)` — A deterministic fluid/flocking system for `LineBatch` rendering. 
- **LIDAR Point Cloud**: `pointCloudGrid(density, noiseFreq, t)` — Topographic data for the "Hunt" sequences. 
- **Apnea EKG**: `drawEKG(ctx, t, flatlineStart, flatlineEnd)` — Returns a straight line during the designated time window, and violent chaotic noise outside of it.