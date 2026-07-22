#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Cross-validate tools/z80_decode.py against z80dasm 1.2.0.

Two independent paths that must agree beats one authoritative
path. Our decoder is hand-written, and an instruction-LENGTH error is the
highest-severity bug class in this project -- one wrong length desyncs the
entire downstream instruction stream and every routine translated from it.

Two checks:

  SYNTHETIC (exhaustive, ROM-independent): every base / CB / ED / DD / FD /
  DDCB / FDCB opcode form, each laid out on an 8-byte stride so the stream
  re-syncs after every instruction regardless of decoded length. Compares our
  length against z80dasm's.

  ROM (boundary agreement): disassemble the real image with z80dasm using the
  tracer's block definitions, and check that z80dasm puts instruction
  boundaries in exactly the same places we do across the reachable code.

Where z80dasm emits `defb` it is declining to decode, not disagreeing, so
those are reported separately rather than counted as mismatches -- its `-u`
handling of undocumented prefix forms is not hardware-faithful.

Usage:
    python3 tools/verify_decoder.py [--rom rom/maincpu.bin]
"""

import argparse
import os
import re
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from z80_decode import decode  # noqa: E402

Z80DASM = "/opt/homebrew/bin/z80dasm"
STRIDE = 8  # > max instruction length (4), so every slot re-syncs
# z80dasm -a -t puts the address AFTER the mnemonic:
#     \tld a,000h\t\t;0000\t3e 00\t\t> .
LINE_RE = re.compile(r";([0-9a-f]{4})\t((?:[0-9a-f]{2} )*[0-9a-f]{2})", re.I)


def _z80dasm(data: bytes, extra: list[str] | None = None) -> dict[int, int]:
    """Run z80dasm and return {address: instruction_length}."""
    with tempfile.NamedTemporaryFile(suffix=".bin", delete=False) as f:
        f.write(data)
        path = f.name
    try:
        out = subprocess.run(
            [Z80DASM, "-a", "-t", "-u", "-g", "0", *(extra or []), path],
            capture_output=True, text=True, check=True,
        ).stdout
    finally:
        os.unlink(path)

    lengths, texts = {}, {}
    for line in out.splitlines():
        m = LINE_RE.search(line)
        if not m:
            continue
        addr = int(m.group(1), 16)
        lengths[addr] = len(m.group(2).split())
        texts[addr] = line
    _z80dasm.texts = texts
    return lengths


def _sequences() -> list[bytes]:
    seqs = [bytes([op]) for op in range(0x100)]
    seqs += [bytes([0xCB, op]) for op in range(0x100)]
    seqs += [bytes([0xED, op]) for op in range(0x100)]
    for pfx in (0xDD, 0xFD):
        seqs += [bytes([pfx, op]) for op in range(0x100) if op != 0xCB]
        seqs += [bytes([pfx, 0xCB, 0x05, op]) for op in range(0x100)]
    return seqs


def check_synthetic() -> int:
    seqs = _sequences()
    blob = bytearray(len(seqs) * STRIDE)
    for i, s in enumerate(seqs):
        blob[i * STRIDE : i * STRIDE + len(s)] = s
    blob = bytes(blob)

    ref = _z80dasm(blob)
    texts = _z80dasm.texts
    checked = mismatch = declined = 0

    for i in range(len(seqs)):
        addr = i * STRIDE
        if addr not in ref:
            continue
        if "defb" in texts.get(addr, ""):
            declined += 1
            continue
        ours = decode(blob, addr)
        checked += 1
        if ours.length != ref[addr]:
            mismatch += 1
            if mismatch <= 20:
                raw = " ".join(f"{b:02x}" for b in seqs[i])
                print(
                    f"  LENGTH MISMATCH [{raw}]: ours={ours.length} "
                    f"z80dasm={ref[addr]}  ({ours.text})"
                )

    print(f"synthetic : {checked} forms checked, {mismatch} length mismatches, "
          f"{declined} declined by z80dasm (defb)")
    return mismatch


def check_rom(rom: str, blocks: str) -> int:
    if not (os.path.exists(rom) and os.path.exists(blocks)):
        # Do NOT return 0: main() would then print "OK -- decoder agrees with
        # z80dasm" having only run the synthetic half. A fresh clone has no
        # rom/ (it is gitignored), so that is the default path.
        print(f"rom check : SKIPPED (need {rom} and {blocks}; run `make trace`)")
        return None

    with open(rom, "rb") as f:
        mem = f.read()
    ref = _z80dasm(mem, ["-b", blocks])

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import json

    from trace import CODE_OPERAND, CODE_START, Tracer, BUILTIN_ENTRIES  # noqa: E402

    tr = Tracer(mem)
    for addr, why in BUILTIN_ENTRIES:
        tr.add_entry(addr, why)
    # Must match how blocks.def was generated, or we compare two different
    # code maps and the mismatch goes unnoticed (trace reported 2868
    # instructions while this said 2769, and nothing flagged it).
    ep = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                      "games", "dkong", "entrypoints.json")
    if os.path.exists(ep):
        with open(ep) as f:
            for e in json.load(f):
                # Must mirror trace.py's ingestion exactly, including the
                # is_routine distinction -- comparing against a blocks.def
                # built from a DIFFERENT code map is how this check silently
                # drifted once already.
                prov = e.get("provenance", "")
                tr.add_entry(
                    int(str(e["addr"]), 0),
                    e.get("why", "discovered"),
                    is_routine="instruction-fetch trace" not in prov,
                )
    tr.run()

    ours = {a for a in range(len(mem)) if tr.kind[a] == CODE_START}
    # BOTH directions. `ours subset of theirs` alone can never fail inside a
    # bytedata span (z80dasm emits one defb per byte, so every address is
    # present) and would also pass if z80dasm split one of our instructions
    # into several.
    #
    # The reverse check is restricted to addresses inside spans we called
    # CODE. Over a bytedata span z80dasm emits one defb per byte, so every
    # address there is in `ref` and an unrestricted reverse check would report
    # thousands of bogus extras. An earlier version of this filtered on
    # `tr.kind[a] == CODE_START`, which is the definition of `ours` -- making
    # the check provably empty and its clean result structurally guaranteed
    # rather than verified.
    code_bytes = {
        a for a in range(len(mem)) if tr.kind[a] in (CODE_START, CODE_OPERAND)
    }
    missing = sorted(a for a in ours if a not in ref)
    extra = sorted(a for a in ref if a in code_bytes and a not in ours)
    print(
        f"rom       : {len(ours)} instruction boundaries, "
        f"{len(missing)} not in z80dasm, {len(extra)} only in z80dasm"
    )
    for a in missing[:20]:
        print(f"  0x{a:04x}: ours={tr.instrs[a].text!r}")
    return len(missing) + len(extra)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rom", default="rom/maincpu.bin")
    ap.add_argument("--blocks", default="out/blocks.def")
    args = ap.parse_args()

    if not os.path.exists(Z80DASM):
        print(f"z80dasm not found at {Z80DASM}", file=sys.stderr)
        return 2

    syn = check_synthetic()
    rom = check_rom(args.rom, args.blocks)
    if rom is None:
        # Nonzero even when the synthetic half passed: an incomplete run must
        # not exit 0, or a caller keyed on exit status reads it as a full pass.
        print("INCOMPLETE -- synthetic check only; ROM check did not run")
        return 2
    bad = syn + rom
    print("OK -- decoder agrees with z80dasm" if not bad else "FAILED")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
