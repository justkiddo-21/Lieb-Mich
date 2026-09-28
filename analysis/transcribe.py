"""Transcribe the vocal stem (German) with word timestamps -> work/whisper.json

A reference for what is actually sung and where: used to check the lyric sheet
against this recording and to seed per-line windows for align.py.

Run:  uv run python transcribe.py [model]   (default large-v3-turbo, CPU int8)
"""
import common
import json
import sys

import numpy as np
from faster_whisper import WhisperModel


def main(name="large-v3-turbo"):
    y, _ = common.load_vocal_source("vocals", sr=16000)
    model = WhisperModel(name, device="cpu", compute_type="int8",
                         download_root=str(common.CACHE / "whisper"))
    segs, _ = model.transcribe(y.astype(np.float32), language="de", word_timestamps=True,
                               vad_filter=False, condition_on_previous_text=False,
                               beam_size=5)
    out = []
    for s in segs:
        words = [dict(w=w.word.strip(), start=round(w.start, 2), end=round(w.end, 2),
                      p=round(w.probability, 2)) for w in (s.words or [])]
        out.append(dict(start=round(s.start, 2), end=round(s.end, 2), text=s.text.strip(), words=words))
        print(f"{s.start:7.2f} {s.end:7.2f}  {s.text.strip()}", flush=True)
    (common.WORK / "whisper.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
    print("wrote", common.WORK / "whisper.json")


if __name__ == "__main__":
    main(*sys.argv[1:])
