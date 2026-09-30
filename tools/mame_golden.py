#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Capture golden reference frames + state dumps from MAME.

Ground-truth side of the arcade-js validation harness: runs MAME under a pinned,
determinism-controlled command line and emits artifacts byte-identical in layout
to the translated JS, so comparison is a memcmp. All rationale (determinism,
MAME-flag gotchas, frame-count formula, config/reset certification, poison
policy) lives in docs/mame-golden.md.

GAME-AGNOSTIC: board driver/screen/refresh come from --hardware
(boards/<board>/hardware.json), Lua dumpers from --lua-dir; neither is defaulted.

Usage:
  mame_golden.py --hardware boards/dkong/hardware.json \
                 --lua-dir games/dkong/tools/lua --out DIR --seconds 3
  mame_golden.py --hardware ... --out DIR --seconds 30 --playback tape.inp
  mame_golden.py --hardware ... --out DIR --seconds 30 --record tape.inp
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
import raw_dumps  # noqa: E402
import frameio  # noqa: E402
import scope  # noqa: E402
import stateio  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def lua_paths(lua_dir):
    """The three dumper scripts inside a --lua-dir (game-specific Lua)."""
    return (
        os.path.join(lua_dir, "dump_state.lua"),
        os.path.join(lua_dir, "dump_at_pc.lua"),
        os.path.join(lua_dir, "dump_writes.lua"),
    )


def build_mame_argv(args, hw, workdir, avi_name="out"):
    """The known-good command line. Every flag is load-bearing; MAME-flag gotchas: docs/mame-golden.md."""
    argv = [
        args.mame,
        # The MAME machine to launch. Usually the hardware.json driver, but a port can target a
        # CLONE set whose program differs from the parent driver (Centipede: driver "centiped" is
        # the rev4 parent, but the port targets the "centiped3" rev3 clone -- a different program,
        # reset 0x3B04 vs 0x3B4B). --set overrides which machine runs; it defaults to hw.driver so
        # every existing game (driver == set == parent) is unchanged.
        getattr(args, "set", None) or hw.driver,
        "-rompath",
        args.rompath,
        "-norotate",  # frame contract: compare unrotated WxH
        "-video",
        "none",
        "-sound",
        "none",
        "-nothrottle",
        "-frameskip",
        "0",
        "-snapshot_directory",
        workdir,
        "-snapsize",
        f"{hw.screen_width}x{hw.screen_height}",
        "-snapview",
        "native",
        "-nvram_directory",
        os.path.join(workdir, "nvram"),  # fresh + empty per run
        # -cfg_directory: same NVRAM-class hazard, and proven real -- a stray cfg
        # silently changes the machine config, invisibly. See docs/mame-golden.md.
        "-cfg_directory",
        os.path.join(workdir, "cfg"),
        "-nonvram_save",
        "-nocheat",
        "-noautosave",
        "-seconds_to_run",
        str(args.seconds),
    ]
    if not args.no_frames:
        argv += ["-aviwrite", avi_name]
    # A Lua script is ALWAYS installed: it certifies DSW0. Skipping it on some
    # paths certified captures green with DSW0 unverified.
    if args.tape:
        # A Lua TAPE drives input; the instrument script records. MAME takes ONE
        # -autoboot_script, so a generated shim dofile()s both -- tape FIRST so its
        # input notifier's frame numbering matches the frame the instrument samples.
        inner = (
            args.lua_writes
            if args.writes
            else (args.lua_at_pc if args.at_pc else args.lua_state)
        )
        shim = os.path.join(workdir, "tape_shim.lua")
        with open(shim, "w") as fh:
            # TEST-ONLY entropy pin FIRST: patches ROM at load, before CPU + tape notifier, so RNG is pinned all run.
            if args.pin_entropy:
                pin_lua = os.path.join(args.lua_dir, "pin_entropy.lua")
                fh.write("dofile(%r)\n" % os.path.abspath(pin_lua))
            fh.write("dofile(%r)\n" % os.path.abspath(args.tape))
            fh.write("dofile(%r)\n" % inner)
        argv += ["-autoboot_script", shim]
    elif args.writes:
        # Hardware write trace: gates control latches, i8257, sound latch -- surface the state dump never covered.
        argv += ["-autoboot_script", args.lua_writes]
    elif args.at_pc:
        # PC-exact capture: one state frame when PC first reaches the target (closes the frame-boundary gap).
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
    bgr24 swap + audio-stream gotchas (why -pix_fmt rgb24 and -map 0:v:0): docs/mame-golden.md.
    """
    rgb_path = os.path.join(out_dir, "frames.rgb")
    cmd = [
        "ffmpeg",
        "-v",
        "error",
        "-i",
        avi_path,
        "-map",
        "0:v:0",
        "-fps_mode",
        "passthrough",  # no frame duplication/drop; 1:1 with emulated frames
        "-pix_fmt",
        "rgb24",
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
    MAME exits without a Lua stop hook, so the last frame may be a partial write; keep whole frames only.
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

    A reset re-runs boot, so reference frames become quietly wrong (worse than none).
    Signature: the frame-0 image (zeroed-VRAM stripes) reappearing well after boot.
    """
    if not hashes:
        return []
    boot_sig = hashes[0]
    # A long uniform boot-fill (galaxian/frogger: ~50 frames of a character-tile fill while RAM
    # loads) can PERSIST as a leading run -- not a reset. A real reset reverts to boot AFTER content
    # shows, so only a recurrence PAST first_div (the first frame != boot) counts.
    first_div = next((i for i, h in enumerate(hashes) if h != boot_sig), None)
    if first_div is None:
        return []  # never left the boot image; the length/zero-frame checks catch a dead capture
    return [i for i, h in enumerate(hashes) if h == boot_sig and i > first_div and i >= guard_from]


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
    # int, not float: -seconds_to_run truncates, so a float would desync the manifest's provenance record.
    p.add_argument("--seconds", type=int, default=3, help="emulated seconds to run")
    p.add_argument(
        "--tape",
        help="Lua input tape (tapes/*.lua), composed with the instrument script",
    )
    p.add_argument("--playback", help="input tape to play back (.inp)")
    p.add_argument("--record", help="record an input tape to this path (.inp)")
    p.add_argument(
        "--pin-entropy",
        dest="pin_entropy",
        help="TEST-ONLY: entropy-pin spec 'AAAA:VV,...' (from the game's "
        "entropyPinRomSpec). Applies tools/lua/pin_entropy.lua before the tape so the "
        "game's RNG matches the pinned JS engine. See docs/idiomatic-generation.md (Entropy pinning).",
    )
    p.add_argument("--rompath", default=os.path.expanduser("~/Downloads"))
    p.add_argument(
        "--set",
        dest="set",
        default=None,
        help="MAME machine/set to launch, overriding the hardware.json driver -- for a port "
        "that targets a CLONE set whose program differs from the parent (e.g. --set centiped3, "
        "the rev3 clone of parent driver 'centiped'). Defaults to the driver, so games where "
        "driver == set are unchanged.",
    )
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
        # The PC sample IS state; skipping the state block would certify an empty capture green.
        p.error("--at-pc emits a state frame, so it cannot be combined with --no-state")

    # Load the board hardware map, configure the shared modules, then resolve the Lua dumpers.
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
        if args.pin_entropy:
            env["ENTROPY_PIN"] = args.pin_entropy  # read by tools/lua/pin_entropy.lua
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
            "mame_set": getattr(args, "set", None) or hw.driver,  # the machine actually launched (may be a clone != driver)
            "seconds": args.seconds,
            "refresh_hz": hw.refresh_hz,
            "playback": args.playback,
            "record": args.record,
        }

        # The tape's parameters travel WITH the golden, not only with the tape: a
        # tape's env timings drift silently, so record them here. See docs/mame-golden.md.
        if args.tape:
            manifest["tape"] = os.path.abspath(args.tape)
            manifest["tape_sha256"] = hashlib.sha256(
                open(args.tape, "rb").read()
            ).hexdigest()
            manifest["tape_env"] = {
                k: v for k, v in sorted(os.environ.items()) if k.startswith("TAPE_")
            }

        # Poison conditions: a suspect capture must HARD-FAIL, never warn. Rationale: docs/mame-golden.md.
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
                # avi_frame_count = floor(refresh*seconds) + 2. The obvious formula is
                # wrong; the full derivation (and why NOT ceil(hz*sec)+1, and the per-board
                # scoping caveat -- re-measure T on a 4th board) is in docs/mame-golden.md.
                expect = math.floor(hw.refresh_hz * args.seconds) + 2
                manifest["expected_frame_count"] = expect
                if n != expect:
                    poison.append(
                        f"frame count {n} != documented formula "
                        f"floor({hw.refresh_hz}*{args.seconds})+2 = {expect}"
                    )

            hits = watchdog_check(fh)
            manifest["watchdog_suspect_frames"] = hits
            # The frame-0 image is a ZEROED-VRAM screen; a game that blanks the screen mid-attract WITHOUT
            # a reset (galaxian blanks between attract phases) reproduces it -- a false positive. A REAL
            # watchdog reset also reverts RAM, so the STATE-signature check below is the authority whenever
            # state is captured; only poison on the frame signature ALONE when there is no state dump to
            # corroborate. (Frame hits are still recorded in the manifest for the record.)
            if hits and args.no_state:
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
            # Absence must never read as success: a no-write capture verifies nothing.
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
                # A PC-triggered capture is one sample by design; the frame-count invariant does not apply.
                manifest["at_pc"] = args.at_pc
                if n != 1:
                    poison.append(
                        f"--at-pc produced {n} state frames, expected exactly 1"
                    )
            else:
                # Same floor(hz*sec)+2 as AVI (power-on sample + notifier samples), and it
                # must NOT live under `if not args.no_frames`. Why: docs/mame-golden.md.
                expect_state = math.floor(hw.refresh_hz * args.seconds) + 2
                manifest["expected_state_count"] = expect_state
                if n != expect_state:
                    poison.append(
                        f"state frame count {n} != documented formula "
                        f"floor({hw.refresh_hz}*{args.seconds})+2 = {expect_state} "
                        f"(truncated dump, or the Lua notifier unsubscribed)"
                    )
                # Verified power-on invariant: if false, this is by definition not ground truth.
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
                # Scan the state dump for a mid-capture reset too, so --no-frames still has poison detection.
                shits = watchdog_check(sh)
                manifest["state_watchdog_suspect_frames"] = shits
                if shits:
                    poison.append(
                        f"power-on state signature reappears at state frames "
                        f"{shits[:10]} -- likely a mid-capture reset"
                    )

        # Certify the machine CONFIGURATION, not just the data (a stray dipswitch cfg is invisible downstream).
        cfg_path = os.path.join(workdir, "config.txt")
        if args.writes:
            # The writes script does not probe config; DSW0 is certified by the
            # separate state capture. Record honestly rather than imply a check.
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
            if hw.cpu == "6502":
                # 6502 boards (Centipede): the program ROM is memory-mapped high (0x2000-0x3FFF),
                # not at 0x0000, and there is no single Konami-style DSW byte -- there are two dip
                # ports (DSW1 0x0800 gameplay bits, DSW2 0x0801 coinage). Certify (a) the ROM loaded
                # via its measured first opcode byte at the ROM base (control_rom2000 == controlByte;
                # 0x4C = JMP, an unmapped/absent ROM would read 0x00/0xFF), and (b) the pinned
                # gameplay dip (DSW1) matches -- a stray cfg silently changing lives/bonus/difficulty
                # would poison every frame. DSW2 (coinage) is recorded, not gated: it does not affect
                # attract-mode determinism (no coin is inserted), so pinning it would only add a
                # brittle check. 6502 reset registers are recorded (not contract-pinned: the 6502
                # reset state is owned by core/cpu/6502.js and not independently re-derived here).
                control = int(cfg.get("control_rom2000", "-1"), 16)
                manifest["rom_verified"] = control == hw.control_byte
                if hw.control_byte is None or control != hw.control_byte:
                    poison.append(
                        f"config probe: ROM 0x2000 read 0x{control:02X}, expected "
                        f"0x{(hw.control_byte or 0):02X} (measured first opcode) -- the program ROM "
                        f"did not load, so this golden is meaningless"
                    )
                if hw.dsw0_expected is None:
                    manifest["dsw0_verified"] = None
                else:
                    dsw1 = int(cfg.get("dsw1", "-1"), 16)
                    manifest["dsw0"] = cfg.get("dsw1")
                    if dsw1 != hw.dsw0_expected:
                        poison.append(
                            f"DSW1 is 0x{dsw1:02X}, contract pins 0x{hw.dsw0_expected:02X} "
                            f"-- a gameplay dipswitch differs from the pinned machine "
                            f"configuration (stray cfg?), so this golden is not comparable"
                        )
                        manifest["dsw0_verified"] = False
                    else:
                        manifest["dsw0_verified"] = True
                manifest["dsw2"] = cfg.get("dsw2")  # coinage: recorded, not gated (see above)
                # Record the reset-vector TARGET the ROM booted from: it identifies WHICH program ran
                # (Centipede rev3 centiped3 -> 0x3B04; rev4 parent centiped -> 0x3B4B). This is the
                # provenance that catches a wrong-set capture -- a port targeting a clone must see its
                # clone's entry, not the parent driver's.
                manifest["reset_vector"] = cfg.get("reset_vector")
                # GATE (fail-closed) the booted reset target against the pinned entry, when the board
                # declares one. This is what makes a wrong-set capture IMPOSSIBLE: a port targeting a
                # clone (centiped3, reset 0x3B04) that accidentally ran the parent driver (centiped,
                # reset 0x3B4B) is caught here instead of silently producing a diverging golden. Boards
                # that do not pin expectedResetVector keep this record-only (no forced declaration).
                if hw.expected_reset_vector is not None:
                    got = int(cfg.get("reset_vector", "-1"), 16)
                    manifest["reset_vector_verified"] = got == hw.expected_reset_vector
                    if got != hw.expected_reset_vector:
                        poison.append(
                            f"reset vector target is 0x{got:04X}, contract pins "
                            f"0x{hw.expected_reset_vector:04X} -- the machine booted a DIFFERENT "
                            f"program than the port targets (wrong --set / parent-vs-clone?), so "
                            f"this golden is not comparable to the port"
                        )
                regs = {k[4:]: v for k, v in cfg.items() if k.startswith("reg_")}
                if regs:
                    manifest["cpu_reset"] = regs
            elif hw.control_byte is None:
                # 8080 boards (Space Invaders): no memory-mapped DSW / control byte. Certify the program
                # ROM loaded via a distinctive ROM byte the 8080 dumper wrote (0x0003 = 0xC3, the reset
                # JMP opcode -- unmapped would read 0x00/0xFF), and record the 8080 reset registers.
                manifest["dsw0_verified"] = None
                rom0003 = int(cfg.get("rom0003", "0"), 16)
                manifest["rom_verified"] = rom0003 == 0xC3
                if rom0003 != 0xC3:
                    poison.append(
                        f"config probe: ROM 0x0003 read 0x{rom0003:02X}, expected 0xC3 (reset JMP) "
                        f"-- the program ROM did not load, so this golden is meaningless"
                    )
                regs = {k[4:]: v for k, v in cfg.items() if k.startswith("reg_")}
                if regs:
                    manifest["cpu_reset"] = regs
            else:
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

                # Certify the CPU RESET STATE too -- an input like DSW0. Only IX/IY are
                # observable (ROM overwrites the rest before NMI). See docs/mame-golden.md.
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
            # Delta 0, not 1: AVI frame 0 and state[0] are the same instant, so the
            # clocks are aligned (the old delta-of-1 was a since-fixed off-by-one). Why: docs/mame-golden.md.
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
    # A SIGTERM from the caller (tools/raw_dumps.py stops its children this way) stops MAME/ffmpeg and
    # then unwinds through main's `finally`, so the temp capture dir (out.avi, state.raw) is removed.
    with raw_dumps.signals_to_exit():
        sys.exit(main())
