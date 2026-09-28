# "Lieb Mich" — Procedural Gothic Treatment

## The idea in one paragraph
The video is a visual representation of **romantic obsession as a relentless targeting system**. We are stripping away all traditional gothic tropes (no castles, no rain, no literal panthers or ravens). Instead, the themes of the song—stalking, yearning, and demanding love—are rendered through LIDAR topographies, fluid dynamics (wind/flocks), magnetic attractors, and aggressive, beat-synced typography. The video has two primary states: the precise, cold calculation of the "hunt" (verses), and the overwhelming, system-breaking typographic violence of the demand (choruses). The entire piece is tied together by a single UI element: a crimson targeting reticle that is constantly trying to lock onto an erratic, bone-white path.

## Tone
- **Relentless:** The camera is almost always pushing forward or tracking a moving target. It never rests.
- **Violent Math:** Changes in direction, cuts, and typographic scaling happen precisely on kick drums and snare snaps. 
- **Clinical Obsession:** The humor/irony comes from treating deeply emotional, desperate lyrics as sterile telemetry data (e.g., labeling "Schritt und Tritt" as exact GPS coordinates).

## Plates (scene modules)

| id | window | lyric | visual core |
|---|---|---|---|
| `boot_seq` | 0.0 → "oder gehen" | Ich halt den Atem an... | System boot, target acquisition. |
| `panther` | "Ich verzehr mich" → "Seite liegen" | Ich verzehr mich... / Wie ein Panther... | LIDAR topography, hunting vector. |
| `raven` | pre-choruses | Sanft singt der Rabe im Wind | Fluid dynamics, boids, wind. |
| `chorus_slam`| all choruses | Lieb mich wie ich bin... | Maximum typographic violence. |
| `orbit` | "Ich halt den Atem an" (V2) | Ich halt den Atem an... / Du bist schön... | Strange attractors, inescapable gravity. |
| `telemetry` | "Ja doch ich folg Dir" | Ja doch ich folg Dir... / Schritt und Tritt... | Footstep data, whip-pans, route mapping. |
| `climax` | final chorus tail | Nur so macht Liebe sinn | System failure, title-safe breaks. |
| `flatline` | Outro | (instrumental) | Heart rate monitor, void. |

### `boot_seq` — "System Initialization"
Pitch black (`C_VOID`). On the first synth notes, a subtle `C_ASH` grid powers on. "Ich halt den Atem an": Set in Cormorant Italic, fading in smoothly. An oscilloscope line representing a held breath flatlines perfectly across the screen. "Sie ist schön wunderschön": A glowing `C_CRIMSON` target reticle appears, searching erratically. "Wird sie bleiben oder gehen": The reticle locks onto a waveform that branches into two probabilistic paths (STAY 0.82 / LEAVE 0.18) written in IBM Plex Mono.

### `panther` — "The Hunt"
"Ich verzehr mich": The camera plunges into a 3D landscape made entirely of `LineBatch` LIDAR point clouds (bone white points on void). "Wart schon so lange hier": A countdown timer in the corner ticks up endlessly. "Wie ein Panther auf der Fährte seines Beutetieres": The camera adopts a low, aggressive tracking angle, speeding through the topography. A crimson vector line draws the "Fährte" (trail) ahead of us. The word BEUTETIERES (prey) is locked onto with a box. "Und noch in dieser Nacht / An ihrer Seite liegen": The topography smooths out into a flat plane, the crimson reticle merging perfectly with a white dot in the center of the screen.

### `raven` — "Fluid Dynamics"
"Sanft singt der Rabe im Wind": The rigid grid completely dissolves. Thousands of thin `LineBatch` segments (boids) swarm the screen, moving via fluid noise algorithms to simulate wind. They flow gracefully, parting around the lyrics (Cormorant Italic, bone white) which stand perfectly still in the center of the turbulence.

### `chorus_slam` — "The Demand"
"Lieb mich wie ich bin / Lieb mich wie ich wär...": **Maximum typographic violence.** The screen goes stark bone-white (`C_BONE`) with ink-black lyrics, instantly inverting to void-black with bone lyrics on the snare hits. The words "LIEB MICH" (Archivo 900, fully expanded) slam into the frame, filling the title-safe area entirely. Every kick drum expands the tracking; every snare snap condenses it. 
"Lieb mich weil du kannst / Lieb mich weil du musst": Words begin to overlap and stack violently. A `C_CRIMSON` box highlights "kannst" and "musst" with aggressive camera shakes (`shake:[x,y]`). 

### `orbit` — "Inescapable Gravity"
"Ich halt den Atem an / Du bist schön so wunderschön": A beautifully complex, mathematical "Strange Attractor" (Lorenz system) begins to draw itself in the center of the screen in silver/mercury. The crimson spark is trapped orbiting it. "Du bezahlst und willst schon gehen": The orbit decays, spinning wildly out of control, pulling the camera into a dizzying spiral. 

### `telemetry` — "Stalking Data"
"Ja doch ich folg Dir / Ich folg auf Schritt und Tritt": A top-down 2D map view. A bone-white path is drawn erratically, simulating someone walking randomly. The crimson reticle follows *exactly* one beat behind. "Keine Ahnung wo du hinwillst / Doch da komm ich mit": IBM Plex Mono data fills the margins (LAT/LON, VELOCITY, PREDICTED HEADING). The camera whip-pans aggressively to keep the reticle dead center as the path takes sharp, unpredictable turns.

### `raven` — (Repeat Pre-Chorus)
The telemetry lines suddenly lose their rigid angles and melt back into the beautiful, chaotic flocking boids. The wind is faster and more turbulent this time.

### `chorus_slam` — (Second Chorus & Climax)
"Lieb mich wenn ich wein / Lieb mich wenn ich lach...": Returns to the typographic violence, but scaled up. The UI begins to break. The safe-area guides (TITLE SAFE 90%) appear in crimson, and as the singer screams "Lieb mich einfach so", the typography literally breaks the lines, pushing out of the frame. 
"Nur so macht Liebe sinn": The Archivo font cycles through weights (300 to 900) rapidly, strobing in crimson and bone, before collapsing into a single point.

### `flatline` — "Target Lost"
The heart-rate monitor: the crimson point the climax collapses into becomes the write head of an ECG trace, one beat per remaining kick, the rate falling; then the line goes flat, SIGNAL LOST, fade to the void.

## This recording's structure (added while building)

The plate table above was written for a two-chorus song. The recording (4:11, 135 BPM) has four choruses and a 24-bar instrumental break, so the edit (`app/src/timeline.ts`) maps the plates like this:

| window | section | plate |
|---|---|---|
| 0 → "Ich verzehr mich" | intro + verse 1 opening | `boot_seq` |
| → pre-chorus 1 | verse 1 | `panther` |
| pre-chorus 1 | "Sanft singt der Rabe im Wind" | `raven` (wind 1) |
| chorus 1 | | `chorus_slam` level 1 |
| interlude + verse 2 opening | the attractor draws itself in the interlude | `orbit` |
| "Ja doch ich folg Dir" → pre-chorus 2 | | `telemetry` |
| pre-chorus 2 | | `raven` (wind 1.8) |
| chorus 2 | | `chorus_slam` level 2 |
| break (24 bars) | bass out, then the full band with a synth lead | `search` |
| choruses 3 + 4 | chorus 3 opens with the bass out | `chorus_slam` level 3 → 4 |
| last "Nur so macht Liebe sinn" | | `climax` |
| outro | | `flatline` |

### `search` — "Target Lost" (the break)
While the bass is out: a radar sweep over the void, blips that are never her (NEG 0.12), the reticle wandering, TARGET LOST blinking. When the band comes back: the hunt resumes over the LIDAR land, faster, crimson scan fronts once a bar; on the last bar the target is reacquired and locked, into chorus 3.

### `chorus_slam` levels 3 and 4
Chorus 3 opens stripped (drums and voice): thin Archivo 300 in bone on the void, no inversions, LOW SIGNAL. When the bass returns the slam comes back and the type overflows the title-safe area out of the frame; in chorus 4 the glyphs scatter on the kicks and the background strobes crimson on alternate snares (under 3 flashes a second).
