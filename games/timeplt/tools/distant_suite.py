#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Distant-state pixel gate for Time Pilot -- design in docs/pixel-tapes.md.

pixel_suite.py only pixel-checks what one credit reaches; a game's DISTANT routines (later
era, two-player, game-over, a boss) stay [code], never [seen]. This drives BOTH MAME and our
generator engine into such a state from one shared poke schedule
(games/timeplt/tapes/<name>.poke.json: coin/start frames, pokes, and the state-cell assertion
that proves the state was reached), then pixel-diffs. The proven pieces of pixel_suite.py are
imported unchanged, so this cannot drift from the gate it extends.

  distant_suite.py --schedule games/timeplt/tapes/era-advance.poke.json
"""

import argparse
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import pixel_suite as ps  # noqa: E402 -- reuse the proven gate pieces unchanged
from raw_dumps import raw_dumps  # noqa: E402

# A direct RAM poke has no input-debounce pipeline, so it aligns on the tape frame itself
# (MEASURED: golden 0xAD04 changes on the tape frame it is poked); the coin's +1 (TAPE_OFFSET)
# is that debounce, which a direct write bypasses. The run prints the golden change frame, so
# re-derive if it stops matching the poke.
POKE_OFFSET = 0

# Semantic input presses -> (MAME IN0 field name, JS input port, bit). Bits verified against
# MAME's port masks; the two sides drive the same event through their own API (field vs raw
# bit at the IN0 mirror), exactly as pixel_suite bridges coin/start.
INPUTS = {
    "coin": ("Coin 1", 0xC300, 0x01),
    "start1p": ("1 Player Start", 0xC300, 0x08),
    "start2p": ("2 Players Start", 0xC300, 0x10),
}


def _int(v):
    """Accept 0x.. or decimal from the schedule JSON."""
    return int(v, 0) if isinstance(v, str) else int(v)


def _event(press, frame, dur):
    field, port, bit = INPUTS[press]
    return {"frame": frame, "field": field, "port": port, "bit": bit, "dur": dur}


def load_schedule(path):
    with open(path, encoding="utf-8") as fh:
        s = json.load(fh)
    for req in ("name", "pokes", "responded", "reaches"):
        if req not in s:
            raise SystemExit(f"schedule {path}: missing required key {req!r}")
    s.setdefault("coin", ps.LUA_COIN)
    s.setdefault("start", ps.LUA_START)
    s.setdefault("hold", ps.HOLD)
    for p in s["pokes"]:
        for req in ("frame", "addr", "val"):
            if req not in p:
                raise SystemExit(f"schedule {path}: poke missing {req!r}: {p}")
    # Normalize inputs: an explicit "inputs" list (each {frame, press[, dur]}) wins; else the
    # coin/start scalars synthesize a one-credit 1P game (the era-4 default).
    hold = s["hold"]
    if "inputs" in s:
        evs = []
        for e in s["inputs"]:
            if e.get("press") not in INPUTS:
                raise SystemExit(
                    f"schedule {path}: input 'press' must be one of {sorted(INPUTS)}: {e}"
                )
            evs.append(_event(e["press"], _int(e["frame"]), _int(e.get("dur", hold))))
        s["_inputs"] = evs
    else:
        s["_inputs"] = [
            _event("coin", _int(s["coin"]), hold),
            _event("start1p", _int(s["start"]), hold),
        ]
    reaches = s["reaches"]
    if not (isinstance(reaches, list) and reaches and all(isinstance(n, str) for n in reaches)):
        raise SystemExit(
            f"schedule {path}: 'reaches' must be a non-empty list of idiomatic routine names -- "
            "the routines this tape exists to put on the glass"
        )
    inv = s.setdefault("pixel_invisible", {})
    for n in inv:
        if n not in reaches:
            raise SystemExit(f"schedule {path}: pixel_invisible names {n!r}, which is not in 'reaches'")
    # Optional per-tape TIGHTER pixel budget for the distant-state window and the band. A tape
    # whose target's whole visible effect is one small sprite can pass the default budgets with
    # that routine broken (countdown-slot's arm mutants do; the tape's note has the measurement);
    # a measured tighter budget gives that tape teeth. It may only
    # TIGHTEN: a value above the default band budget (itself far below the whole-frame rough
    # tolerance) is refused, so no tape can loosen the gate through this key.
    if "distant_budget_px" in s:
        v = s["distant_budget_px"]
        if isinstance(v, bool) or not isinstance(v, int) or not 0 <= v <= ps.BAND_MAX_PX:
            raise SystemExit(
                f"schedule {path}: 'distant_budget_px' must be an integer 0..{ps.BAND_MAX_PX} "
                f"(the default band budget) -- it may only tighten, got {v!r}"
            )
    r = s["responded"]
    if "cell" not in r or "val" not in r:
        raise SystemExit(f"schedule {path}: 'responded' needs 'cell' and 'val'")
    r.setdefault("op", "eq")
    return s


def tape_budget(sched):
    """The per-tape px budget for the distant-state window and the band, or None for the defaults
    (a tape without `distant_budget_px`). distant_gate takes its budget from here, and
    test/distant_budget_check.py drives distant_gate to prove the value reaches both verdicts."""
    return sched.get("distant_budget_px")


def lua_tape(path, sched):
    """MAME tape: the schedule's input presses (active-low IN0 fields) and its direct RAM
    pokes, on the frame-notifier clock. Each field is set to the OR of its presses' windows;
    writes use the program space the state dumper reads."""
    events = sched["_inputs"]
    field_var, decls = {}, []
    for ev in events:
        if ev["field"] not in field_var:
            var = f"fld{len(field_var)}"
            field_var[ev["field"]] = var
            decls.append(f"local {var} = IN0.fields[{ev['field']!r}]")
            decls.append(f'assert({var}, "missing IN0 field {ev["field"]}")')
    sets = []
    for field, var in field_var.items():
        wins = [
            f"(f >= {ev['frame']} and f < {ev['frame'] + ev['dur']})"
            for ev in events
            if ev["field"] == field
        ]
        sets.append(f"  {var}:set_value(({' or '.join(wins)}) and 1 or 0)")
    for p in sched["pokes"]:
        fr, addr, val = _int(p["frame"]), _int(p["addr"]), _int(p["val"])
        dur = p.get("dur")
        cond = (
            f"f >= {fr} and f < {fr + _int(dur)}" if dur is not None else f"f >= {fr}"
        )
        sets.append(f"  if {cond} then mem:write_u8(0x{addr:04X}, 0x{val:02X}) end")
    decl_block, set_block = "\n".join(decls), "\n".join(sets)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(f"""-- Generated by distant_suite.py from schedule {sched["name"]!r}.
local IN0 = manager.machine.ioport.ports[":IN0"]
assert(IN0, "no :IN0")
local mem = manager.machine.devices[":maincpu"].spaces["program"]
assert(mem, "no :maincpu program space")
{decl_block}
local f = 0
_G.__pt = emu.add_machine_frame_notifier(function()
  f = f + 1
{set_block}
end)
""")
    return path


def render_argv(out, frames, sched, idiomatic, reach_out):
    """render.js's argv for this schedule: the same input presses (golden-aligned at +TAPE_OFFSET)
    and pokes (at +POKE_OFFSET), plus the reach instrument for the schedule's `reaches`. The ONE
    place the schedule is aligned to the JS side -- test/distant-reach-tape.test.js reads it back
    through --print-render-argv rather than re-deriving the alignment."""
    cmd = [
        "node",
        os.path.join(HERE, "render.js"),
        "--frames",
        str(frames),
        "--frames-out",
        out,
    ]
    for ev in sched["_inputs"]:
        cmd += [
            "--input",
            f"0x{ev['port']:04X}=0x{ev['bit']:02X}@{ev['frame'] + ps.TAPE_OFFSET}:hold{ev['dur']}",
        ]
    for p in sched["pokes"]:
        fr, addr, val = _int(p["frame"]), _int(p["addr"]), _int(p["val"])
        dur = p.get("dur")
        tail = f":hold{_int(dur)}" if dur is not None else ":hold"
        cmd += ["--poke", f"0x{addr:04X}=0x{val:02X}@{fr + POKE_OFFSET}{tail}"]
    if idiomatic:
        cmd += ["--idiomatic", "--tape-origin", str(ps.LANDMARK)]
    cmd += ["--reach", ",".join(sched["reaches"]), "--reach-out", reach_out]
    return cmd


def render_js(out, frames, sched, idiomatic, reach_out):
    subprocess.run(render_argv(out, frames, sched, idiomatic, reach_out), check=True)


def reach_check(reach_out, sched, lo, hi):
    """Every declared routine must execute inside the COMPARED distant window, JS frames [lo, hi):
    a pixel PASS over a window the routine never ran in says nothing about that routine.
    Returns the names with zero hits there."""
    with open(reach_out, encoding="utf-8") as fh:
        rep = json.load(fh)
    missing = []
    for name in sched["reaches"]:
        r = rep["routines"][name]
        n = sum(c for f, c in r["hits"] if lo <= f < hi)
        inv = sched["pixel_invisible"].get(name)
        tag = f" (reached, pixel-invisible: {inv})" if inv else ""
        print(
            f"  reach {name} [{r['addr']}] via {'+'.join(r['via']) or 'NOTHING'}: "
            f"{n} hit(s) in JS frames {lo}..{hi - 1}{tag if n else ''} -> {'ok' if n else 'NOT REACHED'}"
        )
        if not n:
            missing.append(name)
    return missing


def band_scan(js_rgb, golden_rgb, offset, from_frame, budget=None):
    """Per-frame band (rows BAND_FROM..) pixel diff, reduced to what the reconvergence
    verdict needs: the worst frame, the total frames over the per-frame budget, and the
    LONGEST RUN of consecutive over-budget frames.

    ★ WHY CONSECUTIVE, NOT over==0 (which pixel_suite uses). The rough gate's whole
    premise (pixel_gate.py) is that a RIGHT translation "differs in brief bounded
    transients and snaps back", and the pixel-gate doc names the exact case: "a single
    sprite one frame early -- an artefact of sub-frame timing that no player could see --
    would fail an otherwise-perfect translation". A denser distant scene produces one such
    frame that era-0's quiet field never does (measured: era-4 frame 675, one out-of-phase
    actor at rows 113..131, 125px, 0px on both neighbours). over==0 fails it; the doc says
    it should not. So we keep the SAME per-frame px budget (no floor lowered) and add the
    reconvergence test: an ISOLATED over-budget frame that snaps back is a transient; a RUN
    of >=2 consecutive is a divergence that stayed diverged. This keeps full teeth -- the
    documented adversarial twin (one shape bit flipped) trips it with 209 CONSECUTIVE
    over-budget frames (334 total, 21.3%), still a hard FAIL."""
    import numpy as np

    budget = ps.BAND_MAX_PX if budget is None else budget
    w, h, bpf = ps.pixel_gate.screen_geometry(ps.HW)
    n = min(os.path.getsize(js_rgb) // bpf, os.path.getsize(golden_rgb) // bpf - offset)
    worst, worst_at, over, run, max_run = 0, None, 0, 0, 0
    with open(js_rgb, "rb") as jf, open(golden_rgb, "rb") as gf:
        for i in range(from_frame, n):
            jf.seek(i * bpf)
            gf.seek((i + offset) * bpf)
            a = np.frombuffer(jf.read(bpf), np.uint8).reshape(h, w, 3)[ps.BAND_FROM :]
            b = np.frombuffer(gf.read(bpf), np.uint8).reshape(h, w, 3)[ps.BAND_FROM :]
            c = int(np.any(a != b, axis=2).sum())
            if c > worst:
                worst, worst_at = c, i
            if c > budget:
                over += 1
                run += 1
                max_run = max(max_run, run)
            else:
                run = 0
    frames = max(0, n - from_frame)
    return {
        "worst": worst,
        "worst_at": worst_at,
        "over": over,
        "max_run": max_run,
        "frames": frames,
    }


def _match(byte, op, val):
    if op == "eq":
        return byte == val
    if op == "ne":
        return byte != val
    if op == "ge":
        return byte >= val
    if op == "nonzero":
        return byte != 0
    raise SystemExit(f"unknown responded op {op!r} (use eq/ne/ge/nonzero)")


def responded_frames(golden_dir, sched):
    """The golden frames on which the poked machine actually entered the distant state.
    Read from MAME's state dump, never from our engine -- this is the ground truth that
    the poke DID drive the real ROM where we intended, so a pixel PASS is not just two
    engines agreeing on the same wrong thing."""
    r = sched["responded"]
    col = ps.state_column(golden_dir, _int(r["cell"]))
    val, op = _int(r["val"]), r["op"]
    return [f for f, b in enumerate(col) if _match(b, op, val)]


def work_dir(base, name, layer):
    """Per tape AND per layer, so two layers (or two tapes) never share a work dir. Callers pass
    the shared base (tools/pixel_gate_required.py passes games/<g>/out/distantwork); its selftest
    imports this to prove the partition."""
    return os.path.join(base, name, layer)


def main():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument(
        "--schedule", required=True, help="games/timeplt/tapes/<name>.poke.json"
    )
    p.add_argument("--rompath", default=os.path.join(ps.GAME, "rom"))
    p.add_argument("--frames", type=int, default=ps.GOLDEN_FRAMES - 1)
    p.add_argument("--work", default=os.path.join(ps.GAME, "out", "distantwork"))
    p.add_argument(
        "--layer",
        choices=("idiomatic", "oracle"),
        default=None,
        help="which layer to render vs MAME (as pixel_suite.py). Default reads manifest.runtime; "
        "tools/pixel_gate_required.py passes it explicitly.",
    )
    p.add_argument(
        "--print-render-argv",
        action="store_true",
        help="print the render.js argv (JSON) this schedule renders with, and exit -- no MAME. "
        "test/distant-reach-tape.test.js builds its machine from it.",
    )
    p.add_argument(
        "--keep-frames",
        action="store_true",
        help="keep the raw frames.rgb / state.bin dumps after the verdict (default: delete them, "
        "keeping frames.json hashes, reach.json and summary.json -- as pixel_suite.py).",
    )
    a = p.parse_args()

    sched = load_schedule(a.schedule)
    if a.print_render_argv:
        idio = (a.layer == "idiomatic") if a.layer else (ps.runtime() == "idiomatic")
        off = ps.GEN_OFFSET if idio else ps.FROZEN_OFFSET
        print(
            json.dumps(
                {
                    "argv": render_argv("<frames-out>", a.frames, sched, idio, "<reach-out>")[2:],
                    # the nominal compared window's end, in JS frames (golden length - offset)
                    "window_end": ps.GOLDEN_FRAMES - off,
                }
            )
        )
        return 0

    try:
        verified = (
            subprocess.run(
                ["mame", "-rompath", a.rompath, "-verifyroms", ps.DRIVER],
                capture_output=True,
                text=True,
            ).returncode
            == 0
        )
    except FileNotFoundError:
        print("distant_suite: SKIP -- no `mame` on PATH")
        return 0
    if not verified:
        print(f"distant_suite: SKIP -- romset {ps.DRIVER} not found under {a.rompath}")
        return 0

    idiomatic = (a.layer == "idiomatic") if a.layer else (ps.runtime() == "idiomatic")
    layer = "idiomatic" if idiomatic else "oracle"
    work = work_dir(a.work, sched["name"], layer)
    os.makedirs(work, exist_ok=True)
    # Every step below (responded_frames, frame_diffs, band_scan, the reach window) reads the raw
    # dumps; raw_dumps deletes them only after the verdict is final (tools/raw_dumps.py).
    summary = {"suite": "distant_suite", "tape": sched["name"], "layer": layer, "verdict": "CRASH"}
    with raw_dumps(work, keep=a.keep_frames, summary=summary):
        return distant_gate(a, sched, work, idiomatic, summary)


def distant_gate(a, sched, work, idiomatic, summary):
    """Capture, render, and judge one tape; records the verdict (and, on FAIL, where) in `summary`."""
    go, jo = os.path.join(work, "golden"), os.path.join(work, "js")
    offset = ps.GEN_OFFSET if idiomatic else ps.FROZEN_OFFSET
    src = "--layer" if a.layer else "manifest.runtime"
    # The header says "tape <name>" so no tape name can make it read as the verdict line
    # (tools/pixel_gate_required.py anchors on `^distant_suite: PASS -- <name>$`).
    print(f"distant_suite: tape {sched['name']} -- {sched.get('description', '')}")
    print(
        f"  layer: {'IDIOMATIC (generator engine)' if idiomatic else 'oracle (cycle-driven)'}"
        f"; golden offset {offset}; poke offset {POKE_OFFSET} (layer from {src})"
    )

    ps.capture_golden(a.rompath, go, lua_tape(os.path.join(work, "tape.lua"), sched))
    reach_out = os.path.join(work, "reach.json")
    render_js(jo, a.frames, sched, idiomatic, reach_out)

    # 1) Prove the poke drove the REAL machine into the distant state (MAME, not our engine).
    hit = responded_frames(go, sched)
    r = sched["responded"]
    if not hit:
        print(
            f"distant_suite: FAIL -- golden never satisfied responded "
            f"({r['cell']} {r['op']} {r['val']}); the poke did not reach the distant "
            "state, so there is nothing to validate. Fix the schedule, not the gate."
        )
        summary.update(verdict="FAIL", why="golden never satisfied responded")
        return 1
    print(
        f"  golden responded: {r['cell']} {r['op']} {r['val']} on frames "
        f"{hit[0]}..{hit[-1]} ({len(hit)} frames)"
    )
    for p in sched["pokes"]:
        print(
            f"  poke {p['addr']}={p['val']} @tape-frame {_int(p['frame'])} "
            f"-> js @{_int(p['frame']) + POKE_OFFSET}"
        )

    _, _, bpf = ps.pixel_gate.screen_geometry(ps.HW)
    got = os.path.getsize(os.path.join(jo, "frames.rgb")) // bpf
    if got < a.frames - 1:
        print(
            f"distant_suite: INCOMPLETE -- render delivered {got} of {a.frames - 1} "
            "frames; a comparison this short concludes nothing."
        )
        summary.update(verdict="INCOMPLETE", why=f"render delivered {got} of {a.frames - 1} frames")
        return 1

    # 2) Pixel-diff the whole run and, separately, the distant-state window (from the
    #    first responded golden frame, in JS coordinates).
    d = ps.pixel_gate.frame_diffs(
        os.path.join(jo, "frames.rgb"),
        os.path.join(go, "frames.rgb"),
        ps.HW,
        offset=offset,
    )
    distant_js = max(0, hit[0] - offset)
    rc = 0
    summary["windows"] = {}
    tight = tape_budget(sched)
    w, h, _ = ps.pixel_gate.screen_geometry(ps.HW)
    for label, frm in (("whole run", ps.DIFF_FROM), ("distant state", distant_js)):
        if label == "distant state" and tight is not None:
            # rough_verdict fails a frame over int(total * tolerance) px; +0.5 makes that int exactly `tight`
            v = ps.pixel_gate.rough_verdict(d, ps.HW, from_frame=frm, tolerance=(tight + 0.5) / (w * h))
            note = f" (tape budget {tight}px)"
        else:
            v = ps.pixel_gate.rough_verdict(d, ps.HW, from_frame=frm)
            note = ""
        print(
            f"  {label:15} frames={v['frames']:5d} differ={v['frames_differing']:5d} "
            f"max={v['max_pixels']:5d}px ({v['max_pct']:6.3f}%) "
            f"worst@{v['worst_frame']}{note} -> {v['verdict']}"
        )
        summary["windows"][label] = v
        if v["verdict"] != ps.pixel_gate.PASS:
            rc = 1
    b = band_scan(
        os.path.join(jo, "frames.rgb"),
        os.path.join(go, "frames.rgb"),
        offset,
        distant_js,
        tight,
    )
    band_budget = ps.BAND_MAX_PX if tight is None else tight
    # Same 100px/frame budget as pixel_suite (floor NOT lowered). PASS iff the over-budget
    # band frames are RARE and ISOLATED transients -- not a sustained or systematic
    # divergence. Two guards, both proven to trip on the documented shape-bit twin and to
    # spare a correct denser scene (measured, mutation-tested):
    #   * max_run  -- longest run of consecutive over-budget frames. A real divergence
    #     "stays diverged" (twin: 209 consecutive); a bounded transient snaps back next
    #     frame (era-4: 1). FAIL at >=2.
    #   * over_frac -- share of the window over budget. Catches a scattered/flickering
    #     divergence a run-length test alone would miss (twin: 21.3%; era-4: 0.09%). The
    #     2% line sits ~10x below the twin and ~20x above the correct scene.
    over_frac = b["over"] / b["frames"] if b["frames"] else 0.0
    MAX_RUN, OVER_FRAC = 2, 0.02
    band_ok = b["max_run"] < MAX_RUN and over_frac < OVER_FRAC
    bverdict = ps.pixel_gate.PASS if band_ok else ps.pixel_gate.FAIL
    print(
        f"  band rows {ps.BAND_FROM}.. worst={b['worst']:5d}px (budget {band_budget}) "
        f"over={b['over']}/{b['frames']} ({100 * over_frac:.2f}%) "
        f"max-consecutive={b['max_run']} worst@{b['worst_at']} -> {bverdict}"
    )
    if b["over"]:
        print(
            f"  note: {b['over']} band frame(s) over budget -- "
            + (
                "isolated, reconverging transients (a sprite a frame early, the case the "
                "rough tolerance exists to accept)."
                if band_ok
                else f"SUSTAINED {b['max_run']} consecutive / {100 * over_frac:.2f}% of window -- "
                "a real divergence, not a transient."
            )
        )
    if not band_ok:
        rc = 1
    summary["band"] = dict(b, budget=band_budget, ok=band_ok)

    # 3) REACH: the routines this tape exists for ran inside the compared distant window. The
    #    window ends where the comparison ends (the golden is shorter than the render by `offset`).
    compared = min(got, os.path.getsize(os.path.join(go, "frames.rgb")) // bpf - offset)
    missing = reach_check(reach_out, sched, distant_js, compared)
    if missing:
        print(
            f"  REACH FAIL: {', '.join(missing)} never ran in the compared distant window -- the "
            "pixel verdict above does not cover them. Fix the schedule or its 'reaches'."
        )
        rc = 1
    summary["reach_missing"] = missing
    summary["verdict"] = "PASS" if rc == 0 else "FAIL"
    if rc:
        summary["worst_frames"] = ps.worst_frames(d, distant_js)

    print(f"distant_suite: {'PASS' if rc == 0 else 'FAIL'} -- {sched['name']}")
    return rc


if __name__ == "__main__":
    sys.exit(main())
