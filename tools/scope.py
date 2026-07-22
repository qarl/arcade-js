# SPDX-License-Identifier: GPL-3.0-only
"""What a green verdict is actually EVIDENCE ABOUT.

A gate cannot speak about code it never reached, and the dangerous property is
that **adding unreached code cannot change a gate's verdict**. So it stays green
while dead code accumulates, and every commit reads as validated.

That is not hypothetical. An entire NMI path was once dead --
ROM 0x02BC falls through into 0x02BD and nothing performed that fall-through --
with 24 tests green and 4/4 state frames byte-identical. Nothing in the commit
executed. The gate was structurally blind: every frame it compared ended before
boot did.

So a bare "PASS" is not an honest report. This module lets the differs state the
CYCLE RANGE a verdict covers and name the landmarks that fall outside it, so
"PASS (4 frames, all ending before boot completes)" replaces an unqualified green
that invites exactly the wrong inference.

PROVENANCE IS PART OF EACH LANDMARK. Some are derived here from verified hardware
constants; others come from cycle counting. They are not the same kind
of fact and are not labelled as though they were.
"""

# The timing/probe constants below are BOARD hardware, loaded from the board's
# hardware.json via configure() -- a shared tool has no game default, so they are
# None until a board is configured and any use before configure() fails loudly.
# The documentation of WHERE each number comes from is kept in place; only the
# values themselves now live in hardware.json (copied verbatim from here).

# --- Derived from hardware constants (mame -listxml) ---
# pixclock 6,144,000 / (htotal 384 * vtotal 264) = 60.606061 Hz
# Z80 3,072,000 Hz / 60.606061 = 50688.000 -- an exact integer, which is itself a
# sign the inputs are right.
CPU_HZ = None
REFRESH_HZ = None
CYCLES_PER_FRAME = None

# vblank starts at scanline VBSTART of VTOTAL, so within each frame:
#   50688 * 240/264 = 46080 cycles
VBLANK_INTO_FRAME = None


# --- Machine configuration the tape runs under (harness-contract fact) ---
# DSW0 is read by the ROM at 0x0207 and 0x024F. Its value is an INPUT to the
# capture, so it is pinned here as a stated number exactly like the frame offset.
#
# MEASURED on the running machine, not read off the driver source: 0x7D80 returns
# 0x80 = 3 lives, 7000 bonus, 1 coin/1 play, UPRIGHT cabinet (bit 7 is the only
# bit defaulting set). Control read: the same probe read ROM 0x0000 = 0x3E.
#
# DETERMINISM HAZARD, proven: MAME persists dipswitch changes to cfg/<game>.cfg
# and defaults cfg_directory to "cfg" relative to cwd. With such a cfg present,
# DSW0 measured 0x83 instead of 0x80 -- a silent change to every golden frame,
# invisible in the capture. mame_golden.py therefore pins -cfg_directory to a
# fresh empty dir per run, same treatment as -nvram_directory.
#
# Cocktail mode (bit 7 clear) FLIPS THE SCREEN via the flipscreen latch. That
# latch USED to be ungated; it no longer is -- latch state is unreadable but
# latch WRITES are observable, and tools/writediff.py gates 0x7D80-0x7D87.
# Corrected in place rather than left stale: a dropped correction re-establishes
# the error it corrected.
# (DSW0_ADDR is the read address 0x7D80; DSW0_EXPECTED the pinned 0x80.)
DSW0_ADDR = None
DSW0_EXPECTED = None

# Control byte for the config probe: ROM 0x0000 is the first
# byte of the reset vector, LD A,0x00. A probe reporting an expected DSW0 must
# demonstrate it can report a non-trivial value.
ROM0000_CONTROL = None

# --- Z80 POWER-ON REGISTER STATE (measured, then explained) ---
#
# Only IX and IY are 0xFFFF. Everything else is zero except AF = 0x0040.
#
# Measured from the running machine at t=0 before any instruction, with a
# control (ROM 0x0000 = 0x3E). Then EXPLAINED from MAME's z80 device_start():
#     IX = IY = 0xffff;   // IX and IY are FFFF after a reset!
#     m_f.z_val = 0;      // Zero flag is set
# F bit 6 is the Z flag = 0x40 and A is 0, hence AF = 0x0040.
#
# STATED CHOICE, same class as the power-on RAM zeros and DSW0: AF = 0x0040 is a
# MAME INITIALISATION DETAIL, not documented Z80 silicon behaviour -- MAME's own
# comment says "Zero flag is set", which is a choice. We match MAME's convention
# deliberately because this project treats MAME as ground truth, and we say so rather
# than letting it read as hardware fact.
#
# WHY IT IS PINNED: only IX/IY survive to be observed, because the ROM writes
# every other register before the first NMI -- AF immediately, SP via
# `ld sp,0x6c00` at 0x02B2. So a wrong AF or SP reset value is INVISIBLE today
# and wrong everywhere it eventually matters. A blanket "all registers 0xFFFF"
# was predicted and would have shipped exactly those two latent bugs.
# Values (AF=0x0040, IX=IY=0xFFFF, rest 0) now live in hardware.json z80Reset.
Z80_RESET_STATE = None

# --- WRITE TIMESTAMP CONVENTION ---
#
# A traced write is timestamped at the cycle its WRITE BUS CYCLE occurs, NOT at
# instruction start. This is MAME's convention and we adopt it, because MAME is
# the reference and the reference defines the units -- a translation layer on our
# side would just be somewhere for a second bug to live.
#
# It is DERIVABLE PER INSTRUCTION, not a blanket constant:
#     ld (nn),a   13 T = 4 fetch + 3 lo + 3 hi + 3 write  -> write at T+10
#     ld (hl),a    7 T = 4 fetch + 3 write                -> write at T+4
#     push rr     11 T = 5 + 3 + 3                        -> writes at T+5, T+8
# A single blanket "+10" would be right for one opcode and wrong for the rest --
# the "fits one alignment" trap.
#
# VERIFIED, not merely adopted, from two independent taps already taken:
#     PC-exact tap : fetch of 0x02B8 at cycle 180,796 (opcode byte 0x3E = LD A,n)
#     write tap    : 0x7D84 <- 0x01   at cycle 180,813
#     0x02B8 is LD A,n (7 T), so 0x02BA (LD (nn),A) begins at 180,796 + 7 = 180,803
#     its write bus cycle is 10 T in  ->  predicted 180,813.  MEASURED 180,813.
# Cross-check: consecutive ld (nn),a latch writes are spaced 13, 13, 17 cycles --
# 13 being the instruction exactly, and 17 = 13 + 4 for the `inc a` between the
# third and fourth store.
#
# Stated here so it is an INPUT to phase-2 cycle-exact diffing, never something
# rediscovered mid-diff. A constant offset discovered DURING a diff is the most
# dangerous shape available.
WRITE_TIMESTAMP = None

# (name, cycle, provenance) -- provenance is not decoration; it records whether a
# number was measured here, derived here, or supplied by someone else. The table
# (with the same names/cycles/provenance, plus the tap addresses 0x02B8/0x0066)
# now lives in hardware.json landmarks.
LANDMARKS = None


def configure(hw):
    """Load the DK clocks / DSW / reset state / landmarks from a Hardware object.

    Every value below was previously a literal in this module; it now comes from
    the board's hardware.json (copied verbatim), so this shared tool carries no
    game-specific number.
    """
    global CPU_HZ, REFRESH_HZ, CYCLES_PER_FRAME, VBLANK_INTO_FRAME
    global DSW0_ADDR, DSW0_EXPECTED, ROM0000_CONTROL
    global Z80_RESET_STATE, WRITE_TIMESTAMP, LANDMARKS
    CPU_HZ = hw.cpu_hz
    REFRESH_HZ = hw.refresh_hz
    CYCLES_PER_FRAME = hw.cycles_per_frame
    VBLANK_INTO_FRAME = hw.vblank_into_frame
    DSW0_ADDR = hw.dsw0_addr
    DSW0_EXPECTED = hw.dsw0_expected
    ROM0000_CONTROL = hw.control_byte
    Z80_RESET_STATE = dict(hw.z80_reset)
    WRITE_TIMESTAMP = hw.write_timestamp
    LANDMARKS = list(hw.landmarks)


def _require_configured():
    if LANDMARKS is None:
        raise RuntimeError(
            "scope is not configured: call scope.configure(hardware) with a "
            "Hardware loaded from --hardware before using it."
        )


# NAMING CONVENTION -- pinned, because an off-by-one living in the NAMES rather
# than the code keeps costing until it is stated.
#
#     state[N] is the (N+1)th frame.
#
# So emitting 5 frames yields state[0..4], NOT state[0..5]. This cost a wrongly
# announced milestone: state[4] samples at 202,752, which is 19 cycles BEFORE the
# first NMI at 202,771, so five frames still cannot see the NMI handler -- six
# are needed. Stated here alongside FROZEN_OFFSET and WRITE_TIMESTAMP as a
# convention, not a shared assumption.
FRAME_COUNT_TO_MAX_INDEX = "state[N] is the (N+1)th frame; N frames yield state[0..N-1]"


def frames_needed_to_cover(cycle: int) -> int:
    """How many emitted frames are required for a sample AT OR AFTER `cycle`.

    Turning "does this run cover X?" into arithmetic anyone can gate on, rather
    than something to be inferred from a SCOPE line and skipped.
    """
    _require_configured()
    n = 0
    while (n) * CYCLES_PER_FRAME < cycle:
        n += 1
    return n + 1  # frames 0..n inclusive


def covers(frames_compared: int, cycle: int) -> bool:
    """Does a run of `frames_compared` frames observe state at or after `cycle`?"""
    return last_sample_cycle(frames_compared) >= cycle


def find_landmark(needle: str):
    """Resolve a landmark by case-insensitive substring, or a raw cycle number."""
    _require_configured()
    if needle.isdigit():
        return (f"cycle {int(needle):,}", int(needle), "caller-supplied cycle")
    hits = [lm for lm in LANDMARKS if needle.lower() in lm[0].lower()]
    if len(hits) == 1:
        return hits[0]
    return None


def last_sample_cycle(frames_compared: int) -> int:
    """Cycle at which the final compared sample was taken.

    state[N] is sampled after N frames have executed, so comparing `n` frames
    covers state[0..n-1] and the last observation is at (n-1) * CYCLES_PER_FRAME.
    """
    _require_configured()
    if frames_compared <= 0:
        return 0
    return (frames_compared - 1) * CYCLES_PER_FRAME


def uncovered(frames_compared: int):
    """Landmarks that occur AFTER the last compared sample.

    These are the things the verdict is silent about -- not things it disproves.
    """
    _require_configured()
    edge = last_sample_cycle(frames_compared)
    return [(n, c, p) for (n, c, p) in LANDMARKS if c > edge]


def report(frames_compared: int, indent: str = "  ") -> str:
    """A scope statement to print alongside any verdict, green or red."""
    edge = last_sample_cycle(frames_compared)
    lines = [
        f"{indent}SCOPE: {frames_compared} frames compared, covering emulated cycles "
        f"0..{edge:,} (state[0..{max(frames_compared - 1, 0)}])"
    ]
    missed = uncovered(frames_compared)
    if missed:
        lines.append(
            f"{indent}This verdict is EVIDENCE ONLY about code executing before "
            f"cycle {edge:,}. It says NOTHING about:"
        )
        for name, cycle, prov in missed:
            lines.append(f"{indent}  - {name} @ cycle {cycle:,}  [{prov}]")
        lines.append(
            f"{indent}Adding unreached code cannot change this verdict. "
            f"Extend the compared range to widen it."
        )
    else:
        lines.append(f"{indent}All known landmarks fall within the compared range.")
    return "\n".join(lines)
