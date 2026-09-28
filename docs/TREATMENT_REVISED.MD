# Lieb Mich — Treatment & Style Bible

## The Idea in One Paragraph

The video is an **inescapable, lethal targeting sequence** masquerading as a music video. It strips away all traditional gothic tropes (no vampires, no rain, no graveyards) and replaces them with the terrifying, cold precision of procedural mathematics and surveillance tech. The singer’s obsession is manifested as an autonomous tracking system hunting a target in the dark. It is suffocating, aggressive, and visually violent. The engine shifts between absolute, breath-holding stillness (a razor-thin flatline) and blinding, screen-shaking typographic slams. The aesthetic is "Procedural Gothic": pitch-black voids, harsh bone-white vectors, and a singular, blinding **Crimson** signal color that bleeds out on the heavy downbeats. The video does not illustrate the lyrics; it weaponizes them as system commands, target locks, and error logs.

## Tone

- **Lethal Precision:** No floaty, generic screensaver motion. Everything moves with violent intent. Springs, hard snaps, and instantaneous whip-pans. When the camera moves, it feels like it is being dragged by a force it cannot control.
- **Suffocating Contrast:** Long periods of near-total darkness and tiny, clinical UI elements, instantly shattered by full-screen, heavy-weight typography and blinding crimson bloom. 
- **Typographic Violence:** The words are not subtitles; they are physical objects slamming into the viewer. They stretch, compress, and break the safe-area boundaries when the music peaks.
- **Obsessive:** The camera is always pushing *in*, never pulling out. We are relentlessly closing the distance to the target.

## Palette (Procedural Gothic)

- **Void** `#050505`: The abyss. 90% of the video is this color.
- **Ash** `#1F1F1F`: Background UI, subtle tracking grids, radar sweeps.
- **Bone** `#F2F0E9`: Crisp, harsh white. Used for the primary lyrics, EKG lines, and the target. Must stay crisp, never blooming.
- **Crimson** `#D91424`: The heartbeat, the lock-on, the spark of obsession. This is the *only* color allowed to bloom. On heavy hits, it flashes so bright it burns the retina.
- **Mercury** `#A3A8B5`: A cold, metallic silver for secondary data streams and timestamps.

## Typography

- **Archivo** (Width 62–125, Weight 300–900): The primal command. Used for the choruses ("LIEB MICH"). It scales up to 900 weight, dominating the frame.
- **IBM Plex Mono**: The clinical machinery. Used for coordinates, targeting IDs, distance calculations, and the stalking verses. 
- **Cormorant Garamond** (Italic): The obsessive whisper. Used for moments of twisted devotion ("Sanft singt der Rabe..."). Elegant, sharp, like a scalpel.
- **Single-Stroke** (`stroke.ts`): For the chaotic plotter lines frantically trying to draw the target's trajectory.

## Motifs

1. **The Flatline (Apnea):** A single, razor-thin horizontal line that stops moving when the singer says "Ich halt den Atem an" (I hold my breath), building unbearable tension before snapping into a violent waveform.
2. **The Target Lock:** A rotating, clamping geometric reticle. It starts wide and violently snaps tighter on every snare drum, boxing the lyrics in.
3. **The Maelstrom (Raven):** Thousands of vector lines (boids) swarming like a black hole, representing the "Raven in the wind." It pulls the camera into its center.
4. **The Tether:** A blinding crimson point of light moving erratically, dragging a bone-white path behind it that writes the lyrics as it desperately tries to keep up.

---

## Plates (Scene Modules)

| id | window | lyric | visual concept |
|---|---|---|---|
| `apnea` | Verses 1 & 3 | "Ich halt den Atem an..." | The Flatline. Absolute stillness shattered by EKG spikes. |
| `hunt` | Verses 1 & 3 | "Wart schon so lange hier..." | LIDAR point-cloud surveillance, tracking a phantom signature. |
| `maelstrom` | Pre-Chorus | "Sanft singt der Rabe im Wind" | A gravitational vortex of vector lines swallowing the camera. |
| `command` | Chorus | "Lieb mich..." | Typographic violence. Screen slams, clamping target locks. |
| `tether` | Bridge | "Ich folg auf Schritt und Tritt..." | A chaotic orbit of strange attractors dragging a red line. |

### `apnea` — "Hold Your Breath"
Total blackout. A single, horizontal 1px **Bone** line cuts across the screen (an oscilloscope). The lyrics type out in Plex Mono underneath it. 
On "Ich halt den Atem an" (I hold my breath), the music drops, and the line **freezes completely**. Absolute silence and stillness for a split second. On "schön, wunderschön", the line violently spikes into a jagged, chaotic waveform that vibrates with a **Crimson** halation. The camera shakes slightly, unable to handle the frequency.

### `hunt` — "The Panther"
"Wie ein Panther auf der Fährte..." (Like a panther on the track...). The screen transitions into a 3D LIDAR topographic scan (`LineBatch`). We are looking through a drone's targeting camera. A grid of Ash lines maps a dark terrain. A **Crimson** thermal signature blurs in the distance. The camera aggressively punches in (hard cuts on the kicks) to try and close the distance, but the signature keeps glitching out of frame. The lyrics are rendered as military UI tags attached to the moving target.

### `maelstrom` — "The Raven"
"Sanft singt der Rabe im Wind" (Softly sings the raven...). The rigid grid of the `hunt` plate dissolves. The lines break free and become a fluid simulation (Boids). Tens of thousands of hairline vectors swirl in a massive, chaotic vortex filling the screen. The lyric is set dead-center in **Cormorant Garamond italic**, perfectly still and pristine while the storm rages behind it. The camera is sucked into the center of the vortex, plunging into pitch black right as the chorus hits.

### `command` — "LOVE ME"
The Chorus. This must feel physically aggressive.
"Lieb mich..." (Love me). Every time the phrase is sung, it slams onto the screen in **Archivo weight 900**. The text fills 90% of the frame. 
- The background flashes **Crimson** for exactly one frame on the downbeat, searing the eyes. 
- A geometric **Target Lock** (four brackets) slams inward from the corners of the screen, attempting to crush the words. 
- On "wie du willst" (as you want), the text stretches vertically (width 62) as if being pulled apart by gravity. 
- The engine's post-processing `shake:[x,y]` is cranked up. The plate should feel like it is tearing the video codec apart. 

### `tether` — "Every Step"
The Bridge. "Ich folg auf Schritt und Tritt" (I follow every step). A top-down view of a pitch-black void. A single **Crimson** spark moves chaotically, representing the target. The camera is tethered to it, whip-panning violently to keep it in the center. The spark leaves a trail of **Bone** white that cursive-writes the lyrics (`stroke.ts`). The path loops, intersects, and knots itself into a dense, obsessive web of lines. 
On "Keine Ahnung wo du hinwillst" (No idea where you're going), the tether breaks. The camera spins out of control, tumbling through the void, catching glimpses of the crimson spark in the distance before slamming headfirst back into the `command` plate for the final chorus.

### `outro` — "End of Trace"
The final heavy hits of the song. The word "LIEB" flashes full screen, alternating with "MICH". 
On the final echoing chord, all geometry collapses into a single dot in the center of the screen. 
The dot shrinks.
Total black.
A single caret blinks in Plex Mono: `TARGET LOST. END OF TRACE.`
Cut to black.