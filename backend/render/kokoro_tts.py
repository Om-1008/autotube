"""Batch voiceover with Kokoro (open-source neural TTS, runs offline on CPU).

Usage: python3 kokoro_tts.py jobs.json
jobs.json: [{"text": "...", "out": "/path/sentence.wav", "voice"?: "hm_omega", "speed"?: 0.9, "lang"?: "hi"}, ...]
Prints "PROGRESS <done> <total>" lines. Model files are downloaded once into KOKORO_DIR.
"""
import json
import os
import sys
import urllib.request

import soundfile as sf
from kokoro_onnx import Kokoro

MODEL_DIR = os.environ.get("KOKORO_DIR") or os.path.expanduser("~/.cache/kokoro")
BASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"
# Full-precision model: ~3x faster than the int8 one on typical CPUs (no VNNI), and higher quality
FILES = {"kokoro-v1.0.onnx": BASE + "kokoro-v1.0.onnx", "voices-v1.0.bin": BASE + "voices-v1.0.bin"}


def ensure_models():
    os.makedirs(MODEL_DIR, exist_ok=True)
    for name, url in FILES.items():
        path = os.path.join(MODEL_DIR, name)
        if not os.path.exists(path) or os.path.getsize(path) < 1_000_000:
            tmp = path + ".part"
            urllib.request.urlretrieve(url, tmp)
            os.replace(tmp, path)


def main():
    jobs = json.load(open(sys.argv[1], encoding="utf-8"))
    ensure_models()
    k = Kokoro(os.path.join(MODEL_DIR, "kokoro-v1.0.onnx"), os.path.join(MODEL_DIR, "voices-v1.0.bin"))
    voice = os.environ.get("KOKORO_VOICE") or "am_michael"
    speed = float(os.environ.get("KOKORO_SPEED") or "1.0")
    lang = os.environ.get("KOKORO_LANG") or "en-us"
    for i, job in enumerate(jobs):
        # per-line overrides (used by the multi-voice story renderer)
        samples, sr = k.create(job["text"], voice=job.get("voice") or voice, speed=float(job.get("speed") or speed), lang=job.get("lang") or lang)
        sf.write(job["out"], samples, sr)
        print(f"PROGRESS {i + 1} {len(jobs)}", flush=True)


if __name__ == "__main__":
    main()
