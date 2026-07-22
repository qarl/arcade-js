#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Capture golden reference frames + state dumps from MAME.

This is the ground-truth side of the arcade-js validation harness. It runs MAME
under a pinned, determinism-controlled command line and emits artifacts in
exactly the formats the translated JS also emits, so comparison is a memcmp.

DETERMINISM (proven, see docs/04-integration-testing.md): two independent runs under
this command line produce BYTE-IDENTICAL AVI output. The controls that matter
are a fresh empty -nvram_directory per run (DK writes high scores), -nonvram_save,
-nocheat, -noautosave, -frameskip 0, -nothrottle.

This tool is GAME-AGNOSTIC: the board driver/screen/refresh come from --hardware
(boards/<board>/hardware.json) and the Lua dumpers from --lua-dir; neither is
defaulted. The game-specific caller (games/<id>/tools/*) supplies both.

Usage:
  mame_golden.py --hardware boards/dkong/hardware.json \
                 --lua-dir games/dkong/tools/lua --out DIR --seconds 3
  mame_golden.py --hardware ... --lua-dir ... --out DIR --seconds 30 --playback tape.inp
  mame_golden.py --hardware ... --lua-dir ... --out DIR --seconds 30 --record tape.inp
"""

import argparse
import os as _os_hl; _os_hl.environ.setdefault("SDL_VIDEODRIVER", "dummy")  # noqa: E702 -- headless: null SDL backend, no window (mame#7345).
import hashlib
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hardware  # noqa: E402
import frameio  # noqa: E402
import scope  # noqa: E402
import stateio  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# The board driver, screen size and refresh come from --hardware; the Lua dumpers
# (game-specific) come from --lua-dir. Neither is defaulted: a shared tool must be
# told which board it is capturing. Both are resolved in main() into args.


def lua_paths(lua_dir):
    """The three dumper scripts inside a --lua-dir (game-specific Lua)."""
    return (
        os.path.join(lua_dir, "dump_state.lua"),
        os.path.join(lua_dir, "dump_at_pc.lua"),
        os.path.join(lua_dir, "dump_writes.lua"),
    )


def build_mame_argv(args, hw, workdir, avi_name="out"):
    """The known-good command line. Every flag here is load-bearing -- see docs/04-integration-testing.md.

    Gotchas encoded here so nobody rediscovers them:
      * MAME boolean options take the -noX form. '-nocheat 0' is a parse error.
      * -aviwrite appends '.avi' itself, so pass 'out', not 'out.avi'.
      * -aviwrite's path is relative to -snapshot_directory.
    """
    argv = [
        args.mame,
        hw.driver,  # romset/driver name, from hardware.json
        "-rompath",
        args.rompath,
        "-norotate",  # frame contract: compare unrotated WxH
        "-video",
        "none",  # headless; proven byte-identical to -video soft
        "-sound",
        "none",
        "-nothrottle",
        "-frameskip",
        "0",
        "-snapshot_directory",
        workdir,
        "-snapsize",
        f"{hw.screen_width}x{hw.screen_height}",  # from hardware.json screen
        "-snapview",
        "native",
        "-nvram_directory",
        os.path.join(workdir, "nvram"),  # fresh + empty per run
        # SAME HAZARD CLASS AS NVRAM, and proven not theoretical: MAME persists
        # DIPSWITCH changes to cfg/<game>.cfg and defaults cfg_directory to "cfg"
        # relative to cwd. A stray cfg silently changes what the golden ran with,
        # and the value never appears in the capture. Measured: with a cfg setting
        # the Lives switch, DSW0 (0x7D80) read 0x83 instead of 0x80.
        "-cfg_directory",
        os.path.join(workdir, "cfg"),  # fresh + empty per run
        "-nonvram_save",
        "-nocheat",
        "-noautosave",
        "-seconds_to_run",
        str(args.seconds),
    ]
    if not args.no_frames:
        argv += ["-aviwrite", avi_name]
    # A Lua script is ALWAYS installed, because it is what certifies the machine
    # configuration (DSW0). Skipping it on some paths made those captures certify
    # green with DSW0 unverified.
    if args.tape:
        # A Lua TAPE drives input; the instrument script records. MAME takes ONE
        # -autoboot_script, so they are composed into a generated shim rather
        # than chosen between -- capturing golden for a tape previously meant
        # giving up the instrument, which is why no authored tape had a golden.
        #
        # The shim dofile()s both. Order matters: the tape installs its input
        # notifier first so its frame numbering starts at the same frame the
        # instrument samples.
        inner = (
            args.lua_writes
            if args.writes
            else (args.lua_at_pc if args.at_pc else args.lua_state)
        )
        shim = os.path.join(workdir, "tape_shim.lua")
        with open(shim, "w") as fh:
            fh.write("dofile(%r)\n" % os.path.abspath(args.tape))
            fh.write("dofile(%r)\n" % inner)
        argv += ["-autoboot_script", shim]
    elif args.writes:
        # Hardware write trace: gates the control latches, i8257
        # programming and sound latch -- the surface the state dump never covered.
        argv += ["-autoboot_script", args.lua_writes]
    elif args.at_pc:
        # PC-exact capture (closes the frame-boundary sampling gap): emits a
        # single state frame at the moment PC first reaches the target address.
        argv += ["-autoboot_script", args.lua_at_pc]
    else:
        argv += ["-autoboot_script", args.lua_state]
    if args.playback:
        argv += ["-playback", os.path.abspath(args.playback)]
    if args.record:
        argv += ["-record", os.path.abspath(args.record)]
    return argv


def extract_frames(avi_path, out_dir):
    """AVI -> frames.rgb in the frame contract's RGB888 layout.

    CRITICAL: MAME's AVI is bgr24. Dumping it raw silently swaps R and B, which
    makes every frame differ for a reason that looks like a palette bug. The
    explicit -pix_fmt rgb24 is what prevents that.

    Also: -map 0:v:0 is required. MAME writes an AUDIO stream into the AVI even
    under -sound none, and unfiltered ffmpeg output interleaves both streams.
    """
    rgb_path = os.path.join(out_dir, "frames.rgb")
    cmd = [
        "ffmpeg",
        "-v",
        "error",
        "-i",
        avi_path,
        "-map",
        "0:v:0",  # video only; MAME writes audio even with -sound none
        "-fps_mode",
        "passthrough",  # no frame duplication/drop; 1:1 with emulated frames
        "-pix_fmt",
        "rgb24",  # source is bgr24 -- this conversion is mandatory
        "-f",
        "rawvideo",
        "-y",
        rgb_path,
    ]
    subprocess.run(cmd, check=True)

    size = os.path.getsize(rgb_path)
    if size % frameio.BYTES_PER_FRAME != 0:
        raise RuntimeError(
            f"frames.rgb is {size} bytes, not a multiple of {frameio.BYTES_PER_FRAME}"
        )
    count = size // frameio.BYTES_PER_FRAME

    hashes = []
    with open(rgb_path, "rb") as fh:
        for _ in range(count):
            hashes.append(frameio.frame_sha256(fh.read(frameio.BYTES_PER_FRAME)))
    frameio.write_index(out_dir, hashes)
    return count, hashes


def finalize_state(raw_path, out_dir):
    """Index the Lua state dump, truncating any partial trailing frame.

    MAME exits without running a Lua stop hook, so the dumper writes unbuffered
    and the final frame may be a partial write. Whole frames only.
    """
    size = os.path.getsize(raw_path)
    count = size // stateio.BYTES_PER_FRAME
    partial = size % stateio.BYTES_PER_FRAME

    dst = os.path.join(out_dir, "state.bin")
    hashes = []
    with open(raw_path, "rb") as src, open(dst, "wb") as out:
        for _ in range(count):
            buf = src.read(stateio.BYTES_PER_FRAME)
            out.write(buf)
            hashes.append(stateio.frame_sha256(buf))
    stateio.write_index(out_dir, hashes)
    return count, partial, hashes


def watchdog_check(hashes, guard_from=10):
    """Detect a mid-capture watchdog reset, which silently poisons golden data.

    Reading 0x7D00 kicks DK's watchdog (dkong_in2_r calls watchdog_reset), and the
    NMI reads it every frame. If our model ever drops that kick MAME resets while
    the JS sails on. More urgently for THIS side: a reset inside a golden capture
    re-runs boot, so the reference frames themselves become wrong -- and quietly
    wrong reference data is worse than none.

    Signature: the distinctive frame-0 image (zeroed-VRAM stripes) reappearing
    well after boot. Once the ROM clears VRAM it should never recur.
    """
    if not hashes:
        return []
    boot_sig = hashes[0]
    return [i for i, h in enumerate(hashes) if h == boot_sig and i >= guard_from]


def main():
    p = argparse.ArgumentParser(description="Capture golden MAME reference artifacts")
    hardware.add_hardware_arg(p)
    p.add_argument(
        "--lua-dir",
        required=True,
        metavar="DIR",
        help="directory holding the game's Lua dumpers (dump_state.lua, "
        "dump_at_pc.lua, dump_writes.lua). Game-specific; the caller supplies it.",
    )
    p.add_argument("--out", required=True, help="output directory for artifacts")
    # int, not float: MAME's -seconds_to_run truncates, so a float would make the
    # manifest's provenance record disagree with what actually ran.
    p.add_argument("--seconds", type=int, default=3, help="emulated seconds to run")
    p.add_argument(
        "--tape",
        help="Lua input tape (tapes/*.lua), composed with the instrument script",
    )
    p.add_argument("--playback", help="input tape to play back (.inp)")
    p.add_argument("--record", help="record an input tape to this path (.inp)")
    p.add_argument("--rompath", default=os.path.expanduser("~/Downloads"))
    p.add_argument("--mame", default="mame")
    p.add_argument("--no-frames", action="store_true", help="skip AVI/frame capture")
    p.add_argument("--no-state", action="store_true", help="skip Lua state capture")
    p.add_argument("--keep-avi", action="store_true", help="keep the intermediate AVI")
    p.add_argument(
        "--writes",
        action="store_true",
        help="capture a hardware write trace (latches, i8257, sound latch) instead "
        "of a state dump -- gates what the ROM computes WITH",
    )
    p.add_argument(
        "--at-pc",
        help="capture ONE state frame at the moment PC first reaches this address "
        "(e.g. 0x02B8). Samples mid-frame, which frame-boundary sampling cannot.",
    )
    args = p.parse_args()

    if args.no_frames and args.no_state:
        p.error("--no-frames and --no-state together would capture nothing")
    if args.writes and args.at_pc:
        p.error("--writes and --at-pc are different capture modes; pick one")
    if args.at_pc and args.no_state:
        # The PC sample IS state; skipping the state block would make the
        # never-reached poison unreachable and certify an empty capture green.
        p.error("--at-pc emits a state frame, so it cannot be combined with --no-state")

    # Load the board hardware map and configure the shared modules from it, then
    # resolve the game-specific Lua dumpers from --lua-dir.
    hw = hardware.load_from_args(args)
    frameio.configure(hw)
    scope.configure(hw)
    stateio.configure(hw)
    args.lua_state, args.lua_at_pc, args.lua_writes = lua_paths(args.lua_dir)
    for pth in (args.lua_state, args.lua_at_pc, args.lua_writes):
        if not os.path.exists(pth):
            p.error(f"--lua-dir missing dumper: {pth}")

    os.makedirs(args.out, exist_ok=True)
    workdir = tempfile.mkdtemp(prefix="mame_golden_")
    os.makedirs(os.path.join(workdir, "nvram"), exist_ok=True)
    os.makedirs(os.path.join(workdir, "cfg"), exist_ok=True)

    try:
        argv = build_mame_argv(args, hw, workdir)
        env = dict(os.environ)
        env["STATE_OUT"] = os.path.join(workdir, "state.raw")
        env["CONFIG_OUT"] = os.path.join(workdir, "config.txt")
        env["WRITES_OUT"] = os.path.join(workdir, "writes.txt")
        # Config-only mode: still certify DSW0 when no state dump is wanted.
        env["STATE_ENABLED"] = "0" if args.no_state else "1"
        if args.at_pc:
            env["PC_TARGET"] = args.at_pc
            env["PC_META"] = os.path.join(args.out, "state_at_pc.txt")

        print("[capture] " + " ".join(argv))
        res = subprocess.run(argv, env=env, capture_output=True, text=True)
        if res.returncode != 0:
            sys.stderr.write(res.stdout + res.stderr)
            raise RuntimeError(f"MAME exited {res.returncode}")

        manifest = {
            "mame_argv": argv,
            "seconds": args.seconds,
            "refresh_hz": hw.refresh_hz,
            "playback": args.playback,
            "record": args.record,
        }

        # THE TAPE'S PARAMETERS TRAVEL WITH THE GOLDEN, NOT ONLY WITH THE TAPE.
        #
        # A Lua tape reads its timings from the environment so they can be SWEPT
        # without editing the contract. That means a golden captured from one is
        # uninterpretable without the values it was captured under -- "coin at
        # frame 10" is a property of THIS ARTIFACT, and env defaults are exactly
        # the kind of thing that drifts silently.
        #
        # Same argument that refused to re-time coin_start.lua rather than add a
        # second tape, applied to the artifact instead of the source.
        if args.tape:
            manifest["tape"] = os.path.abspath(args.tape)
            manifest["tape_sha256"] = hashlib.sha256(
                open(args.tape, "rb").read()
            ).hexdigest()
            manifest["tape_env"] = {
                k: v for k, v in sorted(os.environ.items()) if k.startswith("TAPE_")
            }

        # Poison conditions. A capture we have ourselves
        # identified as suspect must HARD-FAIL, not warn and exit 0. Quietly
        # wrong reference data is worse than no reference data, and in a
        # `mame_golden.py && framediff.py` pipeline a warning flows straight
        # through to the consumer.
        poison = []

        if not args.no_frames:
            avi = os.path.join(workdir, "out.avi")
            if not os.path.exists(avi):
                raise RuntimeError(f"MAME produced no AVI at {avi}")
            n, fh = extract_frames(avi, args.out)
            manifest["frame_count"] = n
            print(f"[frames] {n} frames -> {args.out}/frames.rgb")

            if n == 0:
                poison.append("capture produced 0 frames")
            else:
                # avi_frame_count = ceil(refresh * seconds) + 1.
                # A capture that misses this was truncated or mis-run, and is the
                # exact input that makes a short-run false PASS possible downstream.
                expect = math.ceil(hw.refresh_hz * args.seconds) + 1
                manifest["expected_frame_count"] = expect
                if n != expect:
                    poison.append(
                        f"frame count {n} != documented formula "
                        f"ceil({hw.refresh_hz}*{args.seconds})+1 = {expect}"
                    )

            hits = watchdog_check(fh)
            manifest["watchdog_suspect_frames"] = hits
            if hits:
                poison.append(
                    f"boot-frame signature reappears at frames {hits[:10]} -- MAME "
                    f"likely watchdog-reset mid-capture, so these frames are WRONG"
                )
            if args.keep_avi:
                shutil.copy(avi, os.path.join(args.out, "out.avi"))

        if args.writes:
            wsrc = os.path.join(workdir, "writes.txt")
            n_w = 0
            if os.path.exists(wsrc):
                dst = os.path.join(args.out, "writes.txt")
                shutil.copy(wsrc, dst)
                n_w = sum(1 for ln in open(dst) if ln.strip())
            manifest["write_count"] = n_w
            print(f"[writes] {n_w} writes -> {args.out}/writes.txt")
            # Absence must never read as success. A capture that emits no
            # writes has verified nothing.
            if n_w == 0:
                poison.append(
                    "write trace is EMPTY -- no hardware writes captured, so this "
                    "trace verifies nothing (not a pass)"
                )
        elif not args.no_state:
            raw = os.path.join(workdir, "state.raw")
            if not os.path.exists(raw):
                raise RuntimeError(f"Lua dumper produced nothing at {raw}")
            n, partial, sh = finalize_state(raw, args.out)
            manifest["state_count"] = n
            manifest["state_partial_tail_bytes"] = partial
            print(
                f"[state ] {n} frames -> {args.out}/state.bin"
                + (f" (dropped {partial}B partial tail)" if partial else "")
            )

            if n == 0:
                poison.append(
                    "state capture produced 0 frames"
                    + (f" -- PC {args.at_pc} was never reached" if args.at_pc else "")
                )
            elif args.at_pc:
                # A PC-triggered capture is one sample by design, so the
                # ceil(refresh*seconds) frame-count invariant does not apply.
                manifest["at_pc"] = args.at_pc
                if n != 1:
                    poison.append(
                        f"--at-pc produced {n} state frames, expected exactly 1"
                    )
            else:
                # The +1 is the power-on sample taken at Lua script
                # load, before any instruction runs; the notifier then supplies
                # one sample per emulated frame. That extra sample is what makes
                # state[N] mean "after N frames" rather than "after N+1".
                #
                # This check must NOT live under `if not args.no_frames` -- a
                # state-only capture would then have no length validation at all,
                # and the Lua dumper's documented failure mode (GC-unsubscribe ->
                # exactly one frame, plausible-looking truncated file) would sail
                # through certified.
                expect_state = math.ceil(hw.refresh_hz * args.seconds) + 1
                manifest["expected_state_count"] = expect_state
                if n != expect_state:
                    poison.append(
                        f"state frame count {n} != documented formula "
                        f"ceil({hw.refresh_hz}*{args.seconds})+1 = {expect_state} "
                        f"(truncated dump, or the Lua notifier unsubscribed)"
                    )
                # Verified power-on invariant. If this is false the
                # capture is by definition not ground truth.
                zero_ok = (
                    stateio.StateSet(args.out).read(0)
                    == b"\x00" * stateio.BYTES_PER_FRAME
                )
                manifest["state0_all_zero"] = zero_ok
                if not zero_ok:
                    poison.append(
                        "state[0] is NOT all zero -- the verified power-on RAM "
                        "invariant is broken, so this is not ground truth"
                    )
                # The state dump is scannable for a mid-capture reset too, so a
                # --no-frames capture is not left without poisoning detection.
                shits = watchdog_check(sh)
                manifest["state_watchdog_suspect_frames"] = shits
                if shits:
                    poison.append(
                        f"power-on state signature reappears at state frames "
                        f"{shits[:10]} -- likely a mid-capture reset"
                    )

        # Certify the machine CONFIGURATION, not just the data. A capture taken
        # with a stray dipswitch cfg is wrong in a way nothing downstream can see.
        cfg_path = os.path.join(workdir, "config.txt")
        if args.writes:
            # The writes script does not probe config; DSW0 is certified by the
            # separate state capture. Record honestly rather than implying it was
            # checked here.
            manifest["dsw0_verified"] = False
            manifest["dsw0_note"] = "not probed on --writes captures"
        elif not os.path.exists(cfg_path):
            # Never a silent skip: an unverified configuration is not a verified one.
            poison.append(
                "machine configuration was NOT certified -- no config.txt was "
                "produced, so DSW0 is unverified rather than verified"
            )
            manifest["dsw0_verified"] = False
        else:
            cfg = dict(
                ln.split("=", 1) for ln in open(cfg_path).read().split() if "=" in ln
            )
            manifest["dsw0"] = cfg.get("dsw0")
            dsw0 = int(cfg.get("dsw0", "0"), 16)
            control = int(cfg.get("control_rom0000", "0"), 16)
            if control != scope.ROM0000_CONTROL:
                poison.append(
                    f"config probe control failed: ROM 0x0000 read "
                    f"0x{control:02X}, expected 0x{scope.ROM0000_CONTROL:02X} -- probe broken, so "
                    f"the DSW0 reading below means nothing"
                )
                manifest["dsw0_verified"] = False
            elif dsw0 != scope.DSW0_EXPECTED:
                poison.append(
                    f"DSW0 is 0x{dsw0:02X}, contract pins 0x{scope.DSW0_EXPECTED:02X} "
                    f"-- a dipswitch differs from the pinned machine configuration "
                    f"(stray cfg?), so this golden is not comparable to any other"
                )
                manifest["dsw0_verified"] = False
            else:
                manifest["dsw0_verified"] = True

            # Certify the CPU RESET STATE too. It is an input to everything the
            # ROM computes, exactly like DSW0 -- and only IX/IY are ever
            # observable, because the ROM overwrites every other register before
            # the first NMI. So a drifted AF or SP would be invisible in the data
            # and wrong wherever it eventually mattered.
            regs = {k[4:]: int(v, 16) for k, v in cfg.items() if k.startswith("reg_")}
            if regs:
                manifest["z80_reset"] = {k: f"0x{v:04X}" for k, v in regs.items()}
                bad = {
                    k: (v, scope.Z80_RESET_STATE[k])
                    for k, v in regs.items()
                    if k in scope.Z80_RESET_STATE and v != scope.Z80_RESET_STATE[k]
                }
                manifest["z80_reset_verified"] = not bad
                if bad:
                    detail = ", ".join(
                        f"{k}=0x{got:04X} (contract 0x{want:04X})"
                        for k, (got, want) in sorted(bad.items())
                    )
                    poison.append(
                        f"Z80 reset state differs from the pinned contract: {detail}"
                        f" -- MAME's initialisation changed, so this golden is not"
                        f" comparable to any other"
                    )
            else:
                manifest["z80_reset_verified"] = False

        with open(os.path.join(args.out, "manifest.json"), "w") as fh:
            json.dump(manifest, fh, indent=1)
            fh.write("\n")

        if not args.no_frames and not args.no_state:
            delta = manifest["frame_count"] - manifest["state_count"]
            print(
                f"[note  ] AVI frames={manifest['frame_count']} "
                f"emulated frames={manifest['state_count']} (delta={delta})"
            )
            # Delta 0, not 1. AVI frame 0 is the machine-init framebuffer and
            # state[0] is the power-on sample -- the SAME instant -- so the two
            # clocks are aligned. The delta of 1 this check originally enforced
            # was an artifact of the state dump being off by one frame (the Lua
            # frame notifier fires at the END of frame N, so sampling only on the
            # notifier made state[0] mean "after one frame"). Fixed in
            # lua/dump_state.lua; the clocks agreeing is now a positive signal.
            if args.at_pc:
                print("[note  ] --at-pc: one PC-triggered sample, delta check N/A")
            elif delta != 0:
                poison.append(
                    f"AVI/emulated frame delta is {delta}, expected exactly 0 "
                    f"(AVI frame 0 and state[0] are the same instant)"
                )

        if poison:
            sys.stderr.write(
                "\n*** POISONED CAPTURE -- refusing to certify this as golden data.\n"
            )
            for reason in poison:
                sys.stderr.write(f"***   - {reason}\n")
            sys.stderr.write(
                "*** Artifacts were written but MUST NOT be used as a reference "
                "until explained.\n\n"
            )
            return 1

        print("[ok    ] capture certified: all invariants hold")
        return 0
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
