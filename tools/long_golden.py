#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Long-golden done-proof (runbook §2 + §5): the pixel gate run against the FULL ~10-minute MAME golden.

Two parts, each a certified tools/mame_golden.py capture: ATTRACT (no input) and GAMEPLAY (a seeded tape
that coins on both slots and the service switch, starts 1P and 2P games, steers diagonals and fires).
Both layers render the whole golden through tools/long_render.mjs. Per part and layer, fail-closed:
  completeness  the JS run covers the golden with no boot gap, dropped frame or short run (§3 crawl).
  RAM           byte-exact on EVERY compared frame, the manifest's convergence.stateExclude.stack window
                excluded, at an offset MEASURED from state; both neighbour offsets must mismatch (control).
                Drift-tolerant: where the offset shifts the next segment is re-measured, and each shift
                is printed and counted against the game's declared max_shifts.
  pixels        at the pixel offset measured beside it: every frame within pixel_gate.ROUGH_TOLERANCE
                whole-frame, and within the suite's BAND_MAX_PX in rows BAND_FROM.. except an isolated
                tear (one frame, both neighbours in band, RAM exact there, <= TEAR_MAX_PX), at most
                TEAR_MAX_COUNT of them. Rows 0..BAND_FROM-1 carry a deterministic scanline-compositing
                residual no per-frame px budget can sit below, so there the gate counts frames: the frames
                whose top region differs at all must not exceed the game's declared top_frames cap for that
                layer and part (pinned from the measured correct run); a missing pin FAILs.
                Nearest-golden-frame reconverge is NOT a verdict here: it cannot see a sprite-scale defect
                (a dropped sprite dress passes it at 0.56%).
  controls      >= MIN_DISTINCT distinct frames on both sides; GAMEPLAY's golden must show the coin taken
                and play started (the suite's game_responded) and more than one game played.
The golden is ROM-derived and gitignored: kept under games/<g>/out/long-golden/ as a lossless frames.mp4
+ state.bin (tools/golden_mp4.py) and reused while its meta.json matches. Raw dumps are deleted after the
verdict (tools/raw_dumps.py). Prints `long_golden: PASS -- <game>` only on a clean run; done_gate keys on it.

  run --game G [--seconds 600] [--part attract|gameplay|both] [--layer idiomatic|oracle|both] [--recapture]
      [--edit-json F] [--null-mutant] [--keep-frames]
                                            --edit-json renders an idiomatic MUTANT; --null-mutant renders the
                                            game's declared null_mutant, which must FAIL (the control)
  selftest                                  the verdict logic on synthetic data (no MAME, no ROM)
"""
import argparse
import hashlib
import importlib.util
import json
import os
import random
import shutil
import subprocess
import sys
import tempfile

import numpy as np

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "tools"))
import golden_mp4  # noqa: E402
import pixel_gate  # noqa: E402
from framediff import FROZEN_OFFSET  # noqa: E402
from hardware import Hardware  # noqa: E402
from raw_dumps import raw_dumps  # noqa: E402

# Enrolled games: the pixel suite whose constants (HW, LANDMARK, TAPE_OFFSET, BAND_FROM, BAND_MAX_PX,
# MIN_DISTINCT, game_responded) this reads, how many offset shifts a correct layer shows over the run, and
# top_frames: per layer and part, how many compared frames may differ ANYWHERE in rows 0..BAND_FROM-1.
# Each cap is the measured correct-run count (the residual is deterministic, as pixel_suite's RESIDUAL_FRAMES); the gate prints the count, so
# re-measure when MAME, the ROM or the tape changes. null_mutant is the must-FAIL control
# (`run --null-mutant`): every cloud switch row moved up 6. It passed the whole-frame-only verdict.
GAMES = {"timeplt": {"suite": "games/timeplt/tools/pixel_suite.py", "max_shifts": 0,
                     # measured at 014c29c2 (MAME 0.288 goldens): idiomatic 292 / 455, oracle 1 / 5
                     "top_frames": {"idiomatic": {"attract": 292, "gameplay": 455},
                                    "oracle": {"attract": 1, "gameplay": 5}},
                     "null_mutant": {"replayCloudBands.js": [["row: 113 - mem8[y] }",
                                                              "row: 113 - mem8[y] - 6 }"]]}}}
SECONDS = 600
SEED = 0x51A7E5
MIN_FREE_GIB = 30
TEAR_MAX_PX = 1000
TEAR_MAX_COUNT = 24
SEGMENT_PROBE = 120

# Manifest action -> the MAME input field it is (MAME's standard names; the MAME side presses these).
MAME_FIELDS = {"coin": "Coin 1", "coin2": "Coin 2", "service": "Service 1", "start1": "1 Player Start",
               "start2": "2 Players Start", "left": "P1 Left", "right": "P1 Right", "up": "P1 Up",
               "down": "P1 Down", "fire": "P1 Button 1"}


def load_suite(game):
    path = os.path.join(REPO, GAMES[game]["suite"])
    spec = importlib.util.spec_from_file_location(f"{game}_pixel_suite", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def manifest_facts(game):
    js = (f'const m=(await import("{os.path.join(REPO, "games", game, "manifest.js")}")).default;'
          'console.log(JSON.stringify({actions:m.inputs.actions,stack:m.convergence?.stateExclude?.stack??null,'
          'roms:Object.values(m.rom.images).map(i=>i.sha256??null)}))')
    r = subprocess.run(["node", "--input-type=module", "-e", js], capture_output=True, text=True, check=True)
    return json.loads(r.stdout)


# ── the gameplay tape ────────────────────────────────────────────────────────────────────────────
def make_tape(frames, seed=SEED):
    """Seeded sessions in JS tape indices -- the first coin + 1P start (the shape the suite's own
    game_responded control reads), the second coin 2 + service + coin + 2P start, then seeded coins and
    starts -- each followed by stick segments (diagonals too) with fire bursts and a mid-game coin, then an
    idle tail to game over."""
    rng = random.Random(seed)
    segs = []
    t, k = rng.randint(500, 900), 0
    while t < frames - 900:
        coins = [["coin"], ["coin2", "service", "coin"]][k] if k < 2 else [
            rng.choice(["coin", "coin", "coin2", "service"]) for _ in range(rng.choice([1, 2, 2, 3]))]
        for c in coins:
            segs.append([t, t + rng.randint(4, 10), [c]])
            t += rng.randint(30, 90)
        start = ["start1", "start2"][k] if k < 2 else rng.choice(["start1", "start2"])
        segs.append([t, t + rng.randint(5, 10), [start]])
        k += 1
        t += rng.randint(60, 200)
        end = min(t + rng.randint(2500, 7000), frames - 300)
        while t < end:
            n = rng.randint(8, 140)
            stick = rng.choice([[], ["left"], ["right"], ["up"], ["down"], ["left", "up"], ["left", "down"],
                                ["right", "up"], ["right", "down"]])
            if stick:
                segs.append([t, min(t + n, end), stick])
            if rng.random() < 0.8:
                per = rng.randint(6, 30)
                hold = rng.randint(2, per - 1)
                for f in range(t, min(t + n, end), per):
                    segs.append([f, min(f + hold, end), ["fire"]])
            t += n
        if rng.random() < 0.5:
            segs.append([end - 200, end - 194, ["coin"]])
        t = end + rng.randint(1200, 3000)
    return {"seed": seed, "segments": segs}


def lua_tape(tape, tape_offset):
    """The MAME side: press each action's named field over [from, to) shifted by the measured tape offset."""
    ev = []
    for a, b, names in tape["segments"]:
        for n in names:
            ev += [(a - tape_offset, 1, MAME_FIELDS[n]), (b - tape_offset, -1, MAME_FIELDS[n])]
    ev.sort()
    rows = ",\n".join(f'{{{f},{d},"{n}"}}' for f, d, n in ev)
    return ("-- Generated by tools/long_golden.py: action tape on MAME's named input fields.\n"
            "local function field(name)\n"
            "  for _, p in pairs(manager.machine.ioport.ports) do if p.fields[name] then return p.fields[name] end end\n"
            "  error('no MAME input field ' .. name)\nend\n"
            "local E = {\n" + rows + "\n}\n"
            "local F, on = {}, {}\nfor _, e in ipairs(E) do F[e[3]] = F[e[3]] or field(e[3]); on[e[3]] = 0 end\n"
            "local f, k = 0, 1\n_G.__long_tape = emu.add_machine_frame_notifier(function()\n  f = f + 1\n"
            "  while E[k] and E[k][1] <= f do on[E[k][3]] = on[E[k][3]] + E[k][2]; k = k + 1 end\n"
            "  for name, fld in pairs(F) do fld:set_value(on[name] > 0 and 1 or 0) end\nend)\n")


# ── verdicts (pure: the selftest drives these) ───────────────────────────────────────────────────
def mismatch_rows(js, gs, off, mask, lo, hi):
    """Bool per JS frame lo..hi-1: does it differ from golden frame +off outside the masked bytes?"""
    return np.any((js[lo:hi] != gs[lo + off:hi + off]) & mask, axis=1)


def sweep_offset(js, gs, mask, start, lo=-8, hi=400, span=SEGMENT_PROBE):
    """(best offset, its mismatches, neighbour mismatches) over JS frames start..start+span."""
    best, scores = None, {}
    for off in range(lo, hi):
        if start + off < 0 or start + span + off > len(gs) or start + span > len(js):
            continue
        scores[off] = int(mismatch_rows(js, gs, off, mask, start, start + span).sum())
        if best is None or scores[off] < scores[best]:
            best = off
    if best is None:
        return None, None, None
    return best, scores[best], [scores.get(best - 1), scores.get(best + 1)]


def ram_verdict(js, gs, mask, max_shifts):
    """Every JS frame byte-exact against the golden at the measured offset, re-measured where it shifts."""
    off, bad, nb = sweep_offset(js, gs, mask, 0)
    if off is None:
        return False, "RAM: too few frames to measure an offset", None
    if bad:
        return False, f"RAM: no offset makes the opening {SEGMENT_PROBE} frames exact (best {off}: {bad} differ)", None
    if any(x == 0 for x in nb if x is not None):
        return False, f"RAM: neighbour offsets of {off} also match -- the state does not discriminate (frozen?)", None
    first_off, shifts, i, offs = off, [], 0, np.full(len(js), -10**6, dtype=np.int64)
    n = len(js)
    while i < n:
        end = min(n, len(gs) - off)
        mm = mismatch_rows(js, gs, off, mask, i, end) if end > i else np.array([], bool)
        k = int(np.argmax(mm)) if mm.any() else len(mm)
        offs[i:i + k] = off
        i += k
        if i >= end:
            break
        noff, nbad, _ = sweep_offset(js, gs, mask, i, off - 8, off + 9)
        if noff is None or nbad or noff == off:
            d = np.nonzero((js[i] != gs[i + off]) & mask)[0][:8].tolist()
            return False, f"RAM: JS frame {i} differs from golden {i + off} at state bytes {d}", offs
        shifts.append((i, off, noff))
        off = noff
    covered = int((offs > -10**6).sum())
    if len(shifts) > max_shifts:
        return False, f"RAM: {len(shifts)} offset shift(s) {shifts} > max_shifts {max_shifts}", offs
    return True, (f"RAM byte-exact on {covered} frames at offset {first_off}"
                  + (f", shifts {shifts}" if shifts else ", no shift")), offs


def pixel_verdict(full, band, ram_ok, total_px, band_max, top, top_cap):
    """Whole frame within ROUGH_TOLERANCE; band within band_max except isolated, bounded, RAM-exact tears;
    at most top_cap frames whose top region (rows above the band) differs at all. No cap pinned -> FAIL."""
    full, band, top = np.asarray(full), np.asarray(band), np.asarray(top)
    if len(full) == 0:
        return False, "pixels: nothing compared"
    ntop = int(np.count_nonzero(top))
    if top_cap is None:
        return False, f"pixels: {ntop} frame(s) differ above the band, but no top_frames cap is pinned"
    if ntop > top_cap:
        return False, (f"pixels: {ntop} frame(s) differ above the band, over the pinned top_frames cap "
                       f"{top_cap} (the correct-run residual)")
    rough = full > pixel_gate.ROUGH_TOLERANCE * total_px
    if rough.any():
        i = int(np.argmax(rough))
        return False, f"pixels: frame {i} differs on {int(full[i])}px, over {pixel_gate.ROUGH_TOLERANCE:.0%} of the frame"
    over = band > band_max
    tears = []
    for i in np.nonzero(over)[0].tolist():
        lone = (i == 0 or not over[i - 1]) and (i == len(band) - 1 or not over[i + 1])
        if not lone or not ram_ok[i] or band[i] > TEAR_MAX_PX:
            return False, (f"pixels: frame {i} band {int(band[i])}px > {band_max}px and not an isolated tear "
                           f"(neighbours over: {not lone}, RAM exact: {bool(ram_ok[i])}, cap {TEAR_MAX_PX}px)")
        tears.append(i)
    if len(tears) > TEAR_MAX_COUNT:
        return False, f"pixels: {len(tears)} isolated tears > {TEAR_MAX_COUNT}"
    return True, (f"pixels: {len(full)} frames, worst {int(full.max())}px whole / {int(band.max())}px band, "
                  f"{ntop} frame(s) differ above the band (cap {top_cap}), "
                  f"{len(tears)} isolated tear(s){' at ' + str(tears[:8]) if tears else ''}")


# ── the run ──────────────────────────────────────────────────────────────────────────────────────
def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def disk_ok(path, need_bytes):
    free = shutil.disk_usage(path).free
    if free - need_bytes < MIN_FREE_GIB * 2**30:
        print(f"long_golden: FAIL -- {free / 2**30:.1f} GiB free; this step needs {need_bytes / 2**30:.1f} GiB and the "
              f"floor is {MIN_FREE_GIB} GiB")
        return False
    return True


def golden(game, suite, part, seconds, lua, work, recapture):
    """A certified golden for `part` in work/<part>_golden with frames.rgb decoded; reuses the cache."""
    cache = os.path.join(REPO, "games", game, "out", "long-golden", f"{part}-{seconds}s")
    lua_dir = os.path.join(suite.HERE, "lua")
    meta = {"seconds": seconds, "tape": hashlib.sha256((lua or "").encode()).hexdigest(),
            "roms": manifest_facts(game)["roms"], "hardware": sha(suite.HW),
            "lua": {f: sha(os.path.join(lua_dir, f)) for f in sorted(os.listdir(lua_dir)) if f.endswith(".lua")},
            "mame": subprocess.run(["mame", "-version"], capture_output=True, text=True).stdout.strip()}
    gdir = os.path.join(work, f"{part}_golden")
    os.makedirs(gdir, exist_ok=True)
    have = os.path.join(cache, "meta.json")
    bpf = pixel_gate.screen_geometry(suite.HW)[2]
    if not recapture and os.path.exists(have) and json.load(open(have)) == meta:
        for f in ("frames.json", "state.bin", "frames.mp4"):
            shutil.copy(os.path.join(cache, f), gdir)
        if not disk_ok(work, json.load(open(os.path.join(gdir, "frames.json")))["count"] * bpf):
            return None
        golden_mp4.decode(gdir)
        print(f"  [{part}] golden reused from {os.path.relpath(cache, REPO)}")
        return gdir
    if not disk_ok(work, 2 * (seconds * 60 + 2) * bpf):
        return None
    cmd = [sys.executable, os.path.join(REPO, "tools", "mame_golden.py"), "--hardware", suite.HW,
           "--lua-dir", lua_dir, "--rompath", os.path.join(REPO, "games", game, "rom"), "--out", gdir,
           "--seconds", str(seconds)]
    if lua:
        tp = os.path.join(work, f"{part}_tape.lua")
        open(tp, "w").write(lua)
        cmd += ["--tape", tp]
    print(f"  [{part}] capturing a {seconds}s MAME golden ...", flush=True)
    if subprocess.run(cmd, stdout=subprocess.DEVNULL).returncode != 0:
        print(f"long_golden: FAIL -- mame_golden refused to certify the {part} capture")
        return None
    golden_mp4.compress(gdir, drop_rgb=False)
    shutil.rmtree(cache, ignore_errors=True)
    os.makedirs(cache)
    for f in ("frames.json", "state.bin", "frames.mp4"):
        shutil.copy(os.path.join(gdir, f), cache)
    json.dump(meta, open(have, "w"), indent=1)
    return gdir


def states(path, sb):
    return np.memmap(path, np.uint8, "r").reshape(-1, sb)


def judge(suite, gdir, jdir, layer, stack, max_shifts, gameplay, top_cap):
    hw = Hardware.load(suite.HW)
    sb = sum(size for _n, _b, size in hw.state_regions)
    mask, base = np.ones(sb, bool), 0
    for _n, b, size in hw.state_regions:
        for a in range(max(stack[0], b), min(stack[1], b + size)):
            mask[base + a - b] = False
        base += size
    gs, js = states(os.path.join(gdir, "state.bin"), sb), states(os.path.join(jdir, "state.bin"), sb)
    for d, side in ((gdir, "golden"), (jdir, layer)):
        nd = len({f["sha256"] for f in json.load(open(os.path.join(d, "frames.json")))["frames"]})
        if nd < suite.MIN_DISTINCT:
            return False, f"{side} shows {nd} distinct frames; a frozen screen proves nothing"
    if gameplay:
        seen = suite.game_responded(gdir)
        for label, frames in seen.items():
            if not frames:
                return False, f"golden shows no '{label}' -- the tape never reached the machine"
        play = np.frombuffer(suite.state_column(gdir, suite.PLAY_ACTIVE), np.uint8)
        starts = int(((play[1:] != 0) & (play[:-1] == 0)).sum())
        if starts < 2:
            return False, f"golden starts {starts} game(s); the tape must play more than one"
    ok, why, offs = ram_verdict(js, gs, mask, max_shifts)
    print(f"    [{layer}] {why}")
    if not ok:
        return False, why
    w, h, bpf = pixel_gate.screen_geometry(suite.HW)
    jn = os.path.getsize(os.path.join(jdir, "frames.rgb")) // bpf
    gn = os.path.getsize(os.path.join(gdir, "frames.rgb")) // bpf
    jm = np.memmap(os.path.join(jdir, "frames.rgb"), np.uint8, "r", shape=(jn, h, w, 3))
    gm = np.memmap(os.path.join(gdir, "frames.rgb"), np.uint8, "r", shape=(gn, h, w, 3))
    ram_off = int(offs[0])
    sample = list(range(300, min(jn, gn - ram_off - 8) - 8, 997))
    probe = {o: sum(int(np.any(jm[i] != gm[i + o], axis=2).sum()) for i in sample)
             for o in range(ram_off - 3, ram_off + 4) if o >= 0}
    poff = min(probe, key=probe.get)
    if probe.get(poff - 1, 1) <= probe[poff] or probe.get(poff + 1, 1) <= probe[poff]:
        return False, f"pixels: neighbour offsets of {poff} match as well ({probe}) -- no discrimination"
    n = min(jn, gn - poff)
    if n < gn - poff - 2:
        return False, f"{layer} painted {jn} frames; it does not cover the golden's {gn}"
    full, band, top = np.zeros(n, np.int64), np.zeros(n, np.int64), np.zeros(n, np.int64)
    for s in range(0, n, 400):
        e = min(n, s + 400)
        d = np.any(jm[s:e] != gm[s + poff:e + poff], axis=3)
        full[s:e], band[s:e] = d.sum(axis=(1, 2)), d[:, suite.BAND_FROM:].sum(axis=(1, 2))
        top[s:e] = d[:, :suite.BAND_FROM].sum(axis=(1, 2))
    jrow = np.arange(n) + (poff - ram_off)
    ram_ok = np.zeros(n, bool)
    inside = (jrow >= 0) & (jrow < len(offs))
    ram_ok[inside] = offs[jrow[inside]] > -10**6
    ok, why = pixel_verdict(full, band, ram_ok, w * h, suite.BAND_MAX_PX, top, top_cap)
    print(f"    [{layer}] pixel offset {poff} (RAM {ram_off}); {why}")
    return ok, why


def run(a):
    game = a.game
    if game not in GAMES:
        print(f"long_golden: FAIL -- {game} is not enrolled (GAMES)")
        return 1
    suite = load_suite(game)
    rompath = os.path.join(REPO, "games", game, "rom")
    try:
        verified = subprocess.run(["mame", "-rompath", rompath, "-verifyroms", suite.DRIVER],
                                  capture_output=True, text=True).returncode == 0
    except FileNotFoundError:
        print("long_golden: SKIP -- no `mame` on PATH (NOT validated)")
        return 1
    if not verified:
        print(f"long_golden: SKIP -- romset {suite.DRIVER} not under {rompath} (NOT validated)")
        return 1
    facts = manifest_facts(game)
    if not facts["stack"]:
        print(f"long_golden: FAIL -- games/{game}/manifest.js declares no convergence.stateExclude.stack")
        return 1
    if a.null_mutant and "null_mutant" not in GAMES[game]:
        print(f"long_golden: FAIL -- {game} declares no null_mutant")
        return 1
    if a.null_mutant and a.part == "both":
        print("long_golden: --null-mutant needs --part attract or gameplay (the first FAIL ends the run)")
        return 2
    parts = ["attract", "gameplay"] if a.part == "both" else [a.part]
    layers = ["idiomatic", "oracle"] if a.layer == "both" else [a.layer]
    bpf = pixel_gate.screen_geometry(suite.HW)[2]
    frames = a.seconds * 60 + 2
    work = tempfile.mkdtemp(prefix=f"long_golden_{game}_")
    with raw_dumps(work, keep=a.keep_frames, rmtree=True):
        for part in parts:
            tape = make_tape(frames) if part == "gameplay" else None
            lua = lua_tape(tape, suite.TAPE_OFFSET) if tape else None
            gdir = golden(game, suite, part, a.seconds, lua, work, a.recapture)
            if gdir is None:
                return 1
            gc = json.load(open(os.path.join(gdir, "frames.json")))["count"]
            tpath = os.path.join(work, f"{part}_tape.json")
            if tape:
                json.dump(tape, open(tpath, "w"))
            for layer in layers:
                if not disk_ok(work, gc * bpf):
                    return 1
                jdir = os.path.join(work, f"{part}_{layer}")
                cmd = ["node", os.path.join(REPO, "tools", "long_render.mjs"), "--game", game, "--layer", layer,
                       "--frames", str(gc), "--out", jdir]
                if layer == "idiomatic":
                    cmd += ["--tape-origin", str(suite.LANDMARK)]
                if tape:
                    cmd += ["--tape", tpath]
                if a.null_mutant and layer == "idiomatic":
                    a.edit_json = os.path.join(work, "null_mutant.json")
                    json.dump(GAMES[game]["null_mutant"], open(a.edit_json, "w"))
                if a.edit_json and layer == "idiomatic":
                    cmd += ["--edit-json", a.edit_json]
                r = subprocess.run(cmd, capture_output=True, text=True)
                print(f"  [{part}] {layer}: {r.stdout.strip() or r.stderr.strip()[-200:]}")
                if r.returncode != 0:
                    print(f"long_golden: FAIL -- {part}/{layer}: the render stopped short (completeness)")
                    return 1
                top_cap = GAMES[game].get("top_frames", {}).get(layer, {}).get(part)
                ok, why = judge(suite, gdir, jdir, layer, facts["stack"], GAMES[game]["max_shifts"],
                                part == "gameplay", top_cap)
                shutil.rmtree(jdir, ignore_errors=True)
                if not ok:
                    print(f"long_golden: FAIL -- {part}/{layer}: {why}")
                    return 1
            shutil.rmtree(gdir, ignore_errors=True)
    print(f"long_golden: PASS -- {game}")
    return 0


def selftest():
    ok = True

    def check(label, got, want):
        nonlocal ok
        if got != want:
            print(f"selftest FAIL: {label}: got {got!r} want {want!r}", file=sys.stderr)
            ok = False

    rng = np.random.default_rng(7)
    sb, n, off = 64, 900, 5
    gs = rng.integers(0, 256, (n + 40, sb), dtype=np.uint8)
    mask = np.ones(sb, bool)
    mask[60:] = False
    js = gs[off:off + n].copy()
    check("exact at a measured offset", ram_verdict(js, gs, mask, 0)[0], True)
    check("the measured offset", int(ram_verdict(js, gs, mask, 0)[2][0]), off)
    stack = js.copy()
    stack[300, 61] ^= 0xFF
    check("a stack-window byte is excluded", ram_verdict(stack, gs, mask, 0)[0], True)
    bad = js.copy()
    bad[300, 3] ^= 0x01
    check("one RAM byte wrong fails", ram_verdict(bad, gs, mask, 0)[0], False)
    frozen = np.repeat(gs[:1], n + 40, axis=0)
    check("a frozen run fails the neighbour control", ram_verdict(frozen[:n], frozen, mask, 0)[0], False)
    shifted = np.concatenate([gs[off:off + 400], gs[off + 401:off + n]])
    check("an offset shift over max_shifts fails", ram_verdict(shifted, gs, mask, 0)[0], False)
    check("an offset shift within max_shifts passes", ram_verdict(shifted, gs, mask, 1)[0], True)

    total, band_max = 1000, 10
    full, band, ram_ok = np.zeros(50), np.zeros(50), np.ones(50, bool)
    check("clean pixels pass", pixel_verdict(full, band, ram_ok, total, band_max, (), 0)[0], True)
    b = band.copy(); b[20] = 40
    check("an isolated RAM-exact tear passes", pixel_verdict(full, b, ram_ok, total, band_max, (), 0)[0], True)
    b2 = band.copy(); b2[20] = b2[21] = 40
    check("a sustained band defect fails", pixel_verdict(full, b2, ram_ok, total, band_max, (), 0)[0], False)
    r = ram_ok.copy(); r[20] = False
    check("a tear without exact RAM fails", pixel_verdict(full, b, r, total, band_max, (), 0)[0], False)
    b3 = band.copy(); b3[20] = TEAR_MAX_PX + 1
    check("a tear over TEAR_MAX_PX fails", pixel_verdict(full, b3, ram_ok, total, band_max, (), 0)[0], False)
    b4 = np.zeros(4 * (TEAR_MAX_COUNT + 1)); b4[::4] = 40
    check("too many tears fail", pixel_verdict(np.zeros(len(b4)), b4, np.ones(len(b4), bool), total, band_max, (), 0)[0], False)
    f = full.copy(); f[7] = 0.06 * total
    check("a whole-frame defect over the rough tolerance fails", pixel_verdict(f, band, ram_ok, total, band_max, (), 0)[0], False)
    check("an empty comparison fails", pixel_verdict([], [], [], total, band_max, (), 0)[0], False)

    # top_frames: synthetic per-frame stats shaped like the measured 10-minute attract run (correct layer
    # vs the committed null_mutant, which differs above the band on most frames).
    tn, floor = 35766, 292
    tcap = floor
    tz, tok = np.zeros(tn), np.ones(tn, bool)
    correct = np.zeros(tn); correct[rng.choice(tn, floor, replace=False)] = rng.integers(1, 450, floor)
    check("a correct-like top residual within its cap passes",
          pixel_verdict(tz, tz, tok, total * 100, band_max, correct, tcap)[0], True)
    mutant = correct.copy(); mutant[np.arange(0, tn, 2)] = 300
    check("a mutant-like top series over the cap fails",
          pixel_verdict(tz, tz, tok, total * 100, band_max, mutant, tcap)[0], False)
    edge = np.zeros(tn); edge[:tcap] = 1
    check("exactly the cap passes", pixel_verdict(tz, tz, tok, total * 100, band_max, edge, tcap)[0], True)
    edge[tcap] = 1
    check("one frame over the cap fails", pixel_verdict(tz, tz, tok, total * 100, band_max, edge, tcap)[0], False)
    check("no pinned cap fails closed", pixel_verdict(tz, tz, tok, total * 100, band_max, correct, None)[0], False)
    for game, cfg in GAMES.items():
        for layer in ("idiomatic", "oracle"):
            for part in ("attract", "gameplay"):
                check(f"{game} pins a top_frames cap for {layer}/{part}",
                      isinstance(cfg.get("top_frames", {}).get(layer, {}).get(part), int), True)
        for mod, pairs in cfg.get("null_mutant", {}).items():
            src = open(os.path.join(REPO, "games", game, "idiomatic", mod)).read()
            check(f"{game} null_mutant edits live text in {mod}", all(f in src for f, _t in pairs), True)

    t1, t2 = make_tape(36002), make_tape(36002)
    check("the tape is deterministic", t1 == t2, True)
    used = {name for _a, _b, names in t1["segments"] for name in names}
    check("the tape drives every mapped action", used, set(MAME_FIELDS))
    lua = lua_tape({"segments": [[500, 508, ["coin2"]]]}, 1)
    check("the lua tape shifts by the tape offset onto the MAME field",
          ('{499,1,"Coin 2"}' in lua, '{507,-1,"Coin 2"}' in lua), (True, True))
    print("selftest OK" if ok else "selftest FAILED")
    return 0 if ok else 1


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--game", required=True)
    r.add_argument("--seconds", type=int, default=SECONDS)
    r.add_argument("--part", choices=("attract", "gameplay", "both"), default="both")
    r.add_argument("--layer", choices=("idiomatic", "oracle", "both"), default="both")
    r.add_argument("--recapture", action="store_true", help="capture fresh goldens even if the cache matches")
    r.add_argument("--edit-json", help="render an idiomatic MUTANT (see tools/long_render.mjs)")
    r.add_argument("--null-mutant", action="store_true",
                   help="render the game's declared null_mutant on the idiomatic layer; it must FAIL")
    r.add_argument("--keep-frames", action="store_true", help="keep the raw dumps in the work dir")
    sub.add_parser("selftest")
    a = ap.parse_args()
    return selftest() if a.cmd == "selftest" else run(a)


if __name__ == "__main__":
    sys.exit(main())
