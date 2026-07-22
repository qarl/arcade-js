#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only

/**
 * Emit validation artifacts in the pixel-diff and state-diff artifact formats.
 *
 *   --state-out DIR   write state.bin + state.json (5120 bytes/frame)
 *   --frames N        number of frames to emit (default 1)
 *   --post-boot       also report the post-boot fingerprint (diagnostic)
 *   --rom PATH        maincpu image (default rom/maincpu.bin)
 *
 * Writes nothing unless asked (write on request, not always-on).
 *
 * SCOPE, STATED PLAINLY: boot spans ~3.52 frames, so frames 0-3 are all
 * inside it and are all we can currently produce; state[4] onward needs the
 * main loop and the NMI handler. Asking for more yields a SHORT file plus a
 * NOTE and a NONZERO exit -- state.json always records the true count, and a
 * short artifact must not exit 0 and read as complete.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Machine } from "../machine.js";
import { STATE_DUMP_SIZE } from "../../../boards/dkong/memory.js";

function parseArgs(argv) {
  const args = {
    rom: "rom/maincpu.bin", frames: 1, stateOut: null, writesOut: null,
    framesOut: null, postBoot: false, pokes: [], inputs: [],
  };
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case "--rom": args.rom = argv[++i]; break;
      case "--frames": {
        // Bind once: reading argv[++i] twice advances the index an extra
        // step and silently swallows the following flag.
        const v = argv[++i];
        if (v !== "all" && !Number.isInteger(Number(v))) {
          throw new Error(`--frames expects an integer or "all", got ${v}`);
        }
        args.frames = v === "all" ? "all" : Number(v);
        break;
      }
      case "--state-out": args.stateOut = argv[++i]; break;
      case "--writes-out": args.writesOut = argv[++i]; break;
      case "--frames-out": args.framesOut = argv[++i]; break;
      case "--poke": {
        // ADDR=VAL@FRAME[:hold[N]|once] -- match lua/poke_ram.lua (write at the
        // frame boundary before CPU exec). hold = rewrite every frame from
        // FRAME on (default); holdN = for N frames then RELEASE (so the game's
        // own code manages the byte after -- e.g. hold a level select through
        // board-init, then let gameplay run); once = single write at FRAME.
        const spec = argv[++i];
        const mt = spec.match(
          /^(0x[0-9a-fA-F]+|\d+)=(0x[0-9a-fA-F]+|\d+)@(\d+)(?::(hold|once)(\d+)?)?$/,
        );
        if (!mt) {
          throw new Error(
            `--poke expects ADDR=VAL@FRAME[:hold[N]|once], got ${spec}`,
          );
        }
        const pmode = mt[4] || "hold";
        const pdur = pmode === "once" ? 1 : mt[5] ? Number(mt[5]) : null;
        args.pokes.push({
          addr: Number(mt[1]) & 0xffff,
          val: Number(mt[2]) & 0xff,
          frame: Number(mt[3]),
          dur: pdur,
        });
        break;
      }
      case "--input": {
        // PORT=BITS@FRAME[:hold|once] -- assert input bits on IN0(0x7C00)/
        // IN1(0x7C80)/IN2(0x7D00) so the ROM's own credit/start logic drives
        // gameplay. Default once = a 1-frame pulse (coin/start); hold = a held
        // direction from FRAME on.
        const spec = argv[++i];
        const mt = spec.match(
          /^(0x[0-9a-fA-F]+|\d+)=(0x[0-9a-fA-F]+|\d+)@(\d+)(?::(hold|once)(\d+)?)?$/,
        );
        if (!mt) {
          throw new Error(
            `--input expects PORT=BITS@FRAME[:hold[N]|once], got ${spec}`,
          );
        }
        const imode = mt[4] || "once";
        // dur = # of frames the bits stay asserted from FRAME. once=1, holdN=N,
        // hold (no N)=indefinite (null). Match MAME's coin/start hold (~6 frames).
        const idur = imode === "once" ? 1 : mt[5] ? Number(mt[5]) : null;
        args.inputs.push({
          port: Number(mt[1]) & 0xffff,
          bits: Number(mt[2]) & 0xff,
          frame: Number(mt[3]),
          dur: idur,
        });
        break;
      }
      case "--post-boot": args.postBoot = true; break;
      default:
        throw new Error(`unknown argument: ${argv[i]}`);
    }
  }
  return args;
}

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

function main() {
  const args = parseArgs(process.argv);
  const rom = new Uint8Array(readFileSync(args.rom));
  // Video ROMs are only loaded when a frame buffer is requested -- they are
  // not needed for state or write traces.
  const video = args.framesOut
    ? {
        gfx1: new Uint8Array(readFileSync(join(dirname(args.rom), "gfx1.bin"))),
        gfx2: new Uint8Array(readFileSync(join(dirname(args.rom), "gfx2.bin"))),
        proms: new Uint8Array(readFileSync(join(dirname(args.rom), "proms.bin"))),
      }
    : {};
  const machine = new Machine(rom, video);
  machine.pokes = args.pokes;
  machine.inputTape = args.inputs;
  if (args.writesOut) machine.mem.writeTrace = [];

  // "all" means "as far as the translation currently reaches"; there is no
  // natural end-of-run yet, so it is deliberately generous and gets clamped
  // by how far the translated code actually runs.
  const want = args.frames === "all" ? Number.MAX_SAFE_INTEGER : args.frames;
  // Opt in BEFORE runFrames: video is captured at frame boundaries during the
  // run, so setting this afterwards would silently yield an empty stream.
  machine.captureVideo = Boolean(args.framesOut);
  // runFrames keeps the frames it captured and records why it stopped, so an
  // untranslated routine yields a short-but-valid artifact rather than
  // nothing. Anything unexpected still propagates.
  const frames = machine.runFrames(want);
  const stopped = machine.stoppedBy;
  // A frame's IMAGE is only complete once the following boundary is crossed,
  // so a run capturing K states yields K-1 painted frames. `--frames 1` thus
  // yields ZERO -- and this check tracked state frames only, so it wrote an
  // empty frames.rgb with `count: 0` and exited 0: a complete-looking artifact
  // containing nothing, which is precisely the optimistic-failure mode this guards against.
  const painted = machine.videoFrames.length;
  const shortVideo = args.framesOut && painted < want;
  const short = (frames.length < want || shortVideo) && args.frames !== "all";

  if (short || stopped) {
    // Report what we actually produced rather than padding: a short file that
    // looks complete is the optimistic failure this guards against.
    console.error(
      `NOTE: asked for ${args.frames} frames, produced ${frames.length}` +
        (args.framesOut ? ` states / ${machine.videoFrames.length} images` : "") +
        "." +
        (stopped ? `\n      stopped: ${stopped}` : ""),
    );
  }

  if (args.stateOut) {
    mkdirSync(args.stateOut, { recursive: true });
    const bin = Buffer.concat(frames.map((f) => Buffer.from(f)));
    writeFileSync(join(args.stateOut, "state.bin"), bin);
    writeFileSync(
      join(args.stateOut, "state.json"),
      JSON.stringify(
        {
          bytes_per_frame: STATE_DUMP_SIZE,
          count: frames.length,
          regions: [
            { name: "work", start: "0x6000", len: 3072 },
            { name: "sprite", start: "0x7000", len: 1024 },
            { name: "video", start: "0x7400", len: 1024 },
          ],
          frames: frames.map((f, i) => ({ i, sha256: sha256(f) })),
        },
        null,
        2,
      ) + "\n",
    );
    console.log(
      `wrote ${frames.length} frame(s) x ${STATE_DUMP_SIZE} bytes -> ${args.stateOut}/state.bin`,
    );
  }

  if (args.writesOut) {
    mkdirSync(args.writesOut, { recursive: true });
    // "<cycle> <ADDR4hex> <VAL2hex>", one per line, EXECUTION ORDER.
    const lines = machine.mem.writeTrace.map(
      (w) =>
        `${w.cycle} ${w.addr.toString(16).toUpperCase().padStart(4, "0")} ` +
        `${w.value.toString(16).toUpperCase().padStart(2, "0")}`,
    );
    writeFileSync(join(args.writesOut, "writes.txt"), lines.join("\n") + "\n");
    console.log(`wrote ${lines.length} hardware writes -> ${args.writesOut}/writes.txt`);
  }

  if (args.framesOut) {
    mkdirSync(args.framesOut, { recursive: true });
    // The validation harness's contract: headerless concatenation, 256*224*3 = 172032 bytes per
    // frame, row-major, top-left origin, R,G,B, no padding, unrotated.
    //
    // This wrote ONE frame -- machine.renderFrame() at the END of the run --
    // and labelled it `i: 0` whatever `--frames N` said. So `--frames 4`
    // compared frame 3 against golden frame 1 and reported a pixel mismatch:
    // a wrong-frame comparison wearing the costume of a rendering bug. Caught
    // because the "first bad pixel" changed colour between two runs that
    // differed only in N, which no palette change could explain.
    const shots = machine.videoFrames;
    // The frame NUMBER below is the array POSITION, which is only the same
    // thing while the video and state streams stay in lockstep. That holds
    // because captureVideo is constant across a run -- a convention, not an
    // enforced property. Assert it, because if it ever breaks the symptom is
    // silently renumbered frames, which is the exact failure this block's
    // history is made of.
    // Frames are PAINTED over their own duration, so frame N is only
    // complete once the boundary into N+1 is crossed: a run capturing K
    // states finishes K-1 frames, and the one in progress is dropped. What
    // must hold is that no frame was dropped from the MIDDLE, since that
    // would renumber everything after it.
    if (machine.droppedFrames > 1) {
      throw new Error(
        `${machine.droppedFrames} frames abandoned mid-paint; only the final ` +
          "one may be, so frame numbering is no longer trustworthy",
      );
    }
    if (shots.length + machine.droppedFrames !== frames.length - 1) {
      throw new Error(
        `frame accounting: ${shots.length} painted + ${machine.droppedFrames} ` +
          `dropped != ${frames.length - 1} elapsed frames`,
      );
    }
    if (shots.length === 0) {
      throw new Error(
        "no frame images were completed: a frame is only painted once the " +
          "following boundary is crossed, so --frames N yields N-1 images. " +
          "Writing an empty frames.rgb would exit 0 and read as complete.",
      );
    }
    const buf = Buffer.concat(shots.map((f) => Buffer.from(f)));
    writeFileSync(join(args.framesOut, "frames.rgb"), buf);
    writeFileSync(
      join(args.framesOut, "frames.json"),
      JSON.stringify(
        {
          width: 256, height: 224, bytes_per_frame: 172032,
          pixel_format: "RGB888", origin: "top-left", count: shots.length,
          frames: shots.map((f, i) => ({ i, sha256: sha256(Buffer.from(f)) })),
        },
        null, 2,
      ) + "\n",
    );
    // PRINT THE DEFLATED NUMBER NEXT TO THE INFLATED ONE, ALWAYS.
    // A frame count is inflated by repetition and a distinct-image count is
    // not, so "517 byte-exact" and "6 distinct images, one of them 510 of
    // them" describe the same run and only the second is about coverage.
    // This was published as 517 with no distinct count because computing it
    // meant hashing 89 MB and nobody did -- so the tool does it, rather than
    // relying on whoever reports the number remembering to.
    const distinct = new Set(shots.map((f) => sha256(Buffer.from(f))));
    console.log(
      `wrote ${shots.length} frame(s) x 172032 bytes -> ${args.framesOut}/frames.rgb\n` +
        `  ${distinct.size} DISTINCT image(s) -- the frame count is inflated by ` +
        `repetition, the distinct count is not`,
    );
  }

  if (args.postBoot) {
    // A FRESH machine: re-resetting the one runFrames() used would double
    // discardedWrites (2048, against the 1024 asserted below) and append
    // bogus frames sampled from already-booted memory.
    const fresh = new Machine(rom);
    fresh.runBoot();
    const st = fresh.dumpState();
    const distinct = (buf) => [...new Set(buf)].map((v) => `0x${v.toString(16)}`);
    console.log("\npost-boot fingerprint (after reset, before first NMI):");
    console.log(`  work   0x6000-0x6BFF distinct: ${distinct(st.slice(0, 3072))}`);
    console.log(`  sprite 0x7000-0x73FF distinct: ${distinct(st.slice(3072, 4096))}`);
    console.log(`  video  0x7400-0x77FF distinct: ${distinct(st.slice(4096, 5120))}`);
    console.log(`  0x60B0=0x${st[0x0b0].toString(16)} 0x60B1=0x${st[0x0b1].toString(16)}`);
    console.log(
      `  0x60C0-0x60FF all 0xFF: ${st.slice(0x0c0, 0x100).every((v) => v === 0xff)}`,
    );
    console.log(
      `  0x6080-0x608B all 0x00: ${st.slice(0x080, 0x08c).every((v) => v === 0x00)}`,
    );
    console.log(
      `  flipscreen=${fresh.io.flipScreen} spriteBank=${fresh.io.spriteBank} ` +
        `paletteBank=${fresh.io.paletteBank} nmiMask=${fresh.io.nmiMask}`,
    );
    console.log(
      `  discarded writes to 0x6C00-0x6FFF: ${fresh.mem.discardedWrites} (expect 1024)`,
    );
    console.log(`  sha256(state): ${sha256(st)}`);
  }

  return short || stopped ? 1 : 0;
}

process.exit(main());
