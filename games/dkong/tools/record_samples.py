#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Record Donkey Kong's sounds from YOUR MAME + YOUR ROM into local sample files.

WHY THIS TOOL EXISTS (the copyright position)
---------------------------------------------
arcade-js plays audio ABOVE the emulation (see core/audio.js): the board watches
the program's writes to its sound latches and a SamplePlayer plays a named
sample. That design needs samples -- and Donkey Kong's sounds are Nintendo's
copyrighted work, exactly like the sprites and the program ROM.

So we ship NONE of it. Same posture as the bring-your-own-ROM design already
used for `games/dkong/rom/`: the repository contains the *tooling*, you supply
the *content*. This script drives the MAME you already installed, against the
romset you already own, on your own machine, and writes the resulting audio to
a gitignored directory. Nothing copyrighted ever enters the repository.

WHY RECORD RATHER THAN EXTRACT
------------------------------
DK's sound is two different machines:

  * an I8035 sound CPU with its own sample/tune ROM data (the walk-in tune,
    death tune, "how high can you get" cue, ...), and
  * DISCRETE ANALOGUE CIRCUITS (jump, walk, hammer, ...) which have no sample
    data anywhere -- MAME synthesises them from a netlist.

There is nothing to "extract" for the second class. Recording MAME's mixed
audio output handles both classes uniformly, which is why this records.

WHAT THIS IS: A DISCOVERY SWEEP, NOT A SOUND MAP
------------------------------------------------
This tool does NOT assume which write means which sound. It sweeps the sound
hardware and records what each write actually produced:

  * `triggers` phase -- the ls259 at 6H, addresses 0x7D00..0x7D07. Writing to
    0x7D00+n sets latch bit n from the LSB of the data. Each bit is pulsed to 1,
    held, then cleared.
  * `latch` phase -- the ls175 sound latch at 0x7C00, which feeds the I8035.
    Each swept value is written, held, then cleared.
  * `irq` phase -- 0x7D80, the I8035's interrupt line. Pulsed like a trigger.
  * `latchtrig` phase (optional) -- a latch value followed by a pulse on one
    chosen trigger bit, for the case where the sound CPU only consumes the latch
    when it is poked.

Each slot is separated by a fixed, known silence gap, so the single recording
can be split back into per-slot clips by timing. Peak and RMS are reported for
every clip so it is obvious which writes made sound and which were silent. The
results are EVIDENCE for building a sound map; they are not the map.

TWO PASSES PER TUNE -- WHY, AND WHAT IT FIXES
---------------------------------------------
The `latch` and `irq` phases each run every value TWICE: a short PULSE pass
(`--hold`, the ROM's own 3-frame handshake rounded up) and a long SUSTAIN pass
(`--sustain-hold`). That is not redundancy, it is the only way to record a
looping tune correctly, and recording it wrong was a real, audible bug:

  The I8035 keeps playing only while the latch holds a background tune, and it
  RE-READS the latch when a tune ends. So a single short-hold pass gives you
  ~0.24 s of `bgm_25m` -- one fragment of a 2.29 s phrase -- and looping that
  fragment is what "the background music is missing notes" sounds like.

Measured, not assumed. The two passes let the tool CLASSIFY each value instead
of trusting a name:

  * GATED (the sound stops when the latch is released: pulse duration ~= the
    hold, and the sustain pass is many times longer) => the value selects a
    SUSTAINED tune. The clip written is one measured LOOP PERIOD of the sustain
    pass, found by normalised autocorrelation, so the file is a whole repeating
    phrase whose end joins its start.
  * NOT GATED (the sound outlasts the hold and finishes on its own) => the value
    fires a self-contained tune. The clip written is the PULSE pass, which is
    that tune played exactly once. Holding such a value simply replays it, so
    the sustain pass would record N repeats and is used only as evidence.

The classification is reported per clip in index.json (`gated`,
`pulse_duration_s`, `sustain_duration_s`, `loop_period_s`, `loop_corr`), so it
can be checked against -- and disagree with -- the hand-written sound map.

HOW THE ROM IS KEPT OUT OF THE WAY
----------------------------------
The machine must actually boot (the I8035 has to be alive), but a booted DK
writes its own attract-mode sounds, which would contaminate every clip. So write
taps on 0x7C00, 0x7D00-0x7D07 and 0x7D80 replace every program-originated write
with the value THIS tool is currently holding -- the ROM cannot touch the sound
hardware while the sweep runs. The gaps between slots being silent is the proof
that this works, and it is measured and reported (`--report-gaps`).

0x7D80 is in that default mute set because the ROM pulses it on every death,
including in attract mode, which lands inside a sweep slot sooner or later. It
is write-only from the Z80's side and a control run has shown that muting it
leaves the tune sweep byte-identical, so muting it cannot change anything else.

USAGE
-----
  games/dkong/tools/record_samples.py --rompath ~/Downloads
  games/dkong/tools/record_samples.py --phases triggers,latch,latchtrig \
      --latch-values 0x00-0x3f --gap 4.0 --out games/dkong/audio/samples
  games/dkong/tools/record_samples.py --dry-run     # show the schedule + argv
"""

import argparse
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
import wave

REPO = os.path.dirname(  # <repo>
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
)
sys.path.insert(0, os.path.join(REPO, "tools"))

import hardware  # noqa: E402

# The determinism-controlled MAME command line lives in ONE place. Reusing
# mame_golden.build_mame_argv means the recording runs under exactly the flags
# the pixel-golden captures run under (fresh nvram/cfg, -nocheat, -noautosave,
# -frameskip 0, -nothrottle, headless video), and any future fix there applies
# here for free. Importing it also installs the headless SDL_VIDEODRIVER=dummy
# that module sets at import time.
import mame_golden  # noqa: E402

# --- DK sound hardware addresses ------------------------------------------
# Mirrors boards/dkong/hardware.json "writeRanges": sound_latch / sound_trig.
SOUND_LATCH = 0x7C00  # ls175.3d -- the byte the I8035 sound CPU reads
TRIG_BASE = 0x7D00  # ls259.6h -- 0x7D00+n sets latch bit n from data bit 0
TRIG_COUNT = 8
AUDIO_IRQ = 0x7D80  # ls259.5h bit 0 -- the I8035's interrupt line (see io.js)

# What the ROM is prevented from writing while a sweep runs: the sound latch,
# the eight sound triggers, and the sound CPU's IRQ line. 0x7D80 shares its ls259
# with flipscreen/NMI-mask/DRQ, but only the ONE address 0x7D80 is muted and that
# address does nothing except assert the I8035's interrupt -- so the neighbours
# are untouched. It is in the default set because the ROM pulses it on every
# death (attract mode included), which would land inside a sweep slot.
# Everything muted here is write-only from the Z80's side, so muting cannot
# change what the program computes.
DEFAULT_MUTE = "0x7C00,0x7D00-0x7D07,0x7D80"

DEFAULT_OUT = os.path.join("games", "dkong", "audio", "samples")
DEFAULT_HARDWARE = os.path.join("boards", "dkong", "hardware.json")

# ---------------------------------------------------------------------------
# Sample-buffer helpers. numpy if present (it is, in this repo), stdlib if not:
# a BYO-ROM user should not need to install anything to record their own audio.
# ---------------------------------------------------------------------------
try:
    import numpy as _np
except ImportError:  # pragma: no cover -- exercised only on a numpy-less host
    _np = None


def _to_buf(raw):
    """Bytes of 16-bit LE PCM -> a mean-removed float sequence + its length."""
    if _np is not None:
        a = _np.frombuffer(raw, dtype="<i2").astype(_np.float64)
        return (a - a.mean()) if len(a) else a
    import array

    a = array.array("h")
    a.frombytes(raw)
    if not len(a):
        return a
    mean = sum(a) / len(a)
    return [v - mean for v in a]


def _peak_rms(buf):
    """(peak, rms) of a mean-removed buffer. Mean removal matters: MAME's
    discrete netlist carries a slowly-decaying DC offset after power-on, and a
    raw abs-max would read that offset as 'sound'."""
    if len(buf) == 0:
        return 0.0, 0.0
    if _np is not None:
        return float(_np.max(_np.abs(buf))), float(_np.sqrt(_np.mean(buf * buf)))
    peak = max(abs(v) for v in buf)
    rms = math.sqrt(sum(v * v for v in buf) / len(buf))
    return float(peak), float(rms)


def _trim(buf, threshold):
    """First/last index whose magnitude clears `threshold`; (None, None) if silent."""
    if len(buf) == 0:
        return None, None
    if _np is not None:
        hits = _np.flatnonzero(_np.abs(buf) >= threshold)
        if hits.size == 0:
            return None, None
        return int(hits[0]), int(hits[-1]) + 1
    first = last = None
    for i, v in enumerate(buf):
        if abs(v) >= threshold:
            if first is None:
                first = i
            last = i
    if first is None:
        return None, None
    return first, last + 1


# ---------------------------------------------------------------------------
# Schedule
# ---------------------------------------------------------------------------
def parse_values(spec):
    """'0x00-0x1f,0x40,0x80' -> [0,1,...,31,64,128]. Ranges are inclusive."""
    out = []
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part[1:]:  # not a leading minus
            lo, hi = part.split("-", 1)
            lo, hi = int(lo, 0), int(hi, 0)
            if hi < lo:
                raise ValueError(f"descending range {part!r}")
            out.extend(range(lo, hi + 1))
        else:
            out.append(int(part, 0))
    for v in out:
        if not 0 <= v <= 0xFF:
            raise ValueError(f"value {v} out of 0..255")
    return out


def parse_ranges(spec):
    """'0x7C00,0x7D00-0x7D07' -> [(0x7C00,0x7C00), (0x7D00,0x7D07)]."""
    out = []
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part[1:]:
            lo, hi = part.split("-", 1)
            lo, hi = int(lo, 0), int(hi, 0)
        else:
            lo = hi = int(part, 0)
        if hi < lo:
            raise ValueError(f"descending range {part!r}")
        out.append((lo, hi))
    return out


def parse_writes(spec):
    """'0x7D80=0,0x7D06=1' -> [(0x7D80, 0), (0x7D06, 1)]."""
    out = []
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if "=" not in part:
            raise ValueError(f"{part!r} is not ADDR=VALUE")
        a, v = part.split("=", 1)
        out.append((int(a, 0), int(v, 0) & 0xFF))
    return out


# A slot id is a filename stem, so the sustain pass needs a suffix that cannot
# collide with a real clip id. It never reaches disk: the sustain pass is merged
# into its key's single output clip.
SUSTAIN_SUFFIX = "~sustain"

# How much a pulse-pass clip may outlast its hold and still count as "the sound
# stopped when the line was released". It is a release tail, not a tune: the
# widest one measured on this board is trigger 4's ~1.4 s decay, and no LATCH
# value has ever come within 0.15 s of this margin from either side, so the
# classification is not living on a knife edge.
GATED_MARGIN_S = 0.25
# ...and how many times longer the sustain pass must be before we believe the
# hold is what kept it sounding.
SUSTAIN_RATIO = 3.0


def build_schedule(args):
    """The slot list. Each slot: id, key, pass, kind, hold, gap, and writes.

    `key` is the thing being measured (`trig3`, `latch_08`, `irq`) and is the
    name of the ONE clip file it produces. `pass` is "single", "pulse" or
    "sustain"; a key with a pulse AND a sustain pass is resolved into one clip by
    resolve_passes(). `dt` in `writes` is seconds from the slot's own start, and
    each slot owns its `gap`, so a long sustain pass does not force every other
    slot to be equally long.
    """
    slots = []
    hold, gap = args.hold, args.gap
    shold, sgap = args.sustain_hold, args.sustain_gap

    def pair(key, kind, addr, value, on, off):
        """A pulse slot and a sustain slot for the same write. See the module
        docstring: one pass alone cannot tell a self-contained tune from a
        sustained one, and guessing produced the looping-fragment bug."""
        return [
            {"id": key, "key": key, "pass": "pulse", "kind": kind, "addr": addr,
             "value": value, "hold": hold, "gap": gap,
             "writes": [(0.0, addr, on), (hold, addr, off)]},
            {"id": key + SUSTAIN_SUFFIX, "key": key, "pass": "sustain", "kind": kind,
             "addr": addr, "value": value, "hold": shold, "gap": sgap,
             "writes": [(0.0, addr, on), (shold, addr, off)]},
        ]

    for phase in args.phases:
        if phase == "triggers":
            # SINGLE pass on purpose: these six lines are analogue circuits whose
            # LEVEL behaviour is already characterised (see audio/README.md), and
            # the ROM only ever holds them for 3 frames, so the short pass is the
            # sound. A sustain pass here would record a 12 s drone nothing plays.
            for bit in range(TRIG_COUNT):
                slots.append(
                    {
                        "id": f"trig{bit}",
                        "key": f"trig{bit}",
                        "pass": "single",
                        "kind": "trigger",
                        "addr": TRIG_BASE + bit,
                        "value": 1,
                        "hold": hold,
                        "gap": gap,
                        "writes": [
                            (0.0, TRIG_BASE + bit, 1),
                            (hold, TRIG_BASE + bit, 0),
                        ],
                    }
                )
        elif phase == "latch":
            for v in args.latch_values:
                slots += pair(f"latch_{v:02x}", "latch", SOUND_LATCH, v, v, 0)
        elif phase == "irq":
            slots += pair("irq", "irq", AUDIO_IRQ, 1, 1, 0)
        elif phase == "latchtrig":
            b = args.trigger_bit
            for v in args.latch_values:
                slots.append(
                    {
                        "id": f"latch_{v:02x}_trig{b}",
                        "key": f"latch_{v:02x}_trig{b}",
                        "pass": "single",
                        "kind": "latchtrig",
                        "addr": SOUND_LATCH,
                        "value": v,
                        "hold": hold,
                        "gap": gap,
                        "writes": [
                            (0.0, SOUND_LATCH, v),
                            (min(0.02, hold / 2), TRIG_BASE + b, 1),
                            (hold, TRIG_BASE + b, 0),
                            (hold, SOUND_LATCH, 0),
                        ],
                    }
                )
        else:  # unreachable: argparse validates
            raise ValueError(f"unknown phase {phase!r}")
    return slots


LUA_TEMPLATE = """\
-- SPDX-License-Identifier: GPL-3.0-only
-- GENERATED by games/dkong/tools/record_samples.py -- do not edit.
--
-- Drives DK's sound hardware on a fixed schedule and logs the ACTUAL emulated
-- time of every slot, so the recorded wav is split by measured timestamps
-- rather than by assumed ones.

local sp = manager.machine.devices[":maincpu"].spaces["program"]
local out = assert(io.open(os.getenv("SCHEDULE_OUT"), "w"))
out:setvbuf("no")   -- MAME exits without running a Lua stop hook; see dump_state.lua

-- What we are currently holding on each sound address. ROM writes are replaced
-- with this, so the program cannot touch the sound hardware during the sweep.
_G.__hold = {}
_G.__inject = false
_G.__blocked = 0
_G.__taps = {}

local function mute(lo, hi, name)
  -- Retain the tap: MAME unsubscribes taps on garbage collection, which would
  -- silently un-mute the ROM partway through (see dump_state.lua landmine 1).
  _G.__taps[#_G.__taps + 1] = sp:install_write_tap(lo, hi, name,
    function(offset, data, mask)
      if _G.__inject then return data end
      _G.__blocked = _G.__blocked + 1
      return _G.__hold[offset] or 0
    end)
end
%(mutes)s

local function W(addr, val)
  _G.__hold[addr] = val
  _G.__inject = true
  sp:write_u8(addr, val)
  _G.__inject = false
end

-- frame -> { {addr, val}, ... }
local ACTS = %(acts)s
-- frame -> slot id (the clip boundary)
local MARKS = %(marks)s

local BASELINE_FRAME = %(baseline_frame)d
local END_FRAME = %(end_frame)d

local frame = 0
_G.__sub = emu.add_machine_frame_notifier(function()
  frame = frame + 1
  local t = manager.machine.time:as_double()
  if frame == BASELINE_FRAME then
    out:write(string.format("baseline %%.6f\\n", t))
  end
  local m = MARKS[frame]
  if m then out:write(string.format("slot %%s %%.6f\\n", m, t)) end
  local a = ACTS[frame]
  if a then
    for _, w in ipairs(a) do W(w[1], w[2]) end
  end
  if frame == END_FRAME then
    out:write(string.format("end %%.6f\\n", t))
    out:write(string.format("blocked %%d\\n", _G.__blocked))
  end
end)
"""


def lua_table(mapping, fmt):
    """Render a dict as a Lua table literal with integer keys."""
    items = ", ".join(f"[{k}] = {fmt(v)}" for k, v in sorted(mapping.items()))
    return "{ " + items + " }"


def generate_lua(args, hw, slots):
    """Render the autoboot script + return (lua_text, slot_frames, end_frame)."""
    fps = hw.refresh_hz
    boot_frames = max(1, int(round(args.boot * fps)))

    acts = {}
    marks = {}
    slot_frames = []
    start = boot_frames
    for slot in slots:
        slot_frames.append(start)
        marks[start] = slot["id"]
        for dt, addr, val in slot["writes"]:
            f = start + int(round(dt * fps))
            acts.setdefault(f, []).append((addr, val))
        start += max(1, int(round(slot["gap"] * fps)))

    end_frame = start
    # One frame before the first slot: the noise floor is measured over the
    # second leading up to it, which is why boot must be >= 1s.
    baseline_frame = max(1, boot_frames - int(round(1.0 * fps)))

    # Pre-writes land half a second before the first slot: after the machine has
    # booted and settled, before anything is measured. Because they go through
    # the same hold table, a muted address STAYS at the pre-write value for the
    # whole sweep -- that is what makes "hold trigger bit 6 high and re-sweep"
    # a thing you can actually do.
    if args.pre_writes:
        pf = max(1, boot_frames - int(round(0.5 * fps)))
        for addr, val in args.pre_writes:
            acts.setdefault(pf, []).append((addr, val))

    mutes = "\n".join(
        f'mute(0x{lo:04X}, 0x{hi:04X}, "mute_{i}")'
        for i, (lo, hi) in enumerate(args.mute_ranges)
    ) or "-- (muting disabled: the program drives the sound hardware too)"

    text = LUA_TEMPLATE % {
        "mutes": mutes,
        "acts": lua_table(
            acts,
            lambda ws: "{ " + ", ".join(f"{{0x{a:04X}, 0x{v:02X}}}" for a, v in ws) + " }",
        ),
        "marks": lua_table(marks, lambda s: f'"{s}"'),
        "baseline_frame": baseline_frame,
        "end_frame": end_frame,
    }
    return text, slot_frames, end_frame


def parse_schedule_log(path):
    """Read the Lua log back: measured slot times, baseline, end, blocked count."""
    slots, baseline, end_t, blocked = [], None, None, None
    with open(path) as fh:
        for line in fh:
            f = line.split()
            if not f:
                continue
            if f[0] == "slot":
                slots.append((f[1], float(f[2])))
            elif f[0] == "baseline":
                baseline = float(f[1])
            elif f[0] == "end":
                end_t = float(f[1])
            elif f[0] == "blocked":
                blocked = int(f[1])
    return slots, baseline, end_t, blocked


# ---------------------------------------------------------------------------
# Loop-period measurement
# ---------------------------------------------------------------------------
def loop_period(buf, rate, min_period_s, max_period_s, min_corr):
    """Length, in samples, of the repeating phrase in a SUSTAINED recording.

    Normalised autocorrelation: for each candidate lag L, correlate the signal
    with itself shifted by L and divide by the energy of the two overlapping
    halves, so a lag near the end of the buffer is not penalised for having less
    overlap. The fundamental period is the lag that maximises it.

    Two things this deliberately does NOT do:

      * It does not take the smallest strong peak. A musical phrase has strong
        peaks at note spacings too, and the smallest of those is one note, not
        the phrase -- looping it is the very bug this measurement exists to fix.
      * It does not accept the peak blindly. If a whole multiple of the answer
        scores as well, the answer may be a multiple of the true period, so the
        sub-multiples L/2..L/5 are checked and the smallest that correlates
        essentially as well wins.

    @returns (period_samples, correlation) or (None, None) if nothing repeats
             convincingly, which is a result, not a failure -- the caller keeps
             the whole recording and says so.
    """
    if _np is None or len(buf) < 4:
        return None, None
    a = _np.asarray(buf, dtype=_np.float64)
    n = len(a)
    lo = max(1, int(min_period_s * rate))
    hi = min(n // 2, int(max_period_s * rate) if max_period_s else n // 2)
    if hi <= lo:
        return None, None

    nfft = 1 << int(math.ceil(math.log2(2 * n)))
    spec = _np.fft.rfft(a, nfft)
    ac = _np.fft.irfft(spec * _np.conj(spec), nfft)[: hi + 1]
    cum = _np.concatenate(([0.0], _np.cumsum(a * a)))
    lags = _np.arange(lo, hi + 1)
    # energy of a[0:n-L] times energy of a[L:n] -- the two windows being compared
    norm = _np.sqrt(_np.maximum((cum[n - lags] - cum[0]) * (cum[n] - cum[lags]), 1e-9))
    nac = ac[lo : hi + 1] / norm

    best = int(_np.argmax(nac))
    period, corr = int(lags[best]), float(nac[best])
    for d in (2, 3, 4, 5):
        sub = period // d
        if sub < lo:
            break
        c = float(nac[sub - lo])
        if c >= corr - 0.02:  # the shorter period explains the signal just as well
            period, corr = sub, c
            break
    if corr < min_corr:
        return None, None
    return period, corr


# ---------------------------------------------------------------------------
# Splitting
# ---------------------------------------------------------------------------
def analyse_slots(wav_path, marks, baseline_t, end_t, args):
    """Slice the recording per slot and measure each. Writes nothing.

    Returns (rows, meta). A row carries the trimmed PCM bytes so resolve_passes()
    can decide, per key, which pass becomes the clip on disk.
    """
    with wave.open(wav_path, "rb") as w:
        channels, sampwidth, rate = w.getnchannels(), w.getsampwidth(), w.getframerate()
        nframes = w.getnframes()
        raw = w.readframes(nframes)
    if sampwidth != 2:
        raise RuntimeError(f"{wav_path}: expected 16-bit PCM, got {sampwidth*8}-bit")

    bpf = channels * sampwidth  # bytes per audio frame

    def cut(t0, t1):
        i0 = max(0, min(nframes, int(round(t0 * rate))))
        i1 = max(i0, min(nframes, int(round(t1 * rate))))
        return raw[i0 * bpf : i1 * bpf], i0, i1

    # Noise floor, measured on this very recording rather than assumed: the 1s
    # of settled silence immediately before the first slot.
    base_raw, _, _ = cut(baseline_t, marks[0][1]) if marks else (b"", 0, 0)
    base_peak, base_rms = _peak_rms(_to_buf(base_raw))
    threshold = max(float(args.min_peak), base_peak * args.noise_margin)

    rows = []
    for i, (sid, t0) in enumerate(marks):
        t1 = marks[i + 1][1] if i + 1 < len(marks) else end_t
        seg, _, _ = cut(t0, t1)
        buf = _to_buf(seg)
        peak, rms = _peak_rms(buf)
        a, b = _trim(buf, threshold)
        row = {
            "id": sid,
            "slot_start_s": round(t0, 6),
            "slot_end_s": round(t1, 6),
            "peak": round(peak, 1),
            "rms": round(rms, 1),
            "silent": a is None,
            "duration_s": 0.0,
            "clipped_at_slot_end": False,
            "_pcm": b"",
            "_buf": None,
        }
        if a is not None:
            pad = int(round(args.pad * rate))
            a = max(0, a - pad)
            b = min(len(buf), b + pad)
            row["_pcm"] = seg[a * bpf : b * bpf]
            row["_buf"] = buf[a:b]
            row["duration_s"] = round((b - a) / rate, 4)
            # A clip that is still loud at the very end of its slot was cut off
            # by the next trigger -- honest flag, not a silent truncation.
            row["clipped_at_slot_end"] = b >= len(buf) - int(round(0.02 * rate))
        rows.append(row)

    meta = {
        "sample_rate": rate,
        "channels": channels,
        "sample_width_bytes": sampwidth,
        "baseline_peak": round(base_peak, 1),
        "baseline_rms": round(base_rms, 1),
        "silence_threshold": round(threshold, 1),
        "recording_seconds": round(nframes / rate, 3),
    }
    return rows, meta


def resolve_passes(rows, slots, meta, args, out_dir):
    """Turn per-slot measurements into one clip per key, and write the files.

    This is where the pulse pass and the sustain pass are compared. The rule, and
    the reason it is a MEASUREMENT rather than a lookup in the sound map:

      gated  <=>  the pulse pass stopped when the latch was released
                  (its duration is within GATED_MARGIN_S of the hold)
             and  the sustain pass ran far longer than the pulse pass
                  (SUSTAIN_RATIO x), i.e. holding really does keep it sounding.

      gated      -> the clip is ONE LOOP PERIOD of the sustain pass: a whole
                    repeating phrase, ending where it began.
      not gated  -> the clip is the PULSE pass: the tune, played once, exactly as
                    the ROM's 3-frame handshake fires it.

    Returns the report rows, one per key, in schedule order.
    """
    rate = meta["sample_rate"]
    bpf = meta["channels"] * meta["sample_width_bytes"]
    by_id = {r["id"]: r for r in rows}
    os.makedirs(out_dir, exist_ok=True)

    out = []
    seen = set()
    for slot in slots:
        key = slot["key"]
        if key in seen:
            continue
        seen.add(key)
        pulse = by_id.get(key)
        sustain = by_id.get(key + SUSTAIN_SUFFIX)
        if pulse is None:
            continue  # capture cut short; the missing-slot problem is reported

        row = {
            "id": key,
            "kind": slot["kind"],
            "slot_start_s": pulse["slot_start_s"],
            "slot_end_s": pulse["slot_end_s"],
            "peak": pulse["peak"],
            "rms": pulse["rms"],
            "silent": pulse["silent"],
            "file": None,
            "duration_s": 0.0,
            "clipped_at_slot_end": pulse["clipped_at_slot_end"],
            "pulse_hold_s": slot["hold"],
            "pulse_duration_s": pulse["duration_s"],
            "sustain_hold_s": None,
            "sustain_duration_s": None,
            "gated": None,
            "loop": False,
            "loop_period_s": None,
            "loop_corr": None,
        }

        src, buf = pulse["_pcm"], pulse["_buf"]
        if sustain is not None:
            row["sustain_hold_s"] = args.sustain_hold
            row["sustain_duration_s"] = sustain["duration_s"]
            # `peak` is the loudest sample this WRITE produced, over both passes;
            # `rms` (set below) is measured on the clip that was actually
            # written. For a sustained tune those describe the same waveform --
            # a repeating phrase peaks the same in every repeat.
            row["peak"] = max(row["peak"], sustain["peak"])
            gated = (
                not pulse["silent"]
                and not sustain["silent"]
                and pulse["duration_s"] <= slot["hold"] + GATED_MARGIN_S
                and sustain["duration_s"] >= SUSTAIN_RATIO * max(pulse["duration_s"], 1e-6)
            )
            row["gated"] = gated
            if gated:
                # Only the HELD part of the sustain pass is a phrase; the release
                # tail after it is not, and letting it into the search would bias
                # the period. Search up to a QUARTER of it, so whatever comes back
                # was seen at least four times -- a longer cap lets a one-off
                # coincidence near the end of the buffer win, which is exactly how
                # tune 0x0B's phrase was mis-measured at a 12s hold.
                held = int(min(len(sustain["_buf"]), args.sustain_hold * rate))
                region = sustain["_buf"][:held]
                period, corr = loop_period(
                    region, rate, args.min_period, args.sustain_hold / 4.0, args.loop_corr
                )
                row["loop"] = True
                if period:
                    row["loop_period_s"] = round(period / rate, 4)
                    row["loop_corr"] = round(corr, 4)
                    src = sustain["_pcm"][: period * bpf]
                    buf = region[:period]
                else:
                    # No convincing period: keep the whole sustained recording
                    # rather than inventing a loop point. Says so in index.json.
                    src, buf = sustain["_pcm"][: held * bpf], region

        if src:
            name = f"{key}.wav"
            with wave.open(os.path.join(out_dir, name), "wb") as ow:
                ow.setnchannels(meta["channels"])
                ow.setsampwidth(meta["sample_width_bytes"])
                ow.setframerate(rate)
                ow.writeframes(src)
            row["file"] = name
            row["duration_s"] = round(len(src) // bpf / rate, 4)
            if buf is not None and len(buf):
                row["rms"] = round(_peak_rms(buf)[1], 1)
        out.append(row)
    return out


GAP_TAIL_S = 0.25


def gap_report(wav_path, marks, end_t):
    """Peak in the last GAP_TAIL_S of each slot -- two proofs in one number.

    It must be at the noise floor. If it is not, either the ROM is still driving
    the sound hardware (muting failed) or the slot's own sound is still playing
    when the next slot starts (--gap too short, so the next clip is polluted).
    """
    with wave.open(wav_path, "rb") as w:
        rate, channels, sampwidth = w.getframerate(), w.getnchannels(), w.getsampwidth()
        nframes = w.getnframes()
        raw = w.readframes(nframes)
    bpf = channels * sampwidth
    out = []
    for i, (sid, t0) in enumerate(marks):
        t1 = marks[i + 1][1] if i + 1 < len(marks) else end_t
        ts = max(t0, t1 - GAP_TAIL_S)
        i0 = max(0, min(nframes, int(round(ts * rate))))
        i1 = max(i0, min(nframes, int(round(t1 * rate))))
        peak, rms = _peak_rms(_to_buf(raw[i0 * bpf : i1 * bpf]))
        out.append((sid, peak, rms))
    return out


# ---------------------------------------------------------------------------
def main():
    p = argparse.ArgumentParser(
        prog="record_samples.py",
        description=(
            "Record Donkey Kong's sounds from YOUR MAME + YOUR ROM into local, "
            "gitignored sample files."
        ),
        epilog=(
            "COPYRIGHT / BRING-YOUR-OWN-ROM\n"
            "  Donkey Kong's audio is Nintendo's copyrighted work, exactly like its\n"
            "  sprites and program ROM. arcade-js therefore ships NO Donkey Kong audio.\n"
            "  This script drives the MAME you installed against the romset you own and\n"
            "  writes the result to a gitignored directory on your machine. Do not commit\n"
            "  or redistribute anything it produces.\n"
            "\n"
            "WHAT IT DOES\n"
            "  Boots DK headless under the project's determinism flags, mutes the ROM's\n"
            "  own writes to the sound hardware, then sweeps the sound triggers\n"
            "  (ls259.6h at 0x7D00-0x7D07, one latch bit per address) and the sound latch\n"
            "  (ls175.3d at 0x7C00, read by the I8035 sound CPU), leaving a fixed silence\n"
            "  gap between each. The single -wavwrite recording is then split back into\n"
            "  one clip per write, trimmed, and reported with peak/RMS amplitude.\n"
            "\n"
            "  This is a DISCOVERY SWEEP: it does not assume which value means which\n"
            "  sound. It records what each write actually produced, as evidence for\n"
            "  building the trigger map in games/dkong/audio/.\n"
            "\n"
            "  Recording (rather than extracting) is required because half of DK's sound\n"
            "  is discrete analogue circuitry that MAME synthesises from a netlist -- it\n"
            "  has no sample data to extract at all.\n"
            "\n"
            "EXAMPLES\n"
            "  record_samples.py --rompath ~/Downloads\n"
            "  record_samples.py --phases triggers,latch --latch-values 0x00-0x3f\n"
            "  record_samples.py --dry-run          # print the schedule + MAME argv\n"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument(
        "--hardware",
        default=os.path.join(REPO, DEFAULT_HARDWARE),
        metavar="PATH",
        help="board hardware.json (default: %(default)s)",
    )
    p.add_argument(
        "--out",
        default=os.path.join(REPO, DEFAULT_OUT),
        metavar="DIR",
        help="output directory for clips (gitignored; default: %(default)s)",
    )
    p.add_argument("--mame", default="mame", help="MAME binary (default: %(default)s)")
    p.add_argument(
        "--rompath",
        default=os.path.expanduser("~/Downloads"),
        help="MAME rompath holding YOUR dkong romset (default: %(default)s)",
    )
    p.add_argument(
        "--phases",
        default="triggers,latch,irq",
        help="comma list of triggers,latch,irq,latchtrig (default: %(default)s)",
    )
    p.add_argument(
        "--latch-values",
        default="0x00-0x1f",
        metavar="SPEC",
        help="sound-latch values to sweep, e.g. '0x00-0x1f,0x40' (default: %(default)s)",
    )
    p.add_argument(
        "--trigger-bit",
        type=int,
        default=5,
        help="trigger bit pulsed by the latchtrig phase (default: %(default)s)",
    )
    p.add_argument(
        "--gap",
        type=float,
        default=8.0,
        help="seconds between slot starts; also the maximum clip length. 8s is "
        "measured, not guessed: DK's longest sound-CPU tune runs ~6.9s, and a "
        "shorter gap silently truncates it (default: %(default)s)",
    )
    p.add_argument(
        "--hold",
        type=float,
        default=0.25,
        help="seconds a value is held in the PULSE pass before clearing. Models the "
        "ROM's own 3-frame (~0.05s) handshake, rounded up (default: %(default)s)",
    )
    p.add_argument(
        "--sustain-hold",
        type=float,
        default=24.0,
        help="seconds a latch/irq value is held in the SUSTAIN pass. The phrase search "
        "will not return a period longer than a quarter of this, so the answer is "
        "always something seen at least four times. MEASURED, not guessed: DK's "
        "longest repeating phrase is 4.92s (tune 0x03) and at a 12s hold the estimate "
        "for tune 0x0B was still unstable, so 24s is the first value that pinned every "
        "tune on this board (default: %(default)s)",
    )
    p.add_argument(
        "--sustain-gap",
        type=float,
        default=32.0,
        help="seconds between sustain-pass slot starts; must exceed --sustain-hold "
        "plus the longest release tail (default: %(default)s)",
    )
    p.add_argument(
        "--min-period",
        type=float,
        default=0.2,
        help="shortest loop period the phrase search will consider, seconds "
        "(default: %(default)s)",
    )
    p.add_argument(
        "--loop-corr",
        type=float,
        default=0.8,
        help="minimum normalised autocorrelation before a loop period is believed; "
        "below it the whole sustained recording is kept uncut (default: %(default)s)",
    )
    p.add_argument(
        "--boot",
        type=float,
        default=6.0,
        help="seconds to let the machine boot and settle first (default: %(default)s)",
    )
    p.add_argument(
        "--samplerate", type=int, default=48000, help="MAME -samplerate (default: %(default)s)"
    )
    p.add_argument(
        "--min-peak",
        type=float,
        default=64.0,
        help="absolute silence threshold, 16-bit units (default: %(default)s)",
    )
    p.add_argument(
        "--noise-margin",
        type=float,
        default=8.0,
        help="threshold is also >= this x the measured noise floor (default: %(default)s)",
    )
    p.add_argument(
        "--pad", type=float, default=0.01, help="seconds of pad kept around a trimmed clip"
    )
    p.add_argument(
        "--mute-ranges",
        default=DEFAULT_MUTE,
        metavar="SPEC",
        help="address ranges the program is prevented from writing during the sweep, "
        "e.g. '0x7C00,0x7D00-0x7D07,0x7D80' (default: %(default)s). Empty string "
        "lets the ROM drive the sound hardware too, which contaminates every clip.",
    )
    p.add_argument(
        "--pre-writes",
        default="",
        metavar="SPEC",
        help="ADDR=VALUE writes applied once after boot and HELD for the whole "
        "sweep, e.g. '0x7D06=1' to test whether a trigger bit is a mode/page "
        "select rather than a sound",
    )
    p.add_argument("--keep-wav", action="store_true", help="keep the full session wav")
    p.add_argument(
        "--report-gaps",
        action="store_true",
        help="print the residual level at the end of every slot (the muting proof)",
    )
    p.add_argument("--dry-run", action="store_true", help="print the plan and exit")
    args = p.parse_args()

    args.phases = [s.strip() for s in args.phases.split(",") if s.strip()]
    for ph in args.phases:
        if ph not in ("triggers", "latch", "irq", "latchtrig"):
            p.error(f"unknown phase {ph!r} (want triggers, latch, irq or latchtrig)")
    if not args.phases:
        p.error("--phases selected nothing")
    try:
        args.latch_values = parse_values(args.latch_values)
    except ValueError as exc:
        p.error(f"--latch-values: {exc}")
    try:
        args.mute_ranges = parse_ranges(args.mute_ranges)
    except ValueError as exc:
        p.error(f"--mute-ranges: {exc}")
    try:
        args.pre_writes = parse_writes(args.pre_writes)
    except ValueError as exc:
        p.error(f"--pre-writes: {exc}")
    if not 0 <= args.trigger_bit < TRIG_COUNT:
        p.error(f"--trigger-bit must be 0..{TRIG_COUNT - 1}")
    if args.gap <= args.hold + 0.1:
        p.error("--gap must exceed --hold by at least 0.1s or slots would overlap")
    if args.sustain_gap <= args.sustain_hold + 0.1:
        p.error("--sustain-gap must exceed --sustain-hold by at least 0.1s or the "
                "sustain slots would overlap")
    if args.sustain_hold <= args.hold + GATED_MARGIN_S:
        p.error(f"--sustain-hold must exceed --hold by more than {GATED_MARGIN_S}s: "
                "the two passes have to be distinguishable to classify anything")
    if args.boot < 1.5:
        p.error("--boot must be >= 1.5s: the noise floor is measured in the second "
                "before the first slot, and MAME's discrete netlist needs to settle")

    hw = hardware.load_from_args(args)
    slots = build_schedule(args)
    if not slots:
        p.error("schedule is empty")

    lua_text, slot_frames, end_frame = generate_lua(args, hw, slots)
    total_s = end_frame / hw.refresh_hz
    seconds = int(math.ceil(total_s)) + 1  # -seconds_to_run truncates

    workdir = tempfile.mkdtemp(prefix="record_samples_")
    os.makedirs(os.path.join(workdir, "nvram"), exist_ok=True)
    os.makedirs(os.path.join(workdir, "cfg"), exist_ok=True)
    lua_path = os.path.join(workdir, "sweep.lua")
    wav_path = os.path.join(workdir, "session.wav")
    sched_path = os.path.join(workdir, "schedule.txt")

    try:
        with open(lua_path, "w") as fh:
            fh.write(lua_text)

        # Reuse the golden harness's determinism-controlled argv verbatim, then
        # add the audio recording on top. no_frames=True drops -aviwrite; the
        # generated sweep script rides in on the -autoboot_script slot.
        ns = argparse.Namespace(
            mame=args.mame,
            rompath=args.rompath,
            seconds=seconds,
            no_frames=True,
            tape=None,
            writes=False,
            at_pc=None,
            playback=None,
            record=None,
            lua_state=lua_path,
            lua_at_pc=None,
            lua_writes=None,
        )
        argv = mame_golden.build_mame_argv(ns, hw, workdir)
        argv += ["-wavwrite", wav_path, "-samplerate", str(args.samplerate)]

        n_sus = sum(1 for s in slots if s["pass"] == "sustain")
        print(f"[plan  ] {len(slots)} slots ({n_sus} sustain), gap {args.gap}s / "
              f"{args.sustain_gap}s, hold {args.hold}s / {args.sustain_hold}s, "
              f"boot {args.boot}s -> {total_s:.1f}s emulated ({seconds}s -seconds_to_run)")
        print(f"[plan  ] phases: {','.join(args.phases)}")
        if args.dry_run:
            print("[dry   ] " + " ".join(argv))
            print("[dry   ] muted: "
                  + (", ".join(f"0x{lo:04X}-0x{hi:04X}" for lo, hi in args.mute_ranges)
                     or "(nothing -- the ROM will contaminate every clip)"))
            if args.pre_writes:
                print("[dry   ] held for the whole sweep: "
                      + ", ".join(f"0x{a:04X}=0x{v:02X}" for a, v in args.pre_writes))
            print("[dry   ] schedule:")
            for slot, f in zip(slots, slot_frames):
                print(f"          frame {f:6d}  {slot['id']:<22} "
                      + " ".join(f"+{dt:.2f}s {a:04X}={v:02X}" for dt, a, v in slot["writes"]))
            return 0

        env = dict(os.environ)
        env["SCHEDULE_OUT"] = sched_path
        print("[record] " + " ".join(argv))
        res = subprocess.run(argv, env=env, capture_output=True, text=True)
        if res.returncode != 0:
            sys.stderr.write(res.stdout + res.stderr)
            raise RuntimeError(f"MAME exited {res.returncode}")

        if not os.path.exists(wav_path):
            raise RuntimeError(
                f"MAME produced no wav at {wav_path} -- this build may not support "
                f"-wavwrite, or the path was rejected"
            )
        if not os.path.exists(sched_path):
            raise RuntimeError(
                f"the sweep script produced no schedule log at {sched_path} -- the "
                f"autoboot script did not run"
            )

        marks, baseline_t, end_t, blocked = parse_schedule_log(sched_path)
        problems = []
        if len(marks) != len(slots):
            problems.append(
                f"only {len(marks)} of {len(slots)} slots ran -- the capture was cut "
                f"short, so the missing slots are UNTESTED, not silent"
            )
        if end_t is None:
            end_t = marks[-1][1] + args.gap if marks else 0.0
            problems.append("no end marker: the run ended before the last slot closed")
        if baseline_t is None:
            problems.append("no baseline marker: the noise floor could not be measured")
            baseline_t = marks[0][1] - 1.0 if marks else 0.0
        if not marks:
            raise RuntimeError("no slots were recorded; nothing to split")

        out_dir = args.out
        slot_rows, meta = analyse_slots(wav_path, marks, baseline_t, end_t, args)
        rows = resolve_passes(slot_rows, slots, meta, args, out_dir)
        for r in rows:
            if r["gated"] and r["loop_period_s"] is None:
                problems.append(
                    f"{r['id']} sustains but no repeating phrase was found in it -- the "
                    f"whole {r['duration_s']}s recording was kept uncut, so looping it "
                    f"will seam. Try a longer --sustain-hold or a lower --loop-corr"
                )

        meta.update(
            {
                "generated_by": "games/dkong/tools/record_samples.py",
                "note": "DERIVED FROM YOUR OWN ROM -- copyrighted, never commit",
                "mame_argv": argv,
                "phases": args.phases,
                "gap_s": args.gap,
                "hold_s": args.hold,
                "sustain_hold_s": args.sustain_hold,
                "sustain_gap_s": args.sustain_gap,
                "min_period_s": args.min_period,
                "loop_corr_min": args.loop_corr,
                "boot_s": args.boot,
                "mute_ranges": [f"0x{lo:04X}-0x{hi:04X}" for lo, hi in args.mute_ranges],
                "pre_writes": [f"0x{a:04X}=0x{v:02X}" for a, v in args.pre_writes],
                "rom_sound_writes_blocked": blocked,
                "clips": rows,
            }
        )
        with open(os.path.join(out_dir, "index.json"), "w") as fh:
            json.dump(meta, fh, indent=1)
            fh.write("\n")

        # ---- report -------------------------------------------------------
        print(f"[audio ] {meta['recording_seconds']}s @ {meta['sample_rate']}Hz "
              f"{meta['channels']}ch/{meta['sample_width_bytes']*8}-bit")
        print(f"[floor ] noise floor peak={meta['baseline_peak']} "
              f"rms={meta['baseline_rms']} -> silence threshold {meta['silence_threshold']}")
        if blocked is not None:
            print(f"[mute  ] {blocked} program writes to the sound hardware suppressed")
        print()
        print(f"  {'slot':<12} {'peak':>7} {'pulse':>8} {'sustain':>8} {'kept':>8} "
              f"{'period':>8} {'r':>6}  result")
        print("  " + "-" * 78)
        sounded = 0
        for r in rows:
            if r["silent"]:
                verdict = "SILENT"
            else:
                sounded += 1
                verdict = r["file"] + (" (CUT OFF at slot end)" if r["clipped_at_slot_end"] else "")
                if r["gated"]:
                    verdict = "LOOP  " + verdict
            fmt = lambda v: "-" if v is None else f"{v:.3f}s"  # noqa: E731
            print(f"  {r['id']:<12} {r['peak']:>7.0f} {fmt(r['pulse_duration_s']):>8} "
                  f"{fmt(r['sustain_duration_s']):>8} {fmt(r['duration_s']):>8} "
                  f"{fmt(r['loop_period_s']):>8} "
                  f"{'-' if r['loop_corr'] is None else format(r['loop_corr'], '.3f'):>6}  "
                  f"{verdict}")
        print()
        looped = sum(1 for r in rows if r["loop"])
        print(f"[result] {sounded}/{len(rows)} writes produced sound; "
              f"{len(rows) - sounded} silent; {looped} classified SUSTAINED and cut to "
              f"one phrase -> {out_dir}")

        if args.report_gaps:
            print()
            print(f"  residual in the last {GAP_TAIL_S}s of each slot "
                  f"(must be at the floor: proves muting worked AND --gap is long enough)")
            unsettled = 0
            for sid, peak, rms in gap_report(wav_path, marks, end_t):
                bad = peak > meta["silence_threshold"]
                unsettled += bad
                print(f"  {sid:<24} peak={peak:>8.0f} rms={rms:>8.1f}"
                      + ("  <-- STILL SOUNDING, next clip is polluted" if bad else ""))
            if unsettled:
                problems.append(
                    f"{unsettled} slot(s) were still sounding at their boundary -- "
                    f"raise --gap (currently {args.gap}s) or those clips overlap"
                )

        if args.keep_wav:
            dst = os.path.join(out_dir, "session.wav")
            shutil.copy(wav_path, dst)
            print(f"[wav   ] full session kept at {dst}")

        if sounded == 0:
            problems.append(
                "EVERY slot was silent -- nothing was captured. Either the writes are "
                "not reaching the sound hardware or this MAME build records no audio; "
                "this is a failed capture, not a result"
            )
        if problems:
            sys.stderr.write("\n*** PROBLEMS with this capture:\n")
            for pr in problems:
                sys.stderr.write(f"***   - {pr}\n")
            return 1
        return 0
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
