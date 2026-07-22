"""Shared state-artifact I/O for the arcade-js state-diff harness.

THE STATE CONTRACT (QA-chosen, mirrors the frame contract deliberately):

  state.bin   headerless concatenation of per-frame state, 5120 bytes each:
                work   0x6000-0x6BFF  3072 bytes
                sprite 0x7000-0x73FF  1024 bytes
                video  0x7400-0x77FF  1024 bytes
              Regions concatenated in exactly that order, no padding.

  state.json  {"bytes_per_frame":5120,"count":N,"regions":[...],
               "frames":[{"i":0,"sha256":"..."}, ...]}

SAMPLING POINT: state[i] is sampled at the frame boundary BEFORE frame i's CPU
execution. So state[0] is the power-on state and state[N] is the state after
frames 0..N-1 have run. Both MAME and the JS sample at this identical point.

Why state-diff exists alongside pixel-diff: it is available before a renderer
exists, and it separates two failure domains. RAM matches but pixels differ =>
the CPU translation is correct and the bug is in the video model. RAM already
differs => it is the translation, and the video model is irrelevant. A pixel
diff alone conflates those.
"""

import hashlib
import json
import os

# (name, start, length) -- order is part of the contract.
REGIONS = [
    ("work", 0x6000, 3072),
    ("sprite", 0x7000, 1024),
    ("video", 0x7400, 1024),
]

BYTES_PER_FRAME = sum(r[2] for r in REGIONS)  # 5120


def region_of(offset: int):
    """Map a byte offset within a state frame to (region_name, cpu_address)."""
    pos = 0
    for name, start, length in REGIONS:
        if pos <= offset < pos + length:
            return name, start + (offset - pos)
        pos += length
    raise ValueError(f"offset {offset} outside state frame")


def frame_sha256(buf: bytes) -> str:
    if len(buf) != BYTES_PER_FRAME:
        raise ValueError(f"state frame must be {BYTES_PER_FRAME} bytes, got {len(buf)}")
    return hashlib.sha256(buf).hexdigest()


def write_index(out_dir: str, hashes: list[str]) -> str:
    index = {
        "bytes_per_frame": BYTES_PER_FRAME,
        "count": len(hashes),
        "regions": [
            {"name": n, "start": f"0x{s:04X}", "len": ln} for n, s, ln in REGIONS
        ],
        "frames": [{"i": i, "sha256": h} for i, h in enumerate(hashes)],
    }
    path = os.path.join(out_dir, "state.json")
    with open(path, "w") as fh:
        json.dump(index, fh, indent=1)
        fh.write("\n")
    return path


class StateSet:
    """Read-side view of a state.bin + state.json pair."""

    def __init__(self, path: str):
        self.dir = (
            path if os.path.isdir(path) else os.path.dirname(os.path.abspath(path))
        )
        self.bin_path = os.path.join(self.dir, "state.bin")
        self.json_path = os.path.join(self.dir, "state.json")

        if not os.path.exists(self.bin_path):
            raise FileNotFoundError(f"missing state.bin in {self.dir}")

        if os.path.exists(self.json_path):
            with open(self.json_path) as fh:
                self.index = json.load(fh)
            bpf = self.index.get("bytes_per_frame")
            if bpf != BYTES_PER_FRAME:
                raise ValueError(
                    f"{self.dir}: bytes_per_frame {bpf} != {BYTES_PER_FRAME} "
                    "-- state contract violation"
                )
            self.count = self.index["count"]
            self.hashes = [f["sha256"] for f in self.index["frames"]]
            # Mirror frameio's check. Without it a count > len(frames) surfaces as
            # an IndexError mid-diff instead of a clear contract violation.
            if self.count != len(self.index.get("frames", [])):
                raise ValueError(
                    f"{self.dir}: state contract violation: count {self.count} != "
                    f"len(frames) {len(self.index.get('frames', []))}"
                )
        else:
            # Tolerate a bare state.bin (e.g. straight off the Lua dumper) so the
            # harness can still diff before an index has been generated.
            self.index = None
            self.count = os.path.getsize(self.bin_path) // BYTES_PER_FRAME
            self.hashes = None

        # The final frame can be a PARTIAL write (MAME exits mid-write), so we
        # tolerate sub-frame slack -- but only sub-frame. A file holding whole
        # extra frames beyond the declared count means the index is lying, and
        # would silently shorten the comparison into a false PASS.
        actual = os.path.getsize(self.bin_path)
        lo = self.count * BYTES_PER_FRAME
        if not lo <= actual < lo + BYTES_PER_FRAME:
            raise ValueError(
                f"{self.dir}: state contract violation: state.bin is {actual} bytes "
                f"but index declares {self.count} frames (expected {lo} bytes, "
                f"tolerating <{BYTES_PER_FRAME} partial-tail slack)"
            )

    def read(self, i: int) -> bytes:
        if not 0 <= i < self.count:
            raise IndexError(f"state frame {i} out of range (count={self.count})")
        with open(self.bin_path, "rb") as fh:
            fh.seek(i * BYTES_PER_FRAME)
            buf = fh.read(BYTES_PER_FRAME)
        if len(buf) != BYTES_PER_FRAME:
            raise IOError(f"short read on state frame {i}")
        return buf

    def hash_at(self, i: int) -> str:
        if self.hashes is not None:
            return self.hashes[i]
        return frame_sha256(self.read(i))

    def __repr__(self):
        return f"<StateSet {self.dir} count={self.count}>"
