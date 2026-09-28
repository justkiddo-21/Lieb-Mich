# Rendering (the GPU machine: RTX 5060 Ti)

How to set up a fresh clone, check that the GPU is really used, and render the video: quick stills, a light preview, and the full 4K master. Everything runs from `app/`.

## 1. Setup

1. **Clone** and put the song at `audio/liebmich.mp3` (it is not in the repo). Check it is the same recording: the timing data expects a 4:11 track (`ffprobe` should report a duration of about 251.05 s).
2. **Install [bun](https://bun.sh)**, then the dependencies and a headless browser:
   ```sh
   cd app
   bun install
   bunx playwright-core install chromium-headless-shell
   ```
   On Windows or macOS with Google Chrome installed you can skip the second line: macOS uses the installed Chrome, and any machine can point at a browser with `--chrome <path>` (or `$CHROME`).
3. **ffmpeg with 10-bit libx264** (for the 4K master). Check with:
   ```sh
   ffmpeg -hide_banner -h encoder=libx264 | grep yuv420p10le
   ```
   It must print a line. Where to get one:
   - **Ubuntu / Debian:** the distro `ffmpeg` has it.
   - **Fedora:** the default `ffmpeg-free` has no libx264 at all. Install RPM Fusion's `ffmpeg` instead.
   - **Windows:** use the gyan.dev "full" build.
4. **NVIDIA driver:** a current proprietary driver. On Linux, headless Chromium reaches the GPU through EGL, which the NVIDIA driver provides.
5. **Windows:** run the `.sh` scripts from Git Bash, not WSL. Headless Chromium in WSL may not get the GPU.

## 2. Check the GPU is used

```sh
bun scripts/render.ts gpu
```

It should name the card, e.g. `ANGLE (NVIDIA, NVIDIA GeForce RTX 5060 Ti …)`. If it names **SwiftShader**, **llvmpipe** or the integrated GPU, the render is running in software (very slow). To fix it, pick another ANGLE backend with the `ANGLE` environment variable and run the check again:

- **Linux:** try `ANGLE=vulkan`.
- **Windows:** the default is `d3d11`; `ANGLE=d3d11on12` or `vulkan` are the alternatives.

## 3. Quick checks (minutes)

```sh
bun scripts/render.ts stills --t 23.2,56.9,160.9 --out ../out/wip/check                    # single frames
bun scripts/render.ts sheet --cuts --out ../out/wip/cuts.png                               # a frame either side of every cut
bun scripts/render.ts perf --scale 2 --from 49 --to 52 --samples auto --shutter 0.2        # 4K speed with adaptive blur
```

Keep the renders in `out/wip/`: don't delete old ones.

`perf` gives the real speed of this machine. Multiply its average frame time by 15,063 frames (251 s × 60 fps) to estimate the full render time. The chorus (49–77 s) and the raven vortex (46–49 s, 113–117 s) are the heaviest stretches.

## 4. A light preview (480p, adaptive blur)

The engine renders at whole multiples of 1920×1080 (`--scale 1` is the smallest), so render 1080p and downscale:

```sh
bun scripts/render.ts video --fps 30 --samples auto --shutter 0.2 --crf 18 --out ../out/preview-1080p30.mp4
ffmpeg -i ../out/preview-1080p30.mp4 -vf scale=854:480:flags=lanczos -c:v libx264 -crf 20 -preset slow -c:a copy ../out/preview-480p.mp4
```

For a faster, lighter pass, add `--max-samples 108 --tol 4`: fewer sub-frames on the fastest moves, which the downscale hides anyway.

## 5. The 4K master (3840×2160, 60 fps, adaptive blur, 10-bit H.264)

```sh
app/scripts/render-4k.sh /path/to/a/big/disk/liebmich-4k
```

Run it from the repo root; the argument is the output directory (default `out/4k`).

- **What it does:**
  - renders true 4K (`--scale 2`) at 60 fps;
  - uses adaptive motion blur: 4 up to 324 sub-frames per frame, until more wouldn't change the image by more than `TOL` levels out of 255;
  - encodes each segment as 10-bit H.264 (High 10, x264 `aq-mode=3`), in 32 s segments;
  - joins them without re-encoding and adds the song as 320 kb/s AAC.
- **Output:** `liebmich-4k60-10bit.mp4` in the output directory.
- **Resumable:** if it stops, run the same command again and finished segments are skipped. A half-written segment is left as `seg_NN.mp4.part.mp4` and is rendered again.
- **Settings (environment variables):**

  | Variable | Default | Controls |
  |---|---|---|
  | `CRF` | 18 | quality: lower = bigger file |
  | `PRESET` | slow | x264 preset |
  | `TOL` | 3 | blur convergence threshold |
  | `MIN_SAMPLES` / `MAX_SAMPLES` | 4 / 324 | sub-frames per frame |
  | `SHUTTER` | 0.2 | fraction of the frame time the shutter is open |
  | `SEG` | 32 | segment length in seconds |

  `DRY_RUN=1` prints the commands without rendering.
- **Disk:** the film grain is expensive to encode at 4K. Expect somewhere around 5–15 GB at CRF 18; keep 30 GB free.
- **Playback:** 10-bit H.264 (High 10) is fine for YouTube upload, archiving and players like VLC or mpv. Browsers and most phones and TVs can't play it. For a copy that plays everywhere, make an 8-bit one from the master:
  ```sh
  ffmpeg -i liebmich-4k60-10bit.mp4 -c:v libx264 -pix_fmt yuv420p -crf 18 -preset slow -c:a copy liebmich-4k60-8bit.mp4
  ```
- **Other encoders:** `render.ts` can also encode AV1 (`--codec av1`, SVT-AV1 10-bit), for ffmpeg builds without libx264. NVENC isn't wired in.

## 6. Notes for whoever works on this next (including Claude)

- **Read first:**
  - `docs/TREATMENT_REVISED.MD` and `docs/SONG_BREAKDOWN.md`: the direction;
  - `docs/TREATMENT.md`, "This recording's structure": how the plates map onto the four-chorus recording;
  - `docs/ENGINE.md`: the scene API.

  The motif functions named in `docs/ENGINE_REVISED.MD` don't exist; the real ones are in `app/src/scenes/_motifs.ts`.
- **The edit** is `app/src/timeline.ts`:

  | Plate | Covers |
  |---|---|
  | `boot_seq` | apnea |
  | `panther` | hunt |
  | `raven` ×2 | maelstrom |
  | `chorus_slam` ×3 entries | the 4 choruses, one shot per line (in `chorus-bits.ts`) |
  | `orbit` + `telemetry` | tether |
  | `search` | the 24-bar break |
  | `climax` + `flatline` | outro |

  Every scene is stateless (a pure function of song time), which adaptive blur requires.
- **Checking work:** render stills and contact sheets and look at them. Photosensitivity: keep full-frame luminance flashes under 3 a second. The climax runs close to that, at about 2.7.
- **Serving the preview:** `Containerfile` + `deploy/` build a static nginx image (the quadlet serves it on port 21104 on the old machine).
