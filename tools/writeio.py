# SPDX-License-Identifier: GPL-3.0-only
"""Hardware write-trace I/O and diffing.

THE WRITE-TRACE CONTRACT:

  writes.txt   one line per write, in EXECUTION ORDER:
                   <cycle> <ADDR4hex> <VAL2hex>
               e.g.  180326 7D82 01

Covered address set -- the hardware write surface outside RAM:

  0x7800-0x780F   i8257 programming
  0x7C00          ls175.3d sound latch
  0x7C80          grid colour
  0x7D00-0x7D07   ls259.6h sound triggers
  0x7D80-0x7D87   control latches (flipscreen, sprite bank, palette bank, NMI mask, DRQ)

WHY THIS EXISTS: the state dump covers RAM -- what the ROM computes INTO. What it
computes WITH sat outside every gate. A latch WRITE is an action the CPU takes,
so it is TRANSLATION correctness and observable today; the latch's resulting
STATE is device-internal, so it is HARDWARE-MODEL correctness and needs a
renderer. Diffing writes gates the former without waiting for the latter.

ORDER IS PART OF THE CONTRACT. Boot writes latches as `xor a` / three stores /
`inc a` / one store -- the first three carry A=0 and the fourth A=1. A
set-comparison would call a reordered trace equivalent. It is not.

TWO PHASES:
  1. sequence-only -- compare the ordered (addr, value) stream. Works today and
     does not block on the JS side's cycle accounting.
  2. cycle-exact -- once DMA cycle costs land, compare cycles too.
"""

import os

# (start, end, name) -- the hardware write surface outside RAM. This is BOARD
# hardware, loaded from the board's hardware.json via configure(); a shared tool
# has no game default, so it is None until a board is configured and any use
# before configure() fails loudly rather than silently assuming DK.
RANGES = None


def configure(hw):
    """Load the hardware write-range set from a Hardware (hardware.json) object."""
    global RANGES
    RANGES = [(start, end, name) for (start, end, name) in hw.write_ranges]


def _require_configured():
    if RANGES is None:
        raise RuntimeError(
            "writeio is not configured: call writeio.configure(hardware) with a "
            "Hardware loaded from --hardware before using it."
        )


def region_of(addr: int) -> str:
    _require_configured()
    for lo, hi, name in RANGES:
        if lo <= addr <= hi:
            return name
    return "?"


class WriteTrace:
    """An ordered hardware write trace."""

    def __init__(self, path: str):
        if os.path.isdir(path):
            for cand in ("writes.txt", "wtrace.txt"):
                p = os.path.join(path, cand)
                if os.path.exists(p):
                    path = p
                    break
            else:
                raise FileNotFoundError(f"no writes.txt in {path}")
        self.path = path
        self.entries = []  # (cycle:int|None, addr:int, value:int)
        with open(path) as fh:
            for lineno, line in enumerate(fh, 1):
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                parts = line.split()
                if len(parts) == 3:
                    cyc, addr, val = parts
                    self.entries.append((int(cyc), int(addr, 16), int(val, 16)))
                elif len(parts) == 2:
                    # Cycle-less form: the JS side may emit sequence only until
                    # its cycle accounting is exact.
                    addr, val = parts
                    self.entries.append((None, int(addr, 16), int(val, 16)))
                else:
                    raise ValueError(
                        f"{path}:{lineno}: expected '<cycle> <ADDR> <VAL>' or "
                        f"'<ADDR> <VAL>', got {line!r}"
                    )

    @property
    def sequence(self):
        """The (addr, value) stream -- what phase-1 diffing compares."""
        return [(a, v) for _c, a, v in self.entries]

    def has_cycles(self) -> bool:
        return bool(self.entries) and all(c is not None for c, _a, _v in self.entries)

    def __len__(self):
        return len(self.entries)

    def __repr__(self):
        return f"<WriteTrace {self.path} n={len(self.entries)}>"


def first_divergence(golden: "WriteTrace", actual: "WriteTrace", with_cycles: bool):
    """Index of the first differing write, or None.

    Compares in EXECUTION ORDER. A trace that is a strict prefix of the other
    diverges at the point it runs out -- a shorter trace is never a pass.
    """
    gs, as_ = golden.sequence, actual.sequence
    n = min(len(gs), len(as_))
    for i in range(n):
        if gs[i] != as_[i]:
            return i
        if with_cycles and golden.entries[i][0] != actual.entries[i][0]:
            return i
    if len(gs) != len(as_):
        return n
    return None
