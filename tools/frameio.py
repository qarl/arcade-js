# SPDX-License-Identifier: GPL-3.0-only
"""Shared frame-artifact I/O for the arcade-js pixel-diff harness.

THE FRAME CONTRACT:

  frames.rgb   headerless concatenation of frames, 172032 bytes each
               (256 * 224 * 3). No padding, no separators.
               Row-major, top-left origin, byte order R,G,B, 8 bits/channel.
               768 bytes per row, no row padding, 224 rows.
               Native orientation, UNROTATED.

  frames.json  {"width":256,"height":224,"bytes_per_frame":172032,
                "pixel_format":"RGB888","origin":"top-left","count":N,
                "frames":[{"i":0,"sha256":"..."}, ...]}

Frame offsets are implicit (i * BYTES_PER_FRAME) and deliberately NOT stored --
one less thing that can disagree between the two implementations. The per-frame
sha256 IS stored: the differ finds the first divergence by scanning hashes
rather than memcmp'ing 172KB per frame, which makes a 10000-frame diff cheap.

Both sides of the comparison (MAME golden and translated JS) emit this exact
format, so "the images match" and "the bytes match" are the same statement.
"""

import hashlib
import json
import os

# Frame WIRE-FORMAT constants (NOT board hardware): the pixel-diff artifact is
# always RGB888, top-left origin, 3 channels, regardless of which board it came
# from. These stay literals.
CHANNELS = 3
PIXEL_FORMAT = "RGB888"
ORIGIN = "top-left"

# Screen GEOMETRY is board hardware, loaded from the board's hardware.json via
# configure() -- a shared tool has no game default, so these are None until a
# board is configured and any use before configure() fails loudly.
WIDTH = None
HEIGHT = None
BYTES_PER_ROW = None
BYTES_PER_FRAME = None


def configure(hw):
    """Load the screen geometry from a Hardware (hardware.json) object."""
    global WIDTH, HEIGHT, BYTES_PER_ROW, BYTES_PER_FRAME
    WIDTH = hw.screen_width
    HEIGHT = hw.screen_height
    BYTES_PER_ROW = WIDTH * CHANNELS
    BYTES_PER_FRAME = WIDTH * HEIGHT * CHANNELS  # 172032 for DK


def _require_configured():
    if WIDTH is None:
        raise RuntimeError(
            "frameio is not configured: call frameio.configure(hardware) with a "
            "Hardware loaded from --hardware before using it."
        )


def frame_sha256(buf: bytes) -> str:
    """Hash exactly one frame's worth of bytes."""
    _require_configured()
    if len(buf) != BYTES_PER_FRAME:
        raise ValueError(f"frame must be {BYTES_PER_FRAME} bytes, got {len(buf)}")
    return hashlib.sha256(buf).hexdigest()


def write_index(out_dir: str, hashes: list[str]) -> str:
    """Write frames.json describing an already-written frames.rgb."""
    _require_configured()
    index = {
        "width": WIDTH,
        "height": HEIGHT,
        "bytes_per_frame": BYTES_PER_FRAME,
        "pixel_format": PIXEL_FORMAT,
        "origin": ORIGIN,
        "count": len(hashes),
        "frames": [{"i": i, "sha256": h} for i, h in enumerate(hashes)],
    }
    path = os.path.join(out_dir, "frames.json")
    with open(path, "w") as fh:
        json.dump(index, fh, indent=1)
        fh.write("\n")
    return path


class FrameSet:
    """Read-side view of a frames.rgb + frames.json pair."""

    def __init__(self, path: str):
        _require_configured()
        # Accept either the directory or either of the two files.
        if os.path.isdir(path):
            self.dir = path
        else:
            self.dir = os.path.dirname(os.path.abspath(path))
        self.rgb_path = os.path.join(self.dir, "frames.rgb")
        self.json_path = os.path.join(self.dir, "frames.json")

        if not os.path.exists(self.rgb_path):
            raise FileNotFoundError(f"missing frames.rgb in {self.dir}")
        if not os.path.exists(self.json_path):
            raise FileNotFoundError(f"missing frames.json in {self.dir}")

        with open(self.json_path) as fh:
            self.index = json.load(fh)

        self._validate()
        self.hashes = [f["sha256"] for f in self.index["frames"]]
        self.count = self.index["count"]

    def _validate(self):
        """Fail loudly on a format mismatch rather than silently diffing garbage."""
        idx = self.index
        problems = []
        if idx.get("width") != WIDTH or idx.get("height") != HEIGHT:
            problems.append(
                f"geometry {idx.get('width')}x{idx.get('height')} != {WIDTH}x{HEIGHT}"
            )
        if idx.get("bytes_per_frame") != BYTES_PER_FRAME:
            problems.append(
                f"bytes_per_frame {idx.get('bytes_per_frame')} != {BYTES_PER_FRAME}"
            )
        if idx.get("pixel_format") != PIXEL_FORMAT:
            problems.append(
                f"pixel_format {idx.get('pixel_format')!r} != {PIXEL_FORMAT!r}"
            )
        if idx.get("origin") != ORIGIN:
            problems.append(f"origin {idx.get('origin')!r} != {ORIGIN!r}")

        declared = idx.get("count")
        # Must be a real int: a float count (e.g. 18.0) compares equal to the
        # frame-list length and would otherwise skip the size check below,
        # disabling the primary defense against a lying index.
        if not isinstance(declared, int) or isinstance(declared, bool):
            problems.append(f"count {declared!r} is not an integer")
            declared = None
        elif declared != len(idx.get("frames", [])):
            problems.append(
                f"count {declared} != len(frames) {len(idx.get('frames', []))}"
            )

        actual_bytes = os.path.getsize(self.rgb_path)
        expect_bytes = declared * BYTES_PER_FRAME if declared is not None else None
        if expect_bytes is not None and actual_bytes != expect_bytes:
            problems.append(
                f"frames.rgb is {actual_bytes} bytes, index declares {declared} frames "
                f"({expect_bytes} bytes) -- truncated or mis-sized"
            )

        if problems:
            raise ValueError(
                f"{self.dir}: frame contract violation: " + "; ".join(problems)
            )

    def read(self, i: int) -> bytes:
        """Read frame i's raw 172032 bytes."""
        if not 0 <= i < self.count:
            raise IndexError(f"frame {i} out of range (count={self.count})")
        with open(self.rgb_path, "rb") as fh:
            fh.seek(i * BYTES_PER_FRAME)
            buf = fh.read(BYTES_PER_FRAME)
        if len(buf) != BYTES_PER_FRAME:
            raise IOError(f"short read on frame {i}: got {len(buf)} bytes")
        return buf

    def __repr__(self):
        return f"<FrameSet {self.dir} count={self.count}>"
