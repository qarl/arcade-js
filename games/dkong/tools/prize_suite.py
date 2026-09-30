#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Prize (bonus-item) pixel + pickup gate for the DK translation.

Pauline's dropped PRIZES -- parasol/hat/purse -- are worth level-based points
(300/L1, 500/L2, 800/L3+). Unlike movement/hammer they had no tapes and no
pixel gate. This tool builds both: for each of 9 prize scenarios it

  1. writes a MAME-Lua tape into games/dkong/tapes/ (the committed fixture),
  2. captures a fresh MAME golden (tools/mame_golden.py --tape ... --seconds 30),
  3. runs tools/emit.js with the MATCHING --poke/--input, capturing BOTH the
     RGB frame stream (for the pixel diff) and the per-frame state dump,
  4. rough-diffs pixels from frame 1600 on (max per-frame <5% AND 0 frames >5%),
  5. verifies the pickup actually fired in-emit: the collected prize's 0x6A0C
     slot X clears to 0 AND the 3-byte BCD score at 0x60B2 grows by the level
     value.

Prints a PASS/FAIL table. Goldens + emit output live under out/ (gitignored);
only the .lua tapes and this script are meant to be committed.

FACTS (verified earlier, see the task brief):
  * Prize table 0x6A0C, stride 4: +0 = X (cleared to 0 on pickup), +1 = type
    (0x73/74/75), +3 = Y. Pickup fires on EXACT grid match: Mario X (0x6203) ==
    prizeX AND Mario Y (0x6205) == prizeY.
  * Board reached by poke (held frames 464..1463): board 2/3/4 pre-set, exactly
    as tools/move_suite.py does it (ptr byte 0x74/0x76/0x78 -> 0x3A70 seq table).
  * Coin frame 399 (MAME) / 400 (emit N+1); start 459 / 460. Mario poke + walk
    from frame 1600 (MAME) / 1601 (emit).

Usage:
  python3 tools/prize_suite.py            # all 9
  python3 tools/prize_suite.py 50m_hat    # filter by name substring(s)
"""
import os
import subprocess
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..','..','..','tools'))
import pixel_gate
from raw_dumps import raw_dumps

S = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(S)
REPO = os.path.dirname(os.path.dirname(ROOT))  # repo root (games/dkong/tools -> ../../..)
TAPES = os.path.join(ROOT, "tapes")
WORK = os.path.join(ROOT, "out", "prizework")
os.makedirs(WORK, exist_ok=True)
HW = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..','..','..','boards','dkong','hardware.json')
FRAMES = 1820         # == mame_golden --seconds 30 (floor(60.606*30)+2)
SDS = 5120            # state dump bytes/frame
BPTR = {2: 0x74, 3: 0x76, 4: 0x78}   # board -> 0x3A70 seq-table ptr low byte

# name, board, (startX,startY) or None (natural spawn), (prizeX,prizeY),
#   level score value, hold-frames (Right held from frame 1600/1601)
TESTS = [
    ("50m_hat",      2, None,          (0x8B, 0xF0), 500, 200),
    ("50m_parasol",  2, (0x50, 0xA0),  (0x53, 0xA0), 500, 200),
    ("50m_purse",    2, (0xD1, 0xA0),  (0xDB, 0xA0), 500, 200),
    ("75m_parasol",  3, (0x55, 0xC8),  (0x5B, 0xC8), 800, 200),
    ("75m_hat",      3, (0xDD, 0x60),  (0xE3, 0x60), 800, 200),
    ("75m_purse",    3, (0x15, 0x80),  (0x1B, 0x80), 800, 200),
    ("100m_parasol", 4, (0xD5, 0xC8),  (0xDB, 0xC8), 800, 200),
    ("100m_hat",     4, (0x8D, 0xF0),  (0x93, 0xF0), 800, 200),
    ("100m_purse",   4, (0x2D, 0x50),  (0x33, 0x50), 800, 200),
]


def board_poke_lua(b):
    p = BPTR[b]
    return (
        "  if f>=464 and f<=1463 then "
        f"mem:write_u8(0x604A,0x{p:02x});mem:write_u8(0x604B,0x3A);"
        f"mem:write_u8(0x6049,0x0{b});mem:write_u8(0x622A,0x{p:02x});"
        f"mem:write_u8(0x622B,0x3A);mem:write_u8(0x6227,0x0{b});"
        f"mem:write_u8(0x6229,0x0{b}) end\n"
    )


def lua(name, b, start, prize, hold):
    """MAME-Lua tape: coin+start, board pre-set (464..1463), optional Mario
    reposition at 1600, and P1 Right held 1600..1600+hold."""
    bp = board_poke_lua(b)
    if start is not None:
        sx, sy = start
        mpoke = (
            " if f>=1600 and f<=1601 then "
            f"mem:write_u8(0x6203,0x{sx:02x});mem:write_u8(0x6205,0x{sy:02x}) end\n"
        )
    else:
        mpoke = (
            " -- no position poke: walk right from the natural spawn onto the prize\n"
        )
    t = f'''-- PRIZE gate fixture ({name}): collect the {name.split("_")[1]} on board {b}.
-- coin@399 start@459; board-{b} pre-set held 464..1463; {"Mario -> (0x%02x,0x%02x) @1600; " % start if start else ""}hold P1 Right 1600..{1600+hold}.
-- Mirrors tools/prize_suite.py's emit --poke/--input. Pickup = exact grid match
-- (Mario 0x6203==prizeX & 0x6205==prizeY) at prize (0x{prize[0]:02x},0x{prize[1]:02x}).
local M=manager.machine
local mem=M.devices[":maincpu"].spaces["program"]
local I2=M.ioport.ports[":IN2"];local I0=M.ioport.ports[":IN0"]
local coin=I2.fields["Coin 1"];local start=I2.fields["1 Player Start"];local inp=I0.fields["P1 Right"]
assert(coin and start and inp,"fields")
local f=0
_G.__prz=emu.add_machine_frame_notifier(function()
 f=f+1
 coin:set_value((f>=399 and f<400) and 1 or 0)
 start:set_value((f>=459 and f<460) and 1 or 0)
{bp}{mpoke} inp:set_value((f>=1600 and f<{1600+hold}) and 1 or 0)
end)
'''
    path = os.path.join(TAPES, f"test_prize_{name}.lua")
    open(path, "w").write(t)
    return path


def emit_cmd(out, sout, b, start, prize, hold):
    c = [
        "node", "tools/emit.js",
        "--frames-out", out, "--state-out", sout, "--frames", str(FRAMES),
        "--input", "0x7d00=0x80@400:once", "--input", "0x7d00=0x04@460:once",
        "--input", f"0x7c00=0x01@1601:hold{hold}",   # P1 Right (IN0 bit0)
    ]
    p = BPTR[b]
    for a, v in [(0x6049, b), (0x604a, p), (0x604b, 0x3a),
                 (0x622a, p), (0x622b, 0x3a), (0x6227, b), (0x6229, b)]:
        c += ["--poke", f"0x{a:04x}=0x{v:02x}@465:hold1000"]
    if start is not None:
        sx, sy = start
        c += ["--poke", f"0x6203=0x{sx:02x}@1601:hold2",
              "--poke", f"0x6205=0x{sy:02x}@1601:hold2"]
    return c


def diff(js, gd):
    """Rough-gate verdict over the window from frame 1600 on.

    Returns the verdict DICT. Never re-derive PASS from max_pct and frames_over: an empty
    window has 0 and 0, so a run that compared nothing would read clean."""
    d = pixel_gate.frame_diffs(js, gd, HW)
    return pixel_gate.rough_verdict(d, HW, from_frame=1600)


def bcd3(b0, b1, b2):
    """3-byte score decode, MSB-first packed BCD."""
    def d(x):
        return (x >> 4) * 10 + (x & 0xF)
    return d(b0) * 10000 + d(b1) * 100 + d(b2)


def read_frame(binpath, idx):
    with open(binpath, "rb") as fh:
        fh.seek(idx * SDS)
        return fh.read(SDS)


def slot_xty(frame, k):
    """(X, type, Y) of prize slot k. Prize table 0x6A0C -> state offset +0xA0C."""
    o = 0xA0C + k * 4
    return frame[o], frame[o + 1], frame[o + 3]


def score_at(frame):
    """3-byte BCD score at 0x60B2 -> state offset +0xB2."""
    return bcd3(frame[0xB2], frame[0xB3], frame[0xB4])


def verify_pickup(sbin, expect_val, prizeXY):
    """Isolate the TARGET prize's own award.

    The pickup is one atomic event: on the frame the target slot's X clears to
    0, the score jumps by exactly the level value. We must measure THAT jump,
    not the net score change over the whole hold -- Mario keeps walking after
    the pickup, and later, unrelated in-game events (e.g. a board-phase bonus)
    would otherwise inflate the delta and mask a correct pickup (this is exactly
    what happened on 100m_purse: purse = +800 at frame 1613, then an unrelated
    +100 ~40 frames later).

    Returns (ok, detail). ok = the target slot (matched by baseline X,Y) clears
    AND the score jump ACROSS that pickup frame == expect_val.
    """
    n = os.path.getsize(sbin) // SDS
    if n < 1650:
        return False, f"only {n} state frames"
    px, py = prizeXY
    base = read_frame(sbin, 1590)   # board settled, before the walk bites
    # Find the slot holding our target prize at baseline.
    target = None
    for k in range(16):
        x, t, y = slot_xty(base, k)
        if x == px and y == py:
            target = (k, t)
            break
    if target is None:
        return False, f"no prize slot at ({px:#x},{py:#x}) at frame 1590"
    k, ptype = target
    # Frame-by-frame from the walk start: find where THIS slot's X clears.
    pickup_f = None
    for i in range(1601, n):
        if slot_xty(read_frame(sbin, i), k)[0] == 0:
            pickup_f = i
            break
    if pickup_f is None:
        return False, (f"prize slot {k} (type {ptype:#x}) at ({px:#x},{py:#x}) "
                       f"never cleared -- pickup did not fire")
    # Score jump across the pickup (allow a few frames for the BCD write to
    # settle; the pickup event is atomic and any unrelated award is >30f away).
    before = score_at(read_frame(sbin, max(1590, pickup_f - 3)))
    after = score_at(read_frame(sbin, min(n - 1, pickup_f + 4)))
    dscore = after - before
    ok = dscore == expect_val
    detail = (f"pickup@frame {pickup_f}: slot {k} type={ptype:#x} "
              f"({px:#x},{py:#x}) cleared; score {before}->{after} (+{dscore}, "
              f"want +{expect_val})")
    return ok, detail


def main():
    keep = "--keep-frames" in sys.argv[1:]  # else each prize's raw dumps go once its verdict prints
    filt = [a for a in sys.argv[1:] if a != "--keep-frames"]
    tests = [t for t in TESTS if (not filt or any(f in t[0] for f in filt))]
    print(f"{'prize':14} {'emit':6} {'max%':>6} {'>5%':>4} {'pickup':>7} {'verdict'}")
    print("-" * 60)
    rows = []
    for name, b, start, prize, val, hold in tests:
        lp = lua(name, b, start, prize, hold)
        go = os.path.join(WORK, f"g_{name}")
        eo = os.path.join(WORK, f"e_{name}")
        so = os.path.join(WORK, f"s_{name}")
        with raw_dumps(go, eo, so, keep=keep):
            subprocess.run(
                ["python3", os.path.join(REPO, "tools", "mame_golden.py"),
                 "--rompath", os.path.join(ROOT, "rom"),
                 "--hardware", os.path.join(REPO, "boards", "dkong", "hardware.json"),
                 "--lua-dir", os.path.join(REPO, "games", "dkong", "tools", "lua"),
                 "--out", go, "--seconds", "30", "--tape", lp],
                capture_output=True, text=True, timeout=400)
            er = subprocess.run(emit_cmd(eo, so, b, start, prize, hold),
                                cwd=ROOT, capture_output=True, text=True)
            blob = (er.stdout + er.stderr).lower()
            gap = "not impl" in blob or "unmapped" in blob
            efr = os.path.join(eo, "frames.rgb")
            gfr = os.path.join(go, "frames.rgb")
            sbin = os.path.join(so, "state.bin")
            if gap or not (os.path.exists(efr) and os.path.exists(gfr)):
                tag = "GAP" if gap else "NO-FRAMES"
                print(f"{name:14} {tag:6} {'--':>6} {'--':>4} {'--':>7} {tag}")
                rows.append((name, None, None, None, None))
                continue
            r = diff(efr, gfr)
            mx, over = r["max_pct"], r["frames_over"]
            pu_ok, detail = verify_pickup(sbin, val, prize)
            pix_ok = r["verdict"] == pixel_gate.PASS
            verdict = "PASS" if (pix_ok and pu_ok) else (r["verdict"] if not pix_ok else "FAIL")
            print(f"{name:14} {'ran':6} {mx:6.2f} {over:4d} "
                  f"{('yes' if pu_ok else 'NO'):>7} {verdict}")
            print(f"               {detail}")
            rows.append((name, mx, over, pu_ok, verdict))
    print("-" * 60)
    npass = sum(1 for r in rows if r[4] == "PASS")
    print(f"{npass}/{len(rows)} PASS")
    return rows


if __name__ == "__main__":
    main()
