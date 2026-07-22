# SPDX-License-Identifier: GPL-3.0-only
"""Shared loader for a board's tool-facing hardware declaration (hardware.json).

The shared arcade-js Python tools are GAME-AGNOSTIC: they read the board's
hardware/address map from a JSON file passed via --hardware, rather than
hardcoding any one board's addresses. This module loads that JSON into a
Hardware object and provides the --hardware argparse plumbing every tool shares.

DESIGN RULE (why --hardware is required, not defaulted): a SHARED tool must have
NO silent board default. A DK default living in a "shared" tool is exactly the
game-specific literal this seam exists to remove -- it would keep working for DK
and silently misbehave for the next board. So --hardware is required and the
game-specific caller (games/<id>/tools/*) supplies its board's path.

The engine's own numeric constants (boards/<board>/memory.js, io.js, the game
manifest) are NOT loaded from here -- the pixel-validated JS load path keeps its
literals. A drift-test asserts this JSON matches those constants so the two
sources can never diverge.
"""

import json
import os


class Hardware:
    """Parsed view of a board's hardware.json, with typed accessors the tools use.

    '_hex' / '_comment' annotation fields in the JSON are ignored: only the
    documented keys are read.
    """

    def __init__(self, path, data):
        self.path = path
        self._raw = data

        self.driver = data["driver"]

        screen = data["screen"]
        self.screen_width = int(screen["width"])
        self.screen_height = int(screen["height"])

        self.refresh_hz = float(data["refreshHz"])
        self.cpu_hz = int(data["cpuHz"])
        self.cycles_per_frame = int(data["cyclesPerFrame"])

        self.state_dump_size = int(data["stateDumpSize"])
        # (name, base, size) -- order is part of the state-dump contract.
        self.state_regions = [
            (r["name"], int(r["base"]), int(r["size"])) for r in data["stateRegions"]
        ]
        # (start, end, name) -- the hardware write surface outside RAM.
        self.write_ranges = [
            (int(r["start"]), int(r["end"]), r["name"]) for r in data["writeRanges"]
        ]

        self.dsw0_addr = int(data["dsw0"]["addr"])
        self.dsw0_expected = int(data["dsw0"]["expected"])
        self.control_byte = int(data["controlByte"])

        self.z80_reset = {k: int(v) for k, v in data["z80Reset"].items() if k != "_hex"}
        self.write_timestamp = data["writeTimestamp"]

        # (name, cycle, provenance) -- matches scope.LANDMARKS' tuple shape exactly.
        self.landmarks = [
            (lm["name"], int(lm["cycle"]), lm["provenance"]) for lm in data["landmarks"]
        ]

        # Self-consistency: the declared dump size must equal the region sizes.
        # A mismatch means the JSON is internally broken; fail loudly at load,
        # not silently mid-diff.
        summed = sum(size for _n, _b, size in self.state_regions)
        if summed != self.state_dump_size:
            raise ValueError(
                f"{path}: stateDumpSize {self.state_dump_size} != sum of stateRegions "
                f"sizes {summed} -- hardware.json is internally inconsistent"
            )

    @classmethod
    def load(cls, path):
        with open(path) as fh:
            data = json.load(fh)
        return cls(os.path.abspath(path), data)

    def __repr__(self):
        return f"<Hardware {self.driver} {self.path}>"


def add_hardware_arg(parser, required=True):
    """Add the shared --hardware option to an argparse parser."""
    parser.add_argument(
        "--hardware",
        required=required,
        metavar="PATH",
        help="path to the board's hardware.json (e.g. boards/<board>/hardware.json). "
        "A shared tool has no board default; the game-specific caller supplies it.",
    )


def load_from_args(args):
    """Load the Hardware named by args.hardware (from add_hardware_arg)."""
    return Hardware.load(args.hardware)
