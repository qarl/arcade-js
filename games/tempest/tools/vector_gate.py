#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Tempest vector pipeline gate (byte-exact, BYO-ROM).

Captures a MAME golden of Tempest attract with the VECTOR-DEFAULT flags (NO -norotate; snapsize/snapview
auto -> a 480x640 ROT270 frame) plus a per-frame vector-RAM dump, then renders each frame's vector RAM
through boards/tempest/{avg.js,vector-raster.js} and asserts it matches MAME's AVI frame BYTE-FOR-BYTE on
every stable frame (vector_render.mjs does the diff + positive controls). Prints `vector_gate: PASS` only
on a clean run; every cannot-run path exits non-zero (never a silent skip that reads as PASS).

Needs BYO ROM assembled by `node tools/build-rom.mjs tempest` (games/tempest/rom/*.bin) + MAME + ffmpeg.

Usage: games/tempest/tools/vector_gate.py [--seconds N] [--mame PATH] [--rompath DIR]
"""
import argparse
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(HERE)
REPO = os.path.dirname(os.path.dirname(GAME))
sys.path.insert(0, os.path.join(REPO, "tools"))
from raw_dumps import raw_dumps  # noqa: E402
ROM_DIR = os.path.join(GAME, "rom")
LUA = os.path.join(HERE, "lua", "dump_vecram.lua")


def main():
    p = argparse.ArgumentParser(description="Tempest byte-exact vector pipeline gate")
    p.add_argument("--seconds", type=int, default=8)
    p.add_argument("--mame", default=os.environ.get("MAME", "mame"))
    p.add_argument("--rompath", default=os.path.expanduser("~/Downloads"))
    p.add_argument("--keep-frames", action="store_true",
                   help="keep the raw frames.rgb / state.bin dumps after the verdict "
                        "(default: delete them; tools/raw_dumps.py).")
    args = p.parse_args()

    # Fail closed if the BYO ROM images are missing -- an unrunnable gate is not a passing gate.
    for f in ("avgprom.bin", "vectorrom.bin"):
        if not os.path.exists(os.path.join(ROM_DIR, f)):
            sys.stderr.write(f"FAIL: {ROM_DIR}/{f} missing -- run `node tools/build-rom.mjs tempest` first\n")
            return 1

    work = tempfile.mkdtemp(prefix="tempest_vgate_")
    with raw_dumps(work, keep=args.keep_frames, rmtree=True):
        os.makedirs(os.path.join(work, "nvram"), exist_ok=True)
        os.makedirs(os.path.join(work, "cfg"), exist_ok=True)
        vecram = os.path.join(work, "vecram.bin")
        avi = os.path.join(work, "out.avi")

        argv = [
            args.mame, "tempest", "-rompath", args.rompath,
            "-video", "none", "-sound", "none", "-nothrottle", "-frameskip", "0",
            "-aviwrite", avi, "-snapshot_directory", work, "-snapview", "auto",
            "-nvram_directory", os.path.join(work, "nvram"), "-cfg_directory", os.path.join(work, "cfg"),
            "-nonvram_save", "-noautosave", "-nocheat",
            "-seconds_to_run", str(args.seconds), "-autoboot_script", LUA,
        ]
        env = dict(os.environ, VECRAM_OUT=vecram, SDL_VIDEODRIVER="dummy")
        print("[vector_gate] " + " ".join(argv))
        res = subprocess.run(argv, env=env, capture_output=True, text=True)
        if res.returncode != 0 or not os.path.exists(avi):
            sys.stderr.write(res.stdout + res.stderr)
            sys.stderr.write("FAIL: MAME capture failed\n")
            return 1

        frames = os.path.join(work, "frames.rgb")
        ff = subprocess.run(
            ["ffmpeg", "-v", "error", "-i", avi, "-map", "0:v:0", "-fps_mode", "passthrough",
             "-pix_fmt", "rgb24", "-f", "rawvideo", "-y", frames],
            capture_output=True, text=True)
        if ff.returncode != 0 or not os.path.exists(frames):
            sys.stderr.write(ff.stderr + "\nFAIL: ffmpeg extract failed\n")
            return 1

        node = subprocess.run(
            ["node", os.path.join(HERE, "vector_render.mjs"), ROM_DIR, work],
            cwd=REPO, capture_output=True, text=True)
        sys.stdout.write(node.stdout)
        sys.stderr.write(node.stderr)
        return node.returncode


if __name__ == "__main__":
    sys.exit(main())
