"""Word-level lyric alignment -> data/lyrics.json

  1. CTC emissions of the Demucs vocal stem from the multilingual MMS forced-
     alignment model (torchaudio MMS_FA), computed in overlapping chunks.
  2. Each block of continuous singing (lines less than BLOCK_GAP apart in the
     approximate times of lyrics/lyrics.src.js, which come from the Whisper
     transcript via sheet.py) is force-aligned in one pass inside a window
     around its approximate time, with a <star> wildcard before, between and
     after the lines that absorbs backing vocals and ad-libs. In order, so the
     repeated "Lieb mich" lines cannot swap or overlap.
  3. Word ends are extended while the vocal keeps sounding (CTC spans are
     peaky: a held "an" would otherwise end after its first 40 ms), up to the
     next word.

MMS was trained on romanized text, so words are romanized the way uroman does
it for German (ä -> a, ö -> o, ü -> u, ß -> ss). The display token keeps the
original spelling.

Where a line has a disputed reading (the supplied sheet had "Lieb nicht" where the
recording sings "Lieb mich"), both readings are aligned and the one with the better
CTC score is reported; the sheet's word is kept either way (see VARIANTS).

Run:  uv run python align.py
"""
import common
import json
import re
import unicodedata

import numpy as np
import torch
import torchaudio
import torchaudio.functional as AF

SR = 16000
FRAME = 320 / SR          # MMS_FA emits one frame per 20 ms
CHUNK = 30.0              # seconds of audio per emission chunk
CONTEXT = 2.0             # extra seconds either side, discarded
MAX_HOLD = 2.5            # longest a word end may be extended (s)
HOLD_DROP_DB = 16         # a held word ends when the vocal falls this far below its peak
PAD = 1.0                 # window margin around a block's approximate time (s)
BLOCK_GAP = 3.0           # a gap this long between lines starts a new alignment block
VARIANTS = {  # sheet reading -> alternative to test
    "Lieb mich wie ich wär": "Lieb nicht wie ich wär",
    "Lieb mich weil du musst": "Lieb nicht weil du musst",
}

GERMAN = str.maketrans({"ä": "a", "ö": "o", "ü": "u", "ß": "ss"})


def romanize(word):
    w = word.lower().translate(GERMAN)
    w = unicodedata.normalize("NFKD", w)
    return re.sub(r"[^a-z']", "", w)


def emissions(model, y):
    """Log-probs [T, C] for the whole song, from chunks with discarded context."""
    hop = int(CHUNK * SR) // 320 * 320
    ctx = int(CONTEXT * SR) // 320 * 320
    n_frames = len(y) // 320
    out = []
    for a in range(0, len(y), hop):
        lo = max(0, a - ctx)
        x = torch.from_numpy(y[lo:a + hop + ctx]).unsqueeze(0)
        with torch.inference_mode():
            e, _ = model(x)
        e = e[0]
        skip = (a - lo) // 320
        out.append(e[skip:skip + hop // 320])
    e = torch.cat(out)[:n_frames]
    if len(e) < n_frames:
        e = torch.cat([e, e[-1:].expand(n_frames - len(e), -1)])
    return e


def vocal_db(y):
    """Vocal level in dB at the emission frame rate."""
    n = len(y) // 320
    fr = y[: n * 320].reshape(n, 320)
    return 10 * np.log10((fr.astype(np.float64) ** 2).mean(axis=1) + 1e-10)


def main():
    src = common.load_lyrics_src()
    y, _ = common.load_vocal_source("vocals", sr=SR)
    y = y.astype(np.float32)

    bundle = torchaudio.pipelines.MMS_FA
    model = bundle.get_model(with_star=True)
    model.eval()
    vocab = bundle.get_dict(star="*")

    cache = common.WORK / "emission_mms.npy"
    if cache.exists():
        em = torch.from_numpy(np.load(cache))
    else:
        print(f"emissions for {len(y) / SR:.1f} s of vocals ...")
        em = emissions(model, y)
        np.save(cache, em.numpy())

    def align(items, s, e):
        """Align lines [(li, text), ...] in order inside [s - PAD, e + PAD], with a
        <star> before, between and after them. Returns ({(li, wi): (f0, f1, scores)},
        log-likelihood)."""
        f0 = max(0, int((s - PAD) / FRAME))
        f1 = min(len(em), int((e + PAD) / FRAME))
        tok, own = [], []
        for li, text in items:
            tok.append(vocab["*"]); own.append(None)
            for wi, w in enumerate(text.split()):
                r = romanize(w)
                assert r, f"word with no alignable letters: {w!r}"
                tok += [vocab[ch] for ch in r]
                own += [(li, wi)] * len(r)
        tok.append(vocab["*"]); own.append(None)
        path, sc = AF.forced_align(em[f0:f1].unsqueeze(0), torch.tensor([tok], dtype=torch.int32), blank=0)
        spans = AF.merge_tokens(path[0], sc[0].exp())
        assert len(spans) == len(tok), (items[0], len(spans), len(tok))
        ws = {}
        for sp, o in zip(spans, own):
            if o is None:
                continue
            a, b, c = ws.get(o, (sp.start + f0, sp.end + f0, []))
            ws[o] = (min(a, sp.start + f0), max(b, sp.end + f0), c + [sp.score])
        return ws, float(sc[0].sum())

    # blocks of continuous singing (split at gaps > BLOCK_GAP in the approximate times)
    lines = [dict(text=text, approx=(s, e), words=text.split()) for s, e, text in src]
    blocks = [[0]]
    for li in range(1, len(src)):
        (blocks.append([li]) if src[li][0] - src[li - 1][1] > BLOCK_GAP else blocks[-1].append(li))
    wspan = {}
    for b in blocks:
        ws, _ = align([(li, src[li][2]) for li in b], src[b[0]][0], src[b[-1]][1])
        wspan.update(ws)
        print(f"block {src[b[0]][0]:6.1f}-{src[b[-1]][1]:6.1f}: {len(b)} lines")

    # sheet reading vs alternative, scored on the same window (the line's aligned span)
    variant = []
    for li, (s, e, text) in enumerate(src):
        for a, b in VARIANTS.items():
            if a in text:
                t0 = wspan[(li, 0)][0] * FRAME + PAD - 0.3
                t1 = wspan[(li, len(text.split()) - 1)][1] * FRAME - PAD + 0.3
                _, ll = align([(li, text)], t0, t1)
                _, ll2 = align([(li, text.replace(a, b))], t0, t1)
                variant.append((li, text, a, b, ll, ll2))

    db = vocal_db(y)
    order = sorted(wspan)
    starts = {o: wspan[o][0] for o in order}
    out_lines = []
    for li, L in enumerate(lines):
        words = []
        for wi, w in enumerate(L["words"]):
            a, b, conf = wspan[(li, wi)]
            k = order.index((li, wi))
            nxt = starts[order[k + 1]] if k + 1 < len(order) else len(db)
            # extend the end while the vocal holds, up to the next word
            peak = db[a:b + 1].max()
            lim = min(nxt, b + int(MAX_HOLD / FRAME))
            e = b
            while e + 1 < lim and db[e + 1] > peak - HOLD_DROP_DB:
                e += 1
            words.append(dict(w=w, start=round(a * FRAME, 3), end=round((e + 1) * FRAME, 3),
                              conf=round(float(np.mean(conf)), 2)))
        out_lines.append(dict(i=li, text=L["text"], start=words[0]["start"], end=words[-1]["end"], words=words))

    doc = dict(
        lines=out_lines,
        notes=("Word timings from CTC forced alignment (torchaudio MMS_FA, multilingual, "
               "romanized German) against the Demucs vocal stem, one pass per block of "
               f"continuous singing in a window of +/-{PAD} s around its Whisper-derived "
               "time, with <star> wildcards between lines. Word ends are extended "
               f"while the vocal stays within {HOLD_DROP_DB} dB of the word's peak "
               f"(at most {MAX_HOLD} s, never past the next word). conf = mean per-frame "
               "probability of the word's characters."),
    )
    (common.DATA / "lyrics.json").write_text(json.dumps(doc, ensure_ascii=False, indent=1))

    for li, text, a, b, ll, ll2 in variant:
        print(f"{src[li][0]:7.2f}  {text:<24} '{a}' {ll:8.1f}  '{b}' {ll2:8.1f}  -> {a if ll >= ll2 else b}")
    print(f"\n{'line':<52} {'approx':>7} {'aligned':>8} {'moved':>6} {'conf':>5}")
    for L, o in zip(lines, out_lines):
        mv = o["start"] - L["approx"][0]
        conf = np.mean([w["conf"] for w in o["words"]])
        flag = "  <-- check" if abs(mv) > 0.6 or conf < 0.35 else ""
        print(f"{L['text'][:52]:<52} {L['approx'][0]:7.2f} {o['start']:8.2f} {mv:+6.2f} {conf:5.2f}{flag}")
    print("wrote", common.DATA / "lyrics.json")


if __name__ == "__main__":
    main()
