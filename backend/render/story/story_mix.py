"""Mix a kids' story soundtrack: voice lines + procedural music + sound effects.

Usage: python3 story_mix.py plan.json out_dir
plan.json: {"total": s, "lines": [{"file", "start", "who"}], "sfx": [{"type", "at"}],
            "music": [{"from", "to", "mood": "day" | "night"}]}
Writes out_dir/mix.wav and out_dir/env.json ({who: [mouth 0..1 per 1/30 s]}).
Everything (music + effects) is synthesised here, so there are no licensing issues.
"""
import json
import sys

import numpy as np
import soundfile as sf

SR = 48000
FPS = 30


def load(path):
    a, sr = sf.read(path, dtype="float32")
    if a.ndim > 1:
        a = a.mean(axis=1)
    if sr != SR:
        x = np.linspace(0, len(a) - 1, int(len(a) * SR / sr))
        a = np.interp(x, np.arange(len(a)), a).astype(np.float32)
    return a


def pluck(freq, dur, amp, decay=7.0, harmonics=4):
    n = int(dur * SR)
    t = np.arange(n) / SR
    w = sum(np.sin(2 * np.pi * freq * h * t) / (h ** 1.6) for h in range(1, harmonics + 1))
    return (w * np.exp(-t * decay) * amp).astype(np.float32)


def add(buf, sig, at):
    s = int(at * SR)
    if s >= len(buf) or s < 0:
        return
    e = min(len(buf), s + len(sig))
    buf[s:e] += sig[: e - s]


def music_bed(n, mood):
    out = np.zeros(n, np.float32)
    if mood == "night":
        beat = 60 / 72
        scale = [220.0, 261.63, 293.66, 329.63, 392.0, 440.0]
        pattern = [0, 2, 4, 2, 1, 3, 5, 3]
        for step in range(int(n / SR / (beat / 2)) + 1):
            add(out, pluck(scale[pattern[step % len(pattern)]], 1.4, 0.10, decay=2.5, harmonics=2), step * beat / 2)
            if step % 4 == 0:
                add(out, pluck(110.0 if (step // 8) % 2 == 0 else 98.0, 2.5, 0.12, decay=1.2, harmonics=2), step * beat / 2)
    else:
        beat = 60 / 112
        scale = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25]
        melody = [0, 2, 4, 5, 4, 2, 3, 2, 0, 2, 4, 7, 6, 4, 5, 4, 5, 4, 2, 0, 2, 3, 2, 1]
        bass = [130.81, 130.81, 196.0, 196.0, 174.61, 174.61, 196.0, 196.0]
        for step in range(int(n / SR / (beat / 2)) + 1):
            add(out, pluck(scale[melody[step % len(melody)]], 0.45, 0.14), step * beat / 2)
            if step % 2 == 0:
                add(out, pluck(bass[(step // 4) % len(bass)], 0.9, 0.2), step * beat / 2)
            if step % 4 == 2:   # soft shaker
                noise = np.random.default_rng(step).standard_normal(int(0.06 * SR)).astype(np.float32)
                add(out, noise * np.exp(-np.arange(len(noise)) / SR * 60) * 0.025, step * beat / 2)
    return out


rng = np.random.default_rng(7)


def sweep(f0, f1, dur, amp=0.35, decay=6.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = np.linspace(f0, f1, n)
    return (np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * decay) * amp).astype(np.float32)


def noise_burst(dur, amp, decay, smooth=12):
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = np.convolve(rng.standard_normal(n).astype(np.float32), np.ones(smooth) / smooth, mode="same")
    return (x * np.exp(-t * decay) * amp * np.clip(t * 40, 0, 1)).astype(np.float32)


def sfx(kind):
    if kind == "pop":
        return sweep(400, 1100, 0.18, 0.4, 14)
    if kind == "boing":
        n = int(0.45 * SR); t = np.arange(n) / SR
        f = 300 + 180 * np.sin(2 * np.pi * 9 * t) * np.exp(-t * 4)
        return (np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 6) * 0.35).astype(np.float32)
    if kind == "whoosh":
        return noise_burst(0.5, 0.3, 5, smooth=30) * np.sin(np.linspace(0, np.pi, int(0.5 * SR))).astype(np.float32)
    if kind == "splash":
        return noise_burst(1.0, 0.45, 4.5)
    if kind == "thud":
        return sweep(140, 50, 0.35, 0.6, 9)
    if kind in ("chime", "sparkle"):
        out = np.zeros(int(1.4 * SR), np.float32)
        notes = [1046.5, 1318.5, 1568.0, 2093.0] if kind == "chime" else [1568.0, 2093.0, 2637.0, 3136.0, 2637.0]
        for j, fr in enumerate(notes):
            add(out, pluck(fr, 0.8, 0.16), j * 0.08)
        return out
    if kind == "ding":
        return pluck(880, 1.2, 0.25, decay=3)
    if kind == "tick":
        out = np.zeros(int(2.6 * SR), np.float32)
        for j in range(5):
            add(out, pluck(1800 if j % 2 == 0 else 1400, 0.06, 0.12, decay=60), j * 0.5)
        return out
    if kind == "swoosh":
        return sweep(250, 900, 0.5, 0.2, 3)
    return np.zeros(1, np.float32)


def main():
    plan = json.load(open(sys.argv[1], encoding="utf-8"))
    out_dir = sys.argv[2]
    total = float(plan["total"])
    n = int(total * SR) + SR
    voice = np.zeros(n, np.float32)
    frames = int(total * FPS) + 2
    env = {}
    for ln in plan["lines"]:
        a = load(ln["file"])
        peak = np.abs(a).max() + 1e-6
        a = a / peak * 0.85
        add(voice, a, ln["start"])
        e = env.setdefault(ln["who"], [0.0] * frames)
        hop = SR // FPS
        for f in range(len(a) // hop):
            gi = int(round(ln["start"] * FPS)) + f
            if 0 <= gi < frames:
                e[gi] = round(min(1.0, float(np.sqrt(np.mean(a[f * hop:(f + 1) * hop] ** 2))) * 5.5), 3)

    music = np.zeros(n, np.float32)
    for m in plan.get("music", []):
        s0, s1 = int(m["from"] * SR), min(n, int(m["to"] * SR))
        if s1 <= s0:
            continue
        bed = music_bed(s1 - s0, m.get("mood", "day"))
        fade = np.ones(s1 - s0, np.float32)
        k = min(len(fade) // 2, int(0.8 * SR))
        if k > 0:
            fade[:k] = np.linspace(0, 1, k); fade[-k:] = np.linspace(1, 0, k)
        music[s0:s1] += bed[: s1 - s0] * fade
    speech = np.convolve(np.abs(voice), np.ones(2400) / 2400, mode="same")
    music *= (1 - 0.7 * np.clip(speech * 12, 0, 1)).astype(np.float32)

    fx = np.zeros(n, np.float32)
    for e in plan.get("sfx", []):
        add(fx, sfx(e["type"]), e["at"])

    mix = voice + music * 0.5 + fx * 0.7
    mix = mix[: int(total * SR)]
    mix = mix / max(1.0, float(np.abs(mix).max()) / 0.95)
    sf.write(f"{out_dir}/mix.wav", mix, SR)
    json.dump(env, open(f"{out_dir}/env.json", "w"))
    print("mix ok", round(total, 1))


if __name__ == "__main__":
    main()
