#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""A tape's `distant_budget_px` reaches the verdict, end to end, without MAME.

distant_budget.test.js runs this on every `npm test`. It drives the REAL distant_suite.distant_gate
-- the function main() calls after the MAME check -- and the REAL main() itself, from its command
line, from a schedule to a verdict, with only the external steps (MAME's -verifyroms, MAME's golden,
render.js's frames) replaced by synthetic dumps written to a temp dir: an all-black golden whose state dump enters the responded state partway in, and a JS render
identical to it except for a few consecutive distant-window frames carrying a known pixel count in
the band rows. The schedule-to-budget step is distant_suite.tape_budget, which the gate itself
calls; nothing here re-implements it.

Checking only that the key's VALUE is accepted (pixel_gate_required.py's selftest) cannot catch
the key being silently dropped between the schedule and the verdict: every tape would fall back
to the default budget and stay green. So each case asserts the VERDICT, and records the budget the
gate actually handed to rough_verdict and band_scan.

Prints one `[ok ]`/`[BAD]` line per assertion and exits non-zero on any BAD.
"""

import contextlib
import copy
import io
import json
import os
import sys
import tempfile
from types import SimpleNamespace

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(GAME, "tools"))

import distant_suite as ds  # noqa: E402
import numpy as np  # noqa: E402

ps = ds.ps
TAPE = os.path.join(GAME, "tapes", "countdown-slot.poke.json")
FRAMES = 30          # tiny run; the gate's frame-count guard only needs got >= frames - 1
RESPOND_AT = 10      # the distant window starts at JS frame RESPOND_AT - 1 (see _stubbed)
DIFF_AT = (15, 16, 17)  # JS frames that differ: inside the distant window, consecutive (a band run)
LOGS = []            # the gate's own output per case, printed only when an assertion fails


def _frames(path, n, diff_px):
    """`n` black frames; frames in DIFF_AT get `diff_px` white pixels in the band rows."""
    w, h, bpf = ps.pixel_gate.screen_geometry(ps.HW)
    with open(path, "wb") as fh:
        for i in range(n):
            f = np.zeros((h, w, 3), np.uint8)
            if diff_px and i in DIFF_AT:
                rows = ps.BAND_FROM + 7
                for k in range(diff_px):
                    f[rows + k // w, k % w] = 255
            fh.write(f.tobytes())
    assert os.path.getsize(path) == n * bpf


def _state(path, n, responded, first):
    """A state dump whose `responded` cell holds the target value from golden frame `first` on."""
    regions = ps.Hardware.load(ps.HW).state_regions
    frame_bytes = sum(size for _n, _b, size in regions)
    cell, off = ds._int(responded["cell"]), 0
    for _name, base, size in regions:
        if base <= cell < base + size:
            off += cell - base
            break
        off += size
    blob = bytearray(n * frame_bytes)
    for f in range(first, n):
        blob[f * frame_bytes + off] = ds._int(responded["val"])
    with open(path, "wb") as fh:
        fh.write(blob)


@contextlib.contextmanager
def _stubbed(responded, diff_px, offset, seen):
    """Replace ONLY the external steps -- MAME's -verifyroms, the golden capture, render.js --
    with synthetic dumps; everything between the schedule and the verdict is the suite's own code.
    The golden runs `offset` frames longer than the render (as a real capture does) and responds
    from golden frame offset + RESPOND_AT - 1, so the distant window starts at JS frame
    RESPOND_AT - 1 on either layer. The band_scan / rough_verdict wrappers record the budget the
    gate handed each: rough_verdict's is the call with a non-zero from_frame, the distant-state
    window (the whole-run window starts at pixel_suite.DIFF_FROM, 0)."""
    w, h, bpf = ps.pixel_gate.screen_geometry(ps.HW)
    real = (ps.capture_golden, ds.render_js, ds.band_scan, ps.pixel_gate.rough_verdict, ds.subprocess, ps.sound_gate)

    def capture(_rompath, out, _tape):
        os.makedirs(out, exist_ok=True)
        n = FRAMES + offset
        with open(os.path.join(out, "frames.rgb"), "wb") as fh:
            fh.truncate(n * bpf)  # all black; sparse, so the idiomatic offset costs no disk
        _state(os.path.join(out, "state.bin"), n, responded, offset + RESPOND_AT - 1)

    def render(out, frames, s, _idiomatic, reach_out):
        os.makedirs(out, exist_ok=True)
        _frames(os.path.join(out, "frames.rgb"), frames, diff_px)
        rep = {"routines": {n: {"addr": "0x0", "via": ["synthetic"], "hits": [[f, 1] for f in range(frames)]}
                            for n in s["reaches"]}}
        with open(reach_out, "w", encoding="utf-8") as fh:
            json.dump(rep, fh)

    def band(*args, **kw):
        seen["band"] = args[4] if len(args) > 4 else kw.get("budget")
        return real[2](*args, **kw)

    def rough(diffs, hw, from_frame=0, tolerance=ps.pixel_gate.ROUGH_TOLERANCE):
        if from_frame:
            seen["distant"] = int(w * h * tolerance)
        return real[3](diffs, hw, from_frame=from_frame, tolerance=tolerance)

    def run_cmd(argv, **_kw):
        # main()'s only subprocess once capture and render are stubbed: the romset check
        if argv[:1] != ["mame"] or "-verifyroms" not in argv:
            raise AssertionError(f"unexpected subprocess from distant_suite: {argv}")
        seen["verifyroms"] = True
        return SimpleNamespace(returncode=0, stdout="", stderr="")

    ps.capture_golden, ds.render_js = capture, render
    ds.band_scan, ps.pixel_gate.rough_verdict = band, rough
    ds.subprocess = SimpleNamespace(run=run_cmd)
    # the synthetic dumps carry no sound-latch stream; the latch verdict is not what this harness tests
    ps.sound_gate = lambda *_a, **_k: (True, "  sound 0xC000: not compared (synthetic dumps)")
    try:
        yield
    finally:
        (ps.capture_golden, ds.render_js, ds.band_scan, ps.pixel_gate.rough_verdict, ds.subprocess,
         ps.sound_gate) = real


def run(sched, diff_px):
    """Drive distant_gate (oracle layer) on synthetic dumps; return (rc, summary, budgets used)."""
    seen, summary, log = {}, {}, io.StringIO()
    with _stubbed(sched["responded"], diff_px, ps.FROZEN_OFFSET, seen), \
            tempfile.TemporaryDirectory() as work, contextlib.redirect_stdout(log):
        a = SimpleNamespace(rompath="-", frames=FRAMES, layer="oracle")
        rc = ds.distant_gate(a, sched, work, False, summary)
    LOGS.append(log.getvalue())
    return rc, summary, seen


def run_main(tape, diff_px):
    """Drive the suite's own main() from the command line it is run with (idiomatic layer, a temp
    --work); return (exit code, the summary.json main wrote, budgets used). Catches a main() that
    loses the key on the way to distant_gate, which run() alone cannot see."""
    seen, log = {}, io.StringIO()
    with open(tape, encoding="utf-8") as fh:
        responded = json.load(fh)["responded"]
    argv = sys.argv
    with _stubbed(responded, diff_px, ps.GEN_OFFSET, seen), \
            tempfile.TemporaryDirectory() as work, contextlib.redirect_stdout(log):
        sys.argv = ["distant_suite.py", "--schedule", tape, "--layer", "idiomatic",
                    "--work", work, "--frames", str(FRAMES)]
        try:
            rc = ds.main()
        finally:
            sys.argv = argv
        name = ds.load_schedule(tape)["name"]
        with open(os.path.join(ds.work_dir(work, name, "idiomatic"), "summary.json"), encoding="utf-8") as fh:
            summary = json.load(fh)
    LOGS.append(log.getvalue())
    return rc, summary, seen


def main():
    bad = 0

    def check(label, ok):
        nonlocal bad
        bad += not ok
        print(f"  [{'ok ' if ok else 'BAD'}] {label}")

    committed = ds.load_schedule(TAPE)
    with open(TAPE, encoding="utf-8") as fh:
        raw = json.load(fh)
    raw.pop("distant_budget_px", None)
    tmp = tempfile.TemporaryDirectory()
    keyless_tape = os.path.join(tmp.name, "no-key.poke.json")
    with open(keyless_tape, "w", encoding="utf-8") as fh:
        json.dump(raw, fh)
    keyless = ds.load_schedule(keyless_tape)

    check(f"committed countdown-slot tape_budget == 16 (got {ds.tape_budget(committed)!r})",
          ds.tape_budget(committed) == 16)
    check(f"key removed -> tape_budget is None, the default (got {ds.tape_budget(keyless)!r})",
          ds.tape_budget(keyless) is None)

    def verdicts(s):
        return (s.get("windows", {}).get("whole run", {}).get("verdict"),
                s.get("windows", {}).get("distant state", {}).get("verdict"),
                s.get("band", {}).get("ok"))

    # Control first: the synthetic harness can FAIL at all, with no key -- a band divergence over
    # the default budget. Without it, every PASS below could be a harness that never judges.
    rc, s, seen = run(copy.deepcopy(keyless), ps.BAND_MAX_PX + 50)
    check(f"control: no key, {ps.BAND_MAX_PX + 50}px run in the band -> FAIL on band "
          f"(rc={rc}, whole/distant/band_ok={verdicts(s)})", rc == 1 and s["band"]["ok"] is False)

    rc, s, seen = run(copy.deepcopy(committed), 40)
    check(f"committed tape, 40px -> FAIL (rc={rc})", rc == 1)
    check(f"  whole run still PASS (the budget is distant-window only): {verdicts(s)[0]}",
          verdicts(s)[0] == ps.pixel_gate.PASS)
    check(f"  distant-state window FAIL: {verdicts(s)[1]}", verdicts(s)[1] == ps.pixel_gate.FAIL)
    check(f"  band FAIL: ok={verdicts(s)[2]} budget={s.get('band', {}).get('budget')}",
          verdicts(s)[2] is False and s["band"]["budget"] == 16)
    check(f"  budget the gate handed rough_verdict (distant) = {seen.get('distant')}, band_scan = "
          f"{seen.get('band')} (both must be 16)", seen.get("distant") == 16 and seen.get("band") == 16)

    rc, s, seen = run(copy.deepcopy(keyless), 40)
    check(f"key removed, 40px -> PASS under the default (rc={rc}, {verdicts(s)}, band budget "
          f"{s.get('band', {}).get('budget')})",
          rc == 0 and s["band"]["budget"] == ps.BAND_MAX_PX)

    rc, s, seen = run(copy.deepcopy(committed), 0)
    check(f"committed tape, identical frames -> PASS under 16 (rc={rc}, {verdicts(s)})", rc == 0)

    # The same verdicts through main(), from the command line: the key must survive main().
    rc, s, seen = run_main(TAPE, 40)
    check(f"main() on the committed tape, 40px -> exit 1 FAIL (rc={rc}, verdict {s.get('verdict')}, "
          f"{verdicts(s)}, budgets distant={seen.get('distant')} band={seen.get('band')}, "
          f"verifyroms stubbed={seen.get('verifyroms')})",
          rc == 1 and s.get("verdict") == "FAIL" and verdicts(s) == (ps.pixel_gate.PASS, ps.pixel_gate.FAIL, False)
          and seen.get("distant") == 16 and seen.get("band") == 16 and seen.get("verifyroms"))
    rc, s, seen = run_main(keyless_tape, 40)
    check(f"main() on the tape without the key, 40px -> exit 0 PASS under the default (rc={rc}, "
          f"verdict {s.get('verdict')}, {verdicts(s)}, band budget {s.get('band', {}).get('budget')})",
          rc == 0 and s.get("verdict") == "PASS" and s.get("band", {}).get("budget") == ps.BAND_MAX_PX)
    tmp.cleanup()

    if bad:
        for i, text in enumerate(LOGS):
            print(f"--- distant_gate output, case {i + 1} ---\n{text}", end="")
    print(f"distant_budget_check: {'PASS' if not bad else f'FAIL ({bad} bad)'}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
