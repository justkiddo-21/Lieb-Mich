"""Measure the Demucs stem offset against the gapless mp3 decode.

The sum of the four stems should reproduce the mix; the lag of the peak of
their cross-correlation is the offset to put in common.STEM_OFFSET_SAMPLES.

Run:  uv run python measure_offset.py
"""
import common
import numpy as np
import soundfile as sf
from scipy.signal import correlate

mix, sr = common.load_mix(44100)
stems = sum(sf.read(common.STEMS / f"{n}.wav", dtype="float32", always_2d=True)[0].mean(axis=1)
            for n in ("vocals", "drums", "bass", "other"))
for t0 in (30, 120, 200):  # check it is constant over the song
    a = mix[t0 * sr:(t0 + 10) * sr]
    b = stems[t0 * sr:(t0 + 10) * sr + 4000]
    c = correlate(b, a, mode="valid", method="fft")
    print(f"t={t0:3d}s  stems lag the mix by {int(np.argmax(c))} samples")
