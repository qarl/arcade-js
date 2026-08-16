#!/usr/bin/env python3
"""Launch MAME for a game in this repo — windowed to play, or headless to capture.

Reads the MAME driver name from the game's board `hardware.json` (`"driver"`), isolates MAME's
config/nvram in a throwaway temp dir, and skips the info nag so it boots straight in.

The MAME romset — the ORIGINAL per-chip ROM files (e.g. `p38b.ic38`), not our concatenated
`games/<id>/rom/maincpu.bin` — is bring-your-own and lives OUTSIDE the repo. Point `--rompath` at
the directory that CONTAINS the `<driver>/` romset folder.

  # play it in a window
  python3 tools/mame-play.py thepit --rompath ~/mameroms

  # headless capture (attract mode): 45s to an AVI, no window
  python3 tools/mame-play.py thepit --rompath ~/mameroms --headless --seconds 45 -aviwrite attract.avi \
        -snapshot_directory /tmp/cap

  # record / play back an input tape
  python3 tools/mame-play.py thepit --rompath ~/mameroms -record run.inp
  python3 tools/mame-play.py thepit --rompath ~/mameroms -playback run.inp

Any flags after the known options are passed straight through to MAME.
"""
import argparse
import json
import os
import shutil
import sys
import tempfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("game", help="game id under games/ (e.g. thepit, dkong)")
    ap.add_argument("--rompath", required=True, help="dir that contains the <driver>/ romset folder")
    ap.add_argument("--board", help="board dir under boards/ (default: same name as game)")
    ap.add_argument("--driver", help="override the MAME driver (default: board hardware.json 'driver')")
    ap.add_argument("--mame", default=os.environ.get("MAME", "mame"), help="mame binary (default: mame)")
    ap.add_argument("--headless", action="store_true",
                    help="null SDL video + -video none -sound none -nothrottle (for capture, not play)")
    ap.add_argument("--seconds", type=int, help="-seconds_to_run N (emulated seconds, then auto-exit)")
    # everything argparse doesn't recognize (e.g. -aviwrite foo, -record run.inp) passes through to MAME
    a, passthrough = ap.parse_known_args()

    board = a.board or a.game
    driver = a.driver
    if not driver:
        hw_path = os.path.join(REPO, "boards", board, "hardware.json")
        try:
            driver = json.load(open(hw_path))["driver"]
        except (OSError, KeyError) as e:
            sys.exit(f"play.py: could not read driver from {hw_path} ({e}); pass --driver")

    cfg = tempfile.mkdtemp(prefix=f"mame-{a.game}-")
    argv = [
        a.mame, driver,
        "-rompath", a.rompath,
        "-noreadconfig", "-nowriteconfig", "-skip_gameinfo",
        "-nvram_directory", os.path.join(cfg, "nvram"),
        "-cfg_directory", os.path.join(cfg, "cfg"),
    ]
    env = dict(os.environ)
    if a.headless:
        env["SDL_VIDEODRIVER"] = "dummy"  # null backend, no window (mame#7345)
        argv += ["-video", "none", "-sound", "none", "-nothrottle"]
    else:
        env.pop("SDL_VIDEODRIVER", None)  # windowed: use the real video driver, not the headless null one
    if a.seconds:
        argv += ["-seconds_to_run", str(a.seconds)]
    argv += [x for x in passthrough if x != "--"]

    print("play.py: " + " ".join(argv), file=sys.stderr)
    os.execvpe(argv[0], argv, env)


if __name__ == "__main__":
    main()
