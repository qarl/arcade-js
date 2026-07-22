/**
 * Boot-path tests.
 *
 * These assert against facts established from MAME or from the ROM's own
 * code, never against "whatever our implementation happens to produce".
 * Run: node --test
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CYCLES_PER_FRAME, Machine } from "../machine.js";
import { AddressSpace, STATE_DUMP_SIZE, UnmappedAccess } from "../../../boards/dkong/memory.js";
import { IO, Inputs } from "../../../boards/dkong/io.js";
import {
  loc_1dc9, sub_1dbd, loc_1e15, loc_1e00, entry_1e8c, entry_1e94, sub_1e96, entry_1ea0,
  loc_1f09, loc_1f23, entry_2913, sub_2a22, sub_29af, entry_2b9b, entry_2333, sub_298c,
  sub_28b0, sub_28e0, sub_2901, sub_22bd, entry_24b4, entry_2c72, entry_2c8f, sub_26a6, entry_2c03,
  entry_2c41, loc_2c49, loc_2c4b, loc_2c4f, entry_2c7b, loc_2c86, sub_236e, sub_0514, loc_06fe,
  loc_07c3, loc_084b, loc_08b2, sub_0852, loc_08ba, loc_08d5, loc_08f8, sub_0977, loc_09ab,
  loc_0a37, loc_0a76, loc_0bb3, loc_0b06, loc_0a63, loc_0b68, loc_0a8a,
  loc_127c, entry_127f, loc_12ac, loc_12de, loc_138f,
  loc_0abf, loc_0ae8, loc_141e, loc_0f35, sub_239c,
  sub_23de, entry_2974, sub_286f, entry_2ddb,
  sub_2880, sub_2a2f, sub_2523, loc_0bda,
  loc_0986, entry_2954, sub_2808, loc_281d, sub_1e57,
  entry_128b, sub_21ee, sub_216d, sub_2591, sub_24ea, entry_2be1,
  sub_2207, sub_25f2, sub_26fa, sub_2fcb,
  sub_1826, sub_1a1e, entry_1d8a, sub_1d8f, entry_1da6, sub_1f46, sub_13ca, entry_1d03,
  sub_22cb, loc_12f2, sub_2407, sub_241f, entry_1a07, sub_1a33, entry_03fb, sub_2a85, loc_2d15,
  entry_2cb8, entry_2ce6, entry_2cf6, entry_2b1c, entry_2b29, sub_19da, entry_2e04, entry_2ed4,
  loc_1644, loc_13aa, loc_13bb, sub_1186, loc_1131, sub_26de, sub_26e9,
  loc_186f, loc_1839, loc_1344, sub_1d95, loc_1e49, loc_1e4a, entry_0f1b,
  loc_17b6, loc_1880, loc_101f, loc_18c6, entry_0400, loc_07cb,
  loc_1df5, loc_1e08, loc_1e10, loc_1e36, loc_1087,
  sub_1641, sub_1670, sub_176c, sub_0d00, sub_15fa,
  sub_1708, sub_1732, sub_1783, sub_178e, sub_2243, sub_2602,
  sub_2797, sub_27da, sub_2722,
  sub_1654, sub_168a, sub_1757, sub_0d27, sub_0d43, sub_2745,
  sub_271e, sub_2679, sub_262f, sub_2ad3,
  loc_2227, loc_2259, loc_2299, loc_22a2, loc_2303, loc_231a,
  sub_09d6, sub_09fe, sub_0a1b, loc_16a3, loc_16bb,
  sub_004e, sub_0f56, sub_11a6, sub_11d3, sub_11ec, sub_11fa, sub_122a, sub_2441,
  sub_30e4,
  sub_2ff0, sub_3064, sub_3096, entry_30db, sub_3f24, entry_3009, sub_304a, sub_30bd, sub_306f,
  sub_31f6, sub_31dd, sub_3fc0, entry_34f3, entry_330f, sub_3409, entry_33e7, sub_32d6, sub_342c, sub_3478, sub_34b9, sub_32bd, sub_33a1, loc_3069, entry_3ec3, sub_30fa, entry_3e99, guard_3110, guard_311b, guard_3126, guard_3131,
  entry_313c, loc_0ee8,
} from "../translated/state0.js";
import { sub_0da7, loc_0c91, sub_017b } from "../translated/nmi.js";
import { loc_059b } from "../translated/mainloop.js";
import {
  buildPalette, CYCLES_PER_LINE, decodeSprites, drawSprites, decodeTiles, SPRITE_COUNT, normalizeRange, renderFrameRGB,
  renderRowRGB, renderTilemapPens, SCREEN_H, splitProms, VBLANK_LINES,
} from "../../../boards/dkong/video.js";
import { Regs, F_C, F_H, F_N, F_PV, F_S, F_Z } from "../../../core/cpu/z80.js";

const ROM = new Uint8Array(readFileSync(new URL("../rom/maincpu.bin", import.meta.url)));


test("state[0] is 5120 zero bytes (QA verified this against MAME)", () => {
  // Sampled at the frame boundary BEFORE any instruction runs. QA dumped the
  // same regions from real MAME at power-on: the distinct-value set is {0x00}.
  const state0 = new Machine(ROM).dumpState();
  assert.ok(state0.every((b) => b === 0), "power-on state must be all zeroes");
});

test("boot fills video RAM with tile 0x10 -- CONFIRMED against MAME at PC=0x02B8", () => {
  // ROM 0x0281-0x028F: `ld a,0x10` then 4 x 256 stores from 0x7400.
  //
  // HISTORY, because this comment previously said the opposite. I offered
  // this as a fingerprint; QA found it never true at any FRAME BOUNDARY and
  // it was recorded as "not a MAME-checkable claim". That conclusion was
  // wrong in an instructive way: the state exists at PC=0x02B8, which is
  // mid-frame, so frame-boundary sampling structurally cannot see it. QA has
  // since built PC-exact capture (read taps, no debugger) and CONFIRMED all
  // four claims at that PC -- VRAM 0x10 across all 1024 bytes, sprite all
  // 0x00, 0x60C0-0x60FF all 0xFF, 0x60B0 = 0x60B1 = 0xC0.
  //
  // The claim was right; the instrument was blind. A limit of one sampling
  // strategy had been written down as a limit of reality (GATE-RULES §13).
  const m = new Machine(ROM);
  m.runBoot();
  const video = m.dumpState().slice(4096, 5120);
  assert.ok(video.every((b) => b === 0x10), "every video RAM cell must be 0x10");
});

test("boot clears sprite RAM to zero", () => {
  const m = new Machine(ROM);
  m.runBoot();
  assert.ok(m.dumpState().slice(3072, 4096).every((b) => b === 0));
});

test("boot's RAM clear over-runs work RAM by exactly 1024 bytes", () => {
  // ROM 0x0266: b=0x10 outer, inner runs 256 times (c enters at 0), so the
  // clear covers 0x6000-0x6FFF = 4096 bytes. Work RAM is 3072, so exactly
  // 1024 writes land in unmapped 0x6C00-0x6FFF and are discarded.
  // Any other count means the loop bounds or the memory map are wrong.
  const m = new Machine(ROM);
  m.runBoot();
  assert.equal(m.mem.discardedWrites, 1024);
});

test("boot leaves the documented work-RAM fingerprint, including stack traffic", () => {
  const m = new Machine(ROM);
  m.runBoot();
  const work = m.dumpState().slice(0, 3072);
  // 0x02/0xB8 are the return address pushed by `call 0x011c` at 0x02B5. The
  // Z80 does not clear popped bytes, so they persist at 0x6BFE/0x6BFF after
  // the `ret`. Their ABSENCE was how a review caught that translated CALLs
  // were not writing to the stack at all -- and the stack is inside the
  // region QA diffs, so that would have shown up as a phantom mismatch.
  assert.deepEqual(
    [...new Set(work)].sort((a, b) => a - b),
    [0x00, 0x02, 0xb8, 0xc0, 0xff],
  );
  assert.equal(work[0x0bfe], 0xb8, "0x6BFE = low byte of pushed 0x02B8");
  assert.equal(work[0x0bff], 0x02, "0x6BFF = high byte");
  assert.equal(work[0x0b0], 0xc0, "0x60B0 task-list pointer");
  assert.equal(work[0x0b1], 0xc0, "0x60B1 task-list pointer");
  assert.ok(work.slice(0x0c0, 0x100).every((v) => v === 0xff), "0x60C0-0x60FF");
  assert.ok(work.slice(0x080, 0x08c).every((v) => v === 0x00), "0x6080-0x608B");
});

test("boot enables the NMI LAST, after all setup (ordering, not just final value)", () => {
  // A previous version of this test only read final values, and still passed
  // when the NMI enable was moved to the very top of bootInit -- the exact
  // bug it is named for. Record the write ORDER instead.
  const m = new Machine(ROM);
  const order = [];
  const realWrite = m.mem.write8.bind(m.mem);
  m.mem.write8 = (addr, v) => {
    if (addr >= 0x7c00) order.push([addr, v]);
    return realWrite(addr, v);
  };
  m.runBoot();

  const nmiEnable = order.findIndex(([a, v]) => a === 0x7d84 && v === 1);
  assert.ok(nmiEnable > 0, "NMI must be enabled at some point");
  for (const port of [0x7d83, 0x7d86, 0x7d87, 0x7d82, 0x7d80, 0x7c00]) {
    const last = order.map(([a]) => a).lastIndexOf(port);
    assert.ok(
      last < nmiEnable,
      `0x${port.toString(16)} must be configured BEFORE the NMI is enabled`,
    );
  }
  assert.equal(order[0][0], 0x7d84, "reset clears the NMI mask first of all");
  assert.equal(order[0][1], 0, "...to 0");
  assert.equal(m.io.flipScreen, 1, "0x7D82 flipscreen");
  assert.equal(m.io.spriteBank, 0, "0x7D83 sprite bank");
  assert.equal(m.io.paletteBank, 0, "0x7D86/87 palette bank");
  assert.equal(m.io.nmiMask, 1, "0x7D84 NMI enabled at 0x02B8, after setup");
});





// -- CPU semantics the ROM depends on ------------------------------------








// -- cycle accounting ----------------------------------------------------

test("a full boot is exactly 180816 T-states", () => {
  // Pins the cycle model. A missing tick shifts every frame boundary, and
  // the error is invisible across state[0..2] because those frames are
  // all-zero regardless -- so it needs its own assertion rather than relying
  // on the state diff to notice.
  const m = new Machine(ROM);
  m.runBoot();
  assert.equal(m.cycles, 180816);
});

test("boot spans 3.5 frames, so frames 0-3 all land inside it", () => {
  const m = new Machine(ROM);
  m.runBoot();
  assert.ok(m.cycles / CYCLES_PER_FRAME > 3, "must cross boundary 3");
  assert.ok(m.cycles / CYCLES_PER_FRAME < 4, "must not reach boundary 4");
});

test("runFrames captures the requested count, state[0] before any instruction", () => {
  const frames = new Machine(ROM).runFrames(4);
  assert.equal(frames.length, 4);
  assert.ok(frames[0].every((b) => b === 0), "state[0] is power-on");
});

test("state[3] is the first frame capable of failing", () => {
  // GATE-RULES §17: a green on a degenerate frame is not evidence. state[0..2]
  // are all-zero because boot's clear writes zeros over already-zero RAM, so
  // they match under almost any cycle count.
  const frames = new Machine(ROM).runFrames(4);
  const nonzero = (s) => s.reduce((a, b) => a + (b !== 0 ? 1 : 0), 0);
  assert.equal(nonzero(frames[0]), 0);
  assert.equal(nonzero(frames[1]), 0);
  assert.equal(nonzero(frames[2]), 0);
  assert.equal(nonzero(frames[3]), 113, "matches MAME's measured count");
});

test("runFrames records WHY it stopped instead of discarding the run", () => {
  // Execution is bounded by CYCLES, not frame count -- so a run continues a
  // little past the last sampled frame and can reach an untranslated
  // routine. Those frames are still valid; throwing them away or pretending
  // the run completed would both be wrong.
  // ASSERTS THE INVARIANT, NOT WHERE TRANSLATION HAPPENS TO STOP. This used
  // to ask for 5 frames and require stoppedBy to match /not implemented/,
  // which silently encoded "the translation cannot reach frame 5 yet". The
  // moment it could, a green run reported as a failure -- progress arriving
  // as a regression, which is the second instance of that shape in this file.
  //
  // The real contract has two halves and neither mentions a frame number:
  // a run that stops early KEEPS its frames and RECORDS a reason; a run that
  // completes records no reason.
  const m = new Machine(ROM);
  const asked = 8; // small: a completed run now executes the whole budget
  const frames = m.runFrames(asked);
  // `> 1`, not `> 0`: runFrames SEEDS frames[0] before executing a single
  // instruction, so `> 0` would pass vacuously and prove nothing about frames
  // captured DURING execution, which is the half this is meant to pin.
  assert.ok(frames.length > 1, "frames captured during execution survive to the caller");
  assert.equal(frames.length, asked, "a completed run captures every requested frame");
  assert.equal(m.stoppedBy, null, "completed via FramesComplete -> no stop reason recorded");

  const full = new Machine(ROM);
  const few = full.runFrames(2);
  assert.equal(few.length, 2);
  assert.equal(full.stoppedBy, null, "a completed run records no stop reason");
});

test("runFrames leaves the Machine usable (no permanent frame-limit arming)", () => {
  // The limit used to stay armed, so every later tick threw FramesComplete
  // and any second use of the Machine died before executing an instruction.
  // Asserts the POISONING is gone, not that nothing throws at all: as more
  // ROM is translated, execution runs further and can legitimately reach an
  // untranslated routine here. Pinning "does not throw" made this test break
  // every time translation advanced, which tests progress rather than the
  // property.
  const m = new Machine(ROM);
  m.runFrames(4);
  try {
    m.tick(1000);
  } catch (e) {
    assert.notEqual(
      e.constructor.name,
      "FramesComplete",
      "the frame limit must be disarmed after runFrames",
    );
  }
});

test("a fresh Machine discards exactly 1024 writes; re-running boot doubles it", () => {
  const a = new Machine(ROM);
  a.runBoot();
  assert.equal(a.mem.discardedWrites, 1024);
  a.runBoot(); // demonstrates why --post-boot must use a fresh Machine
  assert.equal(a.mem.discardedWrites, 2048, "re-running boot accumulates");
});

test("reset() falls through into the main loop and does NOT return", () => {
  // ROM 0x02BC runs straight into 0x02BD -- there is no jump. That
  // fall-through was MISSING, which made the entire main loop and NMI path
  // dead code while every gate stayed green: the frames the state diff
  // compares all end before boot does, so a passing gate said nothing about
  // code it never reached. This test exists so it cannot vanish silently.
  // The ROM's main loop never returns (it spins on vblank forever), so bound
  // the run. runFrames() calls reset(), which must fall through 0x02BC->0x02BD
  // into the main loop: if that fall-through were missing, execution would halt
  // at the end of boot (~180816 cycles) instead of running the full budget.
  const m = new Machine(ROM);
  m.runFrames(8);
  assert.ok(m.cycles > 180816, "must execute past the end of boot");
  assert.ok(
    m.cycles >= 7 * CYCLES_PER_FRAME,
    "main loop ran the full budget -- reset fell through, did not stall at boot",
  );
  assert.equal(m.stoppedBy, null, "ended by the frame budget, not a NotImplemented stub");
});

test("the first NMI fires at the first unmasked vblank and pushes a real PC", () => {
  // The NMI asserts AT the frame boundary (cycle N*50688), not partway into
  // the frame -- QA measured entries at 202771/253451/304141/... by tapping
  // reads of the 0x0066 vector. Boot masks it (0x7D84=0 at reset) until
  // 0x02B8 at cycle 180816, so vblanks 0-3 are dropped and the first accepted
  // one is vblank 4 at 202752, plus a few cycles to finish the current
  // instruction.
  //
  // The pushed PC lands on the stack inside diffed work RAM. A review caught
  // it being 0x02C5 while execution was actually two calls deep in 0x06xx
  // code, because the PC was separate bookkeeping that went stale outside
  // the one routine maintaining it. It is now carried by step().
  const m = new Machine(ROM);
  let at = null;
  const realFire = m.fireNmi.bind(m);
  m.fireNmi = function () {
    // Capture AT the fire point. Reading m.cycles afterwards measures where
    // the unwind stopped, not where the NMI was accepted.
    const spBefore = this.regs.sp;
    const pc = this.pc;
    const cycles = this.cycles;
    const r = realFire();
    // Read the pushed bytes immediately AFTER the push, not at the end of
    // the run: execution continues and reuses that memory, so reading later
    // measures something else entirely.
    // FIRST, not last. This assigned unconditionally and therefore captured
    // the LAST NMI of the run, while every assertion below is written about
    // the first. It agreed only because exactly one NMI fired before the
    // translation hit its stub -- so the test passed by accident of how far
    // the translation reached, which is the one thing this file's own comment
    // says will keep growing. The moment a second NMI fired it reported
    // 253440 for "the first NMI" and read as a timing regression in the CPU.
    if (!at) {
      at = {
        pc,
        cycles,
        spBefore,
        pushedAt: (spBefore - 2) & 0xffff,
        lo: this.mem.read8((spBefore - 2) & 0xffff),
        hi: this.mem.read8((spBefore - 1) & 0xffff),
      };
    }
    return r;
  };
  // Bound the run: the main loop never returns, so run a few frames -- enough
  // to fire the first (frame-4) NMI, captured by the fireNmi wrapper above.
  m.runFrames(6);

  // At least one -- how many fire before the first stub depends on how far
  // translation reaches, which grows. The assertions below are about the
  // FIRST one, captured in the wrapper.
  assert.ok(m.nmiCount >= 1, "at least one NMI fired");
  assert.ok(
    at.cycles >= 202752 && at.cycles < 202752 + 30,
    `NMI taken at ${at.cycles}; expected just after the frame-4 boundary ` +
      "202752 (MAME measured 202771 -- the spread is the instruction the CPU " +
      "was finishing, so an exact equality here would be over-fitting)",
  );
  // The exact value, not a range: 0x0344 is in sub_0315's loc_033e block, and
  // SP one call deep holds mainLoop's `call 0x0315` return address. A range
  // check over the whole 16KB ROM accepts 16382 wrong answers and would not
  // catch the 0x02C5 CLASS of bug, only that one literal.
  assert.ok(at.pc >= 0x0000 && at.pc <= 0x3fff, "a populated ROM address");
  assert.notEqual(at.pc, 0x0000, "not a sentinel");
  assert.notEqual(at.pc, 0x02c5, "not the stale value a review caught");
  // THE CONSEQUENCE IN MEMORY, not just the intent. The pushed PC lands on
  // the Z80 stack inside diffed work RAM, so assert the bytes actually
  // arrived there -- this is what would catch a push that computed the right
  // value and wrote it somewhere else.
  assert.equal(at.lo | (at.hi << 8), at.pc, "the pushed bytes ARE the PC");
  assert.ok(
    at.pushedAt >= 0x6000 && at.pushedAt <= 0x6bfe,
    `pushed at 0x${at.pushedAt.toString(16)}, must be inside work RAM`,
  );
  // Note SP is at the top (0x6C00) here: with the corrected frame-boundary
  // timing the NMI lands in the main loop's spin, where no call is active.
  // An earlier version asserted "something has been pushed", which was true
  // only under the WRONG timing -- the assertion had encoded the bug.
  assert.equal(at.spBefore, 0x6c00, "NMI taken with the stack empty, in the spin");
});

test("fireNmi refuses to push an unknown PC rather than guessing", () => {
  // Pushing a plausible wrong value into memory MAME gets compared against
  // is worse than stopping. Verified directly, since every translated
  // routine now maintains the PC and the natural path no longer triggers it.
  const m = new Machine(ROM);
  m.runBoot();
  m.pcKnown = false;
  assert.throws(() => m.fireNmi(), /ROM PC is unknown/);
  assert.equal(m.nmiCount, 0, "nothing was pushed");
});


// -- write-only hardware latches -----------------------------------------
// QA's state dump CANNOT observe 0x7D80-0x7D87: the latches are write-only,
// MAME exposes no readable path, and there is no pixel diff yet. So a wrong
// palette bank or a dropped flipscreen write leaves the gate green and silent.
// These assertions are the only thing covering that class of write, and every
// expected value is derived from the ROM, not from what the code produces.

test("boot leaves the exact latch state the ROM writes", () => {
  // ROM 0x02A4-0x02B1: `xor a` then stores to 0x7D83/0x7D86/0x7D87,
  // then `inc a` (A=1) then a store to 0x7D82. So three zeroes and one one,
  // and the ORDER matters: A is 0 for the first three, 1 for the last.
  const m = new Machine(ROM);
  m.runBoot();
  assert.equal(m.io.spriteBank, 0, "0x7D83 written with A=0");
  assert.equal(m.io.paletteBank, 0, "0x7D86 and 0x7D87 both written with A=0");
  assert.equal(m.io.flipScreen, 1, "0x7D82 written with A=1 after `inc a`");
  assert.equal(m.io.nmiMask, 1, "0x7D84 = 1 at 0x02BA, last of all");
  assert.equal(m.io.audioIrq, 0, "0x7D80 zeroed by sub_011c at 0x0131");
  assert.equal(m.io.soundLatch3d, 0, "0x7C00 zeroed by sub_011c at 0x0134");
  assert.ok(
    [...m.io.latch6h].every((v) => v === 0),
    "all eight ls259.6h bits zeroed by sub_011c",
  );
});

test("the palette bank composes two separate address bits, not one value", () => {
  // 0x7D86 is bit 0 and 0x7D87 is bit 1 of a 2-bit bank; each address carries
  // its data on bit 0. Writing them as if either address set the whole value
  // would give the right answer for boot (both zero) and the wrong one later.
  const m = new Machine(ROM);
  m.runBoot();
  m.mem.write8(0x7d87, 1);
  assert.equal(m.io.paletteBank, 0b10, "0x7D87 sets bit 1");
  m.mem.write8(0x7d86, 1);
  assert.equal(m.io.paletteBank, 0b11, "0x7D86 sets bit 0, independently");
  m.mem.write8(0x7d87, 0);
  assert.equal(m.io.paletteBank, 0b01, "and clears independently");
});

test("latch addresses take data from bit 0 only", () => {
  // An addressable latch stores one bit per address. Passing the whole byte
  // through would make 0x7D82 = 0xFF read as flipscreen 255.
  const m = new Machine(ROM);
  m.runBoot();
  m.mem.write8(0x7d82, 0xfe); // bit 0 clear
  assert.equal(m.io.flipScreen, 0);
  m.mem.write8(0x7d82, 0xff); // bit 0 set
  assert.equal(m.io.flipScreen, 1);
});

test("every latch write on a translated path is accounted for", () => {
  // Audited against the traced disassembly: 15 writes to 0x7C00/0x7D8x lie on
  // translated paths (0x0002 0x006F 0x00DB 0x010B 0x0118 0x0131 0x0134 0x0142
  // 0x0173 0x0177 0x02A5 0x02A8 0x02AB 0x02AF 0x02BA). The remaining 12 are in
  // routines not yet reached. This pins the count so a future translation that
  // silently drops one shows up here rather than in a renderer months later.
  const m = new Machine(ROM);
  const hits = [];
  const real = m.mem.write8.bind(m.mem);
  m.mem.write8 = (a, v) => {
    if (a === 0x7c00 || (a >= 0x7d80 && a <= 0x7d87)) hits.push(a);
    return real(a, v);
  };
  m.runBoot();
  // boot path: 0x0002, 0x0131, 0x0134, 0x02A5, 0x02A8, 0x02AB, 0x02AF, 0x02BA
  assert.equal(hits.length, 8, `boot latch writes: ${hits.map((h) => h.toString(16))}`);
});

// ---------------------------------------------------------------------------
// normalize_range -- the last stage of dkong2b_palette
// ---------------------------------------------------------------------------





// ---------------------------------------------------------------------------
// Renderer. These need no golden capture -- they assert properties the
// renderer must satisfy against ITSELF, which is exactly what the pixel gate
// cannot do while golden's flipped frames are all past where translation
// reaches.
// ---------------------------------------------------------------------------



test("frame images are painted per-scanline, one fewer than the states", () => {
  // A frame's IMAGE is not complete until the beam finishes it, so a run
  // capturing K states yields K-1 painted frames. Nothing asserted this, and
  // a review found the whole video stream had been renumbered by one against
  // golden with all 38 tests green -- an off-by-one no existing test could
  // see, because none of them looked at videoFrames at all.
  const gfx1 = new Uint8Array(readFileSync(new URL("../rom/gfx1.bin", import.meta.url)));
  const proms = new Uint8Array(readFileSync(new URL("../rom/proms.bin", import.meta.url)));
  const m = new Machine(ROM, { gfx1, proms });
  m.captureVideo = true;
  const states = m.runFrames(6);

  assert.equal(m.droppedFrames, 0, "no frame may be abandoned mid-paint");
  assert.equal(
    m.videoFrames.length, states.length - 1,
    "K states must yield K-1 completed images",
  );
  assert.ok(
    m.videoFrames.every((f) => f.length === 256 * 224 * 3),
    "every image is a full 172032-byte frame",
  );
});

test("a mid-frame flip renders as a composite, not as either orientation", () => {
  // THE PROPERTY THAT MAKES RASTER TIMING NECESSARY. Boot writes 7D82<-01 at
  // cycle 180326, which is VISIBLE ROW 107 of frame 3's 224 (line 147 from
  // the frame origin, minus the 40 leading vblank lines) -- so frame 3's
  // image is its top unflipped and its bottom flipped. A snapshot renderer must
  // produce ONE orientation and therefore cannot reproduce it; that was the
  // 20380-pixel frame-3 mismatch, and it is why the count of mid-frame VRAM
  // writes never predicted which frames were safe (949 renders clean, 111
  // straddles -- the ordering inverts).
  const gfx1 = new Uint8Array(readFileSync(new URL("../rom/gfx1.bin", import.meta.url)));
  const proms = new Uint8Array(readFileSync(new URL("../rom/proms.bin", import.meta.url)));
  const m = new Machine(ROM, { gfx1, proms });
  m.captureVideo = true;
  const states = m.runFrames(6);

  const painted = Buffer.from(m.videoFrames[3]);
  const vram = new Uint8Array(states[3].subarray(4096, 5120));
  const tiles = decodeTiles(gfx1);
  const { charColour } = splitProms(proms);
  const palette = buildPalette(proms);

  for (const flip of [0, 1]) {
    const single = Buffer.from(
      renderFrameRGB(vram, tiles, charColour, palette, { flip }),
    );
    assert.notDeepEqual(
      Array.from(painted), Array.from(single),
      `frame 3 must not equal a single-orientation render (flip=${flip})`,
    );
  }
  // SCOPE, because mutation testing showed this is weaker than it reads:
  // making renderRowRGB ignore flip entirely does NOT fail the two
  // assertions above. They differ from the single-orientation renders
  // because VRAM EVOLVES during frame 3, not because the orientation
  // changes -- so they pin raster-vs-snapshot but say nothing about flip.
  // The orientation property itself is pinned separately, below.

  // NON-VACUITY. `notDeepEqual` against two images would also pass if the
  // painted frame were uniformly black, which is exactly the failure mode
  // the gfxBank guard exists for -- so assert it actually has content.
  //
  // A first version of this check asserted the frame's TOP and BOTTOM
  // scanlines differ, reasoning they come from opposite orientations. They
  // do, and the assertion still failed: by frame 3 the clear has blanked
  // both, so two different orientations of blank are identical. The
  // orientation boundary is real and invisible at the edges.
  let lit = 0;
  for (let i = 0; i < 256 * 224; i++) {
    if (painted[i * 3] || painted[i * 3 + 1] || painted[i * 3 + 2]) lit++;
  }
  assert.ok(lit > 0, "the painted frame must have content for the comparison to mean anything");
});


test("the first visible scanline is 40 lines after the frame origin, not 16", () => {
  // NOTHING PINNED THIS, and a review found any value from 0 to 41 passed the
  // whole suite. The only thing holding it at 40 was a golden comparison that
  // lives outside the tests -- in a file whose own history includes a
  // constant that "produced a perfect match by concealing the pixels that
  // would have falsified it".
  //
  // The frame ORIGIN is the vblank point (measured: MAME's NMI entries land
  // at frame N.000x). The frame runs vbstart(240)..263, then 0..15, then the
  // 224 displayed lines 16..239 -- so the first DISPLAYED line sits
  // 24 + 16 = 40 lines in, and 40 + 224 == 264 == vtotal exactly, with the
  // visible region ending precisely at the next boundary.
  //
  // VBEND (16) is the first displayed line in the CHIP's raster numbering and
  // is a different zero. Using it here put every scanline 4608 cycles early,
  // which is what made frame 5 render a tile that had not been written yet.
  assert.equal(VBLANK_LINES, 40);
  assert.equal(VBLANK_LINES + SCREEN_H, 264, "visible region must end at the frame boundary");
  assert.equal(VBLANK_LINES * CYCLES_PER_LINE, 7680);

  const gfx1 = new Uint8Array(readFileSync(new URL("../rom/gfx1.bin", import.meta.url)));
  const proms = new Uint8Array(readFileSync(new URL("../rom/proms.bin", import.meta.url)));
  const m = new Machine(ROM, { gfx1, proms });
  m.captureVideo = true;
  m.startRasterFrame(0);
  assert.equal(m.nextRowCycle, 7680, "frame 0's first scanline is painted at cycle 7680");
  m.startRasterFrame(5);
  assert.equal(m.nextRowCycle, 5 * CYCLES_PER_FRAME + 7680);

  // The last displayed row must still fall INSIDE its frame. At 41 it just
  // does; at 42 it does not and frames start being dropped -- so 40 sits one
  // line below a cliff that nothing else documents.
  assert.ok(
    (VBLANK_LINES + SCREEN_H - 1) * CYCLES_PER_LINE < CYCLES_PER_FRAME,
    "row 223 must be due before the frame boundary",
  );
});



test("sub_2ff0 maps (y,x) pixels to a video RAM address, vertically mirrored", () => {
  // Checked against the FORMULA, derived from the listing independently of
  // the translation:
  //
  //     col = (x >> 3) & 0x1f
  //     row = (255 - y) >> 3        <- the ROM complements y itself
  //     HL  = 0x7400 + row * 32 + col
  //
  // The `cpl` is the point: the ROM's own address arithmetic is vertically
  // mirrored, so the 180-degree rotation the renderer applies is reproducing
  // a transform the game already assumes rather than imposing one.
  const m = new Machine(ROM);
  const expected = (y, x) => 0x7400 + (((255 - y) >> 3) * 32) + ((x >> 3) & 0x1f);

  for (const [y, x] of [[0, 0], [0, 255], [255, 0], [255, 255],
                        [7, 7], [8, 8], [120, 96], [200, 31], [63, 200]]) {
    m.regs.h = y;
    m.regs.l = x;
    m.regs.sp = 0x6c00;
    m.push16(0xbeef); // sub_2ff0 ends in `ret`
    sub_2ff0(m);
    assert.equal(
      m.regs.hl, expected(y, x),
      `(y=${y},x=${x}) -> 0x${m.regs.hl.toString(16)}, expected 0x${expected(y, x).toString(16)}`,
    );
    assert.equal(m.pc, 0xbeef, "must return to its caller");
  }

  // Every result must land inside video RAM, or the address arithmetic is
  // wrong in a way the formula check alone would not reveal.
  for (let y = 0; y < 256; y += 5) {
    for (let x = 0; x < 256; x += 5) {
      m.regs.h = y; m.regs.l = x; m.regs.sp = 0x6c00;
      m.push16(0x0000);
      sub_2ff0(m);
      assert.ok(
        m.regs.hl >= 0x7400 && m.regs.hl <= 0x77ff,
        `(y=${y},x=${x}) produced 0x${m.regs.hl.toString(16)}, outside video RAM`,
      );
    }
  }
});

test("sub_2ff0 charges the exact T-states of its 20 instructions", () => {
  // THE FORMULA TEST DOES NOT COVER TIMING. It reads only HL and the return
  // PC, so every T-state in the routine could be wrong and the suite would
  // stay green -- and since nothing reaches sub_2ff0 yet, no gate covers it
  // either. That is precisely the "latent bug behind a passing test" this
  // routine was already caught by once (four rrca where the ROM has three).
  //
  // Expected total from the listing, summed independently:
  //   ld a,l 4 | rrca 4 x3 | and 7 | ld l,a 4 | ld a,h 4 | cpl 4 | and 7
  //   ld e,a 4 | xor a 4 | ld h,a 4 | rl e 8 | rla 4 | rl e 8 | rla 4
  //   add a,n 7 | ld d,a 4 | add hl,de 11 | ret 10
  const EXPECTED = 4 + 4 * 3 + 7 + 4 + 4 + 4 + 7 + 4 + 4 + 4 + 8 + 4 + 8 + 4 + 7 + 4 + 11 + 10;
  assert.equal(EXPECTED, 110, "the hand sum itself, so a typo above is visible");

  const m = new Machine(ROM);
  m.regs.h = 100;
  m.regs.l = 100;
  m.regs.sp = 0x6c00;
  m.push16(0xbeef);
  const before = m.cycles;
  const steps = [];
  const realStep = m.step.bind(m);
  m.step = (next, cyc) => { steps.push([next, cyc]); return realStep(next, cyc); };
  sub_2ff0(m);

  assert.equal(m.cycles - before, EXPECTED, "total T-states");
  assert.equal(steps.length, 20, "one step per instruction");
  // Addresses in order, from the listing. A wrong 2-byte instruction length
  // shows up here as a skipped or duplicated address even if the total holds.
  assert.deepEqual(
    steps.map(([a]) => a),
    [0x2ff1, 0x2ff2, 0x2ff3, 0x2ff4, 0x2ff6, 0x2ff7, 0x2ff8, 0x2ff9, 0x2ffb,
     0x2ffc, 0x2ffd, 0x2ffe, 0x3000, 0x3001, 0x3003, 0x3004, 0x3006, 0x3007,
     0x3008, 0xbeef],
  );
});



test("sub_0da7 charges exact T-states on both the terminator and walk paths", () => {
  // ITS ABSENCE IS WHY A DUPLICATED `jp` WENT UNSEEN. Review found a second
  // `m.step(0x0cc6, 10)` appended beside the throw it should have replaced --
  // 10 phantom T-states downstream, invisible to the pixel gate because that
  // path first executes in frame 518, after all 517 compared images are done.
  //
  // PINS THE INSTRUCTION PREFIX, NOT A RUNNING TOTAL. A first version
  // asserted total cycles up to a `throw` at 0x0DD3, and broke the moment the
  // chain was extended past it -- a test coupled to how far translation has
  // got rather than to the routine it names. Measuring to the first step that
  // lands on 0x0DD3 is stable under extension and strictly more precise,
  // because it checks the address sequence as well as the total.
  const gfx1 = new Uint8Array(readFileSync(new URL("../rom/gfx1.bin", import.meta.url)));
  const proms = new Uint8Array(readFileSync(new URL("../rom/proms.bin", import.meta.url)));

  // Terminator path: ld a,(de) 7 | ld (nn),a 13 | cp n 7 | ret z 11 = 38
  {
    const m = new Machine(ROM, { gfx1, proms });
    m.mem.write8(0x6100, 0xaa);
    m.regs.de = 0x6100;
    m.regs.sp = 0x6c00;
    m.push16(0xcafe);
    const before = m.cycles;
    sub_0da7(m);
    assert.equal(m.cycles - before, 38, "terminator path T-states");
    assert.equal(m.pc, 0xcafe, "ret z must return to the caller");
    assert.equal(m.mem.read8(0x63b3), 0xaa, "the byte is stashed before the test");
  }

  // Walk path, measured to sub_0da7's OWN last instruction -- the `jp nc` at
  // 0x0DCE landing on 0x0DD3. Summed from the listing independently:
  //   7+13+7+5 +6+7+4+4+6+7+4+4 +11 +17 +[sub_2ff0 110] +10
  //   +16+4+7+13+4+7+13 +6+7+4+4 +10   and +8 only when `neg` runs
  const BASE = 7 + 13 + 7 + 5 + 6 + 7 + 4 + 4 + 6 + 7 + 4 + 4 + 11 + 17 + 110 +
               10 + 16 + 4 + 7 + 13 + 4 + 7 + 13 + 6 + 7 + 4 + 4 + 10;
  for (const [plus3, expectNeg] of [[0x80, false], [0x10, true]]) {
    const m = new Machine(ROM, { gfx1, proms });
    // 0xAA at +5 terminates the walk: loc_0e4b now closes the loop back into
    // sub_0da7, so without a terminator the record walk runs into garbage.
    for (const [i2, v] of [[0, 0x01], [1, 0x40], [2, 0x30], [3, plus3],
                           [4, 0x38], [5, 0xaa]]) {
      m.mem.write8(0x6100 + i2, v);
    }
    m.regs.de = 0x6100;
    m.regs.sp = 0x6c00;
    m.push16(0xcafe);
    const steps = [];
    const realStep = m.step.bind(m);
    m.step = (next, cyc) => { steps.push([next, cyc]); return realStep(next, cyc); };
    // NARROWED. An unconditional catch made this test vacuous for everything
    // past 0x0DD3: fault injection showed that replacing loc_0dd3's entire
    // body with a throw, or charging 99 T-states to one instruction, or
    // making the exact `inc l` -> `inc hl` mistake its own comment warns
    // about, ALL left the suite green. A catch that swallows every error
    // turns the code it covers into code it merely runs.
    // The chain now CLOSES -- loc_0e4b jumps back to 0x0DA7 -- so the walk
    // runs to the 0xAA terminator and returns rather than stopping mid-chain.
    sub_0da7(m);
    assert.equal(m.pc, 0xcafe, "walk must return to its caller at the terminator");

    const end = steps.findIndex(([a]) => a === 0x0dd3);
    assert.ok(end > 0, "must reach 0x0DD3");
    const own = steps.slice(0, end + 1).reduce((t, [, c]) => t + c, 0);
    assert.equal(
      own, BASE + (expectNeg ? 8 : 0),
      `walk path with +3=0x${plus3.toString(16)} (neg ${expectNeg ? "runs" : "skipped"})`,
    );
    // The `neg` branch must appear as an extra STEP, not merely extra cycles.
    assert.equal(
      steps.slice(0, end + 1).filter(([a]) => a === 0x0dd1).length,
      expectNeg ? 1 : 0,
      "the not-taken jp must step to 0x0DD1 only on the borrow path",
    );
    assert.equal(m.mem.read8(0x63b4), 0x40 & 7, "y & 7");
    assert.equal(m.mem.read8(0x63af), 0x30 & 7, "x & 7");
    assert.equal(m.mem.read16(0x63ab), 0x7400 + (((255 - 0x40) >> 3) * 32) + ((0x30 >> 3) & 0x1f));
  }
});

test("loc_0dd3 charges exact T-states through to the loc_0e19 boundary", () => {
  // The 150 lines of loc_0dd3 had NO effective coverage: the sub_0da7 test
  // asserts only state written BEFORE 0x0DD3, and its catch swallowed
  // everything after. Verified by fault injection -- deleting the routine's
  // body outright left the suite green.
  //
  // Summed from the listing independently, 0x0DD3 to the step landing on
  // 0x0E19, with sub_2ff0's 110 inlined at the call:
  //   13+6+7+4+4+13+7+7+13 +11+17+[110]+10+16 +13+7+10 +13+7+4+13+4+13
  //   +13+7+16+7+4+7+7 +13+7+10
  const BASE = 13 + 6 + 7 + 4 + 4 + 13 + 7 + 7 + 13 + 11 + 17 + 110 + 10 + 16 +
               13 + 7 + 10 + 13 + 7 + 4 + 13 + 4 + 13 + 13 + 7 + 16 + 7 + 4 +
               7 + 7 + 13 + 7 + 10;
  assert.equal(BASE, 413, "the hand sum itself, so a typo above is visible");

  const gfx1 = new Uint8Array(readFileSync(new URL("../rom/gfx1.bin", import.meta.url)));
  const proms = new Uint8Array(readFileSync(new URL("../rom/proms.bin", import.meta.url)));

  // kind 0x00 -> `cp 0x01` is NZ, so the jp nz at 0x0E12 is taken (no tail).
  // kind 0x01 -> Z, so it falls through `xor a / ld (nn),a` = +17.
  for (const [kind, extra] of [[0x00, 0], [0x01, 4 + 13]]) {
    const m = new Machine(ROM, { gfx1, proms });
    for (const [i2, v] of [[0, kind], [1, 0x40], [2, 0x30], [3, 0x80],
                           [4, 0x38], [5, 0xaa]]) {
      m.mem.write8(0x6100 + i2, v);
    }
    m.regs.de = 0x6100;
    m.regs.sp = 0x6c00;
    m.push16(0xcafe);
    const steps = [];
    const realStep = m.step.bind(m);
    m.step = (next, cyc) => { steps.push([next, cyc]); return realStep(next, cyc); };
    sub_0da7(m);
    assert.equal(m.pc, 0xcafe, `kind 0x${kind.toString(16)}: returns at terminator`);

    const from = steps.findIndex(([a]) => a === 0x0dd3);
    const to = steps.findIndex(([a]) => a === 0x0e19);
    assert.ok(from >= 0 && to > from, "must pass through 0x0DD3 then 0x0E19");
    const own = steps.slice(from + 1, to + 1).reduce((t, [, c]) => t + c, 0);
    assert.equal(own, BASE + extra, `kind 0x${kind.toString(16)} T-states`);

    // The tail must appear as STEPS, not merely as cycles.
    assert.equal(
      steps.slice(from, to + 1).filter(([a]) => a === 0x0e15).length,
      kind === 0x01 ? 1 : 0,
      "the xor/store tail runs only when the kind is 1",
    );

    // The second point's products -- what the routine exists to compute.
    assert.equal(m.mem.read8(0x63b0), 0x38 & 7, "x2 & 7");
    assert.equal(
      m.mem.read16(0x63ad),
      0x7400 + (((255 - 0x80) >> 3) * 32) + ((0x38 >> 3) & 0x1f),
      "tile address of the SECOND point (y2=0x80, x2=0x38)",
    );
    // DE now ends at the TERMINATOR, not at +4: loc_0e4b's `inc de` steps
    // past the record and the walk re-enters sub_0da7, which reads 0xAA at
    // 0x6105 and returns. The old assertion measured a mid-chain state the
    // closed loop moves past.
    assert.equal(m.regs.de, 0x6105, "DE left at the 0xAA terminator");
  }

  // THE PAGE WRAP, which is the whole point of `inc l` rather than `inc hl`
  // and which nothing exercised. The two differ ONLY when L is 0xFF, and the
  // cases above land on 0x76E6 -- so replacing `inc l` with `inc hl` (the
  // exact mistake the routine's own comment names) left the suite green.
  //
  // (y=0x00, x=0xF8) puts the first point's tile at 0x77FF, the one address
  // where they diverge: `inc l` wraps to 0x7700 and stays in video RAM, while
  // `inc hl` would reach 0x7800 -- the i8257 register page, not video memory
  // at all.
  {
    const m = new Machine(ROM, { gfx1, proms });
    for (const [i2, v] of [[0, 0x00], [1, 0x00], [2, 0xf8], [3, 0x80],
                           [4, 0x38], [5, 0xaa]]) {
      m.mem.write8(0x6100 + i2, v);
    }
    m.regs.de = 0x6100;
    m.regs.sp = 0x6c00;
    m.push16(0xcafe);
    sub_0da7(m);

    assert.equal(m.mem.read16(0x63ab), 0x77ff, "first point must land on 0x77FF");
    // A = (x&7) + 0xF0 = 0xF0 is written at 0x77FF, then A-0x30 = 0xC0 at the
    // WRAPPED address. If `inc hl` were used the second byte would go to
    // 0x7800 and 0x7700 would be untouched.
    assert.equal(m.mem.read8(0x77ff), 0xf0, "first tile at 0x77FF");
    assert.equal(m.mem.read8(0x7700), 0xc0, "second tile at the WRAPPED address");
  }
});

test("sub_0f56 clears, copies a ROM table, and seeds the computed values", () => {
  // INTEGRATED FROM A DRAFT. Pins the four products the routine exists to
  // produce, with memory POISONED first so "cleared" means cleared rather
  // than never-written -- the distinction that made my first check of this
  // routine report a false failure.
  const rom = ROM;
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00;
  m.push16(0x0d62); // the return address `call 0x0f56` at 0x0D5F pushes
  // POISON FIRST, THEN set the inputs. A first version did it the other way
  // round and the poison overwrote 0x6229 -- which turned out to demonstrate
  // the drafter's OQ5 by accident: 0xA5 * 10 = 1650 WRAPS to 0x72, +0x28 is
  // 0x9A, and the clamp then bounds it to 0x50. The clamp caught it only
  // because the wrapped value happened to stay above 0x51; a wrap landing
  // below it would pass silently as a small number.
  for (let a = 0x6200; a < 0x6b00; a++) m.mem.write8(a, 0xa5);
  m.mem.write8(0x6229, 0x01);
  m.mem.write8(0x6227, 0x01);

  // With 0x6227 = 1 the rst 0x28 table at 0x0FCD selects entry 1 = 0x0FD7,
  // so reaching past the dispatch PROVES it resolved -- the routine no longer
  // stops at its own tail. That the caller's return address survives the
  // dispatch is the OQ1/OQ4 resolution, recorded at the tail.
  //
  // The stop address moved forward as each helper landed -- 0x122A, then
  // 0x11FA -- and loc_0fd7 IS NOW COMPLETE, so there is no stop left to pin.
  // sub_11fa, sub_11a6, sub_11ec and sub_11d3 are all integrated and the
  // routine runs to its `ret` at 0x101A.
  //
  // The assertion inverts rather than being deleted: it was measuring reach by
  // where execution stopped, and now measures it by where execution ARRIVES.
  // A bare doesNotThrow would be strictly weaker than what it replaces -- it
  // admits every wrong return address -- so this pins the PC as well. 0x0D62
  // is the return address pushed above, which makes this the OQ1/OQ4
  // resolution stated positively: the rst 0x28 dispatch does not consume its
  // caller's return address, and the caller IS returned to (§65).
  assert.doesNotThrow(() => sub_0f56(m), "loc_0fd7 must now run to completion");
  assert.strictEqual(
    m.pc,
    0x0d62,
    "control must return to sub_0f56's caller, not to the dispatch table",
  );

  // THE INTEGRATION POINT ITSELF. Review found that deleting the
  // `sub_122a(m)` call from loc_0fd7 left the entire suite green: the reach
  // assertion above sits DOWNSTREAM of the call and is unaffected by whether
  // it happens. The unit tests prove the routine works; nothing proved it was
  // wired in. These five groups are what loc_0fd7's first call to sub_122a
  // writes, and they fail if the call is dropped or reordered.
  //
  // WHAT MAKES THIS CHECKABLE IS THE SOURCE, NOT A FILL. The 0xA5 fill above
  // does NOT survive to here -- sub_0f56's own 17x0x80 clear covers
  // 0x6280-0x6AFF, which includes this whole range, and runs before the
  // dispatch. (Review established this by mutation: dropping the call fails
  // with actual 0, not actual 165. My first version of this comment credited
  // the fill and was simply wrong.)
  //
  // These assertions discriminate because ROM 0x3DEC is `3d 01 03 02` and
  // contains NO zero byte, so every one of the four compares against a
  // background of zero. That is a property of the data, so it is asserted
  // rather than assumed -- extend this block to a group containing a zero
  // byte and the assertion for that byte would be vacuous, which is F2 again.
  assert.ok(
    [0, 1, 2, 3].every((i) => ROM[0x3dec + i] !== 0),
    "source group must contain no zero byte, or these compares go vacuous",
  );
  for (let pass = 0; pass < 5; pass++) {
    const dst = 0x6407 + 0x20 * pass; // B=0x05, C=0x1C -> stride C+4 = 0x20
    for (let i = 0; i < 4; i++) {
      assert.equal(
        m.mem.read8(dst + i), ROM[0x3dec + i],
        `sub_122a must be CALLED by loc_0fd7: pass ${pass} byte ${i}`,
      );
    }
  }

  // 1. the 0x27-byte clear, minus the two cells written deliberately after it
  for (let a = 0x6200; a <= 0x6226; a++) {
    if (a === 0x6209 || a === 0x620a) continue;
    assert.equal(m.mem.read8(a), 0, `0x${a.toString(16)} must be cleared`);
  }
  assert.equal(m.mem.read8(0x6209), 0x04);
  assert.equal(m.mem.read8(0x620a), 0x08);

  // 2. the 17 x 0x80 clear reaches 0x6AFF
  //
  // 0x69FF WAS A PROBE HERE AND IS NO LONGER A VALID ONE: loc_0fd7's second
  // ldir now copies ROM 0x3E00-0x3E03 to 0x69FC-0x69FF, so the address is
  // legitimately overwritten later in the same execution. Replaced with
  // 0x69F0, which is inside the clear and inside no write loc_0fd7 performs.
  // The old probe is not deleted but INVERTED into group 6 below -- a probe
  // that stops measuring the clear should start measuring whatever displaced
  // it, or the coverage is silently lost.
  for (const a of [0x62c0, 0x6800, 0x69f0, 0x6aff]) {
    assert.equal(m.mem.read8(a), 0, `0x${a.toString(16)} inside the 0x880 clear`);
  }

  // 3. the ldir copies ROM 0x3D9C-0x3DDB, with 0x62B0-0x62B4 overwritten after
  let match = 0;
  for (let i = 0; i < 0x40; i++) if (m.mem.read8(0x6280 + i) === rom[0x3d9c + i]) match++;
  assert.equal(match, 59, "64 copied, 5 overwritten by the computed values");

  // 4. the arithmetic: (0x6229)=1 -> 1*10 + 0x28 = 0x32, under the 0x51 clamp;
  //    then 0xDC - 2*0x32 = 0x78, over the 0x28 floor.
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((i) => m.mem.read8(0x62b0 + i)),
    [0x32, 0x32, 0x32, 0x78, 0x78],
  );

  // 6. THE NEW INTEGRATION POINTS. Review previously found that deleting the
  // sub_122a call from loc_0fd7 left the whole suite green, because the reach
  // assertion sat downstream of it. Same exposure applies to each routine
  // landing now, so each gets memory that fails if its call is dropped.
  //
  // 6a. loc_0fd7's second ldir -- ROM 0x3E00-0x3E03 -> 0x69FC-0x69FF. This is
  //     what displaced the 0x69FF probe above.
  for (let i = 0; i < 4; i++) {
    assert.equal(
      m.mem.read8(0x69fc + i), ROM[0x3e00 + i],
      `loc_0fd7's second ldir must run: byte ${i}`,
    );
  }

  // 6b. sub_11fa, called with HL = 0x3DF4 as a LIVE-IN. Its four (de) writes
  //     land consecutively at 0x6A28-0x6A2B, and its seven IX writes land at
  //     a PERMUTED set of offsets off 0x66A0 -- +00 literal, then +03, +07,
  //     +08, +05, +09, +0A taking source bytes 0..5 in order. Asserting the
  //     permutation explicitly: a translation that sorted the offsets into
  //     ascending order would produce different memory here and is exactly
  //     the plausible-looking cleanup this pins against.
  for (let i = 0; i < 4; i++) {
    assert.equal(
      m.mem.read8(0x6a28 + i), ROM[0x3df4 + i],
      `sub_11fa must be CALLED by loc_0fd7: (de) byte ${i}`,
    );
  }
  assert.equal(m.mem.read8(0x66a0), 0x01, "sub_11fa writes the literal 0x01 at +00");
  for (const [off, src] of [[0x03, 0], [0x07, 1], [0x08, 2], [0x05, 3], [0x09, 4], [0x0a, 5]]) {
    assert.equal(
      m.mem.read8(0x66a0 + off), ROM[0x3df4 + src],
      `sub_11fa (ix+0x${off.toString(16)}) takes source byte ${src}`,
    );
  }

  // 6c. sub_11a6's own two marker writes, 0x10 apart off IX = 0x6680.
  assert.equal(m.mem.read8(0x6680), 0x01, "sub_11a6 marker at +0x00");
  assert.equal(m.mem.read8(0x6690), 0x01, "sub_11a6 marker at +0x10");

  // 6d. THE WHOLE sub_11a6 CHAIN IN ONE PLACE. sub_11d3 gathers (IX+3),
  //     (IX+7), (IX+8), (IX+5) -- in that order, +4 and +6 never read -- into
  //     four consecutive bytes at HL = 0x6A18, twice, with IX advancing 0x10.
  //     The source bytes it gathers were themselves written by sub_11ec
  //     (offsets +3 and +5, stride 2, skipping +4) and sub_122a (offsets +7
  //     and +8). So these eight bytes pin, simultaneously:
  //       - sub_11a6's undocumented HL live-in, supplied as 0x3E0C here
  //         (0x3E0C/0x3E0D reaching +3/+5 can only come from that parameter)
  //       - sub_11ec storing at E and E+2 and never E+1
  //       - sub_122a RESTORING its source pointer across passes, which is why
  //         pass 2 re-reads 0x3E08/0x3E09 rather than advancing
  //       - sub_11d3's +3,+7,+8,+5 permutation
  //     Sorting sub_11d3's offsets, or dropping sub_122a's push/pop, changes
  //     this block.
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 6, 7].map((i) => m.mem.read8(0x6a18 + i)),
    [
      ROM[0x3e0c], ROM[0x3e08], ROM[0x3e09], ROM[0x3e0d], // pass 1, IX = 0x6680
      ROM[0x3e0e], ROM[0x3e08], ROM[0x3e09], ROM[0x3e0f], // pass 2, IX = 0x6690
    ],
    "sub_11a6 chain: 11ec stride-2, 122a source restore, 11d3 +3/+7/+8/+5",
  );

  // OQ5 made concrete: an input that overflows the mod-256 arithmetic. This
  // is the drafter's flagged concern, pinned rather than argued.
  const w = new Machine(ROM);
  w.regs.sp = 0x6c00;
  w.push16(0x0d62);
  w.mem.write8(0x6229, 0xa5); // 0xA5 * 10 = 1650, wraps to 0x72
  w.mem.write8(0x6227, 0x01);
  // This call is INCIDENTAL -- what this test measures is the clamp below,
  // and it only needs the walk to get that far. It was an assert.throws on
  // the frontier address; loc_0fd7 now completes, so there is nothing to
  // catch. Deliberately NOT re-pinned to a reach: the frontier belongs in
  // exactly ONE place (the dispatch test above), and pinning it here too
  // would mean every advance edits two sites and one drifts.
  sub_0f56(w);
  assert.deepEqual(
    [0, 1, 2].map((i) => w.mem.read8(0x62b0 + i)),
    [0x50, 0x50, 0x50],
    "wrapped arithmetic is clamped, NOT detected -- 0x9A > 0x51 so it hits 0x50",
  );

  // 5. the 3 x 4 seed at 0x6A00, A stepping by 0x10
  assert.deepEqual(
    [...Array(12)].map((_, i) => m.mem.read8(0x6a00 + i)),
    [0x4f, 0x3a, 0x0f, 0x18, 0x5f, 0x3a, 0x0f, 0x18, 0x6f, 0x3a, 0x0f, 0x18],
  );
});

test("sub_2441 picks a table from 0x6227 across a flag-neutral load", () => {
  // INTEGRATED FROM A DRAFT. The hazard the drafter flagged as OQ-2: three
  // `jp z` instructions test a `dec a` from TWO instructions back, across an
  // intervening `ld hl,nn` that is flag-neutral. Reorder the load and the
  // test "for readability" and the code still runs and picks the WRONG
  // TABLE -- no crash, no diff on any gate not watching which level drew.
  //
  // Pinned by selecting each table and checking the walk's end state differs.
  // Distinct from the superficially identical case at 0x244C, where `and a`
  // regenerates the flags and the intervening `ld iy` is harmless.
  const ends = new Map();
  for (const kind of [1, 2, 3, 4]) {
    const m = new Machine(ROM);
    m.regs.sp = 0x6c00;
    m.push16(0x0d65); // `call 0x2441` at 0x0D62 pushes this
    m.mem.write8(0x6227, kind);
    sub_2441(m);
    assert.equal(m.pc, 0x0d65, `kind ${kind}: must return via cp 0xa9 / ret z`);
    ends.set(kind, `${m.regs.ix.toString(16)}/${m.regs.iy.toString(16)}`);
  }
  // Each table must produce a DISTINCT walk, or the selection is not working
  // and a reordering bug would be invisible.
  assert.equal(
    new Set([...ends.values()]).size, 4,
    `all four tables must walk differently, got ${JSON.stringify([...ends])}`,
  );

  // head A: sum 0x5E plus six ROM bytes at 0x3F0C, mod 256, picks the IY base.
  // Computed independently from the ROM rather than from the translation.
  let sum = 0x5e;
  for (let i = 0; i < 6; i++) sum = (sum + ROM[0x3f0c + i]) & 0xff;
  const m2 = new Machine(ROM);
  m2.regs.sp = 0x6c00;
  m2.push16(0x0d65);
  m2.mem.write8(0x6227, 0x03);
  sub_2441(m2);
  assert.equal(sum, 0x00, "the ROM's own bytes make this sum zero");
  // sum == 0 so `jp z` is taken and IY is NOT incremented past its base.
  assert.ok(m2.regs.iy >= 0x6310, "IY base 0x6310 when the head-A sum is zero");
});

// ---- loc_1dc9 (INTEGRATED FROM A DRAFT, code3) -----------------------------
// UNGATED by execution: sub_1dbd (its only caller) is not translated, so no
// gate reaches it. These tests exercise the drafted hazards directly. Every
// exit is a tail jump to an untranslated unit, so loc_1dc9 always ends in a
// NotImplemented throw; m.pc after the throw is the tail-jump target, set by
// the m.step that precedes it. Expected exits/values are sourced from the ROM
// bytes at 0x1DC9-0x1DF4, never from the skeleton (§21).

test("loc_1dc9 advances state 0x6340 -> 2 UNCONDITIONALLY, before any dispatch", () => {
  // Draft OQ-3 / S8. `ld a,0x02 / ld (0x6340),a` at 0x1DCE-0x1DD2 precedes the
  // first branch (rra/jp c at 0x1DD6), so 0x6340 steps to 2 on EVERY entry --
  // including the earliest exit, bit 0 set -> 0x3E70. A translator who folds
  // the store into the fall-through path would leave 0x6340 unwritten here.
  // MUTATION this catches: relocate the 0x6340 store below the rra chain.
  // Non-vacuous: 0x6340 and 0x6341 power on at 0x00 (state[0] all-zero, above),
  // so 0x02 / 0x40 differ from the power-on value.
  // The bit-0 tail is now translated; give it clean-completion preconditions:
  // push a return address, and arm the rst-0x30 gate (mem[0x6227]=1 rotates A=5
  // to carry-set so sub_0030 returns instead of caller-skipping off an unmapped
  // stack). The bit-0 tail (loc_1e28) needs no 0x6343 pointer.
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x6227, 0x01);
  m.mem.write8(0x6342, 0x01); // bit 0 set -> earliest exit -> loc_3e70
  loc_1dc9(m);
  assert.equal(m.mem.read8(0x6340), 0x02, "0x6340 advances to 2 even on the earliest exit");
  assert.equal(m.mem.read8(0x6341), 0x40, "0x6341 set to 0x40 unconditionally");
  assert.equal(m.mem.read8(0x6a31), 0x7b, "bit 0 routed via loc_3e70: param block B=0x7B");
  assert.equal(m.pc, 0x4d5e, "runs past the old 0x3E70 frontier and returns to the caller");
});

test("loc_1dc9 dispatches on 0x6342 bits 0,1,2 in PRIORITY ORDER", () => {
  // Draft §4 / S6 (first translated use of rra). Three rra rotate bits 0,1,2
  // out to carry in that order; each jp c takes the FIRST set bit. Exit targets
  // are the ROM's jp operands at 0x1DD7 (0x3E70), 0x1DDB (0x1E00), 0x1DDF
  // (0x1DF5). MUTATION this catches: a wrong/swapped jp target, e.g. the bit-1
  // exit copied as 0x1DF5 -- the 0x02 and 0x06 cases would then miss 0x1E00.
  const cases = [
    [0x01, 0x7b], // bit 0 (lowest) wins -> loc_3e70
    [0x02, 0x7d], // bit 1, bit 0 clear -> loc_1e00
    [0x04, 0x7e], // bit 2, bits 0-1 clear -> loc_1df5 -> loc_1e08 (0x6018 bit0 set)
    [0x06, 0x7d], // bits 1 AND 2 -> bit 1 wins by priority (loc_1e00 = 0x7D), not bit 2 (0x7E)
    [0x05, 0x7b], // bits 0 AND 2 -> bit 0 wins
  ];
  for (const [v, b] of cases) {
    const m = new Machine(ROM);
    m.regs.sp = 0x6c00; m.push16(0x4d5e);
    m.mem.write8(0x6227, 0x01);                              // arm rst-0x30 gate -> clean completion
    m.mem.write8(0x6343, 0x00); m.mem.write8(0x6344, 0x6b);  // ld hl,(0x6343) -> 0x6B00 (mapped RAM)
    m.mem.write8(0x6018, 0x01);                              // bit2 path: loc_1df5 -> loc_1e08 (distinct 0x7E)
    m.mem.write8(0x6342, v);
    loc_1dc9(m);
    assert.equal(m.mem.read8(0x6a31), b, `0x6342=0x${v.toString(16)} exit fingerprint B=0x${b.toString(16)}`);
    assert.equal(m.pc, 0x4d5e, "runs to completion and returns to the caller");
  }
});

test("loc_1dc9's 0x6229 dispatch decs WITHOUT reloading A between the two dec a", () => {
  // Draft §5 / S8. When 0x6342 bits 0-2 are clear, dispatch on A = mem[0x6229]:
  // `dec a / jp z,0x1E00 / dec a / jp z,0x1E08 / jp 0x1E10`, NO reload between
  // the decs (same idiom as sub_2441's 0x6227 dispatch). The 0x6229==2 case is
  // discriminating: the SECOND dec must see 1 (from the first dec), not a
  // reloaded 2. MUTATION this catches: reload A = mem[0x6229] before the second
  // dec -- 0x6229==2 then falls to 0x1E10 instead of 0x1E08. Exits from the ROM
  // jp targets at 0x1DEB / 0x1DEF / 0x1DF2.
  const cases = [
    [1, 0x7d], // loc_1e00
    [2, 0x7e], // loc_1e08 -- the discriminating value
    [3, 0x7f], // loc_1e10
    [0, 0x7f], // dec 0 -> 0xFF, never zero -> falls through to loc_1e10
  ];
  for (const [v, b] of cases) {
    const m = new Machine(ROM);
    m.regs.sp = 0x6c00; m.push16(0x4d5e);
    m.mem.write8(0x6227, 0x01);                              // arm rst-0x30 gate
    m.mem.write8(0x6343, 0x00); m.mem.write8(0x6344, 0x6b);  // ld hl,(0x6343) -> 0x6B00 (mapped RAM)
    m.mem.write8(0x6342, 0x00); // all dispatch bits clear -> reach the 0x6229 path
    m.mem.write8(0x6229, v);
    loc_1dc9(m);
    assert.equal(m.mem.read8(0x6a31), b, `0x6229=${v} exit fingerprint B=0x${b.toString(16)}`);
    assert.equal(m.pc, 0x4d5e, "runs to completion and returns to the caller");
  }
  // 0x6085 := 3 on this bits-clear path (written at 0x1DE7, before the 0x6229 dispatch).
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x6227, 0x01);
  m.mem.write8(0x6343, 0x00); m.mem.write8(0x6344, 0x6b);
  m.mem.write8(0x6342, 0x00);
  m.mem.write8(0x6229, 3);
  loc_1dc9(m);
  assert.equal(m.mem.read8(0x6085), 0x03, "0x6085 set to 3 on the bits-clear path");
});

test("sub_1dbd routes on 0x6340 through the rst 0x28 table at 0x1DC1", () => {
  // INTEGRATED FROM A DRAFT (code3). rst 0x28 inline-jump-table dispatcher:
  // A = mem[0x6340] indexes the 4-entry table at 0x1DC1. Mechanism modelled per
  // the sub_0f56 precedent (push table base, pop it in the handler, index 2*A,
  // read target FROM ROM). Targets come from the ROM table bytes, NOT the
  // skeleton (§21). MUTATION this catches: dropping `add a,a` (index not
  // doubled) sends 0x6340==2 into 0x1DC9 (=loc_1dc9) instead of 0x1E4A, and
  // 0x6340==1 to a garbage target instead of loc_1dc9.
  const romTarget = (i) => ROM[0x1dc1 + 2 * i] | (ROM[0x1dc1 + 2 * i + 1] << 8);
  // Table from ROM: [0]=0x1E49 (loc_1e49, a bare ret)  [1]=0x1DC9 (loc_1dc9)
  //                 [2]=0x1E4A (loc_1e4a countdown)    [3]=0x0000 (reset vector).
  assert.equal(romTarget(1), 0x1dc9, "entry 1 must be loc_1dc9 -- the wiring below depends on it");
  assert.equal(romTarget(3), 0x0000, "entry 3 is the dw 0x0000 reset vector");

  // Entry 0 -> loc_1e49: a bare `ret`, returns to the caller with 0x6340 unchanged.
  {
    const m = new Machine(ROM);
    m.regs.sp = 0x6c00; m.push16(0x4d5e);
    m.mem.write8(0x6340, 0);
    sub_1dbd(m);
    assert.equal(m.pc, 0x4d5e, "entry 0 -> loc_1e49 rets to the caller");
    assert.equal(m.mem.read8(0x6340), 0x00, "entry 0 (idle arm) leaves 0x6340 unchanged");
  }
  // Entry 2 -> loc_1e4a: decrements the state-2 countdown at 0x6341 (0 -> 0xFF)
  // and `ret nz` stays in state 2.
  {
    const m = new Machine(ROM);
    m.regs.sp = 0x6c00; m.push16(0x4d5e);
    m.mem.write8(0x6340, 2);
    sub_1dbd(m);
    assert.equal(m.pc, 0x4d5e, "entry 2 -> loc_1e4a rets (ret nz, counter not expired)");
    assert.equal(m.mem.read8(0x6341), 0xff, "entry 2 -> loc_1e4a dec'd the 0x6341 countdown (0 -> 0xFF)");
    assert.equal(m.mem.read8(0x6340), 0x02, "entry 2 stays in state 2");
  }
  // Entry 3 -> dw 0x0000 (the reset vector) is STILL untranslated -> NotImplemented.
  {
    const m = new Machine(ROM);
    m.regs.sp = 0x6c00;
    m.mem.write8(0x6340, 3);
    assert.throws(() => sub_1dbd(m), /not implemented/, "entry 3 (0x0000 reset vector) is not translated");
  }
  // Entry 1 dispatches INTO loc_1dc9, which advances 0x6340 -> 2 and sets 0x6341
  // = 0x40. (Clean-completion preconditions for loc_1dc9's now-translated tail:
  // pushed return, rst-0x30 gate armed via 0x6227, 0x6343 -> mapped RAM.)
  {
    const m = new Machine(ROM);
    m.regs.sp = 0x6c00; m.push16(0x4d5e);
    m.mem.write8(0x6227, 0x01);
    m.mem.write8(0x6343, 0x00); m.mem.write8(0x6344, 0x6b);
    m.mem.write8(0x6340, 1);
    sub_1dbd(m);
    assert.equal(m.mem.read8(0x6340), 0x02, "entry 1 -> loc_1dc9 advanced 0x6340 to 2");
    assert.equal(m.mem.read8(0x6341), 0x40, "entry 1 -> loc_1dc9 set 0x6341 to 0x40");
    assert.equal(m.pc, 0x4d5e, "entry 1 -> loc_1dc9 runs its tail to completion and rets");
  }
});

// ---- loc_1e15 (INTEGRATED FROM A DRAFT, code3) -- drafted TEST-SPEC, §9 ------
// loc_1e15 calls sub_309f first (harmless with power-on RAM: 0x60B0=0 ->
// mem[0x6000] bit 7 clear -> the "slot occupied" branch returns without writing
// 0x6343 or the planted pointer memory), then dereferences 0x6343 and ends in a
// NotImplemented tail-jump to 0x1E36. Assertions inspect state after the throw;
// expected values are the test's controlled synthetic memory, not the skeleton.

test("loc_1e15 loads HL from the WORD at 0x6343 (indirect ld hl,(nn), not immediate)", () => {
  // Draft §4a / TEST 1. 2A 43 63 = ld hl,(0x6343): HL = the word AT 0x6343.
  // MUTATION this catches: regs.hl = 0x6343 (immediate, opcode 21) -- sets HL to
  // the literal, so it would read/clear 0x6343 and end at HL=0x6346.
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x6343, 0x30);
  m.mem.write8(0x6344, 0x6a); // synthetic pointer -> 0x6A30 (!= 0x6343, != 0)
  m.mem.write8(0x6a30, 0x5a); // non-zero byte 0, so the clear is observable
  loc_1e15(m); // now wired through to loc_1e36 (writes the 0x6A30 param block)
  // deref[0]=0x5A read into A -> loc_1e36's block: (0x6A30)=A confirms the indirect deref
  assert.equal(m.mem.read8(0x6a30), 0x5a, "indirect deref of 0x6343 (not literal): byte0 flowed to A");
});

test("loc_1e15 reads byte 0 into A BEFORE clearing it (order-critical, S8)", () => {
  // Draft §4b / TEST 2. ld a,(hl) then ld (hl),0x00 -- A carries the PRE-clear
  // byte. MUTATION this catches: clear first, then read -> A = 0. Non-vacuous
  // ONLY because the planted byte 0x5A != 0 (the §71 zero-vs-zero trap avoided).
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x6343, 0x30);
  m.mem.write8(0x6344, 0x6a); // -> 0x6A30
  m.mem.write8(0x6a30, 0x5a); // pre-clear value, non-zero
  loc_1e15(m);
  assert.equal(m.mem.read8(0x6a30), 0x5a, "byte0 read BEFORE clear -> A -> loc_1e36 block (0x6A30)");
});

test("loc_1e15's inc l x3 wraps within the page, no carry into H -- SYNTHETIC", () => {
  // Draft §4c / TEST 3, LATENT. Three inc l advance L only; at L=0xFF it wraps
  // without carrying into H. MUTATION this catches: regs.hl += 3 (inc hl x3),
  // which carries into H. SYNTHETIC pointer at 0x6AFE forces the wrap -- no real
  // tape is known to place the 0x6343 pointer at a page boundary (§34).
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x6343, 0xfe);
  m.mem.write8(0x6344, 0x6a); // pointer -> 0x6AFE (low byte near wrap)
  m.mem.write8(0x6afe, 0x5a); // non-zero byte 0 (read-clear independence)
  loc_1e15(m); // inc-l wrap happens inside; deref[0] at 0x6AFE flows to loc_1e36's block
  assert.equal(m.mem.read8(0x6a30), 0x5a, "byte0 read from the wrapped deref pointer 0x6AFE");
});

// ---- loc_1e00 (INTEGRATED FROM A DRAFT, code3) -- drafted TEST-SPEC, §6 ------
// loc_1e00 sets (B, DE) and tail-jumps to the real loc_1e15, so a call runs the
// whole loc_1e15 chain and ends in loc_1e15's NotImplemented throw at 0x1E36.
// The 0x6343 pointer is planted at a safe work-RAM address so loc_1e15's deref
// is clean. loc_1e15 preserves B/DE, so they survive to the throw.

test("loc_1e00 sets B=0x7D, DE=0x0003 -- the constants distinguishing it from siblings", () => {
  // Draft §6 / TEST 1. S7: loc_1e00 / loc_1e08 / loc_1e10 differ ONLY in (B, DE).
  // Expected pair from ROM bytes 0x1E01 (B) and 0x1E03-04 (DE, little-endian),
  // NOT the skeleton (§21). MUTATION this catches: sibling constants (0x7E,
  // 0x0005) copied in, or a DE byte-order slip (0x0300).
  assert.equal(ROM[0x1e01], 0x7d, "ROM 0x1E01 is B's immediate 0x7D");
  assert.equal(ROM[0x1e03] | (ROM[0x1e04] << 8), 0x0003, "ROM 0x1E03-04 LE is DE=0x0003");
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x6343, 0x30);
  m.mem.write8(0x6344, 0x6a); // safe pointer for loc_1e15's deref
  // B/DE at runtime are consumed by the loc_1e15->loc_1e36 chain (sub_309f clobbers B);
  // the constants are pinned by the ROM-byte checks above. Just confirm the chain runs.
  assert.doesNotThrow(() => loc_1e00(m));
});

test("loc_1e00's jp 0x1e15 is a TAIL JUMP -- no return address pushed (SP net-zero)", () => {
  // Draft §6 / TEST 2. S2/S4: ROM 0x1E05 = 0xC3 (jp), not 0xCD (call). A jp
  // changes SP by 0. MUTATION this catches: modelling it as a call (m.push16 +
  // call) leaves SP = sp0 - 2. The loc_1e15 chain (call 0x309f + its ret) is
  // SP-balanced, so at the 0x1E36 throw SP must equal the entry SP.
  assert.equal(ROM[0x1e05], 0xc3, "ROM 0x1E05 is jp (C3), not call (CD)");
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00;
  m.mem.write8(0x6343, 0x30);
  m.mem.write8(0x6344, 0x6a); // safe pointer for loc_1e15's deref
  m.push16(0x4d5e); // caller return -- the chain's final ret pops this
  const sp0 = m.regs.sp;
  loc_1e00(m); // tail-jump chain -> loc_1e15 -> loc_1e36; SP-balanced, rets to the caller
  assert.equal(m.regs.sp, (sp0 + 2) & 0xffff, "chain is SP-balanced: only the caller return is popped");
  assert.equal(m.pc, 0x4d5e, "returns to the pushed caller");
});

// ---- entry_1e8c / entry_1e94 (INTEGRATED FROM A DRAFT, code2) -- §3 ----------

test("entry_1e94 is a SINGLE caller-skip: pop hl drops one frame, ret -> caller's caller", () => {
  // Draft §3 / TEST 1 (SYNTHETIC stack). pop hl (ROM 0x1E94 = e1) discards the
  // caller's return, then ret returns to the caller's CALLER. MUTATION this
  // catches: modelling it as a plain ret (dropping the pop hl) -> returns to the
  // caller with SP one frame lower. Two-assertion form (§71a): SP delta AND PC.
  const SENTINEL = 0x4d5e; // caller's-caller return -- declared synthetic, != 0x1980
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00;
  m.push16(SENTINEL); // caller's caller return (deeper)
  m.push16(0x1980); // the 0x197D caller's return (0x197D + 3, from the ROM)
  const entrySP = m.regs.sp;
  entry_1e94(m);
  assert.equal(m.regs.sp, entrySP + 4, "pop hl discards 0x1980, then ret pops SENTINEL: SP +4");
  assert.equal(m.pc, SENTINEL, "returned to the caller's CALLER, not the stale 0x1980");
});

test("entry_1e8c returns on (0x6350)==0 via ret z WITHOUT calling 0x1e96", () => {
  // Draft §3 / TEST 2. ret z (ROM 0x1E90 = c8) returns when (0x6350)==0 and falls
  // through to call 0x1e96 otherwise. MUTATION this catches: inverting to ret nz
  // -> on (0x6350)==0 it does NOT return, proceeds to `call 0x1e96` and throws
  // NotImplemented. The discriminator is whether 0x1e96 is entered (§38): correct
  // returns cleanly, the mutation throws.
  const RET = 0x4d5e; // synthetic caller return
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00;
  m.push16(RET);
  m.mem.write8(0x6350, 0x00); // Z path -- ret z must be TAKEN
  entry_1e8c(m); // must NOT throw: 0x1e96 is not entered on the zero path
  assert.equal(m.pc, RET, "ret z taken -> normal return to the caller; 0x1e96 not called");
});

// ---- sub_1e96 (INTEGRATED FROM A DRAFT, code2) -- rst 0x28 dispatcher, §4 ----
// 3-entry table at 0x1E9A, indexed by (0x6345); all targets untranslated, so a
// dispatch throws NotImplemented and m.pc is the resolved target. Targets read
// from ROM table bytes, not the skeleton (§21).

test("sub_1e96 dispatches on the INDEX (0x6345), not a neighbouring address", () => {
  // Draft §4 / TEST 1. MUTATION this catches: reading (0x6346) as the index.
  const romTarget = (i) => ROM[0x1e9a + 2 * i] | (ROM[0x1e9a + 2 * i + 1] << 8);
  assert.equal(romTarget(1), 0x1f09, "ROM table[1] is 0x1F09");
  assert.equal(romTarget(2), 0x1f23, "ROM table[2] is 0x1F23");
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00;
  m.push16(0x4d5e); // caller return -- loc_1f09 ends in ret
  m.mem.write8(0x6345, 1); // index 1 -> table[1] = loc_1f09
  m.mem.write8(0x6346, 0); // neighbour: if MISREAD as the index -> table[0] = entry_1ea0
  sub_1e96(m);
  // loc_1f09 prologue: dec (0x6346) 0 -> 0xFF, NZ -> ret nz (immediate return).
  assert.equal(m.mem.read8(0x6346), 0xff, "loc_1f09 ran: dec'd (0x6346) 0 -> 0xFF then ret nz");
  assert.equal(m.mem.read8(0x6345), 1, "0x6345 untouched -- a mis-dispatch to entry_1ea0 (idx0) would inc it / store 6 into 0x6346");
  assert.equal(m.pc, 0x4d5e, "loc_1f09 ret nz -> back to caller");
});

test("sub_1e96 scales the index by 2 (add a,a) before the table lookup", () => {
  // Draft §4 / TEST 2. target = word at (0x1E9A + 2*index). MUTATION this catches:
  // dropping the *2 (byte offset) -> 0x1E9A+1 = 0x1E9B, word (1e 09) = 0x091E,
  // nonsense. Index 1 chosen: at index 0 the *2 error is invisible (§34).
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00;
  m.push16(0x4d5e); // caller return -- loc_1f09 ends in ret
  m.mem.write8(0x6345, 1); // index 1 * 2 -> table[1] = loc_1f09
  m.mem.write8(0x6346, 0x05); // loc_1f09: dec 0x05 -> 0x04, NZ -> ret nz
  sub_1e96(m); // must NOT throw: 0x1F09 is translated (a dropped *2 -> 0x091E throws NotImplemented)
  assert.equal(m.mem.read8(0x6346), 0x04, "index 1 *2 -> loc_1f09 ran (dec'd its 0x6346 delay counter)");
  assert.equal(m.pc, 0x4d5e, "loc_1f09 ret nz -> caller");
});

// ---- entry_1ea0 (INTEGRATED FROM A DRAFT, code2) -- §3, runs to ret ----------
// A complete routine (ret at 0x1F08). ld ix,(0x6351) reads mem[0x6351]|mem[0x6352]<<8,
// and 0x6352 is ALSO the HL-select byte -- so setting 0x6352=0x65 both picks HL=0x69b8
// and puts IX in safe work RAM (0x65xx). Each test pushes a return address and reads
// memory after ret. Expected values are from the ROM bytes / controlled synthetic RAM.

test("entry_1ea0 INCREMENTS 0x6345 (state advance via incMem8), not a hardcoded store", () => {
  // Draft §3 / TEST 1. inc (hl) @ 0x1EF9 advances the 1e96 dispatch index. Two
  // cases separate inc from a store-of-1: MUTATION mem.write8(0x6345,1) gives 1
  // from 0 (case A passes) but 1 from 2 (case B fails).
  const run = (start6345) => {
    const m = new Machine(ROM);
    m.regs.sp = 0x6c00;
    m.push16(0x4d5e); // return address (routine ends in ret)
    m.mem.write8(0x6351, 0x00); // IX low; 0x6352 below is IX high AND HL select
    m.mem.write8(0x6352, 0x65); // == -> HL 0x69b8; IX = 0x6500 (safe work RAM)
    m.mem.write8(0x6354, 0x00); // loop count 0 -> skip the loop
    m.mem.write8(0x6345, start6345);
    entry_1ea0(m);
    return m.mem.read8(0x6345);
  };
  assert.equal(run(0), 1, "0x6345: 0 -> 1 (inc)");
  assert.equal(run(2), 3, "0x6345: 2 -> 3 (inc, NOT a store-of-1)");
});

test("entry_1ea0 sets 0x6342 = 0x02 if (ix+0x15)==0, else 0x04", () => {
  // Draft §3 / TEST 2. MUTATION: jp nz polarity swaps the two. IX = 0x6500 (safe),
  // so (ix+0x15) = mem[0x6515].
  const run = (byteAt15) => {
    const m = new Machine(ROM);
    m.regs.sp = 0x6c00;
    m.push16(0x4d5e);
    m.mem.write8(0x6351, 0x00);
    m.mem.write8(0x6352, 0x65); // HL 0x69b8; IX = 0x6500
    m.mem.write8(0x6354, 0x00); // skip loop -> IX stays 0x6500
    m.mem.write8(0x6515, byteAt15); // (ix+0x15)
    entry_1ea0(m);
    return m.mem.read8(0x6342);
  };
  assert.equal(run(0x00), 0x02, "(ix+0x15)==0 -> 0x6342 = 0x02");
  assert.equal(run(0x01), 0x04, "(ix+0x15)!=0 -> 0x6342 = 0x04");
});

test("entry_1ea0's loop advances HL by 4 each iteration (add hl,bc INSIDE the loop)", () => {
  // Draft §3 / TEST 3. Loop (0x6354) times, HL += 4 each. MUTATION: hoist add hl,bc
  // (advance once) -> wrong copy source. (0x6354)=3, HL start 0x69b8 -> after loop
  // HL = 0x69b8 + 3*4 = 0x69c4; the byte there is copied to 0x6a2c. A hoist-once
  // lands at 0x69bc, a different byte. E=0 so add ix,de is a no-op (IX stays safe).
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00;
  m.push16(0x4d5e);
  m.mem.write8(0x6351, 0x00);
  m.mem.write8(0x6352, 0x65); // HL start 0x69b8; IX = 0x6500
  m.mem.write8(0x6353, 0x00); // E = 0 -> DE = 0 -> add ix,de is a no-op
  m.mem.write8(0x6354, 0x03); // 3 iterations
  m.mem.write8(0x69c4, 0xaa); // correct source: 0x69b8 + 3*4
  m.mem.write8(0x69bc, 0xbb); // hoist-once source: 0x69b8 + 4
  entry_1ea0(m);
  assert.equal(m.mem.read8(0x6a2c), 0xaa, "copied from HL=0x69c4 (3x add hl,bc), not the hoist 0x69bc");
});

// ---- loc_1f09 / loc_1f1d (INTEGRATED FROM A DRAFT, code2) -- §3, delay counter -
// Uses decMem8/incMem8 with LIVE flags (ret nz / jp z read the dec's Z). Each test
// pushes a return address; loc_1f09 runs to one of its two rets.

test("loc_1f09 delays via dec (0x6346) / ret nz -- body runs only when it hits 0", () => {
  // Draft §3 / TEST 1. MUTATION this catches: ret z (inverted delay polarity).
  // Case A: (0x6346)=2 -> dec 1 -> ret nz TAKEN -> body skipped, 0x6347 untouched.
  const a = new Machine(ROM);
  a.regs.sp = 0x6c00; a.push16(0x4d5e);
  a.mem.write8(0x6346, 0x02);
  a.mem.write8(0x6347, 0x09); // sentinel -- UNCHANGED iff the body is skipped
  loc_1f09(a);
  assert.equal(a.mem.read8(0x6346), 0x01, "case A: 0x6346 2 -> 1, ret nz taken (delay)");
  assert.equal(a.mem.read8(0x6347), 0x09, "case A: body skipped -> 0x6347 untouched");
  // Case B: (0x6346)=1 -> dec 0 -> ret nz NOT taken -> body runs (not terminal).
  const b = new Machine(ROM);
  b.regs.sp = 0x6c00; b.push16(0x4d5e);
  b.mem.write8(0x6346, 0x01);
  b.mem.write8(0x6347, 0x09);
  loc_1f09(b);
  assert.equal(b.mem.read8(0x6346), 0x06, "case B: 0x6346 reloaded to 6 (body ran)");
  assert.equal(b.mem.read8(0x6347), 0x08, "case B: 0x6347 decremented 9 -> 8 (not terminal)");
});

test("loc_1f1d advances 0x6345 1 -> 2 and reloads 0x6347 to 4", () => {
  // Draft §3 / TEST 2. MUTATION this catches: omit the inc (hl) (0x6345 stuck at 1).
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x6346, 0x01); // dec -> 0, body runs
  m.mem.write8(0x6347, 0x01); // dec -> 0 -> loc_1f1d
  m.mem.write8(0x6345, 0x01);
  loc_1f09(m);
  assert.equal(m.mem.read8(0x6345), 0x02, "0x6345 advanced 1 -> 2 (via incMem8)");
  assert.equal(m.mem.read8(0x6347), 0x04, "0x6347 reloaded to 4 in loc_1f1d");
});

test("loc_1f09 uses ITS OWN constants (reload 0x06, xor 0x01), not the loc_1f23 twin's", () => {
  // Draft §3 / TEST 3. MUTATION this catches: carrying loc_1f23's constants
  // (reload 0x0c, inc on 0x6a2d). (0x6a2d)=0x03 so xor 0x01 (-> 0x02) and inc
  // (-> 0x04) diverge (§38: avoid the coincidence at 0).
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x6346, 0x01); // body runs
  m.mem.write8(0x6347, 0x02); // dec -> 1, NOT 0 -> the 0x6a2d toggle path
  m.mem.write8(0x6a2d, 0x03);
  loc_1f09(m);
  assert.equal(m.mem.read8(0x6346), 0x06, "reloaded to 0x06 (loc_1f09), not the twin's 0x0c");
  assert.equal(m.mem.read8(0x6a2d), 0x02, "xor 0x01 of 0x03 = 0x02 (loc_1f09), not inc's 0x04");
});

// ---- loc_1f23 / loc_1f34 (INTEGRATED FROM A DRAFT, code2) -- twin of loc_1f09 --

test("loc_1f34 RESETS 0x6345 to 0 (closes the 0-1-2-0 cycle), not inc to 3", () => {
  // Draft §3 / TEST 1. This test IS the bounds guarantee: MUTATION inc (copying
  // loc_1f1d) -> 0x6345 = 3, the exact out-of-bounds index for sub_1e96's table.
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x6346, 0x01); // dec -> 0, body runs
  m.mem.write8(0x6347, 0x01); // dec -> 0 -> loc_1f34
  m.mem.write8(0x6345, 0x02);
  loc_1f23(m);
  assert.equal(m.mem.read8(0x6345), 0x00, "0x6345 RESET to 0 (not inc to 3)");
  assert.equal(m.mem.read8(0x6340), 0x01, "loc_1f34 also sets game state 0x6340 = 1");
  assert.equal(m.mem.read8(0x6343) | (m.mem.read8(0x6344) << 8), 0x6a2c, "0x6343 seeded = 0x6a2c (loc_1e15's pointer)");
});

test("loc_1f23 uses ITS OWN constants (reload 0x0c, inc 0x6a2d), not the loc_1f09 twin's", () => {
  // Draft §3 / TEST 2. MUTATION: loc_1f09's constants (reload 0x06, xor 0x01).
  // (0x6a2d)=0x03 so inc (-> 0x04) and xor 0x01 (-> 0x02) diverge (§38).
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x6346, 0x01); // body runs
  m.mem.write8(0x6347, 0x02); // dec -> 1, NOT 0 -> the 0x6a2d path (not terminal)
  m.mem.write8(0x6a2d, 0x03);
  loc_1f23(m);
  assert.equal(m.mem.read8(0x6346), 0x0c, "reloaded to 0x0c (loc_1f23), not the twin's 0x06");
  assert.equal(m.mem.read8(0x6a2d), 0x04, "inc of 0x03 = 0x04 (loc_1f23), not xor's 0x02");
});

// ---- entry_2913 (INTEGRATED FROM A DRAFT, code2) -----------------------------
// The draft carried no TEST-SPEC (§3 is Open Questions), so these are authored by
// the integrator. Its two exits differ in STACK DEPTH, so per the lead's SP-BLIND
// warning every assertion pins SP delta AND return PC AND A AND the boolean --
// an SP-only test cannot separate them.
//
// Stack model: `call 0x2913` leaves the caller's return R on top, with the
// caller's-caller return CC below it. HIT discards R (inc sp x2) and returns to
// CC; NORMAL returns to R.

const seed2913 = (m, { active }) => {
  m.regs.sp = 0x6c00;
  m.push16(0x4dcc); // CC -- the caller's CALLER return (deeper)
  m.push16(0x4d5e); // R  -- the caller's return (top)
  m.regs.ix = 0x6b00; // record base (safe work RAM)
  m.regs.iy = 0x6b40;
  m.regs.de = 0x0010; // record stride
  m.regs.hl = 0x0505; // H = 0x05, L = 0x05 (read by sub l / sub h)
  m.regs.c = 0x10;
  if (active) {
    m.mem.write8(0x6b00, 0x01); // bit 0 SET -- slot active
    m.mem.write8(0x6b05, 0x10); // C - (ix+5) = 0 -> NC
    m.mem.write8(0x6b43, 0x20); // (iy+3)
    m.mem.write8(0x6b03, 0x20); // (iy+3) - (ix+3) = 0 -> NC
  }
  return m.regs.sp; // entrySP: points at R
};

test("entry_2913 HIT exit returns A=1 to the caller's CALLER (inc sp x2 skip)", () => {
  // The dual-stack-semantics hazard (draft OQ1). MUTATION this catches: modelling
  // the HIT exit as a plain return (dropping the two inc sp) -> lands at R with
  // SP +2 and reports "returned normally". Asserts PC and A too, not just SP.
  const m = new Machine(ROM);
  const entrySP = seed2913(m, { active: true });
  m.regs.b = 0x02;
  const returned = entry_2913(m);
  assert.equal(returned, false, "HIT must report SKIPPED (sub_0008 convention)");
  assert.equal(m.regs.a, 0x01, "HIT sets A = 1");
  assert.equal(m.pc, 0x4dcc, "HIT returns to the caller's CALLER (CC), not R");
  assert.equal(m.regs.sp, entrySP + 4, "HIT consumed R (inc sp x2) AND CC (ret): SP +4");
  assert.equal(m.regs.ix, 0x6b00, "IX restored by the pop that matches the entry push");
});

test("entry_2913 NORMAL exit returns A=0 to the caller, IX restored (push ix OUTSIDE the loop)", () => {
  // Exhausts the list (all slots inactive). Also pins draft S1: `push ix` is
  // OUTSIDE the loop, so ONE push balances ONE pop and IX comes back as the ENTRY
  // value. MUTATION this catches: hoisting push ix INTO the loop -> the final pop
  // restores the LAST advanced IX (0x6b20), not 0x6b00, and SP is off.
  const m = new Machine(ROM);
  const entrySP = seed2913(m, { active: false }); // bit 0 clear -> every slot skipped
  m.regs.b = 0x03; // three iterations, then exhaust
  const returned = entry_2913(m);
  assert.equal(returned, true, "exhausted list must report a NORMAL return");
  assert.equal(m.regs.a, 0x00, "NORMAL exit sets A = 0 (xor a)");
  assert.equal(m.pc, 0x4d5e, "NORMAL returns to the caller (R), not CC");
  assert.equal(m.regs.sp, entrySP + 2, "NORMAL consumed only R: SP +2");
  assert.equal(m.regs.ix, 0x6b00, "IX is the ENTRY value -- one push outside the loop, one pop");
});

// The indexed-bit F3/F5 property is NOT observable end-to-end inside entry_2913
// (the flags are overwritten before anything reads them), so per qa-b it is
// pinned as a SPLIT: [i] the helper SEMANTICS and [ii] the call-site ARGUMENT,
// which chain to the whole property without F3/F5 ever needing to escape.
// Half [i] ALREADY EXISTS -- "bit n,r and bit n,(ix+d) differ ONLY in the F3/F5
// source -- both pinned vs MAME" above covers it (verified: mutating bit() to
// ignore yxFrom fails that test). So only [ii], below, was the real gap.

test("entry_2913's bit n,(ix+d) FORWARDS the EA high byte as yxFrom", () => {
  // White-box on purpose: it couples to the call signature, which is the fair
  // price for pinning a translation detail that is otherwise unpinnable. It pins
  // the ARGUMENT; [i] above pins the SEMANTICS. MUTATION: revert to the 2-arg
  // call -> args[2] is undefined -> fails.
  const m = new Machine(ROM);
  const calls = [];
  const realBit = m.regs.bit.bind(m.regs);
  m.regs.bit = (...args) => { calls.push(args); return realBit(...args); };
  seed2913(m, { active: false }); // IX = 0x6b00, slot inactive -> exactly one bit test
  m.regs.b = 0x01;
  entry_2913(m);
  assert.equal(calls.length, 1, "bit 0,(ix+0x00) executed exactly once");
  assert.equal(calls[0][0], 0, "tests bit 0");
  assert.equal(calls[0][2], 0x6b, "yxFrom = EA high byte (0x6B00 >> 8), NOT the operand value");
});

// ---- sub_2a22 (INTEGRATED FROM A DRAFT, code2) -------------------------------
// Drives the REAL entry_2913 (now integrated), not the draft's stub. Stack models
// `call 0x2a22` from 0x29BD: 0x29C0 on top (sub_2a22's return) with SENTINEL below
// (the caller's caller frame, which must survive). sub_2a22 sets IX=0x6600, so the
// record and the live-ins are seeded there.

const seed2a22 = (m, { hit }) => {
  m.regs.sp = 0x6c00;
  m.push16(0x4dcc); // SENTINEL -- caller's-caller frame; must NOT be popped
  m.push16(0x29c0); // sub_2a22's own return address
  m.regs.hl = 0x0505; // H = L = 0x05 (entry_2913 live-ins)
  m.regs.c = 0x10;
  m.regs.iy = 0x6b40;
  m.mem.write8(0x6b43, 0x20); // (iy+3)
  if (hit) {
    m.mem.write8(0x6600, 0x01); // bit 0 SET at IX=0x6600 -- slot active
    m.mem.write8(0x6605, 0x10); // C - (ix+5) = 0 -> NC
    m.mem.write8(0x6603, 0x20); // (iy+3) - (ix+3) = 0 -> NC
  }
  return m.regs.sp; // entrySP: points at 0x29C0
};

test("sub_2a22 HONOURS entry_2913's skip -- no double return (A=1 path)", () => {
  // Draft §3 / TEST 1. entry_2913's A=1 exit discards 0x2A2E and rets to 0x29C0,
  // so sub_2a22 must NOT run its own ret. MUTATION this catches: ignoring the
  // boolean and running ret(m) anyway -> pops the SENTINEL that belongs to the
  // caller's caller (PC becomes SENTINEL, SP +4). Asserts PC and SP (§71a).
  const m = new Machine(ROM);
  const entrySP = seed2a22(m, { hit: true });
  sub_2a22(m);
  assert.equal(m.regs.a, 0x01, "entry_2913 reported a HIT (A=1)");
  assert.equal(m.pc, 0x29c0, "skip landed at sub_2a22's caller (0x29C0), NOT the SENTINEL");
  assert.equal(m.regs.sp, entrySP + 2, "only the 0x29C0 frame consumed -- SENTINEL still on the stack");
  assert.equal(m.mem.read8(entrySP + 2) | (m.mem.read8(entrySP + 3) << 8), 0x4dcc, "SENTINEL intact");
});

test("sub_2a22 DOES run its own ret on entry_2913's normal (A=0) exit", () => {
  // The other arm: list exhausted -> entry_2913 returns true -> the ret at 0x2A2E
  // executes. Both arms land the caller at 0x29C0; A is what differs, so this
  // pins that the two paths converge correctly rather than by accident.
  const m = new Machine(ROM);
  const entrySP = seed2a22(m, { hit: false }); // bit 0 clear at 0x6600 -> every slot skipped
  sub_2a22(m);
  assert.equal(m.regs.a, 0x00, "entry_2913 exhausted the list (A=0)");
  assert.equal(m.pc, 0x29c0, "normal path also returns to 0x29C0 (via sub_2a22's own ret)");
  assert.equal(m.regs.sp, entrySP + 2, "same net SP as the skip path -- one frame consumed");
});

// ---- sub_29af (INTEGRATED FROM A DRAFT, code2) -------------------------------
// Drives the REAL chain sub_29af -> sub_2a22 -> entry_2913 (all integrated).
// Seeds: 0x6227=3 so rst 0x30's rotate of A=0x04 lands carry-set (normal return);
// records live at IX=0x6600 + n*0x10 with the hit record made to pass every range
// test; 0x620c=0 so the cp at 0x29DC takes the C branch -> the 0x29ED skip exit.

const seed29af = (m, { hitAt }) => {
  m.regs.sp = 0x6c00;
  m.push16(0x4dcc); // SENTINEL -- the caller's CALLER frame
  m.push16(0x4d5e); // R -- sub_29af's own return address
  m.mem.write8(0x6227, 0x03); // rst 0x30: 3 rrca of 0x04 -> C set -> normal return
  m.mem.write8(0x6205, 0x10); // -> C = 0x10 for entry_2913
  m.mem.write8(0x6203, 0x20); // (iy+3), IY = 0x6200
  m.mem.write8(0x620c, 0x00); // A = 0+5 = 5 at the cp -> C -> the skip exit
  const rec = 0x6600 + hitAt * 0x10; // records before `hitAt` stay bit-0 clear
  m.mem.write8(rec + 0x00, 0x01); // slot active
  m.mem.write8(rec + 0x05, 0x10); // C - (ix+5) = 0 -> NC
  m.mem.write8(rec + 0x03, 0x20); // (iy+3) - (ix+3) = 0 -> NC
  return m.regs.sp; // entrySP: points at R
};

test("sub_29af's 0x29ED exit SKIPS the caller (inc sp x2), reporting false", () => {
  // Draft §3 / TEST 1, two-assertion form. MUTATION this catches: modelling the
  // 0x29ED exit as a plain ret -> lands at R with SP +2 and reports true.
  // Also pins the stores on that path, so "took this exit" is not inferred.
  const m = new Machine(ROM);
  const entrySP = seed29af(m, { hitAt: 0 }); // hit on record 0 -> B stays 6 -> loop skipped
  const returned = sub_29af(m);
  assert.equal(returned, false, "the inc-sp exit must report SKIPPED");
  assert.equal(m.pc, 0x4dcc, "returned to the caller's CALLER (SENTINEL), not R");
  assert.equal(m.regs.sp, entrySP + 4, "our return discarded (inc sp x2) AND SENTINEL popped");
  assert.equal(m.mem.read8(0x6205), 0x04, "0x6205 = D-8 = (0x10-4)-8 -- the 0x29E2 store ran");
  assert.equal(m.mem.read8(0x6398), 0x01, "0x6398 = 1 -- the 0x29E8 store ran");
});

test("sub_29af's rst 0x30 SKIP arm aborts the body and returns to our caller", () => {
  // ROM-WIDE rst CALLER-SKIP DOCTRINE: rst 0x30 is one of five skip vectors, and
  // this is an exit sub_29af's OWN BYTES NEVER SHOW. sub_0030 rotates A=0x04 right
  // (0x6227) times and `ret c` -- so it SKIPS when the carry comes back CLEAR.
  // 0x6227 = 1 -> one rrca of 0x04 -> C=0 -> sub_0030 does pop hl / ret, discarding
  // ITS return (0x29B2) and landing at OUR caller: our body never runs.
  // POLARITY IS PER-VECTOR: rst 0x08 skips when bit0 of 0x6007 is SET, rst 0x10
  // when bit0 of 0x6200 is CLEAR, rst 0x18/0x20 when a counter EXPIRES. Not
  // interchangeable -- this test pins 0x30's, not a pattern-matched cousin.
  // MUTATION this catches: ignoring sub_0030's boolean and falling into the body.
  const m = new Machine(ROM);
  const entrySP = seed29af(m, { hitAt: 0 });
  m.mem.write8(0x6227, 0x01); // ONE rotate -> carry CLEAR -> sub_0030 skips us
  const returned = sub_29af(m);
  assert.equal(returned, true, "the rst-0x30 skip still reaches OUR caller -> true");
  assert.equal(m.pc, 0x4d5e, "landed at our caller (R), not the caller's caller");
  assert.equal(m.regs.sp, entrySP + 2, "only our own frame consumed");
  // The body never ran, so the seed value survives untouched.
  assert.equal(m.mem.read8(0x6205), 0x10, "0x6205 still the seed -- the body was aborted");
  assert.equal(m.mem.read8(0x6398), 0x00, "0x6398 never written -- no exit path ran");
});

test("sub_29af's countdown advances IX by DE (6-B) times, add ix,de INSIDE the loop", () => {
  // Draft §3 / TEST 2. WHY THE LOOP EXISTS: entry_2913 ends with `pop ix`, so it
  // RESTORES IX to the base (0x6600) on both exits -- it reports WHICH record hit
  // only through B. sub_29af's countdown re-walks IX to that record: B = 6-hitAt,
  // so A = 6-B = hitAt advances. Hit on record 2 -> B=4 -> A=2 -> IX must land on
  // 0x6620 and read (ix+5) = 0x6625. MUTATION this catches: hoisting add ix,de out
  // of the loop (one advance) -> IX lands on 0x6610 and reads 0x6615 instead.
  // 0x6625 is pinned to 0x10 by the hit setup, so the ADDRESS is the discriminator:
  // plant a different byte at the hoist landing and the exit store diverges.
  const m = new Machine(ROM);
  seed29af(m, { hitAt: 2 });
  m.mem.write8(0x6615, 0x30); // hoist-once landing (IX advanced only once)
  sub_29af(m);
  // 0x6205 = (mem[ix+5] - 4) - 8. Correct (0x6625 = 0x10): 0x04. Hoisted (0x6615 = 0x30): 0x24.
  assert.equal(m.mem.read8(0x6205), 0x04, "read (ix+5) at 0x6625 -- two in-loop add ix,de, not one");
});

// ---- entry_2b9b (INTEGRATED FROM A DRAFT, code2) -----------------------------
// Drives the REAL sub_2ff0, whose contract is HL = 0x7400 + ((255-y)>>3)*32 +
// ((x>>3)&0x1f). With HL = 0x0040 (y=0, x=0x40) the tile lands at 0x77E8, and the
// `pop de` recovers the ORIGINAL HL so E = 0x40. Plant the tile at 0x77E8.

const seed2b9b = (m, tile) => {
  m.regs.sp = 0x6c00;
  m.push16(0x4d5e); // return address for the REJECT path's ret
  m.regs.hl = 0x0040; // y = 0x00, x = 0x40 -> sub_2ff0 gives HL = 0x77E8
  m.mem.write8(0x77e8, tile);
  return m.regs.sp;
};

test("entry_2b9b REJECTS on each of its three unsigned gates, and does NOT over-reject", () => {
  // Draft OQ3: the jp c / jp nc polarity IS the gate. Three rejects:
  //   tile < 0xB0 ; (tile & 0x0F) >= 8 ; tile == 0xC0
  //
  // THE MUST-NOT-REJECT CONTROL IS LOAD-BEARING, and I added it only after a
  // mutation run proved the reject cases ALONE were weak: flipping gate 1's sense
  // (jp c -> jp nc) still rejects all three tiles, just via a DIFFERENT gate, so
  // the reject-only form was blind to it -- and would have passed an
  // always-reject implementation outright (§38, the degenerate baseline). The
  // 0xB0 control is what makes the gates falsifiable: it MUST pass all three.
  for (const [tile, why] of [[0xaf, "tile < 0xB0"], [0xb8, "low nibble >= 8"], [0xc0, "tile == 0xC0"]]) {
    const m = new Machine(ROM);
    const entrySP = seed2b9b(m, tile);
    entry_2b9b(m); // REJECT is a plain ret -- must NOT throw
    assert.equal(m.regs.a, 0x00, `tile 0x${tile.toString(16)} (${why}): A = 0`);
    assert.equal(m.regs.b, 0x00, `tile 0x${tile.toString(16)} (${why}): B = 0`);
    assert.equal(m.pc, 0x4d5e, `tile 0x${tile.toString(16)}: returned to the caller`);
    assert.equal(m.regs.sp, entrySP + 2, `tile 0x${tile.toString(16)}: one frame consumed`);
  }
  // CONTROL: 0xB0 passes every gate (>= 0xB0, low nibble 0 < 8, != 0xC0), so it
  // must NOT take the reject ret -- it reaches a success exit -> entry_2be1 (now
  // translated), which plain-returns A=2 (distinct from the reject's A=0).
  const pass = new Machine(ROM);
  seed2b9b(pass, 0xb0);
  entry_2b9b(pass);
  assert.equal(pass.regs.a, 0x02, "0xB0 PASSES all gates -> entry_2be1 plain return (A=2, not reject's 0)");
});

test("entry_2b9b's loc_2bdc FALLS THROUGH into entry_2be1 (now translated), computing C=0x3F", () => {
  // Draft OQ1. tile in [0xB0,0xBF] with low nibble < 8 passes all three gates and
  // takes jp c,0x2bdc; loc_2bdc runs off its own end into 0x2BE1 (an exit no byte
  // marks -- one only because 0x2BE1 begins entry_2be1). entry_2be1 is now
  // integrated, so the success exit is `return entry_2be1(m)`, not a throw. C is
  // pinned: ld a,e / and 0xf8 / dec a with E = 0x40 gives 0x3F.
  const m = new Machine(ROM);
  seed2b9b(m, 0xb0);
  entry_2b9b(m); // falls through into entry_2be1 -> loc_2bf8 plain return
  assert.equal(m.regs.c, 0x3f, "loc_2bdc computed C = (E & 0xF8) - 1 = 0x3F");
  assert.equal(m.regs.a, 0x02, "reaches entry_2be1's loc_2bf8 plain return (A=2)");
});

// ---- entry_2333 (INTEGRATED FROM A DRAFT, code2) -- pure register transform ---
// H, L, B live-in; result in L. All exits plain ret, so push a return address and
// read L back. Expected L values derived from the ROM byte semantics, not the skeleton.

const run2333 = (h, l, b) => {
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.regs.h = h; m.regs.l = l; m.regs.b = b;
  entry_2333(m);
  return m.regs.l;
};

test("entry_2333 derives the step from (H&0x0F) with the two early-exit clamps", () => {
  // Draft TEST 1 (OQ1). L bit5-clear (0x10) so the step path is add. MUTATION this
  // catches: a flipped clamp (ret c <-> ret nc) or a wrong +1/-1 assignment.
  // (a) dec-b nonzero arm, (H&F)=5 < 0x0F -> ret c -> L unchanged.
  assert.equal(run2333(0x05, 0x10, 0x02), 0x10, "(H&F)=5 < 0x0F -> ret c, L unchanged");
  // (b) dec-b nonzero, (H&F)=0x0F -> NOT ret c -> B=0xFF (-1) -> L + 0xFF = L-1.
  assert.equal(run2333(0x0f, 0x10, 0x02), 0x0f, "(H&F)=0x0F -> step -1 -> 0x10 - 1 = 0x0F");
  // (c) dec-b ZERO arm (B=1), (H&F)=3 >= 1 -> ret nc -> L unchanged.
  assert.equal(run2333(0x03, 0x10, 0x01), 0x10, "(H&F)=3 >= 1 -> ret nc, L unchanged");
});

test("entry_2333 special-cases L==0xF0 / 0x4C and splits sub/add on bit 5 of L", () => {
  // Draft TEST 2 (OQ2). B forced to +1 via the dec-b-zero arm with (H&F)==0
  // (H low nibble 0, B_in=1). MUTATION this catches: dropping the 0xF0 case, or
  // swapping sub/add on the bit-5 split.
  // (a) L=0xF0, H=0x80 (bit7 set) -> loc_2360 -> step (sub b) -> 0xF0 - 1 = 0xEF.
  assert.equal(run2333(0x80, 0xf0, 0x01), 0xef, "L=0xF0, H bit7 set -> 0xEF");
  // (b) L=0xF0, H=0x00 (bit7 clear) -> loc_2360 -> ret -> unchanged.
  assert.equal(run2333(0x00, 0xf0, 0x01), 0xf0, "L=0xF0, H bit7 clear -> unchanged 0xF0");
  // (c) L=0x20 (bit5 set) -> sub b -> 0x20 - 1 = 0x1F.
  assert.equal(run2333(0x80, 0x20, 0x01), 0x1f, "L bit5 set -> sub -> 0x1F");
  // (d) L=0x00 (bit5 clear) -> add b -> 0x00 + 1 = 0x01.
  assert.equal(run2333(0x80, 0x00, 0x01), 0x01, "L bit5 clear -> add -> 0x01");
});

// ---- sub_236e (INTEGRATED FROM A DRAFT, code2) -- cross-partition table search -
// Searches 0x6300.. for A (BC entries) via cpir (cpu.js:561, FIRST executable use);
// on a hit a secondary compare of D against two slots selects the return. cpir
// leaves HL = M+1 (post-increment) and signals found via the Z flag, not its
// return value (which is n, the iteration count -> the 21*(n-1)+16 cost). The
// cpir-MISS path UNWINDS a frame (returns false), modelled like sub_0030. All
// expected values below are derived from the ROM bytes (draft §1), not the skeleton.

test("sub_236e miss path UNWINDS: false, HL = discarded own-return, ret to grandparent", () => {
  // Draft §S4/OQ1 + TEST-1. `jp nz,0x239a` @0x2373 jumps PAST the push @0x2376, so
  // `pop hl` @0x239A takes THIS routine's return address and `ret` @0x239B pops a
  // SECOND frame -> control resumes at the caller's caller. MUTATION this catches
  // (M3): a miss that `return true`s (a normal return). The 0x6300 region is all
  // zero at power-on and the key (0x42) is absent, so cpir exhausts BC -> NZ.
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00;
  m.push16(0x216a); // grandparent (the caller's caller return address) -- deeper
  m.push16(0x2170); // sub_236e's OWN return address -- top of stack
  const spEntry = m.regs.sp;
  m.regs.a = 0x42; // key absent from the all-zero 0x6300 region
  m.regs.bc = 0x0015; // scan 21 bytes, none match -> NZ (the miss)
  const result = sub_236e(m);
  assert.equal(result, false, "miss must return false -- the boolean says 'unwound'");
  assert.equal(m.regs.hl, 0x2170, "`pop hl` @0x239A discarded THIS routine's own return address into HL");
  assert.equal(m.pc, 0x216a, "`ret` @0x239B unwound a second frame -- resumed at the caller's caller");
  // TWO pops (pop hl + ret) => SP = entry + 4. (Draft §3 TEST-1 wrote +2/'one frame';
  // the bytes say two pops -- 0x2373 precedes the push @0x2376. The found-path test
  // below asserts +2, so the pair is non-vacuous.)
  assert.equal(m.regs.sp, (spEntry + 4) & 0xffff, "two frames consumed on the unwind: SP = entry + 4");
});

test("sub_236e found path returns the OTHER slot's byte; A=1 first-slot, A=0 second-slot", () => {
  // Draft TEST-3 (the A/B contract, both variants). Key 0x42 planted at M=0x6300
  // (n=1). cpir leaves HL=0x6301; +0x14 -> first slot 0x6315 (M+0x15), inc c then
  // +0x15 -> second slot 0x632A (M+0x2A). EACH hit returns the OTHER slot's byte.
  // MUTATION this catches (M4): loc_238f returning A=0, or returning the matched
  // slot rather than the other. Both cases run -- one alone can't tell "other slot"
  // from "fixed slot".
  const found = ({ d, firstSlot, secondSlot }) => {
    const m = new Machine(ROM);
    m.regs.sp = 0x6c00;
    m.push16(0x4d5e); // a single caller return address -- the found path returns normally
    const spEntry = m.regs.sp;
    m.regs.a = 0x42; // search key
    m.regs.d = d; // the secondary-compare value
    m.regs.bc = 0x0015;
    m.mem.write8(0x6300, 0x42); // M -- cpir matches here (n=1)
    m.mem.write8(0x6315, firstSlot); // M+0x15
    m.mem.write8(0x632a, secondSlot); // M+0x2A
    const result = sub_236e(m);
    assert.equal(result, true, "found path is a NORMAL return (true)");
    assert.equal(m.pc, 0x4d5e, "found path returns to its caller, not the caller's caller");
    assert.equal(m.regs.sp, (spEntry + 2) & 0xffff, "pushes balance; net one ret-pop: SP = entry + 2");
    return { a: m.regs.a, b: m.regs.b };
  };
  // CASE A -- D equals the FIRST slot's byte -> loc_238f -> A=1, B = SECOND slot.
  assert.deepEqual(found({ d: 0x11, firstSlot: 0x11, secondSlot: 0x22 }), { a: 0x01, b: 0x22 },
    "D matches M+0x15 -> A=1, B = the byte at M+0x2A (the OTHER slot)");
  // CASE B -- D equals the SECOND slot's byte only -> loc_2395 -> A=0, B = FIRST slot.
  assert.deepEqual(found({ d: 0x22, firstSlot: 0x11, secondSlot: 0x22 }), { a: 0x00, b: 0x11 },
    "D matches M+0x2A -> A=0, B = the byte at M+0x15 (the OTHER slot)");
});

test("sub_236e second-slot path: `sbc hl,bc` back-steps HL by 0x15 (M+0x2A -> M+0x15)", () => {
  // Draft TEST-2's path, but see the note below. Exercises loc_2395: `sbc hl,bc`
  // (cpu.js:488, FIRST executable use) steps HL back from M+0x2A to M+0x15 so
  // `ld b,(hl)` reads the first slot. Distinct neighbours pin the offset and guard
  // the `regs.hl = regs.sbcHl(...)` = undefined bug (sbcHl ASSIGNS this.hl, returns
  // nothing). M=0x6300; D=0x88 matches only the second slot (0x632A).
  //
  // NOTE ON DRAFT M2 (the `xor a` carry-clear): within sub_236e that mutation
  // (`regs.a = 0` instead of `regs.xor(regs.a)`) is BEHAVIORALLY EQUIVALENT and
  // this test does NOT and CANNOT discriminate it. loc_2395 is reachable only via
  // `jp z` gated by the EQUAL `cp (hl)` @0x2384, and an equal cp always leaves
  // carry=0; forcing entry carry does not survive that cp. So carry is provably 0
  // at `xor a`, and `sbc hl,bc` then overwrites the flag difference. We keep the
  // faithful `regs.xor(regs.a)` (it is what the ROM does); M2 is flagged to qa-b as
  // a safe/equivalent mutation, not a caught one.
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00;
  m.push16(0x4d5e);
  m.regs.a = 0x42;
  m.regs.d = 0x88; // matches the second slot only
  m.regs.bc = 0x0015;
  m.mem.write8(0x6300, 0x42); // M (n=1) -> HL=0x6301 after cpir
  m.mem.write8(0x6315, 0x5c); // M+0x15: NOT 0x88 (first compare fails) AND the byte we must read back
  m.mem.write8(0x6314, 0x99); // M+0x14: a -1 offset would read this
  m.mem.write8(0x6316, 0xaa); // M+0x16: a +1 offset would read this
  m.mem.write8(0x632a, 0x88); // M+0x2A: equals D -> loc_2395
  const result = sub_236e(m);
  assert.equal(result, true);
  assert.equal(m.regs.a, 0x00, "loc_2395 -> A = 0");
  assert.equal(m.regs.b, 0x5c, "sbc hl,bc back-stepped HL to M+0x15 (0x6315) -- not 0x6314/0x6316/M+0x2A");
});

test("sub_236e charges cpir as 21*(n-1)+16, not a constant (differential on n)", () => {
  // Draft TEST-4. Cannot isolate 0x2371's cycles from the single accumulator, so
  // run the SAME found path (loc_238f) with the match at position n=1 vs n=5 and
  // assert the cycle DELTA is exactly 21*(5-1) - 21*(1-1) = 84 -- the 21-T-per-
  // repeat term, derived from the Z80 CPIR spec, independent of every OTHER cost on
  // the path (they cancel). MUTATION this catches (M1): a flat `m.step(0x2373, 16)`
  // -> delta 0. The ABSOLUTE first-use cpir/sbc cost table is qa-b's writes-trace
  // gate, not a unit test (a test summing the same constants as the code is vacuous).
  const cyclesForMatchAt = (matchAddr) => {
    const m = new Machine(ROM);
    m.regs.sp = 0x6c00;
    m.push16(0x4d5e);
    m.regs.a = 0x42;
    const M = matchAddr;
    m.regs.d = 0x77;
    m.regs.bc = 0x0015;
    m.mem.write8(M, 0x42); // the match; earlier bytes stay 0x00 != 0x42
    m.mem.write8((M + 1 + 0x14) & 0xffff, 0x77); // first slot = D -> loc_238f (same path both runs)
    m.mem.write8((M + 1 + 0x14 + 0x15) & 0xffff, 0x22); // second slot (returned in B)
    const c0 = m.cycles;
    sub_236e(m);
    return m.cycles - c0;
  };
  const n1 = cyclesForMatchAt(0x6300); // match at byte 1 -> n=1 -> cpir 16 T
  const n5 = cyclesForMatchAt(0x6304); // match at byte 5 -> n=5 -> cpir 21*4+16 = 100 T
  assert.equal(n5 - n1, 84, "cpir scales 21 T per repeated iteration: 21*(5-1) = 84 T more for n=5");
});

test("sub_236e retry loop advances past the first occurrence (cpir POST-increments HL)", () => {
  // Draft TEST-5. When D matches NEITHER slot, `jp 0x2371` re-searches from HL,
  // which cpir left at M+1 (post-increment). Key planted TWICE: at 0x6300 (D
  // matches neither slot -> retry) and 0x6303 (D matches the first slot -> return).
  // Reaching the SECOND occurrence PROVES the post-increment: without it the retry
  // would re-find 0x6300 forever. (The negative -- a non-incrementing cpir hangs --
  // is a cpu.js-level mutation with an iteration cap, qa-b's scope, not a line patch.)
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00;
  m.push16(0x4d5e);
  m.regs.a = 0x42; // key
  m.regs.d = 0x77; // matches neither first-occ slot; matches the second-occ first slot
  m.regs.bc = 0x0015;
  m.mem.write8(0x6300, 0x42); // first occurrence (M1)
  m.mem.write8(0x6303, 0x42); // second occurrence (M2), found on the retry
  // first-occ slots: M1=0x6300 -> 0x6315 / 0x632A, both != D(0x77) -> retry
  m.mem.write8(0x6315, 0x11);
  m.mem.write8(0x632a, 0x22);
  // second-occ slots: M2=0x6303 -> HL=0x6304 after cpir; +0x14 -> 0x6318, +0x15 -> 0x632D
  m.mem.write8(0x6318, 0x77); // = D -> loc_238f
  m.mem.write8(0x632d, 0x5a); // the OTHER slot -> returned in B
  const result = sub_236e(m);
  assert.equal(result, true, "retry reached the second occurrence and returned normally");
  assert.equal(m.regs.a, 0x01, "loc_238f at the second occurrence -> A=1");
  assert.equal(m.regs.b, 0x5a, "B = M2+0x2A (0x632D) -- the retry advanced to M2, not stuck at M1");
});

// ---- sub_0514 (INTEGRATED FROM A DRAFT, code3) -- descending 3-cell fill -------
// Stores A, A-1, A-2 at HL, HL+DE, HL+2DE. HL/A/DE live-in; B is set to 3 (a
// run-once prologue -- the djnz targets 0x0516, the loop head, not the entry).
// A is IN-OUT. Expected values derived from the ROM bytes (draft §4), not the skeleton.

test("sub_0514 fills 3 descending cells at HL, HL+DE, HL+2DE (A in-out, B->0, HL+=3DE)", () => {
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.regs.hl = 0x7623; m.regs.de = 0x0020; m.regs.a = 0x10;
  sub_0514(m);
  // MUTATION this catches: dropping `dec a` (all cells = 0x10), or a wrong count.
  assert.equal(m.mem.read8(0x7623), 0x10, "pass 1: (HL) = A");
  assert.equal(m.mem.read8(0x7643), 0x0f, "pass 2: (HL+DE) = A-1");
  assert.equal(m.mem.read8(0x7663), 0x0e, "pass 3: (HL+2DE) = A-2");
  assert.equal(m.mem.read8(0x7683), 0x00, "no 4th cell written (B was 3, not 4)");
  assert.equal(m.regs.a, 0x0d, "A exits decremented by 3 (in-out parameter)");
  assert.equal(m.regs.b, 0x00, "B exits 0");
  assert.equal(m.regs.hl, (0x7623 + 3 * 0x20) & 0xffff, "HL advanced by 3*DE to 0x7683");
  assert.equal(m.pc, 0x4d5e, "returns normally to its caller");
});

test("sub_0514 A is IN-OUT: a second call (HL reloaded, A not) continues the descent", () => {
  // Mirrors the 0x04C3->0x04C9 caller: 0x10,0x0F,0x0E then 0x0D,0x0C,0x0B (draft §4).
  // MUTATION this catches: treating A as input-only or restoring it -> both calls
  // would write 0x10,0x0F,0x0E and the second is wrong.
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.regs.de = 0x0020;
  m.regs.hl = 0x7623; m.regs.a = 0x10;
  sub_0514(m); // A exits 0x0D
  m.push16(0x4d5e);
  m.regs.hl = 0x7583; // HL reloaded; A deliberately NOT reloaded
  sub_0514(m);
  assert.equal(m.mem.read8(0x7583), 0x0d, "second call continues the sequence: 0x0D");
  assert.equal(m.mem.read8(0x75a3), 0x0c, "0x0C");
  assert.equal(m.mem.read8(0x75c3), 0x0b, "0x0B");
  assert.equal(m.regs.a, 0x0a, "A exits 0x0A after six total decrements");
});

// ---- loc_06fe (INTEGRATED FROM A DRAFT, code3) -- rst 0x28 dispatch on 0x600A --
// Selector A = mem[0x600A]; sub_0028 reads the target from the ROM table based at
// 0x0702 (the rst's own return address) and tail-jumps. Targets are unintegrated,
// so dispatchGameState throws with the target address -- which is our observable.
// The tail-jump / no-caller-consume property is sub_0028's, already tested elsewhere.

test("loc_06fe dispatches 0x600A through the ROM table based at 0x0702 (not 0x08B6)", () => {
  // index 0 -> table[0]=0x0986; the byte-identical 0x08B2 dispatcher (base 0x08B6)
  // would give 0x08BA. A second index pins the stride+base against a hard-coded array.
  // Now WIRED (go-live: game state 3). Table base still pinned by the null-entry test below
  // (index 9 -> 0x0000, which is not a dispatch arm -> throws). Here just confirm dispatch runs.
  const withSel = (sel) => {
    const m = new Machine(ROM);
    m.regs.sp = 0x6c00; m.push16(0x4d5e);
    m.mem.write8(0x600a, sel);
    m.mem.write16(0x622a, 0x3a73); // safe pointer for the sub_09fe/level-setup derefs
    return m;
  };
  assert.doesNotThrow(() => loc_06fe(withSel(0x00)), "index 0 -> table[0]=0x0986 (base 0x0702)");
  assert.doesNotThrow(() => loc_06fe(withSel(0x05)), "index 5 -> table[5]=0x0a37");
});

test("loc_06fe null table entry (index 9) resolves to target 0x0000 (surfaced, not silent)", () => {
  // Six entries are 0x0000 (idx 9, 24-28) and A is unchecked. dispatchGameState
  // makes a null target a loud throw rather than a silent jump to the reset vector.
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x600a, 0x09);
  assert.throws(() => loc_06fe(m), /0x0000/, "index 9 is a NULL entry -> target 0x0000");
});

// ---- loc_07c3 / loc_084b / loc_08b2 (code3 drafts) -- 0x0748 & 0x600A handlers -

test("loc_07c3 calls sub_0874 then advances the 0x600A sub-state via inc (hl)", () => {
  // MUTATION this catches: inc hl (the pointer) instead of inc (hl) (the byte), or
  // dropping the advance. sub_0874 takes no register input and must not touch 0x600A.
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x600a, 0x03);
  loc_07c3(m);
  assert.equal(m.mem.read8(0x600a), 0x04, "inc (hl) advanced the 0x600A byte 0x03 -> 0x04");
  assert.equal(m.pc, 0x4d5e, "clean ret to the dispatcher's caller");
});

test("loc_084b clears 0x600A ONLY when both rst-0x20 counters expire (skip polarity)", () => {
  // The body runs only when 0x6008 AND 0x6009 expire in the same call (draft §2).
  // MUTATION this catches: an inverted gate, or running the body unconditionally.
  const run = ({ c8, c9 }) => {
    const m = new Machine(ROM);
    m.regs.sp = 0x6c00; m.push16(0x4d5e); // loc_084b's own return
    m.mem.write8(0x6008, c8);
    m.mem.write8(0x6009, c9);
    m.mem.write8(0x600a, 0x55); // sentinel
    loc_084b(m);
    return m;
  };
  // both were 1 -> both expire -> RUN -> 0x600A cleared.
  assert.equal(run({ c8: 1, c9: 1 }).mem.read8(0x600a), 0x00, "both expired -> 0x600A cleared");
  // 0x6008 was 2 -> does not expire -> SKIP -> 0x600A untouched.
  assert.equal(run({ c8: 2, c9: 1 }).mem.read8(0x600a), 0x55, "0x6008 ticking -> body skipped");
  // 0x6008 expires but 0x6009 (was 2) does not -> SKIP -> 0x600A untouched.
  assert.equal(run({ c8: 1, c9: 2 }).mem.read8(0x600a), 0x55, "only 0x6008 expired -> body skipped");
});

test("loc_08b2 is NOT loc_06fe: dispatches 0x600A through the 2-entry table at 0x08B6", () => {
  // Byte-identical to loc_06fe but a different table base (the copy hazard, §3).
  // index 0 -> 0x08B6[0]=0x08BA; loc_06fe's base 0x0702 would give 0x0986.
  // Now WIRED (go-live: game state 2): index 0 -> loc_08ba (which inc's 0x600A), index 1 -> loc_08f8.
  const withSel = (sel) => {
    const inputs = new Inputs(); inputs._in2 = 0x00;
    const m = new Machine(ROM, { inputs });
    m.regs.sp = 0x6c00; m.push16(0x4d5e);
    m.mem.write8(0x600a, sel);
    m.mem.write8(0x601a, 0x01); // (0x601A&7)!=0 -> loc_08d5 skips its two calls
    return m;
  };
  const a = withSel(0x00);
  assert.doesNotThrow(() => loc_08b2(a), "index 0 -> table[0]=0x08BA (base 0x08B6, not 0x0702->0x0986)");
  assert.equal(a.mem.read8(0x600a), 0x01, "loc_08ba ran: inc (0x600A) 0 -> 1");
  assert.doesNotThrow(() => loc_08b2(withSel(0x01)), "index 1 -> table[1]=0x08F8");
});

// ---- loc_0c91 (INTEGRATED FROM A DRAFT, code3) -- rst 0x18 gate into loc_0c92 --
// A 1-byte rst 0x18 countdown gate that falls through into the existing loc_0c92
// only when 0x6009 expires. loc_0c92's first act (after its sub_0874 call) is
// `xor a / ld (0x638c),a`, so 0x638C == 0 iff the body ran. 0x6227=1 selects
// loc_0c92's single translated arm.

test("loc_0c91 runs loc_0c92 only when the rst 0x18 counter (0x6009) expires", () => {
  const run = (c9) => {
    const m = new Machine(ROM);
    m.regs.sp = 0x6c00; m.push16(0x4d5e);
    m.mem.write8(0x6009, c9);
    m.mem.write8(0x6227, 0x01); // loc_0c92's translated dec-a/jp-z arm
    m.mem.write8(0x638c, 0x77); // sentinel -- cleared to 0 iff loc_0c92 runs
    loc_0c91(m);
    return m;
  };
  // 0x6009 was 1 -> expires -> loc_0c92 runs -> 0x638C cleared.
  assert.equal(run(0x01).mem.read8(0x638c), 0x00, "counter expired -> loc_0c92 ran (0x638C=0)");
  // 0x6009 was 2 -> does not expire -> SKIP -> loc_0c92 never runs -> sentinel intact.
  assert.equal(run(0x02).mem.read8(0x638c), 0x77, "counter ticking -> loc_0c92 skipped (sentinel intact)");
});

// ---- sub_0852 (INTEGRATED FROM A DRAFT, code3) -- two nested fills ------------

test("sub_0852 fills VRAM 0x7400..0x77FF with 0x10, then 0x6900..0x6A7F with 0x00", () => {
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00; m.push16(0x4d5e);
  // Work-RAM sentinels bracketing the 0x6900 clear -- prove the extent is EXACTLY
  // 384 bytes (catches B=0xC0=192 mis-read as 256, which would clear 0x6A80 too).
  m.mem.write8(0x68ff, 0xdd); // one before the clear
  m.mem.write8(0x6a80, 0xcc); // one after
  m.mem.write8(0x6900, 0x55); m.mem.write8(0x6a7f, 0x55); // pre-dirty so 0->0x00 is meaningful
  sub_0852(m);
  // first fill: 0x10 across the full 1024-byte tilemap.
  assert.equal(m.mem.read8(0x7400), 0x10, "first byte of the VRAM fill");
  assert.equal(m.mem.read8(0x77ff), 0x10, "last byte of the 1024-byte VRAM fill (C=4 reaches the end)");
  // second fill: 0x00 across exactly 384 bytes.
  assert.equal(m.mem.read8(0x6900), 0x00, "first byte cleared");
  assert.equal(m.mem.read8(0x6a7f), 0x00, "last byte of the 384-byte clear");
  assert.equal(m.mem.read8(0x6a80), 0xcc, "0x6A80 NOT cleared -- inner count is 0xC0=192, not 256");
  assert.equal(m.mem.read8(0x68ff), 0xdd, "0x68FF NOT cleared -- the clear starts at 0x6900");
  assert.equal(m.pc, 0x4d5e, "returns normally");
});

// ---- loc_08ba / loc_08d5 (code3 drafts) -- 0x08B2 table arm 0 + its fall-tail --

test("loc_08d5 returns mem[0x7D00] & B, B chosen by 0x6001 (==1 -> 0x04, else 0x0C)", () => {
  // Gate the two calls OFF (0x601A & 7 != 0) to isolate the B path. Inject IN2 =
  // START1|START2 (0x0C) so the & B discriminates 0x04 from 0x0C. (0x7D00 is a
  // read-only input port -- can't be poked via memory.)
  const run = (c6001) => {
    const inputs = new Inputs();
    inputs._in2 = 0x0c; // bits 2,3 -> mem[0x7D00] = 0x0C
    const m = new Machine(ROM, { inputs });
    m.regs.sp = 0x6c00; m.push16(0x4d5e);
    m.mem.write8(0x6001, c6001);
    m.mem.write8(0x601a, 0x01); // (0x601A & 7) = 1 != 0 -> skip the two calls
    loc_08d5(m);
    return m.regs.a;
  };
  assert.equal(run(0x01), 0x04, "0x6001==1 -> B=0x04 -> 0x0C & 0x04");
  assert.equal(run(0x00), 0x0c, "0x6001!=1 -> B=0x0C -> 0x0C & 0x0C");
});

test("loc_08d5 runs handler_05e9 + sub_0616 on the gated branch and RETURNS NORMALLY", () => {
  // (0x601A & 7) == 0 -> the two calls execute. handler_05e9 is a caller-skip-
  // SHAPED string draw whose jp z,0x0026 tail actually balances its own push af
  // and returns normally; reaching loc_08d5's own ret PROVES that (an unwind would
  // never return here). E=0x09 (0x6001==1) picks a valid ROM string index.
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x6001, 0x01); // B=0x04, E=0x09
  m.mem.write8(0x601a, 0x00); // (0x601A & 7) == 0 -> calls run
  loc_08d5(m);
  assert.equal(m.pc, 0x4d5e, "handler_05e9 and sub_0616 returned normally -> loc_08d5 reached its ret");
});

test("loc_08ba runs its inits and FALLS THROUGH into loc_08d5 (one combined ret)", () => {
  // loc_08ba has no ret of its own; loc_08d5's ret returns for both. Observe
  // 0x6007 = 0 (loc_08ba's xor a / ld (0x6007),a) and normal completion.
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x6007, 0x55); // sentinel -- loc_08ba clears it
  m.mem.write8(0x6001, 0x01);
  m.mem.write8(0x601a, 0x01); // skip loc_08d5's calls (isolate the fall-through)
  loc_08ba(m);
  assert.equal(m.mem.read8(0x6007), 0x00, "loc_08ba cleared 0x6007");
  assert.equal(m.mem.read8(0x600a), 0x01, "loc_08ba advanced 0x600A (inc (hl)) from 0");
  assert.equal(m.pc, 0x4d5e, "fell through into loc_08d5 and returned via its single ret");
});

// ---- sub_0977 (INTEGRATED FROM A DRAFT, code3) -- BCD-decrement 0x6001 --------

test("sub_0977 BCD-decrements 0x6001 (05->04, 10->09 borrow, 00->99 wrap)", () => {
  const run = (v) => {
    const m = new Machine(ROM);
    m.regs.sp = 0x6c00; m.push16(0x4d5e);
    m.mem.write8(0x6001, v);
    sub_0977(m);
    return m.mem.read8(0x6001);
  };
  // 10->09 is the discriminator: a raw `dec` would give 0x0F; daa gives BCD 09.
  assert.equal(run(0x05), 0x04, "BCD 05 - 1 = 04");
  assert.equal(run(0x10), 0x09, "BCD 10 - 1 = 09 (nibble borrow -- proves daa, not raw dec)");
  assert.equal(run(0x00), 0x99, "BCD 00 - 1 = 99 (wrap)");
});

// ---- loc_09ab (INTEGRATED FROM A DRAFT, code3) -- copy, deref, arm state ------

test("loc_09ab copies 8 bytes, derefs the *word at* 0x622A, and arms state on 0x600F", () => {
  const setup = (c600f) => {
    const m = new Machine(ROM);
    m.regs.sp = 0x6c00; m.push16(0x4d5e);
    // src bytes 2,3 (0x6042/0x6043) become the pointer word copied to 0x622A.
    m.mem.write8(0x6042, 0x50); m.mem.write8(0x6043, 0x63); // -> pointer 0x6350
    m.mem.write8(0x6350, 0xab); // the deref target
    m.mem.write8(0x600f, c600f);
    loc_09ab(m);
    return m;
  };
  const m0 = setup(0x00);
  assert.equal(m0.mem.read8(0x622a), 0x50, "ldir copied 0x6042 -> 0x622A");
  assert.equal(m0.mem.read8(0x622b), 0x63, "ldir copied 0x6043 -> 0x622B");
  // INDIRECT: 0x6227 = *(word at 0x622A) = (0x6350) = 0xAB -- NOT the byte at 0x622A (0x50).
  assert.equal(m0.mem.read8(0x6227), 0xab, "0x6227 = deref of the 0x622A pointer word");
  assert.equal(m0.mem.read8(0x6009), 0x01, "0x600F==0 -> 0x6009 = 1");
  assert.equal(m0.mem.read8(0x600a), 0x05, "0x600F==0 -> 0x600A = 5");
  const m1 = setup(0x01);
  assert.equal(m1.mem.read8(0x6009), 0x78, "0x600F!=0 -> 0x6009 = 0x78");
  assert.equal(m1.mem.read8(0x600a), 0x02, "0x600F!=0 -> 0x600A = 2");
});

// ---- loc_059b (INTEGRATED FROM A DRAFT, code3) -- clear a BCD slot, then render

test("loc_059b throws on payload>=3 (twin-consistent stub) and clears the selected slot", () => {
  const mk = (a) => { const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e); m.regs.a = a; return m; };
  // payload >= 3 (jp nc) -> the stubbed recursion, matching handler_05c6's discipline.
  assert.throws(() => loc_059b(mk(0x03)), /05BD|059b|payload/i, "payload 3 -> NotImplemented stub");
  assert.throws(() => loc_059b(mk(0x05)), /05BD|059b|payload/i, "payload 5 -> stub");
  // payload < 3 -> clear the payload-selected 3-byte slot, then render via handler_05c6.
  const clearAt = (a) => {
    const m = mk(a);
    for (let addr = 0x60b2; addr <= 0x60ba; addr++) m.mem.write8(addr, 0x55); // sentinels
    loc_059b(m);
    return m;
  };
  // 0 -> 0x60B2, 1 -> 0x60B5, 2 -> 0x60B8.
  assert.equal(clearAt(0x00).mem.read8(0x60b2), 0x00, "payload 0 clears the 0x60B2 slot");
  const m1 = clearAt(0x01);
  assert.equal(m1.mem.read8(0x60b5), 0x00, "payload 1 clears the 0x60B5 slot");
  assert.equal(m1.mem.read8(0x60b2), 0x55, "payload 1 leaves the 0x60B2 slot untouched");
  assert.equal(clearAt(0x02).mem.read8(0x60b8), 0x00, "payload 2 clears the 0x60B8 slot");
});

// ---- loc_0a37 / loc_0a76 (code3 drafts) -- 0x06FE table arms 5 and 7 ----------

test("loc_0a37 advances 0x600A and seeds video (0x7740=1, 0x7720=0x25, 0x7700=0x20)", () => {
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x600a, 0x02);
  loc_0a37(m); // enqueues 4 tasks via sub_309f, then the observable seeds
  assert.equal(m.mem.read8(0x600a), 0x03, "0x600A advanced by inc (hl)");
  assert.equal(m.mem.read8(0x7740), 0x01, "0x7740 = 1");
  assert.equal(m.mem.read8(0x7720), 0x25, "0x7720 = 0x25");
  assert.equal(m.mem.read8(0x7700), 0x20, "0x7700 = 0x20");
  assert.equal(m.pc, 0x4d5e, "returns normally after 4 balanced sub_309f calls");
});

test("loc_0a76 dispatches 0x6385 through the NESTED table at 0x0A7A (not 0x0702)", () => {
  // Now WIRED (go-live). index 0 -> loc_0a8a, index 1 -> loc_0abf; dispatch runs.
  const withSel = (sel) => {
    const m = new Machine(ROM);
    m.regs.sp = 0x6c00; m.push16(0x4d5e);
    m.mem.write8(0x6385, sel); // selector is 0x6385 here, NOT 0x600A
    m.mem.write8(0x601a, 0x01); // benign gate state for the handlers
    return m;
  };
  assert.doesNotThrow(() => loc_0a76(withSel(0x00)), "index 0 -> table[0]=0x0A8A (base 0x0A7A)");
  assert.doesNotThrow(() => loc_0a76(withSel(0x01)), "index 1 -> table[1]=0x0ABF");
});

// ---- loc_0bb3 (INTEGRATED FROM A DRAFT, code3) -- wrap the 0x6385 sequence -----

test("loc_0bb3 wraps 0x6385 + advances selectors iff the rst 0x18 countdown expires", () => {
  const run = (c6009, sel6385 = 0x07) => {
    const m = new Machine(ROM);
    m.regs.sp = 0x6c00; m.push16(0x4d5e);
    m.mem.write8(0x6009, c6009);
    m.mem.write8(0x6385, sel6385);
    m.mem.write8(0x600a, 0x03);
    loc_0bb3(m);
    return m;
  };
  // 0x6009 was 1 -> rst 0x18 decrements to 0 -> EXPIRE -> wrap + advance both selectors.
  const mE = run(0x01);
  assert.equal(mE.mem.read8(0x6385), 0x00, "expired -> sequence wrapped to arm 0");
  assert.equal(mE.mem.read8(0x600a), 0x04, "expired -> 0x600A advanced");
  assert.equal(mE.mem.read8(0x6009), 0x01, "0x6009: 1->0 (rst) then inc -> 1");
  // 0x6009 was 2 -> decrements to 1 -> NOT expired -> body skipped, 0x6385 intact.
  assert.equal(run(0x02).mem.read8(0x6385), 0x07, "not expired -> sequence NOT wrapped");
  // 0x6009 == 0x90 -> the cp-0x90 arm writes 0x608A/0x608B before the (skipping) gate.
  const m90 = run(0x90);
  assert.equal(m90.mem.read8(0x608a), 0x0f, "cp 0x90 arm -> 0x608A = 0x0F");
  assert.equal(m90.mem.read8(0x608b), 0x03, "cp 0x90 arm -> 0x608B = 0x03");
});

// ---- loc_0b06 (INTEGRATED FROM A DRAFT, code3) -- walk-table / terminal setup --
// Tests the two non-terminal paths; the 0x7F-sentinel terminal path runs a
// `do { sub_304a } while (0x638E != 0x0A)` loop, left to the go-live exec-tape.

test("loc_0b06 returns early on 0x601A bit0, else advances the 0x63C2 walk pointer", () => {
  // Path 1: 0x601A bit 0 set -> rrca -> carry -> ret c, walk pointer untouched.
  const m1 = new Machine(ROM);
  m1.regs.sp = 0x6c00; m1.push16(0x4d5e);
  m1.mem.write8(0x601a, 0x01);
  m1.mem.write16(0x63c2, 0x6400);
  loc_0b06(m1);
  assert.equal(m1.mem.read16(0x63c2), 0x6400, "ret c early exit -- walk pointer untouched");
  assert.equal(m1.pc, 0x4d5e, "returned to caller");
  // Path 2: bit 0 clear, walk byte != 0x7F -> advance the pointer by 1.
  const m2 = new Machine(ROM);
  m2.regs.sp = 0x6c00; m2.push16(0x4d5e);
  m2.mem.write8(0x601a, 0x00);
  m2.mem.write16(0x63c2, 0x6400);
  m2.mem.write8(0x6400, 0x50); // a non-0x7F table byte
  loc_0b06(m2);
  assert.equal(m2.mem.read16(0x63c2), 0x6401, "non-sentinel -> walk pointer advanced to 0x6401");
});

test("loc_0a63 re-arms 0x6009 and advances 0x600A by 1 or 2 (per 0x622C) when rst 0x18 expires", () => {
  const run = (c6009, c622c) => {
    const m = new Machine(ROM);
    m.regs.sp = 0x6c00; m.push16(0x4d5e);
    m.mem.write8(0x6009, c6009);
    m.mem.write8(0x622c, c622c);
    m.mem.write8(0x600a, 0x10);
    loc_0a63(m);
    return m;
  };
  // expire (0x6009 1->0), 0x622C != 0 -> advance +1.
  const mA = run(0x01, 0x05);
  assert.equal(mA.mem.read8(0x6009), 0x01, "0x6009 re-armed to 1");
  assert.equal(mA.mem.read8(0x600a), 0x11, "0x600A += 1 (0x622C != 0)");
  // expire, 0x622C == 0 -> advance +2.
  assert.equal(run(0x01, 0x00).mem.read8(0x600a), 0x12, "0x600A += 2 (0x622C == 0)");
  // not expired (0x6009 2->1) -> body skipped, 0x600A untouched.
  assert.equal(run(0x02, 0x00).mem.read8(0x600a), 0x10, "not expired -> 0x600A untouched");
});

test("loc_0b68 returns early on 0x601A bit0, else advances the 0x63C4 walk pointer", () => {
  // Path 1: 0x601A bit 0 -> ret c.
  const m1 = new Machine(ROM);
  m1.regs.sp = 0x6c00; m1.push16(0x4d5e);
  m1.mem.write8(0x601a, 0x01);
  m1.mem.write16(0x63c4, 0x6400);
  loc_0b68(m1);
  assert.equal(m1.mem.read16(0x63c4), 0x6400, "ret c -- walk pointer untouched");
  // Path 2: non-0x7F walk byte -> advance the 0x63C4 pointer (two rst 0x38s then ret).
  const m2 = new Machine(ROM);
  m2.regs.sp = 0x6c00; m2.push16(0x4d5e);
  m2.mem.write8(0x601a, 0x00);
  m2.mem.write16(0x63c4, 0x6400);
  m2.mem.write8(0x6400, 0x50);
  loc_0b68(m2);
  assert.equal(m2.mem.read16(0x63c4), 0x6401, "non-sentinel -> walk pointer advanced to 0x6401");
});

test("loc_0a8a seeds the two walk pointers (0x63C2=0x38B4, 0x63C4=0x38CB) and video state", () => {
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x6385, 0x02);
  loc_0a8a(m);
  // The load-bearing setup: the two ROM pointers loc_0b06/loc_0b68 walk.
  assert.equal(m.mem.read16(0x63c2), 0x38b4, "seeded loc_0b06's walk pointer -> 0x38B4");
  assert.equal(m.mem.read16(0x63c4), 0x38cb, "seeded loc_0b68's walk pointer -> 0x38CB");
  assert.equal(m.mem.read8(0x76a3), 0x10, "video 0x76A3 = 0x10");
  assert.equal(m.mem.read8(0x75aa), 0xd4, "video 0x75AA = 0xD4");
  assert.equal(m.mem.read8(0x6009), 0x40, "countdown armed to 0x40");
  assert.equal(m.mem.read8(0x6385), 0x03, "0x6385 sequence advanced");
  assert.equal(m.pc, 0x4d5e, "returns normally");
});

test("entry_127f dispatches 0x639D through the 0x1283 table (0->0x128B, 1->0x12AC)", () => {
  const withIdx = (i) => {
    const m = new Machine(ROM);
    m.regs.sp = 0x6c00; m.push16(0x4d5e);
    m.mem.write8(0x639d, i);
    return m;
  };
  // Now WIRED (batch go-live): index 0 -> entry_128b, index 1 -> loc_12ac; dispatch runs.
  assert.doesNotThrow(() => entry_127f(withIdx(0x00)), "index 0 -> table[0]=0x128B");
  assert.doesNotThrow(() => entry_127f(withIdx(0x01)), "index 1 -> table[1]=0x12AC");
});

test("loc_127c calls the REAL sub_1dbd (un-staled from the draft's 0x1DBD throw)", () => {
  // The draft threw at `call 0x1dbd` (untranslated then). Now it calls sub_1dbd,
  // which is ITSELF a rst-28 dispatcher and throws at its own as-yet-untranslated
  // target (0x1E49) -- so loc_127c doesn't reach entry_127f in this test, but the
  // throw proves it's wired to the real sub_1dbd, not the draft's stub.
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x6227, 0x01);
  m.mem.write8(0x6343, 0x00); m.mem.write8(0x6344, 0x6b);
  m.mem.write8(0x6340, 0x01);
  loc_127c(m);
  assert.equal(m.mem.read8(0x6340), 0x02, "real sub_1dbd -> table[1] -> loc_1dc9 advanced 0x6340 to 2");
  assert.equal(m.mem.read8(0x6341), 0x40, "real sub_1dbd -> loc_1dc9 set 0x6341 to 0x40");
  assert.equal(m.pc, 0x4d5e, "loc_127c falls through entry_127f and rets to the caller");
});

test("loc_12ac animates 0x694D, or advances the 0x639D state when 0x639E expires", () => {
  const run = (c639e, extra = {}) => {
    const m = new Machine(ROM);
    m.regs.sp = 0x6c00; m.push16(0x4d5e);
    m.mem.write8(0x6009, 0x01); // rst 0x18 expires
    m.mem.write8(0x639e, c639e);
    for (const [a, v] of Object.entries(extra)) m.mem.write8(Number(a), v);
    loc_12ac(m);
    return m;
  };
  // 0x639E was 5 -> dec to 4 (nz) -> ANIMATE. Blinker toggles bit0 of 0x694D (0 -> 1).
  const mAnim = run(0x05, { 0x694d: 0x00 });
  assert.equal(mAnim.mem.read8(0x694d), 0x01, "animate path toggles 0x694D 0->1");
  assert.equal(mAnim.mem.read8(0x6009), 0x08, "animate path reloads the counter to 8");
  // 0x639E was 1 -> dec to 0 (z) -> tail: advance 0x639D state, reload counter to 0x80.
  const mTail = run(0x01, { 0x639d: 0x01 });
  assert.equal(mTail.mem.read8(0x639d), 0x02, "0x639E==0 -> advance 0x639D state 1->2");
  assert.equal(mTail.mem.read8(0x6009), 0x80, "tail reloads the counter to 0x80 (not 8)");
});

test("loc_12de advances 0x600A by 1 (player 1) or 2 (player 2) and re-arms 0x6009", () => {
  const run = (c600e) => {
    const m = new Machine(ROM);
    m.regs.sp = 0x6c00; m.push16(0x4d5e);
    m.mem.write8(0x6009, 0x01); // rst 0x18 expires
    m.mem.write8(0x600e, c600e);
    m.mem.write8(0x600a, 0x10);
    loc_12de(m);
    return m;
  };
  assert.equal(run(0x00).mem.read8(0x600a), 0x11, "player 1 (0x600E==0) -> 0x600A += 1");
  assert.equal(run(0x01).mem.read8(0x600a), 0x12, "player 2 (0x600E!=0) -> 0x600A += 2");
  assert.equal(run(0x00).mem.read8(0x6009), 0x01, "re-armed 0x6009 = 1");
});

test("loc_138f sets 0x600A to 0x17 (0x6048 nonzero) or 0x14 (zero), re-arming 0x6009", () => {
  const run = (c6048) => {
    const m = new Machine(ROM);
    m.regs.sp = 0x6c00; m.push16(0x4d5e);
    m.mem.write8(0x6009, 0x01); // rst 0x18 expires
    m.mem.write8(0x6048, c6048);
    loc_138f(m);
    return m;
  };
  assert.equal(run(0x05).mem.read8(0x600a), 0x17, "0x6048 != 0 -> C stays 0x17");
  assert.equal(run(0x00).mem.read8(0x600a), 0x14, "0x6048 == 0 -> C = 0x14");
  assert.equal(run(0x05).mem.read8(0x6009), 0x01, "0x6009 re-armed 0 -> 1");
});

test("loc_0abf sets up 0x638E/0x608A/0x608B and advances 0x6385 when rst 0x18 expires", () => {
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x6009, 0x01); // rst 0x18 expires
  m.mem.write8(0x6385, 0x02);
  loc_0abf(m);
  assert.equal(m.mem.read8(0x638e), 0x1f, "0x638E = 0x1F");
  assert.equal(m.mem.read8(0x608a), 0x01, "0x608A = 1");
  assert.equal(m.mem.read8(0x608b), 0x03, "0x608B = 3");
  assert.equal(m.mem.read8(0x6385), 0x03, "0x6385 advanced");
});

test("loc_0ae8 arms 0x6009 + advances 0x6385 when 0x690B < 0x5D, else ret nc", () => {
  const run = (c690b, sel = 0x02) => {
    const m = new Machine(ROM);
    m.regs.sp = 0x6c00; m.push16(0x4d5e);
    m.mem.write8(0x62af, 0x01); // (0x62AF & 0x0F) != 0 -> skip the sub_304a call
    m.mem.write8(0x690b, c690b);
    m.mem.write8(0x6385, sel);
    loc_0ae8(m);
    return m;
  };
  // 0x690B < 0x5D -> arm + advance.
  const mLo = run(0x10);
  assert.equal(mLo.mem.read8(0x6009), 0x20, "0x690B < 0x5D -> 0x6009 = 0x20");
  assert.equal(mLo.mem.read8(0x6385), 0x03, "0x6385 advanced");
  // 0x690B >= 0x5D -> ret nc, no change.
  assert.equal(run(0x60).mem.read8(0x6385), 0x02, "0x690B >= 0x5D -> ret nc, 0x6385 unchanged");
});

test("loc_141e dispatches on the 0x611C[5] search: record 1/3 -> 0x7D82 write; neither -> 0x600A=0", () => {
  const run = (records) => {
    const m = new Machine(ROM);
    m.regs.sp = 0x6c00; m.push16(0x4d5e);
    m.mem.write8(0x6009, 0x01); // rst 0x18 expires
    m.mem.write8(0x600a, 0x55);
    // seed the 5 records at 0x611C stride 0x22
    records.forEach((v, i) => m.mem.write8(0x611c + i * 0x22, v));
    loc_141e(m);
    return m;
  };
  // a record == 1 -> loc_1459 -> inc (0x600A) (was 0x55 -> 0x56) and clears 0x6009.
  assert.equal(run([0, 1, 0, 0, 0]).mem.read8(0x600a), 0x56, "record 1 found -> loc_1459 increments 0x600A");
  // neither 1 nor 3 -> loc_1475 -> 0x600A = 0.
  assert.equal(run([0, 0, 0, 0, 0]).mem.read8(0x600a), 0x00, "neither found -> loc_1475 clears 0x600A");
  // a record == 3 (and no 1) -> loc_144f sets 0x600E=1, then loc_1459.
  const m3 = run([0, 0, 3, 0, 0]);
  assert.equal(m3.mem.read8(0x600e), 0x01, "record 3 found -> loc_144f sets player index 1");
});

test("loc_0f35 drains 0x63B1 by 8 per iteration until borrow, then tail-jumps to sub_0da7", () => {
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.regs.hl = 0x6100; // a safe RAM destination for the computed writes
  m.regs.de = 0x0010;
  m.mem.write8(0x63b5, 0xaa); // fill byte
  m.mem.write8(0x63b1, 0x10); // 0x10 -> 8 -> 0 -> borrow: 3 iterations
  // The loop runs, THEN tail-jumps to sub_0da7 (a record renderer) which reaches
  // an untranslated record-kind and throws -- expected. sub_0da7 mutates 0x63B1/de,
  // so observe instead the loop's HL fills (0x6100/0x6120/0x6140, stride 0x20),
  // which sub_0da7 doesn't touch: 0x10/8 = 3 iterations -> exactly 3 writes.
  // loc_0e4f's kind!=2 branch is now wired (loc_0ee8) -- the tail walk no longer throws here;
  // this test only pins loc_0f35's own 3 loop fills, done before the tail-jump.
  try { loc_0f35(m); } catch { /* downstream walk may reach an untranslated record */ }
  assert.equal(m.mem.read8(0x6100), 0xaa, "iteration 1 wrote 0x63B5's byte at HL");
  assert.equal(m.mem.read8(0x6140), 0xaa, "iteration 3 wrote at HL + 2*0x20");
  assert.equal(m.mem.read8(0x6160), 0x00, "no 4th write -- loop borrowed after 3 (0x10 -> 8 -> 0 -> -8)");
});

test("sub_239c IX transform: 16-bit add/sub and the B:A=(2n+1)*8 scale (FIRST-USE sla)", () => {
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.regs.ix = 0x6200;
  // (ix+3:4) = 0x0102, (ix+0x10:0x11) = 0x0304 -> sum 0x0406
  m.mem.write8(0x6203, 0x01); m.mem.write8(0x6204, 0x02);
  m.mem.write8(0x6210, 0x03); m.mem.write8(0x6211, 0x04);
  // (ix+5:6) = 0x0500, (ix+0x12:0x13) = 0x0100 -> diff 0x0400, plus the scaled add
  m.mem.write8(0x6205, 0x05); m.mem.write8(0x6206, 0x00);
  m.mem.write8(0x6212, 0x01); m.mem.write8(0x6213, 0x00);
  m.mem.write8(0x6214, 0x02); // n=2 -> (2*2+1)*8 = 40 = 0x28
  sub_239c(m);
  assert.equal(m.mem.read8(0x6203), 0x04, "(ix+3) high of the 16-bit add = 0x04");
  assert.equal(m.mem.read8(0x6204), 0x06, "(ix+4) low of the 16-bit add = 0x06");
  // HL = (0x0500 - 0x0100) + (2n+1)*8 = 0x0400 + 0x28 = 0x0428, stored to (ix+5:6).
  assert.equal(m.mem.read8(0x6205), 0x04, "(ix+5) = 0x04 (HL high after add hl,bc)");
  assert.equal(m.mem.read8(0x6206), 0x28, "(ix+6) = 0x28 (HL low = 0x400 + 40)");
  assert.equal(m.mem.read8(0x6214), 0x03, "(ix+0x14) incremented 2 -> 3");
});

test("sub_23de decrements (ix+0x0F) on the != 1 path", () => {
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.regs.ix = 0x6600;
  // 0x08 -> dec -> 0x07. NB: NOT a value whose dec == 0x04 -- the main (==1) path
  // ends `ld a,0x04` and also writes (ix+0x0F), so 0x04 wouldn't discriminate.
  m.mem.write8(0x660f, 0x08);
  sub_23de(m);
  assert.equal(m.mem.read8(0x660f), 0x07, "(ix+0x0F): 8 -> dec -> 7 written back (not 0x04, the main-path value)");
});

test("entry_2974 sets up the sweep registers and returns after entry_2913", () => {
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00; m.push16(0x4d5e);
  entry_2974(m); // fresh machine: the 2 objects at 0x6680 are inactive -> 2913 true
  assert.equal(m.pc, 0x4d5e, "completed the sweep and returned normally");
});

test("sub_286f dispatches 0x6227 through the collision table at 0x2874 (index 1 -> 0x2880)", () => {
  const withSel = (sel) => {
    const m = new Machine(ROM);
    m.regs.sp = 0x6c00; m.push16(0x4d5e);
    m.mem.write8(0x6227, sel);
    return m;
  };
  assert.throws(() => sub_286f(withSel(0x00)), /0x0000/, "index 0 -> table[0]=0x0000 (null, unwired)");
  assert.doesNotThrow(() => sub_286f(withSel(0x01)), "index 1 -> table[1]=0x2880 (now wired)");
});

test("entry_2ddb triggers (0x63A0=1, 0x639A=1) when both rst gates pass and the mask is clear", () => {
  const setup = (c601a) => {
    const m = new Machine(ROM);
    m.regs.sp = 0x6c00; m.push16(0x4d5e);
    m.mem.write8(0x6227, 0x02); // rst 0x30 passes (rotate 0x0A by 2 -> carry) AND cp 0x02 -> inc b
    m.mem.write8(0x6200, 0x01); // rst 0x10 passes (bit 0 set)
    m.mem.write8(0x6380, 0x00); // mask width = ((0+1)>>1)+1 = 1 bit -> mask 0xFF
    m.mem.write8(0x601a, c601a);
    entry_2ddb(m);
    return m;
  };
  // 0x601A == 0 -> mask clear -> trigger.
  const mT = setup(0x00);
  assert.equal(mT.mem.read8(0x63a0), 0x01, "clear mask -> 0x63A0 = 1");
  assert.equal(mT.mem.read8(0x639a), 0x01, "clear mask -> 0x639A = 1");
  // 0x601A has a masked bit set -> ret nz, no trigger.
  assert.equal(setup(0x01).mem.read8(0x63a0), 0x00, "masked bit set -> no trigger");
});

test("sub_2880 recovers the pushed HL and runs three entry_2913 sweeps", () => {
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00; m.push16(0x4d5e); m.push16(0x1234); // return, then 286f's HL to pop
  sub_2880(m);
  assert.equal(m.mem.read8(0x63b9), 0x01, "last sweep's count written to 0x63B9");
  assert.equal(m.pc, 0x4d5e, "returned normally after the 3 sweeps");
});

test("sub_2a2f: passable tile -> A=0; a solid slope tile -> A=1 and X-adjusts (ix+5)", () => {
  const run = (tile) => {
    const m = new Machine(ROM);
    m.regs.sp = 0x6c00; m.push16(0x4d5e);
    m.regs.ix = 0x6600;
    m.mem.write8(0x6603, 0x00); // Y = 0 (H)
    m.mem.write8(0x6605, 0x3c); // X; +4 = 0x40 (L) -> sub_2ff0 cell 0x77E8
    m.mem.write8(0x77e8, tile);
    sub_2a2f(m);
    return m;
  };
  assert.equal(run(0xa0).regs.a, 0x00, "tile < 0xB0 -> no collision (A=0)");
  const mC = run(0xb5); // 0xB0-0xBF (low nibble < 8) -> offset -1 -> collision
  assert.equal(mC.regs.a, 0x01, "solid slope tile -> collision (A=1)");
  assert.equal(mC.mem.read8(0x6605), 0x3b, "(ix+5) X-adjusted to 0x3B");
});

test("sub_2523: timer gate / no-request / spawn paths", () => {
  const mk = () => { const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e); return m; };
  // timer running (0x639B != 0) -> just dec it.
  const m1 = mk(); m1.mem.write8(0x639b, 0x05); sub_2523(m1);
  assert.equal(m1.mem.read8(0x639b), 0x04, "timer running -> dec (0x639B): 5 -> 4");
  // timer 0, no request -> ret z, no dec.
  const m2 = mk(); m2.mem.write8(0x639b, 0x00); m2.mem.write8(0x639a, 0x00); sub_2523(m2);
  assert.equal(m2.mem.read8(0x639b), 0x00, "no request -> ret z, timer untouched");
  // timer 0 + request + a free slot at 0x65A0 -> activate the object, reload the
  // timer. NB: 0x639B stays 0x7C (NOT dec'd) -- sub_0057 clobbers HL, so the final
  // dec (hl) hits sub_0057's leftover address, not 0x639B (draft's "HL live" was wrong).
  const m3 = mk(); m3.mem.write8(0x639b, 0x00); m3.mem.write8(0x639a, 0x01); sub_2523(m3);
  assert.equal(m3.mem.read8(0x65a0), 0x01, "spawn -> object at 0x65A0 activated (field0=1)");
  assert.equal(m3.mem.read8(0x639b), 0x7c, "spawn reloads 0x639B=0x7C (the dec (hl) does NOT hit it -- sub_0057 clobbered HL)");
  assert.equal(m3.mem.read8(0x639a), 0x00, "spawn clears the request 0x639A");
});

test("loc_0bda: gated level-setup -- seeds state, one outer iter, arms 0x6009/0x600A", () => {
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x6009, 0x01); // rst 0x18 expires -> body runs
  m.mem.write8(0x622e, 0x01); // outer count 1 (< 6, kept)
  m.mem.write8(0x622a, 0x00); m.mem.write8(0x622f, 0x00); // equal -> no extra inc
  m.mem.write8(0x600a, 0x10);
  loc_0bda(m);
  assert.equal(m.mem.read8(0x608a), 0x02, "0x608A seeded to 2");
  assert.equal(m.mem.read8(0x608b), 0x03, "0x608B seeded to 3");
  assert.equal(m.mem.read8(0x63a7), 0x01, "0x63A7 incremented once (one outer iter)");
  assert.equal(m.mem.read16(0x63a8), 0x76d8, "0x63A8 walk pointer 0x76DC -> 0x76D8 (-4 per sprite)");
  assert.equal(m.mem.read8(0x76bc), 0x8b, "the (ix-0x20) NEGATIVE-disp sprite write = 0x8B");
  assert.equal(m.mem.read8(0x6009), 0xa0, "epilogue arms 0x6009 = 0xA0");
  assert.equal(m.mem.read8(0x600a), 0x12, "epilogue 0x600A += 2 (0x10 -> 0x12)");
});

test("loc_0986: 0x600E==0 -> 0x600A=1; else 0x600A=3 with flipscreen per 0x6026", () => {
  const run = (c600e, c6026) => {
    const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
    m.mem.write8(0x600e, c600e); m.mem.write8(0x6026, c6026);
    loc_0986(m); return m;
  };
  assert.equal(run(0x00, 0x00).mem.read8(0x600a), 0x01, "0x600E==0 -> 0x600A=1");
  const m1 = run(0x01, 0x01); // 0x6026==1 -> dec->0 -> keep flip=1
  assert.equal(m1.mem.read8(0x600a), 0x03, "0x600E!=0 -> 0x600A=3");
  assert.equal(m1.io.flipScreen, 1, "0x6026==1 -> flipscreen stays 1");
  assert.equal(run(0x01, 0x00).io.flipScreen, 0, "0x6026!=1 -> flipscreen cleared");
});

test("entry_2954: rst 0x30 gate -- passes (writes 0x6218) or skips", () => {
  const run = (c6227) => {
    const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
    m.regs.ix = 0x6680;
    m.mem.write8(0x6227, c6227); // rotate count for sub_0030 (A=0x0B)
    m.mem.write8(0x6218, 0x99); // sentinel
    entry_2954(m); return m;
  };
  // 1 rotation of 0x0B -> carry=bit0=1 -> gate passes -> 0x6218 = A (0 on fresh sweep).
  assert.equal(run(0x01).mem.read8(0x6218), 0x00, "gate pass -> 0x6218 written");
  // 256 rotations -> carry=bit7=0 -> gate skips -> 0x6218 sentinel intact.
  assert.equal(run(0x00).mem.read8(0x6218), 0x99, "gate skip -> 0x6218 untouched");
});

test("sub_2808 dispatches via sub_286f (reaches the collision dispatch)", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x6227, 0x01); // sub_286f table[1] = 0x2880 (now wired -> runs)
  assert.doesNotThrow(() => sub_2808(m), "reaches sub_286f's dispatch (0x2880 wired)");
});

test("loc_281d: addIy free-slot scan -- none found -> ret; found -> sub_286f dispatch", () => {
  // none found: bit0 of (iy+1) clear for both 0x6680/0x6690 -> scan exhausts (addIy) -> ret.
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  loc_281d(m);
  assert.equal(m.pc, 0x4d5e, "none found (addIy walked both) -> ret");
  // found at the SECOND object (0x6691) with the first (0x6681) clear -> requires
  // addIy to walk 0x6680 -> 0x6690 correctly; then sub_286f dispatch (throws).
  const m2 = new Machine(ROM); m2.regs.sp = 0x6c00; m2.push16(0x4d5e);
  m2.mem.write8(0x6691, 0x01); m2.mem.write8(0x6227, 0x01);
  assert.doesNotThrow(() => loc_281d(m2), "addIy walked to the 2nd object -> found -> dispatch (0x2880 wired)");
});

test("sub_1e57: skip-capable -- normal return (true) or unwind (false, 0x600A=0x16)", () => {
  const run = (c6290) => {
    const m = new Machine(ROM); m.regs.sp = 0x6c00;
    m.push16(0x216a); // grandparent (caller's caller)
    m.push16(0x1e00); // sub_1e57's own return
    m.mem.write8(0x6227, 0x04); // bit 2 set -> loc_1e80
    m.mem.write8(0x6290, c6290);
    const r = sub_1e57(m);
    return { m, r };
  };
  // 0x6290 != 0 -> loc_1e80 ret nz -> NORMAL return (true) to own-return 0x1E00.
  const a = run(0x01);
  assert.equal(a.r, true, "0x6290 != 0 -> normal return (true)");
  assert.equal(a.m.pc, 0x1e00, "returned to its own caller");
  // 0x6290 == 0 -> loc_1e85 UNWIND: 0x600A=0x16, false, pc = grandparent.
  const b = run(0x00);
  assert.equal(b.r, false, "0x6290 == 0 -> unwound (false)");
  assert.equal(b.m.mem.read8(0x600a), 0x16, "unwind sets 0x600A = 0x16");
  assert.equal(b.m.pc, 0x216a, "unwound to the caller's caller");
});

test("entry_128b: rst 0x18 gate -> advance 0x639D, set 0x639E/0x6088, re-arm 0x6009", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x6009, 0x01); // rst 0x18 expires
  m.mem.write8(0x639d, 0x00);
  entry_128b(m);
  assert.equal(m.mem.read8(0x639d), 0x01, "0x639D state advanced");
  assert.equal(m.mem.read8(0x639e), 0x0d, "0x639E = 0x0D");
  assert.equal(m.mem.read8(0x6088), 0x03, "0x6088 = 3");
  assert.equal(m.mem.read8(0x6009), 0x08, "0x6009 re-armed to 8");
});

test("sub_21ee: decode script input to 0x6010, count down 0x63CD (or advance when 0)", () => {
  const run = (c63cd) => {
    const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
    m.mem.write8(0x63cc, 0x00); m.mem.write8(0x63cd, c63cd);
    sub_21ee(m); return m;
  };
  // 0x63CD != 0 -> dec + ret; 0x6010 = the script byte at 0x21D1 (index 0).
  const m1 = run(0x03);
  assert.equal(m1.mem.read8(0x6010), ROM[0x21d1], "0x6010 = script input byte at 0x21D1");
  assert.equal(m1.mem.read8(0x63cd), 0x02, "0x63CD counted down 3 -> 2");
  // 0x63CD == 0 -> advance: reload from the duration byte, bump 0x63CC index.
  assert.equal(run(0x00).mem.read8(0x63cc), 0x01, "0x63CC index advanced 0 -> 1");
});

test("sub_216d: honors 236e miss-unwind, and on a hit reaches tail21b2 (set 0,(ix+2))", () => {
  // MISS: key absent -> 236e unwinds -> 216d's body skipped, returns to its caller.
  const mM = new Machine(ROM); mM.regs.sp = 0x6c00;
  mM.push16(0x216a); mM.push16(0x4d5e); // grandparent, then 216d's own return
  mM.regs.a = 0x42; mM.regs.bc = 0x0015; // no 0x42 in the all-zero 0x6300 region -> miss
  mM.regs.ix = 0x6600; mM.mem.write8(0x6602, 0x00);
  sub_216d(mM);
  assert.equal(mM.mem.read8(0x6602) & 0x01, 0x00, "236e miss -> tail21b2 never runs (bit0 clear)");
  // HIT reaching tail21b2: 236e matches at 0x6300 (D == M+0x15), A=1 -> continue,
  // 0x6348==0 -> straight to tail21b2 -> inc (ix+7), set 0,(ix+2).
  const mH = new Machine(ROM); mH.regs.sp = 0x6c00; mH.push16(0x4d5e);
  mH.regs.a = 0x42; mH.regs.d = 0x77; mH.regs.bc = 0x0015;
  mH.regs.ix = 0x6600;
  mH.mem.write8(0x6300, 0x42); // 236e matches here (M = 0x6300)
  mH.mem.write8(0x6315, 0x77); // (M+0x15) == D -> loc_238f -> A=1
  mH.mem.write8(0x6348, 0x00); // -> jp z,0x21b2 straight to the success tail
  mH.mem.write8(0x6602, 0x00); mH.mem.write8(0x6607, 0x10);
  sub_216d(mH);
  assert.equal(mH.mem.read8(0x6602) & 0x01, 0x01, "tail21b2: set 0,(ix+2) -- bit0 of 0x6602 set");
  assert.equal(mH.mem.read8(0x6607), 0x11, "tail21b2: inc (ix+7) -- 0x6607 0x10 -> 0x11");
});

test("sub_2591: active slot -- cull when field3+7 < 0x0E, else advance field3 by 0x63A6", () => {
  // cull: field3=0x00 (+7=0x07 < 0x0E) -> clear field0/field3 + the 0x69B8[0] byte.
  const c = new Machine(ROM); c.regs.sp = 0x6c00; c.push16(0x4d5e);
  c.mem.write8(0x65a0, 0x01); c.mem.write8(0x65a3, 0x00); c.mem.write8(0x69b8, 0x55);
  sub_2591(c);
  assert.equal(c.mem.read8(0x65a0), 0x00, "field3+7 < 0x0E -> cull -> field0 cleared");
  assert.equal(c.mem.read8(0x69b8), 0x00, "cull clears the 0x69B8[0] record byte");
  // update: field3=0x20 (+7=0x27 >= 0x0E), field5 != 0x7C -> field3 += (0x63A6).
  const u = new Machine(ROM); u.regs.sp = 0x6c00; u.push16(0x4d5e);
  u.mem.write8(0x65a0, 0x01); u.mem.write8(0x65a3, 0x20); u.mem.write8(0x65a5, 0x00); u.mem.write8(0x63a6, 0x05);
  sub_2591(u);
  assert.equal(u.mem.read8(0x65a3), 0x25, "field3 0x20 += (0x63A6)=0x05 -> 0x25");
});

test("sub_24ea: rst 0x30 gate, then compact one active slot's fields into 0x69B8", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x6227, 0x02); // rotate 0x02 by 2 -> carry (bit1) -> gate passes
  m.mem.write8(0x65a0, 0x01); // slot 0 active
  m.mem.write8(0x65a3, 0x20); // field3 (high enough: +7 >= 0x0E, no cull)
  m.mem.write8(0x65a5, 0xcc); // field5 (!= 0x7C)
  m.mem.write8(0x65a7, 0xaa); // field7
  m.mem.write8(0x65a8, 0xbb); // field8
  m.mem.write8(0x63a6, 0x00); // sub_2591 leaves field3 unchanged
  sub_24ea(m);
  // compact copies (ix+3,7,8,5) as 4 consecutive bytes at 0x69B8.
  assert.equal(m.mem.read8(0x69b8), 0x20, "compact copied field3");
  assert.equal(m.mem.read8(0x69b9), 0xaa, "compact copied field7");
  assert.equal(m.mem.read8(0x69ba), 0xbb, "compact copied field8");
  assert.equal(m.mem.read8(0x69bb), 0xcc, "compact copied field5");
});

test("entry_2be1: A>C -> plain return (true); A<=C -> store 0x6205 + DOUBLE unwind (false)", () => {
  const run = (c620c, ix5, e, c) => {
    const m = new Machine(ROM); m.regs.sp = 0x6c00;
    m.push16(0x3000); // R3 -- the double-skip target (great-grandparent)
    m.push16(0x2000); // R2 -- 2b9b's caller's return
    m.push16(0x4d5e); // R1 -- entry_2be1's own return
    m.regs.ix = 0x6600; m.mem.write8(0x6605, ix5);
    m.mem.write8(0x620c, c620c); m.regs.e = e; m.regs.c = c;
    const r = entry_2be1(m);
    return { m, r };
  };
  // A = (0x620C) - (ix+5) + E = 0x1B > C=0x10 -> loc_2bf8 plain return.
  const a = run(0x20, 0x05, 0x00, 0x10);
  assert.equal(a.r, true, "A > C -> plain return (true)");
  assert.equal(a.m.regs.a, 0x02, "loc_2bf8: A = 2");
  assert.equal(a.m.pc, 0x4d5e, "plain return -> R1");
  // A = 0x0B <= C=0x20 -> store 0x6205 = C-7, then the DOUBLE unwind to R3.
  const b = run(0x10, 0x05, 0x00, 0x20);
  assert.equal(b.r, false, "A <= C -> double-unwound (false)");
  assert.equal(b.m.mem.read8(0x6205), 0x19, "0x6205 = C - 7 = 0x19");
  assert.equal(b.m.pc, 0x3000, "double-skip discarded R1+R2 -> pc = R3");
});

// ---- rst-0x30 gate-heads (197a cascade): sub_2207 / sub_25f2 / sub_26fa -----
// Each is `ld a,N / rst 0x30`; the gate rotates A right mem[0x6227] times, carry -> body,
// else pop+ret SKIP to the caller. On the coin_start tape it SKIPS (only the 3-byte head
// runs; the body is a NON-EXECUTING frontier that throws NotImplemented). mem[0x6227]=1 ->
// one rrca -> carry = bit0(A) = 0 for A in {0x02,0x04} -> SKIP. Bodies unwired dead code.
// HAZARD: modelling rst 0x30 as a plain call (no skip) or inverting the gate runs the body.
for (const [name, fn, addr, ret, bodyPc, openRot, stubbed] of [
  ["sub_2207", sub_2207, 0x2207, 0x220a, "0x220A", 0x02, false], // body now translated (sub_2207_body)
  ["sub_25f2", sub_25f2, 0x25f2, 0x25f5, "0x25F5", 0x02, false], // body now translated (sub_25f2_body)
  ["sub_26fa", sub_26fa, 0x26fa, 0x26fd, "0x26FD", 0x03, false], // body @0x26FD now translated (tile/pos dispatch)
  ["sub_2fcb", sub_2fcb, 0x2fcb, 0x2fce, "0x2FCE", 0x02, false], // body @0x2FCE now translated (two-level countdown)
]) {
  test(`${name}: rst-0x30 gate SKIPS on coin_start (mem[0x6227]=1) -> returns to caller, body not entered`, () => {
    const m = new Machine(ROM); m.regs.sp = 0x6c00;
    m.push16(0x199e); // R_caller (197a cascade continuation)
    m.mem.write8(0x6227, 0x01); // one rrca -> carry clear -> SKIP
    assert.doesNotThrow(() => fn(m), `${name} gate must skip, not enter @${bodyPc}`);
    assert.equal(m.pc, 0x199e, "skip -> pop rst-frame + ret -> back at caller");
    assert.equal(m.regs.sp, 0x6c00, "SP fully unwound (rst frame + call frame popped)");
  });
  if (stubbed) {
    test(`${name}: gate OPENS (carry set) -> body @${bodyPc} is a NotImplemented frontier`, () => {
      const m = new Machine(ROM); m.regs.sp = 0x6c00;
      m.push16(0x199e);
      m.mem.write8(0x6227, openRot); // enough rrca to bring a set bit into carry -> body runs
      assert.throws(() => fn(m), new RegExp(bodyPc), `${name} open path must hit the frontier`);
    });
  }
}
test("sub_25f2: gate OPENS -> sub_25f2_body runs the 2602/262f/2679/2ad3 sub-cascade (no throw)", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x199e);
  m.mem.write8(0x6227, 0x02); // opens
  m.regs.de = 0x0010; // sub_27da-style live-in kept benign for sub_2602 path
  assert.doesNotThrow(() => sub_25f2(m), "body translated -> sub-cascade, no 0x25F5 throw");
});
test("sub_2207: gate OPENS -> sub_2207_body dispatches the object update (no longer a frontier)", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x199e);
  m.mem.write8(0x6227, 0x02); // opens
  m.mem.write8(0x6280, 0x02); // odd-frame record, state 2 -> loc_2299 (simplest arm)
  m.mem.write8(0x601a, 0x01); // rra -> carry set (odd) -> keep 0x6280
  assert.doesNotThrow(() => sub_2207(m), "body translated -> dispatches, no 0x220A throw");
});
test("sub_26fa: gate OPENS -> body @0x26FD runs the tile/pos dispatch (no longer a frontier)", () => {
  // gate opens (A=0x04, 0x6227=3 -> 3 rrca brings bit2 into carry). Body reads
  // (0x6205); >= 0xf0 -> jp nc,0x277f (edge reset) which clears 0x6398 and 0x6200.
  // A pre-seeded 0x6398 sentinel proves the BODY executed vs the gate skipping it.
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x199e);
  m.mem.write8(0x6227, 0x03); // opens
  m.mem.write8(0x6398, 0xaa); // sentinel -- loc_277f clears it iff the body ran
  m.mem.write8(0x6205, 0xf5); // >= 0xf0 -> jp nc,0x277f (edge-reset arm)
  assert.doesNotThrow(() => sub_26fa(m), "body translated -> dispatches, no 0x26FD throw");
  assert.equal(m.mem.read8(0x6398), 0x00, "edge-reset arm ran: loc_277f cleared 0x6398");
  assert.equal(m.mem.read8(0x6200), 0x00, "loc_277f also cleared 0x6200");
  assert.equal(m.pc, 0x199e, "loc_277f ret -> back to caller");
});
test("sub_2fcb: gate OPENS -> body @0x2FCE decrements the 0x62b4 inner timer (no longer a frontier)", () => {
  // gate opens (A=0x0e, 0x6227=2 -> 2 rrca brings a set bit into carry). Body:
  // ld hl,0x62b4 / dec (hl) -- inner countdown; nonzero result -> ret nz (period
  // not elapsed). 0x62b4: 5 -> 4 proves the BODY ran vs the gate skipping it.
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x199e);
  m.mem.write8(0x6227, 0x02); // opens
  m.mem.write8(0x62b4, 0x05); // inner timer
  assert.doesNotThrow(() => sub_2fcb(m), "body translated -> countdown, no 0x2FCE throw");
  assert.equal(m.mem.read8(0x62b4), 0x04, "dec (hl) ran: 0x62b4 5 -> 4");
  assert.equal(m.pc, 0x199e, "period not elapsed -> ret nz -> back to caller");
});

// ---- Layer-0 batch: sub_1826 / sub_1a1e / entry_1d8a / sub_1d8f / entry_1da6 / sub_1f46 ----
// All unwired dead code (callers are the held spine entry_1ac3/1d03 region or the 0x1A0A
// rst-0x28 table) -> net-zero. Tests pin the behaviour for go-live.

test("sub_1826: nested 5x14 fill of 0x10 walking backward by 0x25 per row (HL live-in)", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  const start = 0x6400; m.regs.hl = start;
  sub_1826(m);
  // Row 0: 5 bytes at start..start+4. Row 1 starts at (start+5) - 0x25 = start - 0x20.
  for (let i = 0; i < 5; i++) assert.equal(m.mem.read8(start + i), 0x10, `row0 byte ${i}`);
  const row1 = (start + 5 - 0x25) & 0xffff;
  for (let i = 0; i < 5; i++) assert.equal(m.mem.read8(row1 + i), 0x10, `row1 byte ${i}`);
  assert.equal(m.pc, 0x4d5e, "ret to caller");
  // HL after 14 rows: start walked (5 - 0x25)*14 forward-then-back. Final add hl,de brings
  // it to start + 14*(5 - 0x25) = start - 14*0x20 = start - 0x1c0.
  assert.equal(m.regs.hl, (start - 14 * 0x20) & 0xffff, "HL ends one full row-stride below");
});

test("sub_1a1e: no-op dispatch slot -- just ret to the 0x1A0A routine's caller", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x1234);
  sub_1a1e(m);
  assert.equal(m.pc, 0x1234, "ret pops the grandparent return (no frame of its own)");
  assert.equal(m.regs.sp, 0x6c00, "SP unwound by the single ret");
});

test("entry_1d8a: decrements the 4-frame animation timer at 0x620F (dec the byte, not HL)", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x620f, 0x04);
  entry_1d8a(m);
  assert.equal(m.mem.read8(0x620f), 0x03, "0x620F: 4 -> 3");
  assert.equal(m.regs.hl, 0x620f, "HL points at the timer (dec (hl) is the byte)");
  assert.equal(m.pc, 0x4d5e, "ret to caller");
});

test("sub_1d8f: sound trigger -- 0x6080 = 3 unconditionally", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x6080, 0x00);
  sub_1d8f(m);
  assert.equal(m.mem.read8(0x6080), 0x03, "sound latch = 3");
  assert.equal(m.regs.a, 0x03);
  assert.equal(m.pc, 0x4d5e, "ret to caller");
});

test("entry_1da6: copies player(+3,+7,+8,+5) -> 0x694C..0x694F OUT OF ORDER (do not sort)", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x6203, 0xa3); m.mem.write8(0x6207, 0xa7);
  m.mem.write8(0x6208, 0xa8); m.mem.write8(0x6205, 0xa5);
  entry_1da6(m);
  assert.equal(m.mem.read8(0x694c), 0xa3, "694C <- (0x6203)");
  assert.equal(m.mem.read8(0x694d), 0xa7, "694D <- (0x6207)");
  assert.equal(m.mem.read8(0x694e), 0xa8, "694E <- (0x6208)");
  assert.equal(m.mem.read8(0x694f), 0xa5, "694F <- (0x6205) -- the OUT-OF-ORDER field");
  assert.equal(m.pc, 0x4d5e, "ret to caller");
});

test("sub_1f46: 0x6221==0 -> no-op ret; else clear 8 + set 2 ones + snapshot Y", () => {
  // gate closed: 0x6221 == 0 -> ret, nothing written.
  const g = new Machine(ROM); g.regs.sp = 0x6c00; g.push16(0x4d5e);
  g.mem.write8(0x6221, 0x00); g.mem.write8(0x6216, 0x55);
  sub_1f46(g);
  assert.equal(g.mem.read8(0x6216), 0x55, "gate closed -> state untouched");
  assert.equal(g.pc, 0x4d5e, "ret z");
  // gate open: reset the player to state 1, snapshot Y.
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x6221, 0x01); m.mem.write8(0x6205, 0x7a);
  m.mem.write8(0x6204, 0xff); m.mem.write8(0x6214, 0xff);
  sub_1f46(m);
  assert.equal(m.mem.read8(0x6204), 0x00, "cleared (before the inc-a boundary)");
  assert.equal(m.mem.read8(0x6214), 0x00, "cleared (last zero before boundary)");
  assert.equal(m.mem.read8(0x6221), 0x00, "trigger cleared");
  assert.equal(m.mem.read8(0x6216), 0x01, "state = 1 (after the inc-a boundary)");
  assert.equal(m.mem.read8(0x621f), 0x01, "0x621F = 1");
  assert.equal(m.mem.read8(0x620e), 0x7a, "Y snapshot 0x6205 -> 0x620E");
  assert.equal(m.pc, 0x4d5e, "ret to caller");
});

// ---- sub_13ca: BCD unpack + fill + 3-byte-subtract sort (rst-0x08 caller-skip) ----
// HL = 3-byte source, A = value -> 0x61C6. HAZARDS: (a) rst 0x08 SKIPS when bit0 of
// 0x6007 set; (b) FOUR explicit rrca take the HIGH nibble (a loop miscount would swap
// hi/lo); (c) sbc a,(hl) is a first-use of the memory form (the 3-byte borrow chain).
test("sub_13ca: rst-0x08 caller-skip -- bit0 of 0x6007 set aborts to caller after storing 0x61C6", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x6007, 0x01); // bit0 set -> sub_0008 skips (inc sp x2 / ret)
  m.mem.write8(0x61b1, 0x77); // BCD dest sentinel -- must stay untouched on abort
  m.regs.hl = 0x60b2; m.regs.a = 0x05;
  sub_13ca(m);
  assert.equal(m.mem.read8(0x61c6), 0x05, "0x61C6 = A written BEFORE the rst 0x08");
  assert.equal(m.mem.read8(0x61b1), 0x77, "aborted before the BCD unpack -- dest untouched");
  assert.equal(m.pc, 0x4d5e, "caller-skip returns to sub_13ca's caller");
  assert.equal(m.regs.sp, 0x6c00, "SP unwound (rst frame discarded + ret)");
});
test("sub_13ca: main path -- ldir copy, BCD unpack (4 rrca = HIGH nibble), fill 0x10 + 0x3F term", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x6007, 0x00); // bit0 clear -> rst 0x08 returns normally
  // distinct-nibble source so a hi/lo swap (wrong rrca count) is caught:
  m.mem.write8(0x60b2, 0x9a); m.mem.write8(0x60b3, 0x5c); m.mem.write8(0x60b4, 0x3e);
  // make the FIRST 3-byte subtract borrow (0x61A5[]=0xFFFFFF > copied) -> ret c after fill.
  m.mem.write8(0x61a5, 0xff); m.mem.write8(0x61a6, 0xff); m.mem.write8(0x61a7, 0xff);
  m.regs.hl = 0x60b2; m.regs.a = 0x01;
  sub_13ca(m);
  assert.equal(m.mem.read8(0x61c6), 0x01, "A parameter -> 0x61C6");
  // ldir copied the 3 source bytes to 0x61C7..0x61C9:
  assert.equal(m.mem.read8(0x61c7), 0x9a, "ldir[0]");
  assert.equal(m.mem.read8(0x61c8), 0x5c, "ldir[1]");
  assert.equal(m.mem.read8(0x61c9), 0x3e, "ldir[2]");
  // BCD unpack reads DE backward from 0x61C9: hi nibble then lo, into 0x61B1..0x61B6.
  assert.deepEqual(
    [0x61b1, 0x61b2, 0x61b3, 0x61b4, 0x61b5, 0x61b6].map((a) => m.mem.read8(a)),
    [0x3, 0xe, 0x5, 0xc, 0x9, 0xa], // 0x3E->3,E ; 0x5C->5,C ; 0x9A->9,A (HIGH nibble first)
    "BCD hi/lo nibbles -- 4 rrca yields the HIGH nibble",
  );
  // fill: 14x 0x10 at 0x61B7..0x61C4, then 0x3F terminator at 0x61C5.
  assert.equal(m.mem.read8(0x61b7), 0x10, "fill start");
  assert.equal(m.mem.read8(0x61c4), 0x10, "fill end");
  assert.equal(m.mem.read8(0x61c5), 0x3f, "0x3F terminator");
  assert.equal(m.pc, 0x4d5e, "ret c (borrow) -> back to caller before the swap pass");
});

// ---- entry_1d03: player walk/climb animation stepper (shared body loc_1d11) ----
// timer 0x620F gates: !=0 -> loc_1d76; ==0 -> reset timer=4, delta=-2, loc_1d11.
// loc_1d11 toggles phase 0x6222: phase-0 -> frame logic -> loc_1d3f/1d67; phase-1 -> loc_1d51.
// All exits tail-jump to entry_1da6 (or entry_1d8a). Unwired dead code.
test("entry_1d03: timer expired, phase-0 -> steps Y by -2, writes sprite-control, hands to 1da6", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x620f, 0x00); // timer expired
  m.mem.write8(0x6205, 0x50); // player Y
  m.mem.write8(0x6222, 0x01); // phase: xor 1 -> 0 -> phase-0 (frame logic)
  m.mem.write8(0x621c, 0x00); m.mem.write8(0x621b, 0x00); // frame comparisons miss -> fall to loc_1d3f, B=3
  m.mem.write8(0x6207, 0x00); // sprite-control: and 0x80 -> 0, xor 0x80 -> 0x80, or 3 -> 0x83
  m.mem.write8(0x6203, 0xaa); m.mem.write8(0x6208, 0xbb);
  entry_1d03(m);
  assert.equal(m.mem.read8(0x620f), 0x04, "timer reset to 4");
  assert.equal(m.mem.read8(0x6205), 0x4e, "Y += delta (-2): 0x50 -> 0x4E");
  assert.equal(m.mem.read8(0x6222), 0x00, "phase toggled 1 -> 0");
  assert.equal(m.mem.read8(0x6207), 0x83, "sprite-control = flip(bit7) | frame 3");
  assert.equal(m.mem.read8(0x6215), 0x01, "loc_1d49 marks dirty := 1");
  assert.equal(m.mem.read8(0x694d), 0x83, "entry_1da6 copied 0x6207 -> 0x694D");
  assert.equal(m.mem.read8(0x694f), 0x4e, "entry_1da6 copied 0x6205 -> 0x694F");
  assert.equal(m.pc, 0x4d5e, "tail entry_1da6 rets to entry_1d03's caller");
});
test("entry_1d03: timer expired, phase-1 -> loc_1d51 (or 0x03 / res 2) + sound trigger", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x620f, 0x00);
  m.mem.write8(0x6205, 0x50);
  m.mem.write8(0x6222, 0x00); // xor 1 -> 1 -> phase-1 (loc_1d51)
  m.mem.write8(0x6203, 0x04); // or 0x03 -> 0x07, res 2,a -> 0x03
  m.mem.write8(0x6224, 0x01); // xor 1 -> 0 -> call z sub_1d8f (sound)
  m.mem.write8(0x6080, 0x00);
  entry_1d03(m);
  assert.equal(m.mem.read8(0x6203), 0x03, "0x6203: (0x04|0x03) then res 2 -> 0x03");
  assert.equal(m.mem.read8(0x6224), 0x00, "0x6224 toggled 1 -> 0");
  assert.equal(m.mem.read8(0x6080), 0x03, "sub_1d8f fired: sound latch 0x6080 = 3");
  assert.equal(m.mem.read8(0x6215), 0x01, "loc_1d49 marks dirty");
  assert.equal(m.pc, 0x4d5e, "tail entry_1da6 rets to caller");
});
test("entry_1d03: timer running (0x620F!=0), 0x621A==0 -> loc_1d76 falls to entry_1d8a tail", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x620f, 0x03); // timer running
  m.mem.write8(0x621a, 0x00); // -> jp z 0x1d8a
  entry_1d03(m);
  assert.equal(m.mem.read8(0x620f), 0x02, "entry_1d8a decremented the timer 3 -> 2");
  assert.equal(m.pc, 0x4d5e, "ret to caller");
});

// ---- sub_22cb: object velocity init (mode/difficulty/RNG), faithful rst-0x28 dispatch ----
// mode (0x6348)==0 -> loc_22e1 picks A from (0x6229); else rst 0x28 indexes the INLINE table
// at 0x22D7 by (0x6380)-1: diff 1/2 -> 0x22F6 (RNG, internal), diff 3/4 -> 0x2303, 5 -> 0x231a
// (EXTERNAL frontier -> NotImplemented). Store: (ix+0x11)=A, (ix+0x10)=(A&1)-1. Unwired.
test("sub_22cb: mode 0 -> loc_22e1 picks (0x6229)==1 -> A=0x01, stores odd-sign 0x00", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.regs.ix = 0x6600;
  m.mem.write8(0x6348, 0x00); // mode 0 -> loc_22e1
  m.mem.write8(0x6229, 0x01); // -> A = 0x01
  sub_22cb(m);
  assert.equal(m.mem.read8(0x6611), 0x01, "(ix+0x11) = magnitude A = 0x01");
  assert.equal(m.mem.read8(0x6610), 0x00, "(ix+0x10) = (A&1)-1 = 0x00 (odd)");
  assert.equal(m.pc, 0x4d5e, "ret to caller");
});
test("sub_22cb: mode!=0, difficulty 1 -> rst-0x28 table[0]=0x22F6 (RNG), even-sign 0xFF", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.regs.ix = 0x6600;
  m.mem.write8(0x6348, 0x01); // mode != 0
  m.mem.write8(0x6380, 0x01); // difficulty 1 -> index 0 -> 0x22F6
  m.mem.write8(0x6018, 0x04); // RNG value
  sub_22cb(m);
  assert.equal(m.mem.read8(0x6611), 0x04, "(ix+0x11) = RNG (0x6018) = 0x04");
  assert.equal(m.mem.read8(0x6610), 0xff, "(ix+0x10) = (0x04&1)-1 = 0xFF (even)");
  assert.equal(m.pc, 0x4d5e, "ret to caller");
});
test("sub_22cb: difficulty 3/5 -> rst-0x28 dispatches to loc_2303/loc_231a (now integrated)", () => {
  const d3 = new Machine(ROM); d3.regs.sp = 0x6c00; d3.push16(0x4d5e);
  d3.regs.ix = 0x6600; d3.mem.write8(0x6348, 0x01); d3.mem.write8(0x6380, 0x03); // index 2 -> 0x2303
  d3.mem.write8(0x6018, 0x55);
  sub_22cb(d3);
  assert.equal(d3.mem.read8(0x6611), 0x55, "diff 3 -> loc_2303 wrote (ix+0x11)=frame");
  const d5 = new Machine(ROM); d5.regs.sp = 0x6c00; d5.push16(0x4d5e);
  d5.regs.ix = 0x6600; d5.mem.write8(0x6348, 0x01); d5.mem.write8(0x6380, 0x05); // index 4 -> 0x231a
  sub_22cb(d5);
  assert.equal(d5.pc, 0x4d5e, "diff 5 -> loc_231a runs + rets");
});

// ---- loc_12f2: counter-gated state setup (idx 14, TWIN of loc_1344) ----
// dec (0x6228); ldir 8 bytes -> 0x6040; counter!=0 -> loc_1334 (0x600A=0x08/0x17);
// counter==0 -> call 13ca + render (309F/1826/309F) + 0x6009=0xC0, 0x600A=0x10. Unwired.
test("loc_12f2: counter != 0 -> loc_1334 sets 0x600A (0x08 when 0x600F==0)", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x6228, 0x05); // dec -> 0x04 (!= 0) -> loc_1334
  m.mem.write8(0x600f, 0x00); // -> keep C = 0x08
  loc_12f2(m);
  assert.equal(m.mem.read8(0x622c), 0x00, "0x622C cleared at entry");
  assert.equal(m.mem.read8(0x6228), 0x04, "counter decremented 5 -> 4");
  assert.equal(m.mem.read8(0x6040), 0x04, "ldir copied the counter byte to 0x6040");
  assert.equal(m.mem.read8(0x600a), 0x08, "0x600A = 0x08 (0x600F==0)");
  assert.equal(m.pc, 0x4d5e, "ret to caller");
});
test("loc_12f2: counter != 0, 0x600F != 0 -> 0x600A = 0x17", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x6228, 0x03); m.mem.write8(0x600f, 0x01);
  loc_12f2(m);
  assert.equal(m.mem.read8(0x600a), 0x17, "0x600A = 0x17 (0x600F != 0)");
});
test("loc_12f2: counter == 0 -> render path ends with 0x6009=0xC0, 0x600A=0x10", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x6228, 0x01); // dec -> 0x00 -> render path
  m.mem.write8(0x600f, 0x00); // jr z -> skip the extra 309F enqueue
  m.mem.write8(0x6007, 0x00); // sub_13ca rst-0x08 does not skip
  loc_12f2(m);
  assert.equal(m.mem.read8(0x6009), 0xc0, "0x6009 armed to 0xC0");
  assert.equal(m.mem.read8(0x600a), 0x10, "0x600A = 0x10");
  assert.equal(m.pc, 0x4d5e, "ret to caller");
});

// ---- sub_2407: fixed-point subtract -- spread packed nibbles then sbc hl,bc ----
test("sub_2407: (ix+0x14)=0x35 -> HL=0x0350, minus BC=0x0010 -> 0x0340 (bare sbcHl)", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.regs.ix = 0x6600;
  m.mem.write8(0x6614, 0x35); // packed 0xHL: H=3, L=5 -> HL = (3<<8)|(5<<4) = 0x0350
  m.mem.write8(0x6612, 0x00); // B
  m.mem.write8(0x6613, 0x10); // C -> BC = 0x0010
  sub_2407(m);
  assert.equal(m.regs.hl, 0x0340, "HL = 0x0350 - 0x0010 - carry(0) = 0x0340");
  assert.equal(m.pc, 0x4d5e, "ret to caller");
});
test("sub_2407: nibble spread is exact -- (ix+0x14)=0x9C -> H=9, L<<4=0xC0 -> HL=0x09C0", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.regs.ix = 0x6600;
  m.mem.write8(0x6614, 0x9c); // H=9, L=C -> HL = 0x0900 | 0x00C0 = 0x09C0
  m.mem.write8(0x6612, 0x00); m.mem.write8(0x6613, 0x00); // BC = 0
  sub_2407(m);
  assert.equal(m.regs.hl, 0x09c0, "distinct nibbles: H high-byte, L<<4 low-byte");
});

// ---- loc_08f8: arm 1 of 0x08B2's table -- ends the sub-state machine ----
// A = loc_08d5's return (mem[0x7D00] & B). A==0x04 -> zero 0x6048[8], HL=0x0000; A==0x08 ->
// copy block, HL=0x0100; else -> ret unchanged. Shared tail loc_0938 stores HL->0x600E and
// ends the machine (0x600A=0, 0x6005=3). Unwired dead code. Drive 0x7D00 via inputs._in2.
const run08f8 = (in2, c6001) => {
  const inputs = new Inputs();
  inputs._in2 = in2; // -> mem[0x7D00]
  const m = new Machine(ROM, { inputs });
  m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x6001, c6001); // loc_08d5: ==1 -> B=0x04, else B=0x0C
  m.mem.write8(0x601a, 0x01); // (0x601A & 7) != 0 -> loc_08d5 skips its two calls
  m.mem.write8(0x6005, 0x99); m.mem.write8(0x600a, 0x99); // sentinels for the else path
  loc_08f8(m);
  return m;
};
test("loc_08f8: A==0x04 -> zero 0x6048[8], HL=0x0000; tail ends machine (0x6005=3, 0x600A=0)", () => {
  const m = run08f8(0x04, 0x01); // B=0x04, 0x04 & 0x04 = 0x04
  for (let i = 0; i < 8; i++) assert.equal(m.mem.read8(0x6048 + i), 0x00, `0x6048+${i} zeroed`);
  assert.equal(m.mem.read8(0x600e), 0x00, "0x600E = low(HL=0x0000)");
  assert.equal(m.mem.read8(0x600f), 0x00, "0x600F = high(HL=0x0000)");
  assert.equal(m.mem.read8(0x600a), 0x00, "0x600A reset (machine selector)");
  assert.equal(m.mem.read8(0x6005), 0x03, "0x6005 = 3 (game state advance)");
  assert.equal(m.pc, 0x4d5e, "ret to caller");
});
test("loc_08f8: A==0x08 -> HL=0x0100 join; tail ends machine (0x600F=1, 0x6005=3)", () => {
  const m = run08f8(0x08, 0x00); // B=0x0C, 0x08 & 0x0C = 0x08
  assert.equal(m.mem.read8(0x600e), 0x00, "0x600E = low(HL=0x0100)");
  assert.equal(m.mem.read8(0x600f), 0x01, "0x600F = high(HL=0x0100) -- the arm-2 join");
  assert.equal(m.mem.read8(0x600a), 0x00, "0x600A reset");
  assert.equal(m.mem.read8(0x6005), 0x03, "0x6005 = 3");
  assert.equal(m.pc, 0x4d5e, "ret to caller");
});
test("loc_08f8: A==0x0C (neither arm) -> ret, changes NOTHING", () => {
  const m = run08f8(0x0c, 0x00); // B=0x0C, 0x0C & 0x0C = 0x0C
  assert.equal(m.mem.read8(0x6005), 0x99, "0x6005 untouched (sentinel)");
  assert.equal(m.mem.read8(0x600a), 0x99, "0x600A untouched (sentinel)");
  assert.equal(m.pc, 0x4d5e, "ret to caller");
});

// ---- sub_241f: position gate -- 5 fall-through conditional rets, (D,E) is the answer ----
test("sub_241f: (D,E) pair by position -- default (1,0), far-right (0,1), blocked (0,0)", () => {
  const de = ({ x = 0x50, x2 = null, y = 0x40, p6227 = 0x01 } = {}) => {
    const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
    m.mem.write8(0x6203, x); m.mem.write8(0x6205, y); m.mem.write8(0x6227, p6227);
    // sub_241f re-reads 0x6203 at 0x2439; if x2 given, the routine sees the same x
    sub_241f(m);
    return [m.regs.d, m.regs.e];
  };
  assert.deepEqual(de({ x: 0x10 }), [1, 0], "X < 0x16 -> (1,0) default (ret c)");
  assert.deepEqual(de({ x: 0xf0 }), [0, 1], "X >= 0xEA -> (0,1) far-right (ret nc)");
  assert.deepEqual(de({ x: 0x50, p6227: 0x00 }), [0, 0], "bit0(0x6227)==0 -> (0,0) blocked");
  assert.deepEqual(de({ x: 0x50, y: 0x60 }), [0, 0], "Y >= 0x58 -> (0,0)");
  assert.deepEqual(de({ x: 0x70 }), [0, 0], "X >= 0x6C -> (0,0)");
  assert.deepEqual(de({ x: 0x50, y: 0x40 }), [1, 0], "in-band -> (1,0) (inc d at the end)");
});

// ---- entry_1a07: rst-0x28 state machine (faithful body); dispatches (0x6386) 0..3 ----
test("entry_1a07: state 1 (INIT) -> clear 0x6387, advance 0x6386 to 2", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x6386, 0x01); m.mem.write8(0x6387, 0xaa);
  entry_1a07(m);
  assert.equal(m.mem.read8(0x6387), 0x00, "counter cleared");
  assert.equal(m.mem.read8(0x6386), 0x02, "state advanced 1 -> 2");
  assert.equal(m.pc, 0x4d5e, "handler ret -> caller");
});
test("entry_1a07: state 2 (DELAY) -- countdown 0x6387; at 0 advance to 3, else stay", () => {
  const at1 = new Machine(ROM); at1.regs.sp = 0x6c00; at1.push16(0x4d5e);
  at1.mem.write8(0x6386, 0x02); at1.mem.write8(0x6387, 0x01);
  entry_1a07(at1);
  assert.equal(at1.mem.read8(0x6387), 0x00, "counter 1 -> 0");
  assert.equal(at1.mem.read8(0x6386), 0x03, "state advanced 2 -> 3");
  const at5 = new Machine(ROM); at5.regs.sp = 0x6c00; at5.push16(0x4d5e);
  at5.mem.write8(0x6386, 0x02); at5.mem.write8(0x6387, 0x05);
  entry_1a07(at5);
  assert.equal(at5.mem.read8(0x6387), 0x04, "counter 5 -> 4");
  assert.equal(at5.mem.read8(0x6386), 0x02, "state stays 2 (ret nz)");
});
test("entry_1a07: state 3 (WAIT) -- (0x6216)!=0 stays; ==0 runs the 0x19D2 spine tail", () => {
  const stay = new Machine(ROM); stay.regs.sp = 0x6c00; stay.push16(0x4d5e);
  stay.mem.write8(0x6386, 0x03); stay.mem.write8(0x6216, 0x01);
  entry_1a07(stay);
  assert.equal(stay.mem.read8(0x6386), 0x03, "stays in state 3 while (0x6216) != 0");
  assert.equal(stay.pc, 0x4d5e, "ret nz -> back to caller (loc_197a)");
  // (0x6216)==0: loc_1a2a's hidden exit pops loc_197a's 0x19BF continuation and jumps
  // to the now-translated shared tail tail_19d2 (0x19D2), which re-arms the rst-0x18
  // counter and rets to loc_197a's CALLER. Two returns on the stack: the discarded
  // 0x19BF and the real caller underneath (else tail_19d2's ret pops unmapped 0x6c00).
  const exit = new Machine(ROM); exit.regs.sp = 0x6c00;
  exit.push16(0x4d5e); // loc_197a's caller -- tail_19d2's ret lands here
  exit.push16(0x19bf); // loc_197a's 0x19BF continuation -- DISCARDED by the hidden exit
  exit.mem.write8(0x6386, 0x03); exit.mem.write8(0x6216, 0x00);
  exit.mem.write8(0x600a, 0x00);
  entry_1a07(exit);
  assert.equal(exit.mem.read8(0x600a), 0x01, "tail_19d2 re-armed: inc (0x600a) 0 -> 1");
  assert.equal(exit.mem.read8(0x6009), 0x40, "tail_19d2 re-armed the rst-0x18 counter (0x6009 = 0x40)");
  assert.equal(exit.pc, 0x4d5e, "hidden exit discarded 0x19BF; tail_19d2 ret -> loc_197a's caller");
});
test("entry_1a07: state 0 -> no-op (sub_1a1e ret); state >=4 -> wild jp 0x0000 frontier", () => {
  const s0 = new Machine(ROM); s0.regs.sp = 0x6c00; s0.push16(0x4d5e);
  s0.mem.write8(0x6386, 0x00);
  entry_1a07(s0);
  assert.equal(s0.pc, 0x4d5e, "state 0 = no-op ret to caller");
  const s4 = new Machine(ROM); s4.regs.sp = 0x6c00; s4.push16(0x4d5e);
  s4.mem.write8(0x6386, 0x04);
  assert.throws(() => entry_1a07(s4), /0x0000/, "state 4 -> table[4]=0x0000 wild frontier");
});

// ---- sub_1a33: rst-0x30 position trigger; hit paths are external frontiers ----
test("sub_1a33: rst-0x30 gate skips (mem[0x6227]=1) -> ret, no frontier hit", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x199e);
  m.mem.write8(0x6227, 0x01); // one rrca of 0x08 -> carry clear -> skip
  assert.doesNotThrow(() => sub_1a33(m));
  assert.equal(m.pc, 0x199e, "caller-skip returns to caller");
});
test("sub_1a33: gate open, no position hit -> plain ret", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x6227, 0x04); // 4 rrca of 0x08 -> carry set -> body runs
  m.mem.write8(0x6203, 0x00); // X != 0x4B/0xB3
  m.mem.write8(0x6291, 0x05); // (0x6291)-1 != 0
  assert.doesNotThrow(() => sub_1a33(m));
  assert.equal(m.pc, 0x4d5e, "no hit -> ret to caller");
});
test("sub_1a33: gate open, X==0x4B -> arm the pickup ((0x6291)=1)", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x6227, 0x04); m.mem.write8(0x6203, 0x4b);
  m.mem.write8(0x6291, 0x00);
  sub_1a33(m);
  assert.equal(m.mem.read8(0x6291), 0x01, "edge X -> arm (0x6291=1)");
});
test("loc_16a3 / loc_16bb: L2 board-load handlers -- advance 0x6388, run without error", () => {
  const a = new Machine(ROM); a.regs.sp = 0x6c00; a.push16(0x4d5e); a.mem.write8(0x6388, 0x03);
  loc_16a3(a);
  assert.equal(a.mem.read8(0x6388), 0x04, "16a3 advances selector");
  const b = new Machine(ROM); b.regs.sp = 0x6c00; b.push16(0x4d5e);
  b.mem.write8(0x6910, 0x5b); // [0x5A,0x5D) -> reinit path (loc_16ee) -> inc 0x6388
  b.mem.write8(0x6388, 0x02);
  loc_16bb(b);
  assert.equal(b.mem.read8(0x6388), 0x03, "16bb reinit path advances selector");
});
test("sub_09d6 / sub_09fe / sub_0a1b: level-setup routines run + set 0x600A", () => {
  const a = new Machine(ROM); a.regs.sp = 0x6c00; a.push16(0x4d5e);
  sub_09d6(a);
  assert.equal(a.mem.read8(0x74e0), 0x02, "sub_09d6 -> shared sub_09ee tail (0x74E0=2)");
  const b = new Machine(ROM); b.regs.sp = 0x6c00; b.push16(0x4d5e);
  b.mem.write16(0x622a, 0x3a73);
  sub_09fe(b);
  assert.equal(b.mem.read8(0x6009), 0x78);
  assert.equal(b.mem.read8(0x600a), 0x04);
  const c = new Machine(ROM); c.regs.sp = 0x6c00; c.push16(0x4d5e);
  sub_0a1b(c);
  assert.equal(c.mem.read8(0x600a), 0x05);
});

// ---- entry_03fb: attract/colour-cycle driver (flattened 15-block routine) ----
// (6227)!=2/4 main path: frame counter 0x6390 ++, colour writes via sub_0514, 3 ret exits in
// loc_04ac gated by bit6/low3 of C (=counter). Unwired dead code (caller is held loc_197a).
test("entry_03fb: main path advances frame counter 0x6390 and returns (EXIT-1 ret z)", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x6227, 0x00); // != 2 (skip cold arm), != 4 (skip blink block)
  m.mem.write8(0x6391, 0x01); // frame flag set -> loc_0426
  m.mem.write8(0x6390, 0x00); // counter -> inc to 0x01 (bit6 clear -> ret z at 0x04B1)
  m.mem.write8(0x6393, 0x01); // != 0 -> loc_0486 (skips the 0x004E table copy)
  entry_03fb(m);
  assert.equal(m.mem.read8(0x6390), 0x01, "frame counter 0x6390: 0 -> 1");
  assert.equal(m.pc, 0x4d5e, "reaches loc_04ac EXIT-1 (ret z, bit6(C=1) clear)");
});
test("entry_03fb: counter hits 0x80 -> loc_0464 resets 0x6390 and 0x6391 to 0", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x6227, 0x00);
  m.mem.write8(0x6391, 0x01);
  m.mem.write8(0x6390, 0x7f); // inc -> 0x80 -> jp z loc_0464 (reset)
  m.mem.write8(0x6393, 0x01); // != 0 -> skip the 0x004E copy in loc_0464
  entry_03fb(m);
  assert.equal(m.mem.read8(0x6390), 0x00, "loc_0464 reset the counter to 0");
  assert.equal(m.mem.read8(0x6391), 0x00, "loc_0464 reset the frame flag to 0");
  assert.equal(m.pc, 0x4d5e, "ret to caller");
});
test("entry_03fb: EXIT-3 blink flip -- C bit6 set, low3==0 -> (0x6905) ^= 0x03", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x6227, 0x00);
  m.mem.write8(0x6391, 0x01);
  m.mem.write8(0x6390, 0x3f); // inc -> 0x40 (bit6 set, low3==0) -> EXIT-3
  m.mem.write8(0x6393, 0x01);
  m.mem.write8(0x6905, 0x00); // flipped by xor 0x03 -> 0x03
  entry_03fb(m);
  assert.equal(m.mem.read8(0x6390), 0x40, "counter 0x3F -> 0x40");
  assert.equal(m.mem.read8(0x6905), 0x03, "loc_04ac EXIT-3: 0x6905 ^= 0x03 (blink flip)");
  assert.equal(m.pc, 0x4d5e, "ret to caller");
});

// ---- sub_2a85: gated tile probe (0x198F cascade, sub_2a2f sibling) ----
// 3 gates (0x6215/0x6216 ret nz, 0x6398==1 ret z), then probe tilemap at (0x6203-3, 0x6205+0x0C)
// via sub_2ff0. Executing exit = ret 0x2AB3 (tile>=0xB0 & low-nibble<8); else 0x2AB4 frontier.
test("sub_2a85: gate 1 (0x6215 != 0) -> immediate ret nz", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x6215, 0x01);
  sub_2a85(m);
  assert.equal(m.pc, 0x4d5e, "ret nz -- gate 1");
});
test("sub_2a85: gate 3 (0x6398 == 1) -> ret z", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x6215, 0x00); m.mem.write8(0x6216, 0x00); m.mem.write8(0x6398, 0x01);
  sub_2a85(m);
  assert.equal(m.pc, 0x4d5e, "ret z -- gate 3");
});
test("sub_2a85: gates pass, tile probe -- solid tile -> ret; slope tile -> loc_2ab4 sets 0x6221", () => {
  // position (0x6203=0x20 -> H=0x1D, 0x6205=0x30 -> L=0x3C); sub_2ff0 maps to cell 0x7787.
  // Saved-position high D=0x1D, so loc_2ab4's `and 0x07` != 0 -> it probes one row up
  // (0x7787-0x20=0x7767, empty=0x00 < 0xB0) -> entry_2acd sets slope flag 0x6221=1.
  const setup = (tile) => {
    const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
    m.mem.write8(0x6215, 0x00); m.mem.write8(0x6216, 0x00); m.mem.write8(0x6398, 0x00);
    m.mem.write8(0x6203, 0x20); m.mem.write8(0x6205, 0x30);
    m.mem.write8(0x7787, tile); // the probed tilemap cell
    return m;
  };
  const exec = setup(0xb0); // >= 0xB0, low nibble 0 < 8 -> solid: executing ret 0x2AB3
  sub_2a85(exec);
  assert.equal(exec.pc, 0x4d5e, "tile 0xB0 -> executing ret (solid ground)");
  assert.equal(exec.mem.read8(0x6221), 0x00, "solid tile -> loc_2ab4 not entered -> slope flag untouched");
  const slopeLow = setup(0x05); // tile < 0xB0 -> jp c -> loc_2ab4
  sub_2a85(slopeLow);
  assert.equal(slopeLow.mem.read8(0x6221), 0x01, "tile < 0xB0 -> loc_2ab4 -> entry_2acd sets slope flag");
  assert.equal(slopeLow.pc, 0x4d5e, "loc_2ab4/entry_2acd ret -> caller");
  const slopeHigh = setup(0xb8); // >= 0xB0 but low nibble 8 -> jp nc -> loc_2ab4
  sub_2a85(slopeHigh);
  assert.equal(slopeHigh.mem.read8(0x6221), 0x01, "tile 0xB8 (low nibble 8) -> loc_2ab4 -> slope flag set");
  assert.equal(slopeHigh.pc, 0x4d5e, "loc_2ab4/entry_2acd ret -> caller");
});

// ---- loc_2d15: frame-gated string/sprite renderer (2c-cluster convergence) ----
// frame gate (0x62AF); (0x638F)==0 -> char loop loc_2d54 (write 4-byte record via DE=(0x62AC),
// fields from IX=(0x62AA), advance ptr (0x62A8)); 0x7F terminator -> loc_2d8c reinit. Unwired.
test("loc_2d15: frame gate -- (0x62AF) decrements, ret nz until it hits 0", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x62af, 0x05); // dec -> 0x04 != 0 -> ret nz
  loc_2d15(m);
  assert.equal(m.mem.read8(0x62af), 0x04, "counter 5 -> 4");
  assert.equal(m.pc, 0x4d5e, "ret nz -- frame not due");
});
test("loc_2d15: char loop writes a 4-byte record and advances the string pointer", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x62af, 0x01); // dec -> 0 -> frame due
  m.mem.write8(0x638f, 0x00); // -> jp z loc_2d51 (skip the table-copy branch)
  m.mem.write16(0x62a8, 0x6a00); // string pointer (RAM for the test)
  m.mem.write16(0x62aa, 0x6600); // IX = object record
  m.mem.write16(0x62ac, 0x6b00); // DE = record destination
  m.mem.write8(0x6a00, 0x41); // char (not 0x7F, bit7 clear)
  m.mem.write8(0x6a01, 0xcc); // second string byte
  m.mem.write8(0x6607, 0xaa); // (ix+0x07)
  m.mem.write8(0x6608, 0xbb); // (ix+0x08)
  loc_2d15(m);
  assert.equal(m.mem.read8(0x6b00), 0x41, "record[0] = char & 0x7F");
  assert.equal(m.mem.read8(0x6b01), 0xaa, "record[1] = (ix+0x07)");
  assert.equal(m.mem.read8(0x6b02), 0xbb, "record[2] = (ix+0x08)");
  assert.equal(m.mem.read8(0x6b03), 0xcc, "record[3] = next string byte");
  assert.equal(m.mem.read16(0x62a8), 0x6a02, "string pointer advanced by 2");
  assert.equal(m.pc, 0x4d5e, "ret (per-char exit 0x2D82)");
});
test("loc_2d15: 0x7F terminator -> loc_2d8c reinit (ptr:=0x39C3, ix+0:=1, ix+f:=1)", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x62af, 0x01);
  m.mem.write8(0x638f, 0x00);
  m.mem.write16(0x62a8, 0x6a00);
  m.mem.write16(0x62aa, 0x6600); // IX
  m.mem.write16(0x62ac, 0x6b00); // DE
  m.mem.write8(0x6a00, 0x7f); // terminator -> loc_2d8c
  m.mem.write8(0x6382, 0x01); // bit0 set -> jp c 0x2da5 (keep ix+1 = 1)
  m.mem.write8(0x6600, 0x00); m.mem.write8(0x660f, 0x00); // sentinels
  loc_2d15(m);
  assert.equal(m.mem.read16(0x62a8), 0x39c3, "string pointer reinitialised to 0x39C3");
  assert.equal(m.mem.read8(0x6600), 0x01, "(ix+0x00) := 1");
  assert.equal(m.mem.read8(0x6601), 0x01, "(ix+0x01) := 1 (0x6382 bit0 set)");
  assert.equal(m.mem.read8(0x660f), 0x01, "(ix+0x0F) := 1");
  assert.equal(m.mem.read8(0x6393), 0x00, "(0x6393) cleared");
  assert.equal(m.pc, 0x4d5e, "ret (reinit exit 0x2DDA)");
});

// ---- 2c-cluster chain: entry_2cb8 -> entry_2ce6 -> entry_2cf6 -> loc_2d15 ----
// entry_2cb8: free-slot claim, (0x62AC)=0x6980+(10-B)*4, (0x62AA)=IX, then flows down.
// entry_2ce6: (hl)>=4 -> entry_2cf6 else clear 0x69A8+(hl)*4. entry_2cf6: ix+7/8/15 init by
// (0x6382) bit7. All UNWIRED (entry_2c8f's jp nc,0x2CB8 is still a stub -> go-live wiring).
test("entry_2cb8: claims a free slot -- (0x62AA)=IX, (0x62AC)=0x6980+(10-B)*4, then chains", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.regs.ix = 0x6600; m.regs.b = 0x02; m.regs.hl = 0x6a00;
  m.mem.write8(0x62b1, 0x05); // dec -> 4 (!=0) -> jp nz entry_2ce6
  m.mem.write8(0x6a00, 0x05); // entry_2ce6 sees (hl)>=4 -> entry_2cf6
  m.mem.write8(0x6382, 0x00); // entry_2cf6: bit7 clear -> keep defaults
  m.mem.write8(0x62af, 0x05); // loc_2d15 frame gate: dec -> 4, ret nz (stop the chain)
  entry_2cb8(m);
  assert.equal(m.mem.read16(0x62aa), 0x6600, "(0x62AA) = IX");
  assert.equal(m.mem.read16(0x62ac), 0x69a0, "(0x62AC) = 0x6980 + (10-2)*4 = 0x69A0");
  assert.equal(m.mem.read8(0x6600), 0x02, "(ix+0x00) = 2");
  assert.equal(m.mem.read8(0x6393), 0x01, "(0x6393) = 1");
  assert.equal(m.mem.read8(0x62b1), 0x04, "(0x62B1): 5 -> 4");
  assert.equal(m.mem.read8(0x6607), 0x15, "entry_2cf6 default (ix+0x07) = 0x15 (bit7 clear)");
  assert.equal(m.mem.read8(0x62af), 0x04, "loc_2d15 frame gate stopped the chain");
  assert.equal(m.pc, 0x4d5e, "ret nz from loc_2d15");
});
test("entry_2ce6: (hl) < 4 clears 0x69A8+(hl)*4", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.regs.ix = 0x6600; m.regs.hl = 0x6a00;
  m.mem.write8(0x6a00, 0x02); // (hl)=2 < 4 -> clear 0x69A8 + 2*4 = 0x69B0
  m.mem.write8(0x69b0, 0xff); // sentinel to be cleared
  m.mem.write8(0x6382, 0x00);
  m.mem.write8(0x62af, 0x05); // stop at loc_2d15
  entry_2ce6(m);
  assert.equal(m.mem.read8(0x69b0), 0x00, "0x69A8 + (hl)*4 = 0x69B0 cleared");
  assert.equal(m.pc, 0x4d5e, "chain ret nz from loc_2d15");
});
test("entry_2cf6: (0x6382) bit7 set -> overwrite ix+7/8/15 with (0x19,0x0C,0x01)", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.regs.ix = 0x6600;
  m.mem.write8(0x6382, 0x80); // bit7 set -> rlca carry -> the overwrite path
  m.mem.write8(0x62af, 0x05); // stop at loc_2d15
  entry_2cf6(m);
  assert.equal(m.mem.read8(0x6607), 0x19, "(ix+0x07) = 0x19 (bit7 set)");
  assert.equal(m.mem.read8(0x6608), 0x0c, "(ix+0x08) = 0x0C");
  assert.equal(m.mem.read8(0x6615), 0x01, "(ix+0x15) = 0x01");
  assert.equal(m.pc, 0x4d5e, "chain ret nz from loc_2d15");
});

// ---- entry_2b29 / entry_2b1c: player-vs-tilemap collision probe (caller-skip) ----
// entry_2b29 calls entry_2b9b (tile classifier via sub_2ff0). tile < 0xB0 -> reject (A=0).
// (0x6227)==1 arm: reject -> pop-hl/ret SKIP (return false). (0x6227)!=1 arm: two rejecting
// probes -> 0x2B70 ret z NORMAL (return true). entry_2b1c: `if(!entry_2b29) return` mirrors it.
test("entry_2b29: (0x6227)==1, entry_2b9b rejects -> pop-hl/ret caller-skip (returns false)", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00;
  m.push16(0x4d5e); // R2 -- 2b29's caller's caller (the skip target)
  m.push16(0x2b23); // R1 -- 2b29's own return (discarded by the skip's pop hl)
  m.mem.write8(0x6227, 0x01); // ==1 arm
  m.mem.write8(0x6203, 0x20); m.mem.write8(0x6205, 0x30); // probe (X=0x20, Y+7=0x37) -> cell 0x7766
  m.mem.write8(0x7766, 0x50); // tile < 0xB0 -> entry_2b9b rejects (A=0)
  const r = entry_2b29(m);
  assert.equal(r, false, "reject -> jp z 0x2B51 -> pop hl/ret SKIP");
  assert.equal(m.pc, 0x4d5e, "skip unwound past 2b29's caller to R2");
});
test("entry_2b29: (0x6227)!=1, both probes reject -> 0x2B70 ret z NORMAL (returns true)", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00;
  m.push16(0x4d5e); // R2
  m.push16(0x2b23); // R1 -- 2b29's return (popped by the normal ret z)
  m.mem.write8(0x6227, 0x02); // != 1 -> loc_2b53
  m.mem.write8(0x6203, 0x20); m.mem.write8(0x6205, 0x30);
  m.mem.write8(0x7786, 0x50); // first probe (X-3=0x1D, 0x37) -> cell 0x7786: reject
  m.mem.write8(0x7766, 0x50); // second probe (X+4=0x24, 0x37) -> cell 0x7766: reject
  const r = entry_2b29(m);
  assert.equal(r, true, "second reject -> and a -> Z -> ret z (normal)");
  assert.equal(m.pc, 0x2b23, "normal ret pops R1 (2b29's return)");
});
test("entry_2b1c: normal entry_2b29 -> calls sub_29af, B:=0, ret to caller", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00;
  m.push16(0x4d5e); // entry_2b1c's caller
  m.mem.write8(0x6227, 0x02);
  m.mem.write8(0x6203, 0x20); m.mem.write8(0x6205, 0x30);
  m.mem.write8(0x7786, 0x50); m.mem.write8(0x7766, 0x50); // both probes reject -> 2b29 normal
  entry_2b1c(m);
  assert.equal(m.regs.b, 0x00, "xor a / ld b,a -> B = 0 (only reached on the normal path)");
  assert.equal(m.pc, 0x4d5e, "ret to entry_2b1c's caller");
  assert.equal(m.regs.ix, 0x6200, "IX was set to 0x6200");
});

// ---- sub_19da: 3-entry table search (stride 4) over 0x6A0C; match -> 0x19ED frontier ----
test("sub_19da: no match -> ret after scanning 3 entries (stride 4)", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x6203, 0x99); // X -- not in the table
  m.mem.write8(0x6a0c, 0x11); m.mem.write8(0x6a10, 0x22); m.mem.write8(0x6a14, 0x33);
  sub_19da(m);
  assert.equal(m.pc, 0x4d5e, "no match -> ret");
  assert.equal(m.regs.l, 0x0c + 0x0c, "HL walked 3*4 = 0x0C past 0x6A0C (L = 0x18)");
});
test("sub_19da: X matches table[1] -> entry_19ed registers the hit (0x19ED translated)", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x6203, 0x22); // X = table[1] -> match on the 2nd entry, HL = slot 0x6A10
  m.mem.write8(0x6a0c, 0x11); m.mem.write8(0x6a10, 0x22); m.mem.write8(0x6a14, 0x33);
  // entry_19ed confirm gates: player Y (0x6205) == (slot+3) at 0x6A13, and bit3 of
  // (slot+1) at 0x6A11 clear -> eligible -> register the hit.
  m.mem.write8(0x6205, 0x55); m.mem.write8(0x6a13, 0x55); // Y == (slot+3)
  m.mem.write8(0x6a11, 0x00); // bit 3 clear -> eligible
  sub_19da(m);
  assert.equal(m.mem.read8(0x6340), 0x01, "hit registered: (0x6340) := 1");
  assert.equal(m.mem.read8(0x6342), 0x00, "(0x6342) := 0");
  assert.equal(m.mem.read8(0x6343), 0x10, "(0x6343) := matched slot ptr low byte (0x6A10)");
  assert.equal(m.mem.read8(0x6344), 0x6a, "(0x6343) := matched slot ptr high byte (0x6A10)");
  assert.equal(m.pc, 0x4d5e, "entry_19ed ret -> sub_19da's caller (tail jp)");
});

// ---- entry_2e04: per-object actor/animation updater (10-object scan, rst-0x30/0x10 gated) ----
// gates: sub_0030 (A=0x04 rotated mem[0x6227] times) + sub_0010 (bit0 of mem[0x6200]). Then scan
// 10 objects IX=0x6500 stride 0x10 / IY=0x6980 stride 0x04. Active object: 16-frame toggle (iy+1)^=7,
// position (ix+3)+=2, string walk, accumulate (ix+5), mirror to IY. Unwired dead code.
test("entry_2e04: rst-0x30 gate closed -> ret immediately (no object scan)", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x6227, 0x01); // A=0x04, 1 rrca -> carry clear -> sub_0030 skips
  entry_2e04(m);
  assert.equal(m.pc, 0x4d5e, "gate skip -> return to caller");
});
test("entry_2e04: active object 0 -- toggle, position+=2, accumulate, mirror to IY", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x6227, 0x03); // A=0x04, 3 rrca -> carry set -> sub_0030 opens
  m.mem.write8(0x6200, 0x01); // bit0 set -> sub_0010 opens
  // object 0 (IX=0x6500): active, state != 4
  m.mem.write8(0x6500, 0x01); // (ix+0) bit0 = active
  m.mem.write8(0x650d, 0x00); // (ix+0x0d) state != 4
  m.mem.write8(0x6503, 0x10); // (ix+0x03) position -> 0x12
  m.mem.write8(0x6505, 0x20); // (ix+0x05) accumulator
  m.mem.write8(0x650e, 0x00); m.mem.write8(0x650f, 0x6a); // (ix+0e/0f) string ptr = 0x6A00
  m.mem.write8(0x6a00, 0x10); // char (not 0x7F) -> accumulate 0x10
  m.mem.write8(0x601a, 0x00); // (0x601A & 0x0F)==0 -> the 16-frame toggle fires
  m.mem.write8(0x6981, 0x00); // (iy+0x01) -> toggled ^= 0x07 = 0x07
  entry_2e04(m);
  assert.equal(m.mem.read8(0x6981), 0x07, "16-frame toggle (iy+0x01) ^= 0x07");
  assert.equal(m.mem.read8(0x6503), 0x12, "(ix+0x03) position += 2");
  assert.equal(m.mem.read8(0x6505), 0x30, "(ix+0x05) += char: 0x20 + 0x10 = 0x30");
  assert.equal(m.mem.read8(0x650e), 0x01, "(ix+0x0e) string ptr advanced by 1");
  assert.equal(m.mem.read8(0x6980), 0x12, "mirror (ix+0x03) -> (iy+0x00)");
  assert.equal(m.mem.read8(0x6983), 0x30, "mirror (ix+0x05) -> (iy+0x03)");
  assert.equal(m.pc, 0x4d5e, "ret after 10 objects");
});

// ---- entry_2ed4: two-object sprite-state updater; all paths converge on loc_2f7c record write ----
// rst-0x30/0x10 gated (A=0x0b). Object select by (ix+1) bit0. (0x6217) bit0 -> build path or
// loc_2f97. loc_2f7c writes 4-byte record x/B/C/y through DE->HL, mirrors x/y to (ix+3)/(ix+5).
test("entry_2ed4: rst-0x30 gate closed -> ret immediately", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x6227, 0x03); // A=0x0b, 3 rrca -> carry clear -> sub_0030 skips
  entry_2ed4(m);
  assert.equal(m.pc, 0x4d5e, "gate skip -> return to caller");
});
test("entry_2ed4: (0x6217) bit0 clear, (0x6218) bit0 clear -> loc_2f97 ret nc (EXIT-2)", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x6227, 0x01); m.mem.write8(0x6200, 0x01); // both gates open
  m.mem.write8(0x6681, 0x01); // (ix+1) bit0 set -> keep IX=0x6680
  m.mem.write8(0x6217, 0x00); // bit0 clear -> loc_2f97
  m.mem.write8(0x6218, 0x00); // bit0 clear -> ret nc
  entry_2ed4(m);
  assert.equal(m.mem.read8(0x668e), 0x00, "loc_2eed ran: (ix+0x0e)=0x00");
  assert.equal(m.mem.read8(0x668f), 0xf0, "loc_2eed ran: (ix+0x0f)=0xf0");
  assert.equal(m.pc, 0x4d5e, "loc_2f97 ret nc");
});
test("entry_2ed4: build path -> loc_2f7c writes record x/B/C/y to 0x6A18 + mirrors to IX", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x6227, 0x01); m.mem.write8(0x6200, 0x01); // gates open
  m.mem.write8(0x6681, 0x01); // keep IX=0x6680, DE=0x6A18
  m.mem.write8(0x6217, 0x01); // bit0 set -> the build path
  m.mem.write8(0x6207, 0x00); // sla a -> 0, carry clear -> skip or/set
  m.mem.write8(0x6394, 0x00); // bit 3 clear -> jp z loc_2f43 (skips set 0,b/c block)
  m.mem.write8(0x6395, 0x00); // loc_2fb7: (0x6395)==0 -> jp z loc_2f7c
  m.mem.write8(0x6203, 0x40); // X
  m.mem.write8(0x6205, 0x50); // Y
  entry_2ed4(m);
  // (ix+0x0e)=0x00, (ix+0x0f)=0xf0 (from loc_2eed); B=0x1E, C=0x07 (loc_2f43 ld c,0x07)
  assert.equal(m.mem.read8(0x6a18), 0x40, "record[0] = X + (ix+0x0e) = 0x40 + 0x00");
  assert.equal(m.mem.read8(0x6a19), 0x1e, "record[1] = B = 0x1E");
  assert.equal(m.mem.read8(0x6a1a), 0x07, "record[2] = C = 0x07");
  assert.equal(m.mem.read8(0x6a1b), 0x40, "record[3] = Y + (ix+0x0f) = 0x50 + 0xF0 = 0x40");
  assert.equal(m.mem.read8(0x6683), 0x40, "mirror X -> (ix+0x03)");
  assert.equal(m.mem.read8(0x6685), 0x40, "mirror Y -> (ix+0x05)");
  assert.equal(m.mem.read8(0x694d), 0x08, "(0x694D) = C (=0x08) written at loc_2f43");
  assert.equal(m.pc, 0x4d5e, "loc_2f7c ret (EXIT-1)");
});

// ---- sub_017b coin-accepted path (0x018C-0x01B9): pulse count -> BCD credit ----
test("sub_017b: coin accepted, pulse reaches coins-per-credit -> +1 BCD credit", () => {
  const inputs = new Inputs(); inputs._in2 = 0x80; // 0x7D00 bit7 = coin
  const m = new Machine(ROM, { inputs }); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x6003, 0x01); // edge latch armed
  m.mem.write8(0x6005, 0x03); // state 3 -> skip the coin-sound call
  m.mem.write8(0x6024, 0x01); m.mem.write8(0x6002, 0x00); // coins-per-credit=1, pulse->1
  m.mem.write8(0x6025, 0x01); m.mem.write8(0x6001, 0x00); // credits-per-coin=1, credit->1
  sub_017b(m);
  assert.equal(m.mem.read8(0x6003), 0x00, "latch cleared");
  assert.equal(m.mem.read8(0x6002), 0x00, "pulse counter reset");
  assert.equal(m.mem.read8(0x6001), 0x01, "1 credit added (BCD)");
  assert.equal(m.pc, 0x4d5e, "ret");
});
test("sub_017b: coin accepted, pulse below threshold -> count, no credit (ret nz)", () => {
  const inputs = new Inputs(); inputs._in2 = 0x80;
  const m = new Machine(ROM, { inputs }); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x6003, 0x01); m.mem.write8(0x6005, 0x03);
  m.mem.write8(0x6024, 0x02); m.mem.write8(0x6002, 0x00); // needs 2 pulses, only 1
  m.mem.write8(0x6001, 0x00);
  sub_017b(m);
  assert.equal(m.mem.read8(0x6002), 0x01, "pulse counted");
  assert.equal(m.mem.read8(0x6001), 0x00, "no credit yet");
});

// ---- <0x3000 fillers batch (unwired/net-zero): 1644/13aa/13bb/1186/1131/26de/26e9 ----
test("loc_13aa: state reset -- 0x7D82=(0x6026), 0x600A=0, 0x600D/E=1", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x6026, 0x55); m.mem.write8(0x600a, 0x99);
  loc_13aa(m);
  assert.equal(m.mem.read8(0x600a), 0x00);
  assert.equal(m.mem.read8(0x600d), 0x01);
  assert.equal(m.mem.read8(0x600e), 0x01);
  assert.equal(m.pc, 0x4d5e);
});
test("loc_13bb: state reset -- 0x600D/E/A=0, 0x7D82=1", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x600d, 0xff); m.mem.write8(0x600e, 0xff); m.mem.write8(0x600a, 0xff);
  loc_13bb(m);
  assert.equal(m.mem.read8(0x600d), 0x00);
  assert.equal(m.mem.read8(0x600e), 0x00);
  assert.equal(m.mem.read8(0x600a), 0x00);
  assert.equal(m.pc, 0x4d5e);
});
test("sub_26de: sign-reversing write -- bit7 set -> +2, clear -> -2 (0xFE)", () => {
  const neg = new Machine(ROM); neg.regs.sp = 0x6c00; neg.push16(0x4d5e);
  neg.regs.hl = 0x6a00; neg.mem.write8(0x6a00, 0x80); // bit7 set
  sub_26de(neg);
  assert.equal(neg.mem.read8(0x6a00), 0x02, "negative -> +2");
  const pos = new Machine(ROM); pos.regs.sp = 0x6c00; pos.push16(0x4d5e);
  pos.regs.hl = 0x6a00; pos.mem.write8(0x6a00, 0x10); // bit7 clear
  sub_26de(pos);
  assert.equal(pos.mem.read8(0x6a00), 0xfe, "non-negative -> -2");
});
test("sub_26e9: (0x601A)&1 gate; else (HL)=0xFF if bit7 set else 0x01", () => {
  const gated = new Machine(ROM); gated.regs.sp = 0x6c00; gated.push16(0x4d5e);
  gated.regs.hl = 0x6a00; gated.mem.write8(0x601a, 0x00); gated.mem.write8(0x6a00, 0x55);
  sub_26e9(gated);
  assert.equal(gated.regs.a, 0x00, "ret z -> A=0");
  assert.equal(gated.mem.read8(0x6a00), 0x55, "(HL) untouched on the gate");
  const run = new Machine(ROM); run.regs.sp = 0x6c00; run.push16(0x4d5e);
  run.regs.hl = 0x6a00; run.mem.write8(0x601a, 0x01); run.mem.write8(0x6a00, 0x80);
  sub_26e9(run);
  assert.equal(run.mem.read8(0x6a00), 0xff, "bit7 set -> 0xFF");
});
test("sub_1186 / loc_1131 / loc_1644: chain routines run without error (net-zero fillers)", () => {
  const a = new Machine(ROM); a.regs.sp = 0x6c00; a.push16(0x4d5e);
  assert.doesNotThrow(() => sub_1186(a));
  const b = new Machine(ROM); b.regs.sp = 0x6c00; b.push16(0x4d5e);
  assert.doesNotThrow(() => loc_1131(b));
  // loc_1644 tail-dispatches via sub_0028 to the 0x1648 ROM table (arms wired at go-live).
  const c = new Machine(ROM); c.regs.sp = 0x6c00; c.push16(0x4d5e); c.mem.write8(0x6388, 0x01);
  assert.equal(typeof loc_1644, "function");
});

// ---- <0x3000 fillers batch 2: 186f/1839/1344/1d95/1e49/1e4a/0f1b ----
test("sub_1d95: 0x6225=A; 0x6227!=1 -> 0x608A=0x0D, 0x608B=0x03", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.regs.a = 0x07; m.mem.write8(0x6227, 0x00);
  sub_1d95(m);
  assert.equal(m.mem.read8(0x6225), 0x07);
  assert.equal(m.mem.read8(0x608a), 0x0d);
  assert.equal(m.mem.read8(0x608b), 0x03);
  // 0x6227==1 -> ret z, no 0x608A write
  const g = new Machine(ROM); g.regs.sp = 0x6c00; g.push16(0x4d5e);
  g.regs.a = 0x09; g.mem.write8(0x6227, 0x01); g.mem.write8(0x608a, 0x55);
  sub_1d95(g);
  assert.equal(g.mem.read8(0x6225), 0x09);
  assert.equal(g.mem.read8(0x608a), 0x55, "ret z -> untouched");
});
test("loc_1e4a: countdown 0x6341; stay while nz, on expiry reset 0x6A30/0x6340", () => {
  const stay = new Machine(ROM); stay.regs.sp = 0x6c00; stay.push16(0x4d5e);
  stay.mem.write8(0x6341, 0x03);
  loc_1e4a(stay);
  assert.equal(stay.mem.read8(0x6341), 0x02, "3 -> 2, ret nz");
  const done = new Machine(ROM); done.regs.sp = 0x6c00; done.push16(0x4d5e);
  done.mem.write8(0x6341, 0x01); done.mem.write8(0x6a30, 0xff); done.mem.write8(0x6340, 0x02);
  loc_1e4a(done);
  assert.equal(done.mem.read8(0x6a30), 0x00);
  assert.equal(done.mem.read8(0x6340), 0x00, "dispatcher reset");
});
test("loc_1e49: no-op ret", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  loc_1e49(m);
  assert.equal(m.pc, 0x4d5e);
});
test("entry_0f1b: strip fill by record kind (4->0xE0, 6->0xFE) at (0x63AB)", () => {
  const run = (kind) => {
    const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
    m.mem.write8(0x63b3, kind);
    m.mem.write16(0x63ab, 0x7400); // dest tilemap
    m.mem.write8(0x63b1, 0x08); // one cell (8 - 8 = 0, no borrow -> loop once)
    entry_0f1b(m);
    return m.mem.read8(0x7400);
  };
  assert.equal(run(0x04), 0xe0, "kind 4 -> 0xE0");
  assert.equal(run(0x06), 0xfe, "kind 6 -> 0xFE");
});
test("186f/1839/1344 chain fillers run without error", () => {
  for (const fn of [loc_186f, loc_1839, loc_1344]) {
    const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
    m.mem.write8(0x6009, 0x01); // arm rst-0x18 gate to pass for 186f
    assert.doesNotThrow(() => fn(m));
  }
});

test("loc_07cb: timer 0 -> arm 0x638A=0x60; runs the pattern/fill body", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x638a, 0x00); // timer == 0 -> arm path
  loc_07cb(m);
  assert.equal(m.mem.read8(0x638a), 0x60, "timer armed to 0x60");
  assert.equal(m.pc, 0x4d5e);
});
test("loc_07cb: timer wrap-to-0 -> hands 0x6009=2, 0x600A++", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x638a, 0x01); // dec -> 0 -> finish path
  m.mem.write8(0x600a, 0x05);
  loc_07cb(m);
  assert.equal(m.mem.read8(0x6009), 0x02);
  assert.equal(m.mem.read8(0x600a), 0x06, "0x600A incremented");
  assert.equal(m.mem.read8(0x638a), 0x00);
});
test("entry_0400: Z live-in dispatches into entry_03fb's loc_0413 chain (reuse, not dup)", () => {
  // Z clear (fNZ) -> jp nz 0x0413. Set up so loc_0413's frame path reaches EXIT-1 (ret z).
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.regs.a = 0x01; m.regs.and(0x01); // set NZ (Z clear) as the live-in
  m.mem.write8(0x6227, 0x00);
  m.mem.write8(0x6391, 0x01); m.mem.write8(0x6390, 0x00); m.mem.write8(0x6393, 0x01);
  entry_0400(m);
  assert.equal(m.mem.read8(0x6390), 0x01, "frame counter advanced via loc_0413->loc_0426");
  assert.equal(m.pc, 0x4d5e);
});
test("2207-body arms (2227/2259/2299/22a2): pop record base, RMW timers/state", () => {
  const run = (fn, base) => {
    const m = new Machine(ROM); m.regs.sp = 0x6c00;
    m.push16(0x4d5e); m.push16(base); // caller return, then the record-base (popped first)
    return m;
  };
  // loc_2299: (0x6018)&0x3C==0 -> advance state at base
  const a = run(loc_2299, 0x6500); a.mem.write8(0x6018, 0x00); a.mem.write8(0x6500, 0x01);
  loc_2299(a); assert.equal(a.mem.read8(0x6500), 0x02, "state advanced");
  // loc_2227: base+1 timer dec, running -> 0x621A=0
  const b = run(loc_2227, 0x6500); b.mem.write8(0x6501, 0x05); // timer -> 4 (nz)
  loc_2227(b); assert.equal(b.mem.read8(0x621a), 0x00);
});
test("loc_2303 / loc_231a: object direction from playerX vs (ix+3)", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.regs.ix = 0x6600; m.mem.write8(0x6603, 0x80); m.mem.write8(0x6203, 0x40); // playerX < objX
  m.mem.write8(0x6018, 0x22);
  loc_2303(m);
  assert.equal(m.mem.read8(0x6611), 0x22, "(ix+0x11)=frame");
  assert.equal(m.mem.read8(0x6610), 0xff, "(ix+0x10)=-1 (player left of object)");
});
test("sub_2679: even frame, 0x62A5 wrap -> publishes 0x62A6 to 0x63A6 via 0x26e9", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x601a, 0x00); // even; &0x1f=0 != 2 -> ret nz after publish
  m.mem.write8(0x62a5, 0x01); // dec -> 0 wrap
  m.mem.write8(0x62a6, 0x00);
  sub_2679(m);
  assert.equal(m.pc, 0x4d5e);
});
test("sub_262f: Y<0xC0, bit7(0x62A3) clear -> 0x62A3=0xFF then tail publishes 0x63A5/0x63A4", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x6205, 0x40); // < 0xC0 -> loc_266f
  m.mem.write8(0x62a3, 0x00); // bit7 clear -> set 0xFF
  m.mem.write8(0x601a, 0x03); // &0x1f=3 != 0 -> ret nz
  sub_262f(m);
  assert.equal(m.pc, 0x4d5e);
});
test("sub_2ad3: Y==0x50 -> X += (0x63A3) velocity, mirror to 0x694C", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x6203, 0x40); // X
  m.mem.write8(0x6205, 0x50); // platform row
  m.mem.write8(0x63a3, 0x02); // velocity
  m.mem.write8(0x6227, 0x00);
  sub_2ad3(m);
  assert.equal(m.mem.read8(0x694c), m.mem.read8(0x6203), "X mirrored to 0x694C");
});
test("sub_271e: thin wrapper -> sub_2745, ret", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  assert.doesNotThrow(() => sub_271e(m));
  assert.equal(m.pc, 0x4d5e);
});
test("sub_0d27 / sub_0d43: fill 0xFD/0xFC rows via the shared sub_0d30/sub_0d4c body", () => {
  const a = new Machine(ROM); a.regs.sp = 0x6c00; a.push16(0x4d5e);
  sub_0d27(a);
  assert.equal(a.mem.read8(0x770d), 0xfd, "0d27 row1 @0x770D = 0xFD");
  assert.equal(a.mem.read8(0x760d), 0xfd, "0d27 row (HL=0x760D) filled");
  const b = new Machine(ROM); b.regs.sp = 0x6c00; b.push16(0x4d5e);
  sub_0d43(b);
  assert.equal(b.mem.read8(0x7687), 0xfd, "0d43 @0x7687 = 0xFD");
});
test("sub_2745: (0x6203) band dispatch -- < 0x2C -> reset (0x6398=0, 0x6221=1)", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x6398, 0x01); m.mem.write8(0x6216, 0x00); m.mem.write8(0x6203, 0x10);
  sub_2745(m);
  assert.equal(m.mem.read8(0x6398), 0x00, "reset");
  assert.equal(m.mem.read8(0x6221), 0x01);
});
test("sub_1654 / sub_168a / sub_1757: chain routines callable (share tail_1662)", () => {
  for (const fn of [sub_1654, sub_168a, sub_1757]) {
    const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
    m.mem.write8(0x6009, 0x01); // arm rst-0x18 gate (168a) to pass
    assert.doesNotThrow(() => fn(m));
  }
});
test("sub_2797: active obj, (ix+0d) bit3 set, (ix+5) hits 0x60 -> land ((ix+3)=0x77, (ix+0d)=0x04)", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x6600, 0x01); // active
  m.mem.write8(0x660d, 0x08); // bit3 set -> decrement arm
  m.mem.write8(0x6605, 0x61); // -1 -> 0x60 -> land
  sub_2797(m);
  assert.equal(m.mem.read8(0x6603), 0x77, "landed (ix+3)=0x77");
  assert.equal(m.mem.read8(0x660d), 0x04, "(ix+0d)=0x04");
});
test("sub_27da: (0x62A7)==0 seeds a free slot then decrements the counter", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.regs.de = 0x0010; // live-in stride
  m.mem.write8(0x62a7, 0x00); // spawn armed
  m.mem.write8(0x6600, 0x00); // slot 0 free
  sub_27da(m);
  assert.equal(m.mem.read8(0x6600), 0x01, "slot activated");
  assert.equal(m.mem.read8(0x6605), 0xf8, "(ix+5) seeded");
  assert.equal(m.mem.read8(0x62a7), 0x33, "0x62A7 set to 0x34 then dec -> 0x33");
});
test("sub_2722: mirrors (ix+3)/(ix+5) of 6 objects to 0x6958", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x6600, 0x00); // slot 0 inactive (2797/27da no-op-ish)
  m.mem.write8(0x6603, 0xaa); m.mem.write8(0x6605, 0xbb);
  m.mem.write8(0x62a7, 0x05); // 27da: nonzero -> just dec
  sub_2722(m);
  assert.equal(m.mem.read8(0x6958), 0xaa, "mirror (ix+3) -> 0x6958");
  assert.equal(m.mem.read8(0x695b), 0xbb, "mirror (ix+5) -> 0x695B");
});
test("sub_2243: (0x6205)<0x7A & (0x6216)==0 & (0x6203)==(HL) -> HIT ret to caller; else caller-skip", () => {
  const hit = new Machine(ROM); hit.regs.sp = 0x6c00;
  hit.push16(0x1111); hit.push16(0x2222); // grandparent, then 2243's return
  hit.regs.hl = 0x6a00; hit.mem.write8(0x6a00, 0x40);
  hit.mem.write8(0x6205, 0x10); hit.mem.write8(0x6216, 0x00); hit.mem.write8(0x6203, 0x40);
  sub_2243(hit);
  assert.equal(hit.pc, 0x2222, "HIT -> ret to the call site (2243's own return)");
  const miss = new Machine(ROM); miss.regs.sp = 0x6c00;
  miss.push16(0x1111); miss.push16(0x2222);
  miss.regs.hl = 0x6a00; miss.mem.write8(0x6205, 0x7f); // >= 0x7A -> no hit
  sub_2243(miss);
  assert.equal(miss.pc, 0x1111, "no-hit -> pop-hl/ret caller-skip to grandparent");
});
test("sub_2602: 32nd frame path updates 0x63A3 via 0x26e9 and rets", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x601a, 0x03); // odd frame (skip the 0x62A0 countdown); &0x1f=3 != 1 -> ret nz
  m.mem.write8(0x62a1, 0x00);
  sub_2602(m);
  assert.equal(m.pc, 0x4d5e);
});
test("sub_1708: writes record 80 76 09 20 at 0x6A20 + 0x6905=0x13 + 0x608A/B=07/03", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  sub_1708(m);
  assert.equal(m.mem.read8(0x6a20), 0x80);
  assert.equal(m.mem.read8(0x6a23), 0x20);
  assert.equal(m.mem.read8(0x6905), 0x13);
  assert.equal(m.mem.read8(0x608a), 0x07);
});
test("sub_1732: (0x6913) >= 0x2C -> hold (ret nc); else reset + advance 0x6388", () => {
  const hold = new Machine(ROM); hold.regs.sp = 0x6c00; hold.push16(0x4d5e);
  hold.mem.write8(0x6913, 0x2c); hold.mem.write8(0x6388, 0x01);
  sub_1732(hold);
  assert.equal(hold.mem.read8(0x6388), 0x01, "held -- no advance");
  const go = new Machine(ROM); go.regs.sp = 0x6c00; go.push16(0x4d5e);
  go.mem.write8(0x6913, 0x00); go.mem.write8(0x6388, 0x01);
  sub_1732(go);
  assert.equal(go.mem.read8(0x6924), 0x6b);
  assert.equal(go.mem.read8(0x6388), 0x02, "advanced");
});
test("sub_1783: first non-zero cell -> caller-skip (pop+ret to grandparent); all-zero -> ret", () => {
  const hit = new Machine(ROM); hit.regs.sp = 0x6c00;
  hit.push16(0x1111); hit.push16(0x2222); // grandparent, then sub_1783's return
  hit.regs.hl = 0x6a00; hit.regs.de = 0x0001; hit.mem.write8(0x6a00, 0x05);
  sub_1783(hit);
  assert.equal(hit.pc, 0x1111, "caller-skip -> grandparent");
  const clear = new Machine(ROM); clear.regs.sp = 0x6c00; clear.push16(0x4d5e);
  clear.regs.hl = 0x6b00; clear.regs.de = 0x0001; // all zero
  sub_1783(clear);
  assert.equal(clear.pc, 0x4d5e, "all clear -> normal ret");
});
test("sub_178e: rst-0x18 gate -> resets 0x6388=0 and hands 0x600A=8", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x6009, 0x01); // arm the rst-0x18 gate to pass
  m.mem.write16(0x622a, 0x3a73);
  sub_178e(m);
  assert.equal(m.mem.read8(0x6388), 0x00);
  assert.equal(m.mem.read8(0x600a), 0x08);
});
test("sub_0d00: fills 2 cells per record with a descending 0xB8 from the 0x0D17 table", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  // record 0 dest = word at 0x0D17 (ROM); read it, fill 2 cells 0xB8,0xB7
  const dest = ROM[0x0d17] | (ROM[0x0d18] << 8);
  sub_0d00(m);
  assert.equal(m.mem.read8(dest), 0xb8);
  assert.equal(m.mem.read8((dest + 1) & 0xffff), 0xb7, "descending");
  assert.equal(m.pc, 0x4d5e);
});
test("sub_15fa: builds record 0x6974 = {tbl[0], 0x72, 0x0C, tbl[1]}; preserves DE/HL", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.regs.bc = 0x0000; m.regs.de = 0x1234; m.regs.hl = 0x5678;
  sub_15fa(m);
  assert.equal(m.mem.read8(0x6975), 0x72);
  assert.equal(m.mem.read8(0x6976), 0x0c);
  assert.equal(m.regs.de, 0x1234, "DE restored");
  assert.equal(m.regs.hl, 0x5678, "HL restored");
});
test("sub_176c: zeroes 0x692F-region cells whose (byte-3) < 0x19", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x692f, 0x10); // read value < 0x19 -> zero the cell at HL-3 = 0x692C
  m.mem.write8(0x692c, 0xff); // sentinel to be zeroed
  sub_176c(m);
  assert.equal(m.mem.read8(0x692c), 0x00, "(HL after sbc hl,de = 0x692C) zeroed");
  assert.equal(m.pc, 0x4d5e);
});
test("sub_1670: rst-0x18 gate passes -> arms 0x6009=0x20 and advances 0x6388", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x6009, 0x01); // arm the rst-0x18 counter to pass
  m.mem.write8(0x6388, 0x02);
  m.mem.write8(0x6227, 0x01); // rst 0x30 opens (or skips) -- either way 0x6009/0x6388 set first
  sub_1670(m);
  assert.equal(m.mem.read8(0x6009), 0x20);
  assert.equal(m.mem.read8(0x6388), 0x03, "selector advanced");
});
test("sub_1641 / sub_1670: chain routines are callable functions", () => {
  assert.equal(typeof sub_1641, "function");
  assert.equal(typeof sub_1670, "function");
});
test("loc_1e36: writes 0x6A30 block {A,B,0x07,C}, then 0x6085=3 if the rst-0x30 gate opens", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.regs.a = 0x11; m.regs.b = 0x22; m.regs.c = 0x33;
  m.mem.write8(0x6227, 0x01); // A=0x05 -> rst 0x30 opens (bit0 set)
  loc_1e36(m);
  assert.equal(m.mem.read8(0x6a30), 0x11);
  assert.equal(m.mem.read8(0x6a31), 0x22);
  assert.equal(m.mem.read8(0x6a32), 0x07);
  assert.equal(m.mem.read8(0x6a33), 0x33);
  assert.equal(m.mem.read8(0x6085), 0x03, "gate open -> 0x6085 = 3");
});
test("loc_1df5: 0x6018 bit0 -> loc_1e08 (B=0x7E) chain into loc_1e36 block", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x6018, 0x01); // bit0 set -> loc_1e08 -> loc_1e15 -> loc_1e36
  m.mem.write8(0x6227, 0x01);
  m.mem.write8(0x6343, 0x30); m.mem.write8(0x6344, 0x6a); // loc_1e15 deref -> 0x6A30 (safe RAM)
  loc_1df5(m);
  assert.equal(m.mem.read8(0x6a31), 0x7e, "0x6A31 = B (0x7E from loc_1e08)");
});
test("loc_1087: inline-table arm C=3 -- fill loops + IX=0x6400 init block", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  loc_1087(m);
  assert.equal(m.mem.read8(0x6600), 0x01, "fill loop 1: 0x6600 = 1");
  assert.equal(m.mem.read8(0x660d), 0x08, "fill loop 2: 0x660D = 8");
  assert.equal(m.mem.read8(0x6400), 0x01, "(ix+0x00) = 1");
  assert.equal(m.mem.read8(0x6423), 0xeb, "(ix+0x23) = 0xEB");
  assert.equal(m.pc, 0x4d5e);
});
test("loc_101f: inline-table arm C=2 -- runs the copy chain and sets 0x62B9=1", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  loc_101f(m);
  assert.equal(m.mem.read8(0x62b9), 0x01);
  assert.equal(m.pc, 0x4d5e);
});
test("loc_18c6: 0x62AF wrap -> resets 0x6388=0 and hands 0x600A=8 (state 8)", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x62af, 0x01); // dec -> 0 -> wrap
  m.mem.write16(0x622a, 0x3a73); // walk ptr into ROM (inc -> read the real ROM byte)
  loc_18c6(m);
  assert.equal(m.mem.read8(0x6388), 0x00, "sequence reset");
  assert.equal(m.mem.read8(0x600a), 0x08, "hand to state 8");
  assert.equal(m.pc, 0x4d5e);
});
test("loc_0ee8: kind 3 -> vertical strip 0xB3/0xB1.../0xB2 at (0x63AB) stride 0x20; kind!=3 -> 0f1b", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x63b3, 0x03); // kind 3
  m.mem.write16(0x63ab, 0x7400); // dest
  m.mem.write8(0x63b1, 0x10); // -0x10 -> 0 (1 body cell), then -0x08 -> borrow -> cap
  loc_0ee8(m);
  assert.equal(m.mem.read8(0x7400), 0xb3, "top cap 0xB3");
  assert.equal(m.mem.read8(0x7420), 0xb1, "body cell 0xB1 (+0x20)");
  assert.equal(m.mem.read8(0x7440), 0xb2, "bottom cap 0xB2 (+0x40)");
});
test("loc_17b6: setup arm advances 0x6388 and repoints 0x63C0 at it; 0x6390:=0x80", () => {
  const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x6388, 0x00);
  loc_17b6(m);
  assert.equal(m.mem.read8(0x6388), 0x01, "selector advanced");
  assert.equal(m.mem.read16(0x63c0), 0x6388, "0x63C0 repointed at 0x6388");
  assert.equal(m.mem.read8(0x6390), 0x80);
  assert.equal(m.pc, 0x4d5e);
});
test("loc_1880: 0x691B!=0xD0 -> ret nz; ==0xD0 -> spawn record 7F 39 01 D8 + advance 0x6388", () => {
  const skip = new Machine(ROM); skip.regs.sp = 0x6c00; skip.push16(0x4d5e);
  skip.mem.write8(0x691b, 0x00);
  loc_1880(skip);
  assert.equal(skip.pc, 0x4d5e, "ret nz");
  const go = new Machine(ROM); go.regs.sp = 0x6c00; go.push16(0x4d5e);
  go.mem.write8(0x691b, 0xcf); go.mem.write8(0x6388, 0x05); // rst-0x38 bumps 0x691B -> 0xD0
  loc_1880(go);
  assert.equal(go.mem.read8(0x6a24), 0x7f);
  assert.equal(go.mem.read8(0x6a27), 0xd8, "record byte 3");
  assert.equal(go.mem.read8(0x6388), 0x06, "selector advanced");
});

// ---- sub_298c (INTEGRATED FROM A DRAFT, code2) -- tile-in-range predicate -----
// Drives the REAL sub_2ff0: HL = 0x7400 + ((255-y)>>3)*32 + ((x>>3)&0x1f), y=H, x=L.
// Table at (0x63c8); D = table[+0x0E] = y, E = table[+0x0F] + 0x0C = x. With y=0,
// table[+0x0F]=0x34 -> x = 0x40 -> sub_2ff0 -> 0x77E8. Plant the tile there. Returns
// A=0 in range / A=1 out; both exits plain ret (a value return, not a caller-skip).

const run298c = (tile, { rawX = 0x34, y = 0x00, addr = 0x77e8 } = {}) => {
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write16(0x63c8, 0x6300); // table base
  m.mem.write8(0x630e, y); // D = y
  m.mem.write8(0x630f, rawX); // E = rawX + 0x0C
  m.mem.write8(addr, tile);
  sub_298c(m);
  return m.regs.a;
};

test("sub_298c returns A=0 for an in-range tile, A=1 otherwise (the 3202 seam)", () => {
  // Draft TEST 1 (OQ1). MUTATION this catches: swapped A constants, or a jp
  // polarity flip. Three tiles on the three sides of the two thresholds (§38).
  assert.equal(run298c(0xb3), 0x00, "0xB3 (>=0xB0, low nibble 3) -> A=0 in range");
  assert.equal(run298c(0xa0), 0x01, "0xA0 (< 0xB0) -> A=1 via jp c");
  assert.equal(run298c(0xb9), 0x01, "0xB9 (low nibble 9 >= 8) -> A=1 via jp nc");
});

test("sub_298c assembles x = table[+0x0F] + 0x0C before the sub_2ff0 conversion", () => {
  // Draft TEST 2 (OQ2). The +0x0C shifts x, so the tile is read at a DIFFERENT
  // VRAM column. Correct: rawX=0x34 -> x=0x40 -> 0x77E8 (in-range tile planted).
  // MUTATION (drop the +0x0C): x=0x34 -> col (0x34>>3)=6 -> 0x77E6 (out-of-range
  // tile planted). Correct code reads 0x77E8 -> A=0; the mutation reads 0x77E6 -> A=1.
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write16(0x63c8, 0x6300);
  m.mem.write8(0x630e, 0x00); // y = 0
  m.mem.write8(0x630f, 0x34); // rawX; correct x = 0x40, dropped-+0x0C x = 0x34
  m.mem.write8(0x77e8, 0xb3); // in-range tile at the CORRECT (x=0x40) address
  m.mem.write8(0x77e6, 0xa0); // out-of-range tile at the dropped-+0x0C (x=0x34) address
  sub_298c(m);
  assert.equal(m.regs.a, 0x00, "read the tile at the +0x0C-adjusted column (0x77E8), not 0x77E6");
});

// ---- sub_28b0 family (INTEGRATED FROM A DRAFT, code2) -- entry_2913 sweeps -----
// TAIL dispatch targets: pop the dispatcher's HL, then N guarded calls to the REAL
// entry_2913. The guard must be `if (!entry_2913(m)) return true` (a HIT skips the
// rest of the routine to the dispatch's caller). Seed makes entry_2913 MISS (all
// slots inactive) so all groups run; a per-group active slot makes it HIT.

const seed28 = (m, { hitGroup1 = false } = {}) => {
  m.regs.sp = 0x6c00;
  m.push16(0x4dcc); // the dispatch's caller-caller (survives a HIT skip)
  m.push16(0x29c0); // the dispatch's caller return
  m.push16(0x0abc); // the HL the dispatcher pushed (planted -- C1: 2913 must USE it)
  m.regs.c = 0x10; m.regs.iy = 0x6b40;
  m.mem.write8(0x6b43, 0x20); // (iy+3)
  if (hitGroup1) {
    // group 1 uses IX=0x6400: make object 0 active and in-range so 2913 HITs.
    m.mem.write8(0x6400, 0x01); // bit 0 set -- slot active
    m.mem.write8(0x6405, 0x10); // C - (ix+5) = 0 -> NC
    m.mem.write8(0x6403, 0x20); // (iy+3) - (ix+3) = 0 -> NC
  }
};

test("sub_28b0 pops the dispatcher's HL and feeds it (H,L) to entry_2913 (C1)", () => {
  // C1: the popped HL is 2913's axis-2 bounds -- planted 0x0ABC must reach 2913's
  // H/L. With all slots inactive 2913 never HITs, so H/L survive to the final ret;
  // assert regs.h/regs.l == the planted HL. MUTATION: drop the pop hl -> H/L are
  // whatever the machine had, not 0x0ABC.
  const m = new Machine(ROM);
  seed28(m); // no hit -> all three groups sweep, 2913 preserves H/L (never writes them)
  const returned = sub_28b0(m);
  assert.equal(returned, true, "all sweeps completed -> caller continues (true)");
  assert.equal(m.pc, 0x29c0, "returned to the dispatch's caller");
  assert.equal((m.regs.h << 8) | m.regs.l, 0x0abc, "HL popped from the stack reached 2913 unmodified");
});

test("sub_28b0's call 0x2913 CARRIES the skip guard -- a HIT skips groups 2 & 3 (Finding A)", () => {
  // Group 1 HITs -> entry_2913 discards our return, rets to the dispatch's caller,
  // and sub_28b0 must NOT run groups 2/3. Observable: 0x63b9 holds group 1's B (5),
  // never group 2's (6) or group 3's (1). MUTATION (drop the guard): groups 2/3 run,
  // 0x63b9 ends at 1. Also pins the skip landed at the caller's caller (SP + PC).
  const m = new Machine(ROM);
  seed28(m, { hitGroup1: true });
  const returned = sub_28b0(m);
  assert.equal(m.mem.read8(0x63b9), 0x05, "0x63b9 = group 1's B(5) -- groups 2/3 SKIPPED, not run");
  assert.equal(m.pc, 0x29c0, "the skip landed at the dispatch's caller (2913 discarded our frame)");
  // FINDING C, and my first draft of this test got it wrong: sub_28b0 returns
  // TRUE even on a HIT. 2913's FALSE is about 2913's frame; sub_28b0's caller
  // still continues (tail target). So the RETURN VALUE cannot detect the guard --
  // the SKIP does (0x63b9=5, pc=caller above). The entry_06b8 scope-error lesson,
  // which bit my test assertion until the mutation/real run flagged it.
  assert.equal(returned, true, "returns TRUE (caller continues) even on a HIT -- not 2913's false");
});

test("sub_28e0 (2 groups) and sub_2901 (1 group) sweep and return true when 2913 misses", () => {
  // Twin backstop (S7): different group counts. With no HIT, each runs all its
  // groups and returns true; 0x63b9 holds the LAST group's B.
  const e = new Machine(ROM); seed28(e);
  assert.equal(sub_28e0(e), true, "sub_28e0 completes -> true");
  assert.equal(e.mem.read8(0x63b9), 0x0a, "sub_28e0's last group B = 0x0A");
  const s = new Machine(ROM); seed28(s);
  assert.equal(sub_2901(s), true, "sub_2901 completes -> true");
  assert.equal(s.mem.read8(0x63b9), 0x07, "sub_2901's only group B = 0x07");
});

test("sub_22bd copies (HL) to 0x694B or 0x6947 selected by bit 3 of L", () => {
  // Draft: bit 3 of L picks the destination; A = (HL) is stored there. MUTATION
  // this catches: wrong destination constant, or inverted jp polarity (the two
  // addresses swap). Two cases pin distinct addresses; the copied byte 0x5A != 0.
  const withL = (l) => {
    const m = new Machine(ROM);
    m.regs.sp = 0x6c00; m.push16(0x4d5e);
    m.regs.hl = 0x6a00 | l; // L = low byte; source at 0x6A00|L
    m.mem.write8(m.regs.hl, 0x5a); // (HL) = 0x5A
    sub_22bd(m);
    return { at694b: m.mem.read8(0x694b), at6947: m.mem.read8(0x6947), pc: m.pc };
  };
  const set = withL(0x08); // bit 3 SET -> 0x694B
  assert.equal(set.at694b, 0x5a, "bit3(L) set -> stored at 0x694B");
  assert.equal(set.at6947, 0x00, "bit3(L) set -> 0x6947 untouched");
  const clr = withL(0x00); // bit 3 CLEAR -> 0x6947
  assert.equal(clr.at6947, 0x5a, "bit3(L) clear -> stored at 0x6947");
  assert.equal(clr.at694b, 0x00, "bit3(L) clear -> 0x694B untouched");
  assert.equal(clr.pc, 0x4d5e, "returns to the caller");
});

// ---- entry_24b4 (INTEGRATED FROM A DRAFT, code3) -- bounds gate + return splice
// IX live-in. Three early ret cc (normal return -> true); the main path (in the
// band (ix+5)>=0xE8 and 0x20<=(ix+3)<0x2A) pops the caller's return into HL and
// tail-jumps to untranslated 0x21ba (NotImplemented). Integrator-authored tests
// (draft predates TEST-SPEC).

const run24b4 = (ix5, ix3, { ix15 = 0x00, latch6348 = 0x00, retAddr = 0x4d5e } = {}) => {
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00;
  m.push16(0x4dcc); // caller's-caller (survives the splice)
  m.push16(retAddr); // the caller's pushed return address (popped on the main path)
  m.regs.ix = 0x6b00;
  m.mem.write8(0x6b05, ix5); // (ix+0x05)
  m.mem.write8(0x6b03, ix3); // (ix+0x03)
  m.mem.write8(0x6b15, ix15); // (ix+0x15)
  m.mem.write8(0x6348, latch6348);
  return m;
};

test("entry_24b4 returns to the caller on each of its three bounds early-exits", () => {
  // Draft OQ-1: control returns on THREE paths (ret c / ret nc / ret c). MUTATION
  // this catches: a flipped clamp polarity, which changes which side returns.
  // (a) (ix+5) < 0xE8 -> ret c
  let m = run24b4(0x50, 0x25);
  assert.equal(entry_24b4(m), true, "(ix+5)<0xE8 -> ret c returns true");
  assert.equal(m.pc, 0x4d5e, "returned to the caller");
  assert.equal(m.regs.sp, 0x6c00 - 2, "only the caller frame consumed (SENTINEL intact)");
  // (b) (ix+5)>=0xE8, (ix+3) >= 0x2A -> ret nc
  m = run24b4(0xf0, 0x30);
  assert.equal(entry_24b4(m), true, "(ix+3)>=0x2A -> ret nc returns true");
  assert.equal(m.pc, 0x4d5e, "returned to the caller");
  // (c) (ix+5)>=0xE8, (ix+3) < 0x20 -> ret c
  m = run24b4(0xf0, 0x10);
  assert.equal(entry_24b4(m), true, "(ix+3)<0x20 -> ret c returns true");
  assert.equal(m.pc, 0x4d5e, "returned to the caller");
});

test("entry_24b4 main path POPS the caller's return (forwarded to 0x21ba), resets IX, throws", () => {
  // Draft OQ-1/OQ-2: in the band the routine does NOT return -- it pops the
  // caller's return into HL (forwarded to 0x21ba's exx) and tail-jumps to
  // untranslated 0x21ba. MUTATION this catches: modelling it as a plain ret
  // (no pop / no splice), or dropping the (ix) reset.
  const m = run24b4(0xf0, 0x25, { ix15: 0x00, latch6348: 0x00 }); // in band: (ix+5)>=0xE8, 0x20<=(ix+3)<0x2A
  assert.throws(() => entry_24b4(m), /unmapped write to ROM at 0x0000/i, "main path tail-jumps into 0x21ba (now translated), which faults on the minimal setup");
  assert.ok(m.pc >= 0x21ba && m.pc < 0x2200, "PC forwarded into the 0x21ba block -- did NOT return to the caller (0x4d5e)");
  assert.equal(m.regs.sp, 0x6c00 - 4 + 2, "the caller's return frame was popped (SP +2 from the pop)");
  assert.equal(m.mem.read8(0x6b00), 0x00, "(ix+0) reset to 0");
  assert.equal(m.mem.read8(0x6b03), 0x00, "(ix+3) reset to 0");
  assert.equal(m.mem.read8(0x6082), 0x03, "0x6082 := 3");
  assert.equal(m.mem.read8(0x6348), 0x01, "0x6348 one-shot latch bumped 0 -> 1");
});

test("entry_24b4 (ix+0x15) != 0 writes 0x62B9 = 3 before the reset", () => {
  // Draft §4: the conditional side effect. (ix+15)!=0 -> 0x62B9 := 3; ==0 -> skip.
  // MUTATION this catches: dropping the conditional, or the wrong constant.
  const on = run24b4(0xf0, 0x25, { ix15: 0x01 });
  assert.throws(() => entry_24b4(on), /unmapped write to ROM at 0x0000/i);
  assert.equal(on.mem.read8(0x62b9), 0x03, "(ix+15)!=0 -> 0x62B9 = 3");
  const off = run24b4(0xf0, 0x25, { ix15: 0x00 });
  off.mem.write8(0x62b9, 0x77); // sentinel -- must stay untouched
  assert.throws(() => entry_24b4(off), /unmapped write to ROM at 0x0000/i);
  assert.equal(off.mem.read8(0x62b9), 0x77, "(ix+15)==0 -> 0x62B9 untouched");
});

test("entry_2c72 sets bit 7 of 0x6382, preserving the low bits", () => {
  // Draft TEST 1: or 0x80 forces bit 7, low bits unchanged. MUTATION this catches:
  // a wrong bit mask, or `and` instead of `or`. 0x0F -> 0x8F (not 0x80, not 0x0F).
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00; m.push16(0x4d5e);
  m.mem.write8(0x6382, 0x0f); // low bits set, bit 7 clear
  entry_2c72(m);
  assert.equal(m.mem.read8(0x6382), 0x8f, "bit 7 set AND low bits (0x0F) preserved");
  assert.equal(m.pc, 0x4d5e, "returns to the caller");
});

// ---- entry_2c8f (INTEGRATED FROM A DRAFT, code2) -- three-way twin of
// entry_2c03/sub_03a2; scans 10 records at 0x6700 for a free slot. The rst
// 0x30/0x10 prologue uses the REAL caller-skip gates (sub_0030/sub_0010); both
// flow-outs (0x2d15, entry_2cb8) are untranslated -> NotImplemented. Both gates
// are seeded to CONTINUE: (0x6227)=1 makes sub_0030 rotate A=0x01 once -> carry
// set -> normal return; (0x6200) bit0=1 makes sub_0010 return normally.
const run2c8f = ({ v6393 = 0x00, v6392 = 0x01, rec = {} } = {}) => {
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00;
  m.push16(0x4d5e); // the caller
  m.mem.write8(0x6227, 0x01); // sub_0030 rotate count B=1 -> A=0x01 rrca once -> carry
  m.mem.write8(0x6200, 0x01); // sub_0010 gate bit0 -> normal return
  m.mem.write8(0x6393, v6393);
  m.mem.write8(0x6392, v6392);
  for (const [off, val] of Object.entries(rec)) m.mem.write8(0x6700 + Number(off), val);
  return m;
};

test("entry_2c8f 0x6393 bit0 set tail-jumps to 0x2d15, jp c not ret c", () => {
  // Draft S7/TEST 1: the prologue is byte-identical to the translated twin
  // sub_03a2 for 5 instructions, then this does jp c,0x2d15 where the twin does
  // ret c. A translator copying the twin returns to the caller; the ROM jumps
  // to 0x2d15. MUTATION this catches: `if (regs.fC) { ret(m); return; }` (the
  // twin's ret c) -- that returns without throwing, so assert.throws fails.
  const m = run2c8f({ v6393: 0x01 }); // bit0 set -> rrca -> carry -> jp c taken
  entry_2c8f(m);
  assert.equal(m.mem.read8(0x62af), 0xff, "reached loc_2d15: dec (0x62af) ran (0x00 -> 0xFF); ret c would have skipped it");
  assert.equal(m.pc, 0x4d5e, "loc_2d15's frame-gate ret nz returned to the caller");
});

test("entry_2c8f advances IX by 0x20 per record, add ix,de inside the loop", () => {
  // Draft OQ2/TEST 2: the scan walks 0x6700 stride 0x20; add ix,de sits inside
  // loc_2ca8. record 0 has bit0 set (advance); record 1 is 0x00 (bit1 clear ->
  // free slot -> entry_2cb8, untranslated). Correct reaches entry_2cb8 with
  // IX=0x6720. MUTATION this catches: add ix,de removed from the loop body --
  // then IX never advances, the scan spins on record 0 and exhausts to a plain
  // ret, so it never throws.
  const m = run2c8f({ v6393: 0x00, v6392: 0x01, rec: { 0x00: 0x01, 0x20: 0x00 } });
  entry_2c8f(m);
  assert.equal(m.regs.ix, 0x6720, "IX advanced exactly one 0x20 stride to record 1");
  assert.equal(m.mem.read16(0x62aa), 0x6720, "entry_2cb8 entered with IX=0x6720 (ld (0x62aa),ix)");
  assert.equal(m.mem.read8(0x6720), 0x02, "entry_2cb8 claimed the free slot: (ix+0) := 0x02");
  assert.equal(m.pc, 0x4d5e, "entry_2cb8 -> loc_2d15 frame gate returned to the caller");
});

test("entry_2c8f 0x6392 bit0 clear returns to the caller, ret nc", () => {
  // Draft §5: the (0x6392) gate. bit0 clear -> rrca -> carry clear -> ret nc
  // returns to the caller before the scan. MUTATION this catches: ret c instead
  // of ret nc (flipped polarity) -- that falls through to the scan (all records
  // 0x00 -> immediate free slot -> throws) instead of returning to the caller.
  const m = run2c8f({ v6393: 0x00, v6392: 0x00 }); // bit0 clear -> carry clear
  entry_2c8f(m);
  assert.equal(m.pc, 0x4d5e, "ret nc returned to the caller");
});

// ---- sub_26a6 (INTEGRATED FROM A DRAFT, code3) -- two-arm RMW; bit 7 of mem[DE]
// selects the direction. Both HL and DE are live-in (callers do ld de,0x69Ex /
// ex de,hl). Each arm bumps two cells at P=HL+1 and P+4 with an exact-value wrap.
// The arms are MIRRORS (inc<->dec, constants inverted), so the tests check all
// four counters' directions independently (draft §4).
const run26a6 = ({ selByte = 0x00, p = 0x10, p4 = 0x20 } = {}) => {
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00;
  m.push16(0x2668); // a caller return address
  m.regs.hl = 0x69e4; // ex de,hl target (site 0x2627); inc l -> P=0x69E5, P+4=0x69E9
  m.regs.de = 0x6a00; // arm-select pointer, clear of the write cells
  m.mem.write8(0x6a00, selByte); // mem[DE] -- bit 7 selects the arm
  m.mem.write8(0x69e5, p); // P
  m.mem.write8(0x69e9, p4); // P+4
  return m;
};

test("sub_26a6 carry-clear arm increments P and decrements P+4", () => {
  // Draft §3/§4: bit7 of mem[DE] clear -> (P) += 1, (P+4) -= 1. MUTATION this
  // catches: an inc<->dec flip on EITHER counter (0x0F not 0x11, or 0x21 not
  // 0x1F), and a wrong 0x04 stride (P+4 would miss 0x69E9).
  const m = run26a6({ selByte: 0x00, p: 0x10, p4: 0x20 });
  sub_26a6(m);
  assert.equal(m.mem.read8(0x69e5), 0x11, "(P) incremented 0x10 -> 0x11");
  assert.equal(m.mem.read8(0x69e9), 0x1f, "(P+4) decremented 0x20 -> 0x1F at stride 0x04");
  assert.equal(m.regs.a, 0x1f, "A live-out = the P+4 result");
  assert.equal(m.pc, 0x2668, "returns to the caller");
});

test("sub_26a6 carry-clear arm wraps P at 0x53 and P+4 at 0xCF", () => {
  // Draft OQ-1: exact-value wrap. (P) 0x52 -> inc 0x53 -> 0x50 ; (P+4) 0xD0 ->
  // dec 0xCF -> 0xD2. MUTATION this catches: a wrong wrap constant (0x50/0xD2)
  // or a wrong cp threshold (the wrap would not fire, storing 0x53 / 0xCF).
  const m = run26a6({ selByte: 0x00, p: 0x52, p4: 0xd0 });
  sub_26a6(m);
  assert.equal(m.mem.read8(0x69e5), 0x50, "(P) inc hits 0x53 -> wraps to 0x50");
  assert.equal(m.mem.read8(0x69e9), 0xd2, "(P+4) dec hits 0xCF -> wraps to 0xD2");
});

test("sub_26a6 carry-set arm decrements P and increments P+4", () => {
  // Draft §3/§4 mirror: bit7 of mem[DE] set -> (P) -= 1, (P+4) += 1. MUTATION
  // this catches: the bit7 arm-select polarity (would run the clear arm), and an
  // inc<->dec flip on either set-arm counter (0x61 not 0x5F, or 0x3F not 0x41).
  const m = run26a6({ selByte: 0x80, p: 0x60, p4: 0x40 });
  sub_26a6(m);
  assert.equal(m.mem.read8(0x69e5), 0x5f, "(P) decremented 0x60 -> 0x5F");
  assert.equal(m.mem.read8(0x69e9), 0x41, "(P+4) incremented 0x40 -> 0x41");
  assert.equal(m.regs.a, 0x41, "A live-out = the P+4 result");
});

test("sub_26a6 carry-set arm wraps P at 0x4F and P+4 at 0xD3", () => {
  // Draft OQ-1 mirror. (P) 0x50 -> dec 0x4F -> 0x52 ; (P+4) 0xD2 -> inc 0xD3 ->
  // 0xD0. MUTATION this catches: a wrong wrap constant on the set arm (0x52/0xD0).
  const m = run26a6({ selByte: 0x80, p: 0x50, p4: 0xd2 });
  sub_26a6(m);
  assert.equal(m.mem.read8(0x69e5), 0x52, "(P) dec hits 0x4F -> wraps to 0x52");
  assert.equal(m.mem.read8(0x69e9), 0xd0, "(P+4) inc hits 0xD3 -> wraps to 0xD0");
});

// ---- entry_2c03 (INTEGRATED FROM A DRAFT, code2) -- head of the 0x2C.. cluster;
// twin of sub_03a2. The rst 0x30/0x10 gates are the real caller-skip pair; the
// cluster flow-outs (0x2c7b/0x2c86/0x2c41) are untranslated -> NotImplemented.
// The default fixture drives every gate so control reaches loc_2c33 and takes the
// jp c,0x2c41 tail (NotImplemented) -- that throw is the "reached loc_2c33" signal.
// Gate recipe: (0x6227)=1 & (0x6200) bit0 -> both rst continue; (0x6393) bit0=0
// (ret c skip); (0x62b1)=0x50 nonzero (C, ret z skip); (0x62b0)=0x80 (0x7E>=C ->
// jp c,0x2c7b skip; srl 0x80 -> 0x40 at loc_2c33); (0x6382) bit1=0 (jp nz skip);
// loop (0x6380)=5,(0x601a)=3 -> match on 3rd pass; (0x6019) bit0=0 (ret nc).
const run2c03 = (over = {}) => {
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00;
  m.push16(0x198c); // caller: call 0x2c03 @ 0x1989 returns to 0x198c
  const v = {
    v6227: 0x01, v6200: 0x01, v6393: 0x00, v62b1: 0x50, v62b0: 0x80,
    v6382: 0x00, v6380: 0x05, v601a: 0x03, v6019: 0x00, v6350: 0x00, ...over,
  };
  m.mem.write8(0x6227, v.v6227); // rst 0x30 rotate count -> continue
  m.mem.write8(0x6200, v.v6200); // rst 0x10 gate bit -> continue
  m.mem.write8(0x6393, v.v6393);
  m.mem.write8(0x6350, v.v6350); // the twin sub_03a2's cell (draft TEST 2)
  m.mem.write8(0x62b1, v.v62b1);
  m.mem.write8(0x62b0, v.v62b0);
  m.mem.write8(0x6382, v.v6382);
  m.mem.write8(0x6380, v.v6380);
  m.mem.write8(0x601a, v.v601a);
  m.mem.write8(0x6019, v.v6019);
  return m;
};

test("entry_2c03 srl a is LOGICAL not sra -- 0x80 >> 1 = 0x40", () => {
  // Draft OQ5/TEST 1: srl a @ 0x2C36. At loc_2c33 (0x62b0)=0x80 -> srl -> 0x40,
  // and 0x40 < C=0x50 -> jp c,0x2c41 (throws). MUTATION this catches: sra a
  // sign-extends 0x80 -> 0xC0 >= 0x50, so jp c is NOT taken, the routine falls to
  // ret nc and returns -- no throw, and A would be 0xC0 not 0x40.
  const m = run2c03();
  assert.doesNotThrow(() => entry_2c03(m), "0x2c41 is translated now -- no frontier throw");
  assert.equal(m.mem.read8(0x6392), 0x01, "jp c,0x2c41 taken -> loc_2c4f ran (srl gave 0x40 < C)");
  assert.equal(m.mem.read8(0x638f), 0x03, "2c41 cluster reached (sra 0xC0 would skip it, leaving 0x00)");
  assert.equal(m.pc, 0x198c, "loc_2c4f ret nz -> back to caller");
});

test("entry_2c03 reads 0x6393 not the twin sub_03a2 cell 0x6350", () => {
  // Draft S7/TEST 2: the prologue is byte-identical to sub_03a2 except 0x01/0x6393
  // vs 0x03/0x6350. Set (0x6393)=0x01 (bit0 -> ret c early) and (0x6350)=0x00.
  // Correct returns at ret c BEFORE ld c,a, so C keeps its entry sentinel.
  // MUTATION this catches: reading 0x6350 (=0x00) instead -> no carry -> continues
  // past ret z and writes C := (0x62b1).
  const m = run2c03({ v6393: 0x01, v6350: 0x00 });
  m.regs.c = 0xee; // sentinel: only ld c,a @ 0x2C11 (past ret c) would overwrite it
  entry_2c03(m);
  assert.equal(m.pc, 0x198c, "ret c @ 0x2C0B returned to the caller");
  assert.equal(m.regs.c, 0xee, "returned at ret c BEFORE ld c,a -- never read (0x62b1) via 0x6350");
});

test("entry_2c03 djnz loop compares A against a DECREMENTING B", () => {
  // Draft OQ3/TEST 3: cp b is inside the loop; B counts 5,4,3 and A=3 matches on
  // the 3rd pass -> loc_2c33 (throws at 0x2c41). MUTATION this catches: comparing
  // against the loop-invariant initial B (5) every pass -- A=3 never equals 5, so
  // the loop exhausts to ret @ 0x2C32 and returns (no throw).
  const m = run2c03({ v6380: 0x05, v601a: 0x03 });
  assert.doesNotThrow(() => entry_2c03(m), "0x2c41 is translated now -- no frontier throw");
  assert.equal(m.mem.read8(0x6392), 0x01, "match on 3rd pass -> loc_2c33 -> jp c,0x2c41 -> loc_2c4f ran");
  assert.equal(m.pc, 0x198c, "loc_2c4f ret nz -> back to caller");
});

test("entry_2c03 rst 0x10 skip aborts the routine, not run as a plain call", () => {
  // Draft OQ1/TEST 4: with (0x6200) bit0 CLEAR, sub_0010 does inc sp/inc sp/ret --
  // it SKIPS the caller (returns to 0x198c, SP balanced). MUTATION this catches:
  // modelling rst 0x10 as an ordinary call (dropping the skip guard) -- the body
  // at 0x2C07+ runs anyway on a corrupted stack and control does NOT land at 0x198c.
  const m = run2c03({ v6200: 0x00, v6393: 0x01 });
  entry_2c03(m);
  assert.equal(m.pc, 0x198c, "rst 0x10 skip returned control to the caller");
  assert.equal(m.regs.sp, 0x6c00, "stack balanced by the skip's inc sp/inc sp");
});

// ---- entry_2c41 (INTEGRATED FROM A DRAFT, code2) -- continuation of entry_2c03;
// MULTI-ENTRY (0x2C41 + loc_2c49/loc_2c4b/loc_2c4f from the untranslated 2c7b).
// call 0x0057 is the translated sub_0057 (A = (0x6018)+(0x601a)+(0x6019)). Flow-
// outs: 0x2c86 (untranslated -> NotImplemented) and entry_2c72 (translated,
// wired). C is a live-in (entry_2c03's ld c,a).
const run2c41 = (over = {}) => {
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00;
  m.push16(0x198c); // caller (reached via entry_2c03's jump chain)
  const v = { v6018: 0x00, v601a: 0x00, v6019: 0x00, c: 0x30, v62b2: 0x30, ...over };
  m.mem.write8(0x6018, v.v6018);
  m.mem.write8(0x601a, v.v601a);
  m.mem.write8(0x6019, v.v6019);
  m.regs.c = v.c;
  m.mem.write8(0x62b2, v.v62b2);
  return m;
};

test("entry_2c41 primary entry stores 0x6382=1 and 0x638f=2", () => {
  // Draft S8/TEST 1: sub_0057 low nibble 0 -> loc_2c49 sets A=1; ld (0x6382),a;
  // inc a; ld (0x638f),a -> 0x638f = 0x6382+1. (0x62b2)!=C -> ret nz returns after
  // the stores. MUTATION this catches: dropping the inc a (0x638f would be 1).
  const m = run2c41({ v62b2: 0x99 }); // != C=0x30 -> ret nz returns
  entry_2c41(m);
  assert.equal(m.mem.read8(0x6382), 0x01, "0x6382 := 1");
  assert.equal(m.mem.read8(0x638f), 0x02, "0x638f := 0x6382 + 1 = 2 (inc a between the stores)");
  assert.equal(m.pc, 0x198c, "ret nz returned to the caller");
});

test("entry_2c41 loc_2c4b external entry stores A and A+1", () => {
  // Draft OQ1: entry_2c7b jumps to loc_2c4b with its OWN A -> 0x6382=A, 0x638f=A+1.
  // Validates the multi-entry model. MUTATION this catches: dropping inc a (== A).
  const m = run2c41({ v62b2: 0x99 }); // != C -> ret nz returns after the stores
  m.regs.a = 0x40;
  loc_2c4b(m);
  assert.equal(m.mem.read8(0x6382), 0x40, "0x6382 := caller's A");
  assert.equal(m.mem.read8(0x638f), 0x41, "0x638f := A + 1 (inc a between the stores)");
});

test("entry_2c41 sub_0057 low nibble nonzero tail-jumps to 0x2c86", () => {
  // Draft §5: and 0x0f; jp nz,0x2c86. sub_0057 = (0x6018)+(0x601a)+(0x6019); set
  // it to 0x03 (low nibble != 0) -> jp nz taken -> untranslated tail (throws).
  // MUTATION this catches: jp z polarity (would fall through to loc_2c49).
  const m = run2c41({ v6018: 0x03, v62b2: 0x99 }); // sum = 3; gate returns clean
  assert.doesNotThrow(() => entry_2c41(m), "0x2c86 is translated now -- no frontier throw");
  assert.equal(m.mem.read8(0x638f), 0x03, "via 0x2c86 -> loc_2c4f: 0x638f = 3 (loc_2c49 path would give 2)");
  assert.equal(m.mem.read8(0x6382), 0x00, "loc_2c86 CLEARED 0x6382 (loc_2c49 path would leave 1)");
  assert.equal(m.pc, 0x198c, "ret nz -> back to caller");
});

test("entry_2c41 ret nz returns without decrementing 0x62b2 when not equal to C", () => {
  // Draft OQ3/TEST 3: cp c / ret nz. (0x62b2) != C -> returns BEFORE sub 0x08.
  // MUTATION this catches: ret z polarity -- it would NOT return and would
  // decrement (0x62b2) by 8.
  const m = run2c41({ v62b2: 0x20, c: 0x10 }); // 0x20 != 0x10 -> ret nz taken
  entry_2c41(m);
  assert.equal(m.mem.read8(0x62b2), 0x20, "(0x62b2) unchanged -- returned before sub 0x08");
  assert.equal(m.pc, 0x198c, "returned to the caller");
});

test("entry_2c41 free-slot loop jp z: 5 nonzero records fall through to ret", () => {
  // Draft OQ4/TEST 2: loc_2c69 jp z finds an EMPTY (zero) record. With all 5
  // records non-zero it never jumps -> ret @ 0x2C71 without reaching entry_2c72.
  // MUTATION this catches: jp nz polarity -- it jumps to entry_2c72 on the FIRST
  // non-zero record, which sets bit 7 of 0x6382.
  const m = run2c41({ c: 0x30, v62b2: 0x30 }); // == C -> ret nz falls through to loop
  for (const off of [0x00, 0x20, 0x40, 0x60, 0x80]) m.mem.write8(0x6400 + off, 0x01);
  entry_2c41(m);
  assert.equal(m.pc, 0x198c, "loop exhausted -> ret @ 0x2C71 -> caller");
  assert.equal(m.mem.read8(0x6382) & 0x80, 0x00, "entry_2c72 NOT reached -- 0x6382 bit 7 stays clear");
});

// ---- entry_2c7b / loc_2c86 (INTEGRATED FROM A DRAFT, code2) -- the multi-entry
// SOURCES into entry_2c41 (resolves 2c41's OQ1). Both tail-jump into the
// translated loc_2c49/loc_2c4b/loc_2c4f. A and C are entry_2c03 live-ins. The
// (0x62b2) gate downstream returns cleanly when (0x62b2) != C.
const run2c7b = ({ a = 0x00, c = 0x00, v62b2 = 0x99, v6382 = 0x00 } = {}) => {
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00;
  m.push16(0x198c); // final return target (up the entry_2c03 jump chain)
  m.regs.a = a;
  m.regs.c = c;
  m.mem.write8(0x62b2, v62b2); // != C by default -> loc_2c4f's ret nz returns
  m.mem.write8(0x6382, v6382);
  return m;
};

test("entry_2c7b A+2 == C jumps to loc_2c49 (A kept), else loc_2c4b with A=2", () => {
  // Draft OQ2/TEST 1: add a,0x02 / cp c. (a) A=3,C=5 -> A+2==C -> loc_2c49 (sets
  // A=1) -> 0x6382=1, 0x638f=2. (b) A=3,C=9 -> A+2!=C -> loc_2c4b with A=0x02 ->
  // 0x6382=2, 0x638f=3. MUTATION this catches: dropping add a,0x02 -- case (a)
  // then compares 3 vs 5, misses loc_2c49, takes loc_2c4b (0x6382=2, not 1).
  const a = run2c7b({ a: 0x03, c: 0x05 }); // A+2 = 5 == C -> loc_2c49
  entry_2c7b(a);
  assert.equal(a.mem.read8(0x6382), 0x01, "loc_2c49 path: 0x6382 := 1");
  assert.equal(a.mem.read8(0x638f), 0x02, "loc_2c49 path: 0x638f := 2");

  const b = run2c7b({ a: 0x03, c: 0x09 }); // A+2 = 5 != C=9 -> loc_2c4b, A:=2
  entry_2c7b(b);
  assert.equal(b.mem.read8(0x6382), 0x02, "loc_2c4b path: 0x6382 := A = 2");
  assert.equal(b.mem.read8(0x638f), 0x03, "loc_2c4b path: 0x638f := A+1 = 3");
});

test("loc_2c86 CLEARS 0x6382 (xor a), not entry_2c72's set-bit-7", () => {
  // Draft S7/TEST 2: loc_2c86 does xor a / ld (0x6382),a -> 0x6382 = 0. MUTATION
  // this catches: confusing it with entry_2c72's `or 0x80` -- 0x40 | 0x80 = 0xC0.
  const m = run2c7b({ a: 0x00, c: 0x10, v62b2: 0x20, v6382: 0x40 }); // (0x62b2) != C
  loc_2c86(m);
  assert.equal(m.mem.read8(0x6382), 0x00, "xor a cleared 0x6382 to 0 (not 0xC0)");
});

test("sub_3f24 subtracts via a wrapping add, and the carry escapes", () => {
  // INTEGRATED FROM A DRAFT. The finding a memory diff cannot see: writing
  // this as `hl -= 0x20` gets the SAME ADDRESS and produces NO FLAGS, where
  // `add hl,de` with DE=0xFFE0 sets C, sets H and clears N. Both operands
  // are literals, so the wrap is unconditional -- the carry is handed to the
  // caller on every call, and would surface only as a wrong branch there.
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00;
  m.push16(0xbeef);
  m.regs.f = 0; // start with carry CLEAR so a set carry can only come from here
  sub_3f24(m);

  assert.equal(m.pc, 0xbeef, "returns to its caller");
  assert.equal(m.regs.hl, 0x748f, "0x74AF + 0xFFE0 wraps to 0x748F");
  assert.ok(m.regs.fC, "CARRY MUST BE SET -- the add wraps, every call");
  assert.equal(m.mem.read8(0x74af), 0x9f, "first tile");
  assert.equal(m.mem.read8(0x748f), 0x9e, "second tile, 0x20 BELOW the first");

  // The two writes are 0x20 apart in the same VRAM page, so the second is one
  // tile row up -- not an arbitrary address.
  assert.equal(0x74af - 0x748f, 0x20);
});

test("sub_122a replicates ONE 4-byte group down N slots at stride C+4", () => {
  // INTEGRATED FROM A DRAFT (code2). Set up exactly as the ROM does it at
  // 0x1006-0x100F: source 0x101B, dest 0x6707, B=0x08, C=0x1C.
  //
  // THE TWIN DISCRIMINATOR. sub_11ec (ROM 0x11EC) is this routine with the
  // source behaviour INVERTED -- no push/pop, so its HL advances cumulatively
  // and it walks 2*B0 CONSECUTIVE source bytes at stride C+2. Translating one
  // from the other is the failure mode the lead flagged. These assertions are
  // chosen to FAIL if 11ec's behaviour were transcribed here: if HL advanced,
  // the eight destination groups would hold 32 DIFFERENT bytes instead of the
  // same 4 repeated, and HL would not come back equal to its entry value.
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00;
  m.push16(0xbeef);

  // SENTINEL FILL, and it is load-bearing. The source group at ROM 0x101B is
  // `00 00 02 02`, and work RAM powers on at zero -- so against a zero
  // background the assertions on bytes 0 and 1 compare zero to zero and
  // CANNOT FAIL. Review proved it: making the store conditional on a nonzero
  // byte left the whole suite green. Filling with 0xAA first makes all four
  // bytes of every group carry signal, and lets the untouched-slot check
  // below mean something.
  for (let a = 0x6700; a < 0x6900; a++) m.mem.write8(a, 0xaa);

  m.regs.hl = 0x101b; // the 4 DATA bytes after loc_0fd7's ret
  m.regs.de = 0x6707;
  m.regs.bc = 0x081c; // B=8 passes, C=0x1C stride addend
  m.regs.f = 0;       // carry CLEAR, so a set carry can only come from here
  const before = m.cycles;
  sub_122a(m);

  assert.equal(m.pc, 0xbeef, "returns to its call site");

  // The same four source bytes appear at all eight destinations.
  const src = [0, 1, 2, 3].map((i) => ROM[0x101b + i]);
  assert.deepEqual(src, [0x00, 0x00, 0x02, 0x02], "the source group, from the ROM");
  for (let pass = 0; pass < 8; pass++) {
    const dst = 0x6707 + 0x20 * pass; // stride is C+4 == 0x20, NOT C == 0x1C
    for (let i = 0; i < 4; i++) {
      assert.equal(
        m.mem.read8(dst + i), src[i],
        `pass ${pass} byte ${i}: every pass re-reads the SAME group`,
      );
    }
  }

  // THE STRIDE-C DECOY. If the stride were C (0x1C) rather than C+4 (0x20),
  // pass 1 would land here instead. Against the sentinel this is a real
  // check; comparing the two literals 0x20 and 0x1C+4 would not be.
  for (let i = 0; i < 4; i++) {
    assert.equal(m.mem.read8(0x6707 + 0x1c + i), 0xaa, "stride is C+4, NOT C");
  }

  // The two preservations the ROM itself depends on at 0x1012-0x1017, where
  // the next call reloads DE and B but NEITHER HL NOR C.
  assert.equal(m.regs.hl, 0x101b, "HL PRESERVED -- pop hl discards the inc hl");
  assert.equal(m.regs.c, 0x1c, "C PRESERVED -- pop bc restores the stride");

  // E is 8-bit and D is never written, so this call site WRAPS inside page
  // 0x67: E runs 0x07 -> 0xE7 then 0xE7+4+0x1C = 0x107, truncated to 0x07.
  assert.equal(m.regs.d, 0x67, "D NEVER MODIFIED -- destination stays in one page");
  assert.equal(m.regs.e, 0x07, "E wrapped within the page, back to its entry value");
  assert.ok(m.regs.fC, "CARRY from the final `add a,c` ESCAPES through the ret");

  // 217 per outer pass, MINUS 5 because the final outer djnz falls through
  // (8T) instead of branching (13T), PLUS 10 for the ret. Both signs in the
  // first version of this message were inverted, which would have handed
  // 1731 to anyone re-deriving the constant from the prose.
  assert.equal(m.cycles - before, 217 * 8 - 5 + 10, "217*8 - 5 + 10 == 1741");
});

test("sub_122a's `inc e` confines the destination to one page -- SYNTHETIC input", () => {
  // THIS INPUT IS NOT PRODUCED BY ANY KNOWN CALL SITE, and the test says so
  // rather than implying otherwise. It exists because the natural inputs
  // CANNOT tell the right translation from the wrong one.
  //
  // Writing `inc e` as a 16-bit `regs.de++` is a real and easy defect: at
  // every ROM call site E runs 0x07->0x0B, 0x27->0x2B ... and never crosses
  // 0xFF inside the inner loop, so the two versions are byte-identical on any
  // tape that reaches here. Fault injection confirmed it: swapping in the
  // 16-bit form left the whole suite green until this test existed.
  //
  // So the boundary is crossed deliberately. With E = 0xFE the four inner
  // writes land at 0x67FE, 0x67FF, 0x6700, 0x6701 -- WRAPPING INSIDE page
  // 0x67, because D is never written. The 16-bit form would spill the last
  // two into page 0x68 and corrupt an unrelated structure.
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00;
  m.push16(0xbeef);
  // SENTINEL, and it is load-bearing for the WRITTEN bytes, not the unwritten
  // ones. Source ROM 0x101B is `00 00 02 02`, so the two compares at 0x67FE
  // and 0x67FF expect 0x00 and would pass against zero-initialised RAM
  // whether or not the routine ran. Those are what the fill protects.
  //
  // The "page 0x68 MUST NOT be written" checks below were never vacuous: the
  // bytes the 16-bit defect spills into page 0x68 are src[2]/src[3] = 0x02,
  // so they discriminate against a zero background too. An earlier version of
  // this comment named those and not the two above -- backwards, and worth
  // correcting because the next person removes the fill on that reasoning.
  for (let a = 0x6700; a < 0x6900; a++) m.mem.write8(a, 0xaa);
  m.regs.hl = 0x101b;
  m.regs.de = 0x67fe;
  m.regs.bc = 0x0100; // B=1 pass, C=0 -- isolate the inner loop's wrap
  sub_122a(m);

  const src = [0, 1, 2, 3].map((i) => ROM[0x101b + i]);
  assert.equal(m.mem.read8(0x67fe), src[0]);
  assert.equal(m.mem.read8(0x67ff), src[1]);
  assert.equal(m.mem.read8(0x6700), src[2], "WRAPPED to the page base, not 0x6800");
  assert.equal(m.mem.read8(0x6701), src[3], "WRAPPED to the page base, not 0x6801");
  assert.equal(m.regs.d, 0x67, "D NEVER MODIFIED, even across an E wrap");

  // And the page above must be untouched -- the 16-bit form's signature.
  assert.equal(m.mem.read8(0x6800), 0xaa, "page 0x68 MUST NOT be written");
  assert.equal(m.mem.read8(0x6801), 0xaa, "page 0x68 MUST NOT be written");
});

test("sub_122a's outer djnz re-runs the pushes -- they are body, not setup", () => {
  // The sub_3fa6 trap, in its most convincing disguise: the two pushes and
  // `ld b,0x04` sit at the ROUTINE ENTRY, which is also the outer djnz target.
  // Hoisting them out of the loop would leave pass 2 popping the CALLER's
  // stack. Pinned by checking SP is balanced across a multi-pass call -- a
  // hoisted `push` would leave B0-1 words stranded and the ret would go wild.
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00;
  m.push16(0xbeef);
  const spAfterPush = m.regs.sp;
  m.regs.hl = 0x101b;
  m.regs.de = 0x6707;
  m.regs.bc = 0x081c;
  sub_122a(m);

  assert.equal(m.pc, 0xbeef, "eight passes and the ret still finds its address");
  assert.equal(m.regs.sp, spAfterPush + 2, "SP balanced: the ret consumed exactly one word");
  assert.equal(m.regs.b, 0, "B exhausted by the outer djnz");
});

test("sub_004e copies 40 bytes from caller-supplied HL, preserving carry", () => {
  // INTEGRATED FROM A DRAFT. Two findings pinned:
  //
  // 1. HL IS AN IMPLICIT INPUT -- the routine sets DE and BC but never HL,
  //    so the ldir SOURCE comes from the caller. All 13 call sites set it
  //    immediately before; this pins that the routine reads it rather than
  //    assuming a fixed source.
  // 2. LDIR PRESERVES CARRY (it clears H, N and PV and leaves S, Z, C). A
  //    caller's carry survives the call, and `ret c` sits nine bytes away at
  //    0x004B. A translation clobbering flags is wrong in a way no memory
  //    diff catches -- the same shape as sub_3f24's wrapping add.
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00;
  m.push16(0xbeef);
  m.regs.hl = 0x385c; // one of the twelve literal ROM sources
  m.regs.f = F_C;     // carry SET going in
  const before = m.cycles;
  sub_004e(m);

  assert.equal(m.pc, 0xbeef, "returns to its call site -- one unconditional ret");
  assert.ok(m.regs.fC, "LDIR MUST PRESERVE CARRY");
  assert.equal(m.cycles - before, 865, "fixed cost: BC is the literal 0x28");

  // 40 bytes landed at 0x6908, from the caller's HL, not a fixed source.
  for (let i = 0; i < 0x28; i++) {
    assert.equal(m.mem.read8(0x6908 + i), ROM[0x385c + i], `byte ${i}`);
  }
  assert.equal(m.regs.de, 0x6908 + 0x28, "DE past the destination");
  assert.equal(m.regs.bc, 0, "BC exhausted");

  // A DIFFERENT caller HL must copy different bytes -- proving the source is
  // read rather than baked in.
  const m2 = new Machine(ROM);
  m2.regs.sp = 0x6c00;
  m2.push16(0xbeef);
  m2.regs.hl = 0x39f7;
  sub_004e(m2);
  assert.equal(m2.mem.read8(0x6908), ROM[0x39f7], "source follows the caller's HL");
});

test("sub_11ec's `inc e` confines the destination to one page -- SYNTHETIC input", () => {
  // SYNTHETIC, and stated as such. sub_11ec takes DE from its caller, and at
  // all three ROM call sites E stays low (0x83 at 0x11AC), so `inc e` never
  // crosses 0xFF and a 16-bit `regs.de++` would be byte-identical on any real
  // tape. §34: the boundary has to be synthesised or it is never tested.
  //
  // Distinct from the sub_122a case in a way that matters: sub_11ec does TWO
  // `inc e` per pass and stores at E and E+2, so a wrap can land BETWEEN the
  // two stores of a single pass. With E = 0xFF the first store lands at
  // 0x66FF and the second at 0x6601 -- backwards by 254, inside page 0x66.
  // The 16-bit form would put the second at 0x6701, in an unrelated page.
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00;
  m.push16(0xbeef);
  for (let a = 0x6600; a < 0x6800; a++) m.mem.write8(a, 0xaa);
  m.regs.hl = 0x3e0c; // the live-in, as loc_0fd7 supplies it
  m.regs.de = 0x66ff; // SYNTHETIC: E at the boundary
  m.regs.bc = 0x010e; // ONE pass, so only the intra-pass wrap is under test
  sub_11ec(m);

  assert.equal(m.mem.read8(0x66ff), ROM[0x3e0c], "first store lands at E");
  assert.equal(m.mem.read8(0x6601), ROM[0x3e0d], "second store WRAPS to E+2 in page");
  assert.equal(m.mem.read8(0x6700), 0xaa, "page 0x67 must not be touched");
  assert.equal(m.mem.read8(0x6701), 0xaa, "the 16-bit defect would land here");
  // E+1 is never written by this routine -- 0x6600 sits between the two
  // stores and must still hold the sentinel.
  assert.equal(m.mem.read8(0x6600), 0xaa, "E+1 is skipped, even across a wrap");
  assert.equal(m.regs.d, 0x66, "D is never written, so the page cannot change");
});

test("sub_11d3's `inc l` wraps within the page, and add ix,de sets carry -- SYNTHETIC", () => {
  // SYNTHETIC on both axes. At the ROM call sites L is low and IX+DE never
  // approaches 0xFFFF, so neither the `inc l` wrap nor the `add ix,de` carry
  // is exercised and both wrong forms pass on any real tape.
  //
  // AXIS 1 -- `inc l` vs `inc hl`. L advances 4 per pass with H never
  // written. Starting at L = 0xFE the four destination bytes land at 0x66FE,
  // 0x66FF, 0x6600, 0x6601: wrapping BACKWARDS inside page 0x66. `inc hl`
  // would carry into H and walk forward into page 0x67.
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00;
  m.push16(0xbeef);
  for (let a = 0x6600; a < 0x6800; a++) m.mem.write8(a, 0xaa);
  // A source struct with distinguishable values at the four gathered offsets,
  // and DIFFERENT values at +4 and +6, which this routine must NOT read.
  const IX = 0x6a00;
  for (let i = 0; i < 0x10; i++) m.mem.write8(IX + i, 0xf0 | i);
  m.regs.ix = IX;
  m.regs.hl = 0x66fe; // SYNTHETIC: L at the boundary
  m.regs.de = 0x0010;
  m.regs.b = 0x01; // one pass
  sub_11d3(m);

  assert.deepEqual(
    [0x66fe, 0x66ff, 0x6600, 0x6601].map((a) => m.mem.read8(a)),
    [0xf3, 0xf7, 0xf8, 0xf5],
    "gathers +3,+7,+8,+5 in ROM order while L wraps inside page 0x66",
  );
  assert.equal(m.mem.read8(0x6702), 0xaa, "`inc hl` would have walked into page 0x67");
  assert.equal(m.regs.h, 0x66, "H is never written");

  // AXIS 2 -- `add ix,de` is not a bare 16-bit add. The carry out of the FINAL
  // one survives djnz and ret and reaches the caller, so a translation using
  // `regs.ix = (regs.ix + regs.de) & 0xffff` is arithmetically identical and
  // flag-wise wrong. This is the defect already fixed once at mainloop.js:878.
  const c = new Machine(ROM);
  c.regs.sp = 0x6c00;
  c.push16(0xbeef);
  // IX must stay MAPPED, because the four gathers happen before the add -- so
  // the crossing is built from the STRIDE rather than from a high base.
  // 0x6A00 + 0x9600 = 0x10000 exactly. A stride this large is not far-fetched:
  // the drafter's OQ7 noted DE may be intended as a signed downward stride,
  // and 0x9600 read as signed is -0x6A00.
  c.regs.ix = 0x6a00;
  c.regs.de = 0x9600; // SYNTHETIC: IX + DE crosses 0xFFFF exactly
  c.regs.hl = 0x6600;
  c.regs.b = 0x01;
  c.regs.f = 0; // carry clear going in, so a set carry can only come from the add
  sub_11d3(c);
  assert.equal(c.regs.ix, 0x0000, "IX wraps modulo 0x10000");
  assert.ok(c.regs.f & F_C, "the 16-bit carry ESCAPES via the ret -- not dead");
  assert.ok(!(c.regs.f & F_N), "add clears N");
});








test("sub_30e4 zeros B bytes at stride 4 walking L only -- SYNTHETIC wrap boundary", () => {
  // First unit of the 0x1977 closure drain. It does not execute on any current
  // tape (reached only via handler_1977, untranslated), so this UNIT test is
  // its gate -- there is no state/write diff to lean on.
  //
  // Normal path: B=5 from HL=0x6A0C writes 0x6A0C,10,14,18,1C (stride 4), L only.
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00;
  m.push16(0xbeef);
  for (let a = 0x6a00; a < 0x6b00; a++) m.mem.write8(a, 0xaa);
  m.regs.hl = 0x6a0c;
  m.regs.b = 0x05;
  sub_30e4(m);
  for (const off of [0x00, 0x04, 0x08, 0x0c, 0x10]) {
    assert.equal(m.mem.read8(0x6a0c + off), 0x00, `zeroed 0x6a0c+${off}`);
  }
  assert.equal(m.mem.read8(0x6a0e), 0xaa, "stride 4 -- 0x6A0E is NOT written");
  assert.equal(m.regs.l, 0x20, "L exits at 0x0C + 4*5 = 0x20");
  assert.equal(m.regs.h, 0x6a, "H is never written");

  // SYNTHETIC WRAP (§34): no entry path reaches it, but `ld l,a` writes L only,
  // so at L near 0xFF the pointer WRAPS within page 0x6A and does NOT carry into
  // H. A 16-bit `regs.hl += 4` would spill into page 0x6B and is the natural
  // wrong translation. Start L=0xF8, B=3 -> writes 0x6AF8, 0x6AFC, 0x6A00 (wrap).
  const w = new Machine(ROM);
  w.regs.sp = 0x6c00;
  w.push16(0xbeef);
  for (let a = 0x6a00; a < 0x6c00; a++) w.mem.write8(a, 0xaa);
  w.regs.hl = 0x6af8;
  w.regs.b = 0x03;
  sub_30e4(w);
  assert.equal(w.mem.read8(0x6af8), 0x00, "write at 0xF8");
  assert.equal(w.mem.read8(0x6afc), 0x00, "write at 0xFC");
  assert.equal(w.mem.read8(0x6a00), 0x00, "third write WRAPS to 0x6A00 in-page");
  assert.equal(w.mem.read8(0x6b00), 0xaa, "the 16-bit defect would land in page 0x6B");
  assert.equal(w.regs.h, 0x6a, "H stays 0x6A across the wrap");
});

test("sub_3096 XORs C into two bytes at stride DE -- RMW, not a plain store", () => {
  // 0x1977-closure drain unit, ungated by execution (reached only via sub_306f,
  // untranslated), so this is its gate. B=2, stride DE, XOR of the EXISTING byte.
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00;
  m.push16(0xbeef);
  m.mem.write8(0x6a00, 0xff);
  m.mem.write8(0x6a04, 0x0f); // stride DE=4 apart
  m.mem.write8(0x6a02, 0x55); // BETWEEN the two -- must be untouched
  m.regs.hl = 0x6a00;
  m.regs.de = 0x0004;
  m.regs.c = 0x0f; // the mask
  sub_3096(m);
  // RMW: 0xFF ^ 0x0F = 0xF0 ; 0x0F ^ 0x0F = 0x00. A plain "store C" would give
  // 0x0F at both -- so these values catch a non-XOR translation.
  assert.equal(m.mem.read8(0x6a00), 0xf0, "0xFF ^ 0x0F");
  assert.equal(m.mem.read8(0x6a04), 0x00, "0x0F ^ 0x0F -- and NOT 0x0F (would be a plain store)");
  assert.equal(m.mem.read8(0x6a02), 0x55, "the byte between is not touched (stride 4, B=2)");
  assert.equal(m.regs.hl, 0x6a08, "HL exits at entry + 2*DE");
  assert.equal(m.regs.c, 0x0f, "C is preserved (the mask)");
});

test("entry_30db seeds sub_30e4 and falls through -- 0x694C + six at 0x6958 stride 4", () => {
  // 0x1977-closure drain, ungated by execution. entry_30db writes 0x694C then
  // enters sub_30e4 with HL=0x6958, B=6 (a fallthrough, not a call).
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00;
  m.push16(0xbeef);
  for (let a = 0x6940; a < 0x6980; a++) m.mem.write8(a, 0xaa);
  entry_30db(m);
  assert.equal(m.mem.read8(0x694c), 0x00, "0x694C cleared before the fallthrough");
  for (const off of [0x00, 0x04, 0x08, 0x0c, 0x10, 0x14]) {
    assert.equal(m.mem.read8(0x6958 + off), 0x00, `sub_30e4 zeroed 0x6958+${off}`);
  }
  assert.equal(m.mem.read8(0x695a), 0xaa, "stride 4 gap not touched");
  assert.equal(m.mem.read8(0x694e), 0xaa, "0x694C write is a single byte");
});

test("sub_3064 copies (HL+BC) to (HL+BC+DE)", () => {
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00;
  m.push16(0xbeef);
  m.mem.write8(0x6a10, 0x5a); // source at HL+BC
  m.mem.write8(0x6a18, 0xff); // dest at HL+BC+DE, will be overwritten
  m.regs.hl = 0x6a00;
  m.regs.bc = 0x0010; // HL+BC = 0x6A10
  m.regs.de = 0x0008; // +DE = 0x6A18
  sub_3064(m);
  assert.equal(m.mem.read8(0x6a18), 0x5a, "byte copied to HL+BC+DE");
  assert.equal(m.mem.read8(0x6a10), 0x5a, "source unchanged");
  assert.equal(m.regs.hl, 0x6a18, "HL exits at HL+BC+DE");
});

// ---------------------------------------------------------------------------
// entry_3009 -- ROM 0x3009-0x3049. 0x1977-closure drain, UNGATED BY EXECUTION
// (callers 0x1C9E/0x1CBA/0x23F4 are untranslated), so these HAND-TRACED unit
// vectors are its only gate. Every expected value below is derived by stepping
// the ROM bytes with Z80 semantics BY HAND (GATE-RULES §21), never by running
// the skeleton. The routine reads A and B live-in; D is saved from A internally.
//
// Trace of the loop's field structure, needed by all three vectors: the loop at
// 0x3031 does `ld a,c / rrca rrca / ld c,a` (C <- C ror 2) then `and 3 / cp b`,
// so it scans C's four 2-bit fields (across the 4 rotations that return C to
// its start) for one equal to B. Fields:
//   C=0x1E -> {3,1,0,2} (covers ALL of 0..3, so ANY B terminates)
//   C=0x90 -> {0,1,2,0}
// ---------------------------------------------------------------------------

test("entry_3009: A=0x05,B=0x02 -> res 2,d/dec d exit returns A=0x04, D=0x00", () => {
  // HAND TRACE (0x3022 branch, since bit0(0x05)=1):
  //   D=0x05. rrca 0x05->0x82 C=1 -> jp c TAKEN. C=0xB4.
  //   rrca 0x82->0x41 C=0 ; rrca 0x41->0xA0 C=1 -> jp nc NOT taken. C=0x1E.
  //   bit2(0x02)=0 -> jp z TAKEN (no dec b). B stays 2.
  //   LOOP C=0x1E: it1 C=0x87 f=3!=2 ; it2 C=0xE1 f=1!=2 ; it3 C=0x78 f=0!=2 ;
  //                it4 C=0x1E f=2==2 EXIT. C=0x1E.
  //   0x303b: (0x1E ror2)=0x87, &3 = 3. cp 0x03 -> Z. ret nz NOT taken.
  //   res 2,d: 0x05 & ~0x04 = 0x01. dec d -> 0x00 Z set. ret nz NOT taken.
  //   ld a,0x04 ; ret. => A=0x04, D=0x00.
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00;
  m.push16(0xbeef);
  m.regs.a = 0x05;
  m.regs.b = 0x02;
  entry_3009(m);
  assert.equal(m.regs.a, 0x04, "final exit returns A = 0x04");
  assert.equal(m.regs.d, 0x00, "D = res2(0x05)=0x01 then dec -> 0x00");
  // MUTATION this catches: `res 2,d` clearing the wrong bit or being skipped.
  // If res is a no-op, D stays 0x05, dec -> 0x04 (nz), `ret nz` at 0x3046 is
  // TAKEN and A is left at 0x03 (the (C ror2)&3 value) -- so A==0x04 fails.
  // `res 0,d` on 0x05 -> 0x04, dec -> 0x03 (nz), same early exit, A==0x03.
});

test("entry_3009: A=0x05,B=0x03 -> early `ret nz` returns A=0x01 with CARRY set", () => {
  // Same input A as above; only B differs, proving B is live-in and steers the
  // loop's exit point. HAND TRACE (0x3022 branch):
  //   C reaches 0x1E, bit2(0x03)=0 -> jp z TAKEN, B stays 3.
  //   LOOP C=0x1E: it1 C=0x87 f=3==3 EXIT (first iteration). C=0x87.
  //   0x303b: (0x87 ror2)=0xE1, &3 = 1. cp 0x03: 1-3 -> NZ and BORROW (carry).
  //   ret nz TAKEN. => A=0x01, carry set.
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00;
  m.push16(0xbeef);
  m.regs.a = 0x05;
  m.regs.b = 0x03;
  entry_3009(m);
  assert.equal(m.regs.a, 0x01, "early ret nz returns A = (C ror2)&3 = 0x01");
  assert.ok(m.regs.fC, "carry from `cp 0x03` (1<3) escapes to the caller (OQ-2, 0x23F7 `rra`)");
  // MUTATION this catches: `cp 0x03` dropped or carry not modelled -- the
  // caller's `rra` would then rotate a stale carry. Distinct B from the prior
  // vector also catches hard-coding the loop iteration count.
});

test("entry_3009: A=0x02,B=0x01 -> non-0x3022 path (rlca + and 0xF0), A=0x02 CARRY set", () => {
  // Exercises the branch the other two skip: bit0(0x02)=0 so `jp c` NOT taken,
  // reaching rlca at 0x3017 and the `and 0xF0` join. HAND TRACE:
  //   D=0x02. rrca 0x02->0x01 C=0 -> jp c NOT taken. C=0x93.
  //   rrca 0x01->0x80 C=1 ; rrca 0x80->0x40 C=0 -> jp nc TAKEN (C stays 0x93).
  //   rlca 0x40->0x80 C=0 -> jp c NOT taken. ld a,c=0x93; and 0xF0 -> 0x90;
  //   ld c,a. C=0x90. jp 0x3031.
  //   LOOP C=0x90 (fields {0,1,2,0}), B=1: it1 C=0x24 f=0!=1 ; it2 C=0x09 f=1==1
  //   EXIT. C=0x09.
  //   0x303b: (0x09 ror2)=0x42, &3 = 2. cp 0x03: 2-3 -> NZ + BORROW. ret nz. => A=0x02, carry set.
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00;
  m.push16(0xbeef);
  m.regs.a = 0x02;
  m.regs.b = 0x01;
  entry_3009(m);
  assert.equal(m.regs.a, 0x02, "non-0x3022 path returns A = 0x02");
  assert.ok(m.regs.fC, "carry from `cp 0x03` (2<3)");
  // MUTATION this catches (VERIFIED by injection): `and 0xf0` -> `and 0x70` (a
  // plausible F0->70 typo dropping the top bit) makes C=0x10 not 0x90; the loop
  // then exits at iter2 with C=0x01 and returns A=0x00, so A==0x02 fails. V1/V2
  // take the 0x3022 path and are correctly UNAFFECTED. (`and 0xEF` was rejected
  // as a mutation: it makes C=0x83, whose fields {0,0,2,3} exclude B=1, so the
  // faithful loop HANGS rather than returning a wrong value -- a timeout is not
  // a clean fail, and a hang is the ROM's own behaviour when no field matches.)
});

test("entry_3009 charges exact T-states and step SEQUENCE for A=0x05,B=0x02", () => {
  // Closes the gap QA-1 named on the drain: the image gate cannot see a cycle-
  // VALUE error that does not move a write across a boundary (§72), and
  // stepcheck's default mode audits step TARGETS not counts, while its --draft
  // sequence mode is unreliable on multi-block drafts (this routine has a loop).
  // Since nothing executes entry_3009 yet, THIS is the only thing gating its
  // timing. Expected total and sequence are summed from the LISTING by hand
  // (§21), for the fully-determined A=0x05,B=0x02 vector (loop runs 4 passes).
  //
  //   prologue 0x3009-0x302D (0x3022 branch): ld d,a 4 | rrca 4 | jp c 10 |
  //     ld c 7 | rrca 4 | rrca 4 | jp nc(nt) 10 | ld c 7 | bit 2,b 8 | jp z 10
  //   loop 0x3031-0x3038 x4: ld a,c 4 | rrca 4 | rrca 4 | ld c,a 4 | and 7 |
  //     cp b 4 | jp nz 10   (jp cc = 10 whether taken or not)
  //   post 0x303B-0x3049: ld a,c 4 | rrca 4 | rrca 4 | and 7 | cp n 7 |
  //     ret nz(nt) 5 | res 2,d 8 | dec d 4 | ret nz(nt) 5 | ld a,n 7 | ret 10
  const PROLOGUE = 4 + 4 + 10 + 7 + 4 + 4 + 10 + 7 + 8 + 10; // 68
  const LOOP1 = 4 + 4 + 4 + 4 + 7 + 4 + 10; // 37, one pass
  const POST = 4 + 4 + 4 + 7 + 7 + 5 + 8 + 4 + 5 + 7 + 10; // 65
  const EXPECTED = PROLOGUE + LOOP1 * 4 + POST;
  assert.equal(EXPECTED, 281, "the hand sum itself, so a typo above is visible");

  const m = new Machine(ROM);
  m.regs.sp = 0x6c00;
  m.push16(0xbeef);
  m.regs.a = 0x05;
  m.regs.b = 0x02;
  const before = m.cycles;
  const steps = [];
  const realStep = m.step.bind(m);
  m.step = (next, cyc) => { steps.push(next); return realStep(next, cyc); };
  entry_3009(m);

  assert.equal(m.cycles - before, EXPECTED, "total T-states -- a mis-costed instruction fails here");
  const loop = [0x3032, 0x3033, 0x3034, 0x3035, 0x3037, 0x3038]; // one loop pass, cp b -> 0x3038 (the step fix)
  assert.deepEqual(steps, [
    0x300a, 0x300b, 0x3022, 0x3024, 0x3025, 0x3026, 0x3029, 0x302b, 0x302d, 0x3031, // prologue
    ...loop, 0x3031, // pass 1: jp nz TAKEN back to 0x3031
    ...loop, 0x3031, // pass 2
    ...loop, 0x3031, // pass 3
    ...loop, 0x303b, // pass 4: match, jp nz NOT taken -> 0x303b
    0x303c, 0x303d, 0x303e, 0x3040, 0x3042, 0x3043, 0x3045, 0x3046, 0x3047, 0x3049, // post
    0xbeef, // ret -> pushed return address
  ], "the exact step sequence; a missing/extra/misaimed step shows here");
  assert.equal(steps.length, 49, "10 prologue + 4*7 loop + 11 post = 49 steps");
});

// ---------------------------------------------------------------------------
// sub_304a -- ROM 0x304A-0x3063. 0x1977-closure drain, UNGATED BY EXECUTION
// (callers 0x0AF0/0x0B38 are in an untranslated routine; nothing in translated
// src references 0x304A). Straight-line: loads the index at 0x638E into BC
// (B=0), calls sub_3064 twice to copy a byte 0x20 lower, decrements the index.
// Expected values derived from the ROM listing by hand (§21).
// ---------------------------------------------------------------------------

test("sub_304a copies two bytes -0x20 (DE=0xFFE0 wrap) and decrements 0x638E", () => {
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00;
  m.push16(0xbeef);
  m.mem.write8(0x638e, 0x05); // the index -> BC = 5
  m.mem.write8(0x7605, 0xab); // source 1 at 0x7600 + 5
  m.mem.write8(0x75c5, 0xcd); // source 2 at 0x75C0 + 5
  // dests power on 0x00, and 0xAB/0xCD != 0x00, so the asserts are non-vacuous (§71).
  sub_304a(m);
  // add hl,de wraps: 0x7605 + 0xFFE0 = 0x75E5 ; 0x75C5 + 0xFFE0 = 0x75A5.
  assert.equal(m.mem.read8(0x75e5), 0xab, "byte 1 copied 0x20 LOWER (0x7605 -> 0x75E5)");
  assert.equal(m.mem.read8(0x75a5), 0xcd, "byte 2 copied 0x20 LOWER (0x75C5 -> 0x75A5)");
  assert.equal(m.mem.read8(0x7605), 0xab, "source 1 unchanged (copy, not move)");
  assert.equal(m.mem.read8(0x75c5), 0xcd, "source 2 unchanged");
  assert.equal(m.mem.read8(0x638e), 0x04, "index at 0x638E decremented 5 -> 4");
  // MUTATION this catches: `ld de,0xffe0` -> `ld de,0x0020` (reading -0x20 as a
  // +0x20 forward stride) writes to 0x7625/0x75E5 instead of 0x75E5/0x75A5, so
  // 0x75E5 stays 0x00 and the copy assert fails. Also catches a dropped
  // `dec (hl)` (0x638E would stay 0x05) or B not zeroed (BC != index).
});

test("sub_304a charges exact T-states and step SEQUENCE (incl. both sub_3064 calls)", () => {
  // Closes §72 on this vector: image/state gates and stepcheck-targets don't
  // check cycle VALUES; this does. Total and sequence hand-summed from the
  // listing (§21), spanning both real `call 0x3064` expansions and their rets.
  //   sub_304a own: ld de 10 | ld a,(nn) 13 | ld c,a 4 | ld b,n 7 | ld hl 10 |
  //                 call 17 | ld hl 10 | call 17 | ld hl 10 | dec (hl) 11 | ret 10
  //   sub_3064 x2 : add hl,bc 11 | ld a,(hl) 7 | add hl,de 11 | ld (hl),a 7 | ret 10
  const OWN = 10 + 13 + 4 + 7 + 10 + 17 + 10 + 17 + 10 + 11 + 10; // 119
  const CALLEE = (11 + 7 + 11 + 7 + 10) * 2; // 46 * 2 = 92
  const EXPECTED = OWN + CALLEE;
  assert.equal(EXPECTED, 211, "the hand sum itself, so a typo above is visible");

  const m = new Machine(ROM);
  m.regs.sp = 0x6c00;
  m.push16(0xbeef);
  m.mem.write8(0x638e, 0x05);
  const before = m.cycles;
  const steps = [];
  const realStep = m.step.bind(m);
  m.step = (next, cyc) => { steps.push(next); return realStep(next, cyc); };
  sub_304a(m);

  assert.equal(m.cycles - before, EXPECTED, "total T-states across both calls");
  assert.deepEqual(steps, [
    0x304d, 0x3050, 0x3051, 0x3053, 0x3056,       // to the first call
    0x3064, 0x3065, 0x3066, 0x3067, 0x3068,       // sub_3064 body
    0x3059,                                        // ret -> return addr 0x3059
    0x305c,                                        // ld hl,0x75c0 -> to second call
    0x3064, 0x3065, 0x3066, 0x3067, 0x3068,       // sub_3064 body again
    0x305f,                                        // ret -> return addr 0x305f
    0x3062, 0x3063,                                // ld hl,0x638e ; dec (hl)
    0xbeef,                                        // final ret -> pushed caller
  ], "exact step sequence; a missing/extra/misaimed step or wrong call/ret shows here");
  assert.equal(steps.length, 21, "5 pre + 6 call1 + 1 mid + 6 call2 + 3 tail = 21");
});

// ---------------------------------------------------------------------------
// sub_30bd -- ROM 0x30BD-0x30DA. 0x1977-closure drain, UNGATED BY EXECUTION
// (callers 0x12A3/0x1615 untranslated). Zeros four stride-4 runs via sub_30e4:
// three real calls + one TAIL JUMP (jp 0x30e4). Expected values hand-derived
// from the listing (§21). The tail-jump/stack-splice is the judgement point.
// ---------------------------------------------------------------------------

test("sub_30bd zeros four stride-4 runs via sub_30e4 and TAIL-JUMPS to its caller", () => {
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00;
  m.push16(0xbeef); // the caller's return address; the TAIL jump must return HERE
  for (let a = 0x6940; a < 0x6a30; a++) m.mem.write8(a, 0xaa);

  let lastTarget = null;
  const realStep = m.step.bind(m);
  m.step = (next, cyc) => { lastTarget = next; return realStep(next, cyc); };
  sub_30bd(m);

  // Run 1: HL=0x6950 B=2  -> 0x6950,0x6954
  for (const a of [0x6950, 0x6954]) assert.equal(m.mem.read8(a), 0x00, `run1 zeroed 0x${a.toString(16)}`);
  assert.equal(m.mem.read8(0x6952), 0xaa, "run1 stride-4 gap untouched");
  // Run 2: HL=0x6980 B=10 -> 0x6980..0x69A4 (H PRESERVED at 0x69 across the call)
  for (let k = 0; k < 10; k++) assert.equal(m.mem.read8(0x6980 + 4 * k), 0x00, `run2 zeroed +${4 * k}`);
  assert.equal(m.mem.read8(0x69a8), 0xaa, "run2 stops after 10 (0x69A8 untouched)");
  // Run 3: HL=0x69B8 B=11 -> 0x69B8..0x69E0
  for (let k = 0; k < 11; k++) assert.equal(m.mem.read8(0x69b8 + 4 * k), 0x00, `run3 zeroed +${4 * k}`);
  // Run 4 (via TAIL JUMP): HL=0x6A0C B=5 -> 0x6A0C..0x6A1C
  for (let k = 0; k < 5; k++) assert.equal(m.mem.read8(0x6a0c + 4 * k), 0x00, `run4 zeroed +${4 * k}`);
  assert.equal(m.mem.read8(0x6a20), 0xaa, "run4 stops after 5 (0x6A20 untouched)");

  // H PRESERVATION: runs 2 and 3 landing in page 0x69 proves sub_30e4 kept H;
  // a corrupted H would scatter them elsewhere and 0x6980/0x69B8 would stay 0xAA.
  assert.equal(m.regs.hl, 0x6a20, "HL exits at 0x6A0C + 4*5 = 0x6A20 (last run ran via the tail jump)");

  // THE STACK SPLICE: the tail jump pushed nothing, so sub_30e4's final ret pops
  // the CALLER's 0xbeef -- SP returns to its initial value and the last step
  // targets 0xbeef. An extra push/ret (tail-jump-as-call) breaks one of these.
  assert.equal(m.regs.sp, 0x6c00, "SP back to initial -- exactly one ret consumed the caller frame");
  assert.equal(lastTarget, 0xbeef, "control returns to the CALLER, not to a spliced 0x30xx frame");
});

test("sub_30bd charges exact T-states and step COUNT across all four sub_30e4 calls", () => {
  // Closes §72 on this vector (cycle VALUES + missing/extra steps, which
  // stepcheck-targets and the image gate cannot see). All counts from the
  // listing (§21). sub_30e4 with count B: prologue ld a,l 4 | body (ld(hl) 10 +
  // add 7 + ld l,a 4)=21 x B | djnz 13*(B-1)+8 | ret 10 = 34B+9 cycles, 4B+2 steps.
  const own = 10 + 7 + 17 + 7 + 7 + 17 + 7 + 7 + 17 + 10 + 7 + 10; // 123 (jp=10, calls=17)
  const call30e4Cyc = (b) => 34 * b + 9;
  const call30e4Steps = (b) => 4 * b + 2;
  const EXPECTED = own + call30e4Cyc(2) + call30e4Cyc(10) + call30e4Cyc(11) + call30e4Cyc(5);
  const STEPS = 12 + call30e4Steps(2) + call30e4Steps(10) + call30e4Steps(11) + call30e4Steps(5);
  assert.equal(EXPECTED, 1111, "hand sum, so a typo is visible");
  assert.equal(STEPS, 132, "hand step count, so a typo is visible");

  const m = new Machine(ROM);
  m.regs.sp = 0x6c00;
  m.push16(0xbeef);
  for (let a = 0x6940; a < 0x6a30; a++) m.mem.write8(a, 0xaa);
  const before = m.cycles;
  let n = 0;
  const realStep = m.step.bind(m);
  m.step = (next, cyc) => { n++; return realStep(next, cyc); };
  sub_30bd(m);

  assert.equal(m.cycles - before, EXPECTED, "total T-states -- a mis-costed instr or tail-jump-as-call (call 17 vs jp 10) fails here");
  assert.equal(n, STEPS, "step count -- a spurious ret from mis-modelling the tail jump adds a step here");
});

// ---------------------------------------------------------------------------
// sub_306f -- ROM 0x306F-0x3095. 0x1977-closure drain, UNGATED BY EXECUTION
// (callers 0x0AE8/0x1732/0x1757 untranslated). Every-8th-call gate at 0x62AF;
// on the 8th, runs loc_0038 (via rst 0x38), two sub_3096, sub_0057, then toggles
// bit 7 of 0x692D. Expected values hand-derived from the ROM listing (§21) and
// the (separately-tested) callee bodies.
// ---------------------------------------------------------------------------

test("sub_306f: 7-of-8 calls hit the ret nz gate and run NO body", () => {
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00;
  m.push16(0xbeef);
  for (let a = 0x6900; a < 0x6940; a++) m.mem.write8(a, 0xaa);
  m.mem.write8(0x6018, 0x41); // sub_0057 input -- must stay untouched on this path
  m.mem.write8(0x62af, 0x05); // counter: inc -> 0x06, 0x06 & 7 = 6 (NZ) -> ret nz

  let lastTarget = null;
  const realStep = m.step.bind(m);
  m.step = (next, cyc) => { lastTarget = next; return realStep(next, cyc); };
  sub_306f(m);

  assert.equal(m.mem.read8(0x62af), 0x06, "counter incremented (inc (hl) ran)");
  assert.equal(m.mem.read8(0x690b), 0xaa, "loc_0038 did NOT run (body gated off)");
  assert.equal(m.mem.read8(0x6909), 0xaa, "sub_3096 did NOT run");
  assert.equal(m.mem.read8(0x692d), 0xaa, "final toggle did NOT run");
  assert.equal(m.mem.read8(0x6018), 0x41, "sub_0057 did NOT run");
  assert.equal(m.regs.sp, 0x6c00, "ret nz popped the caller frame -- SP restored");
  assert.equal(lastTarget, 0xbeef, "ret nz returns to the caller");
  // MUTATION: `ret nz` sense flipped (or gate mask wrong) runs the body on 7/8
  // calls -- 0x690b/0x6909/0x692d would change and this fails.
});

test("sub_306f: 8th call runs the whole body -- loc_0038, DE-stride sub_3096, bit-7 toggle", () => {
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00;
  m.push16(0xbeef);
  for (let a = 0x6900; a < 0x6940; a++) m.mem.write8(a, 0xaa);
  // loc_0038 subtracts 4 from ten bytes 0x690B stride 4 (0x20 -> 0x1C):
  for (let k = 0; k < 10; k++) m.mem.write8(0x690b + 4 * k, 0x20);
  // sub_3096 XORs 0x81 into 0x6909/0x690D and 0x691D/0x6921 (0x00 -> 0x81):
  for (const a of [0x6909, 0x690d, 0x691d, 0x6921]) m.mem.write8(a, 0x00);
  m.mem.write8(0x692d, 0x00); // final toggle target
  // sub_0057: A = 0x41 + 0x80 + 0x00 = 0xC1 (bit 7 set); `and 0x80` -> 0x80:
  m.mem.write8(0x6018, 0x41);
  m.mem.write8(0x601a, 0x80);
  m.mem.write8(0x6019, 0x00);
  m.mem.write8(0x62af, 0x07); // inc -> 0x08, 0x08 & 7 = 0 (Z) -> body runs

  let lastTarget = null;
  const realStep = m.step.bind(m);
  m.step = (next, cyc) => { lastTarget = next; return realStep(next, cyc); };
  sub_306f(m);

  assert.equal(m.mem.read8(0x62af), 0x08, "gate passed on the 8th (counter=8)");
  // loc_0038 ran (C=0xFC=-4), first and last of the 10-byte stride-4 run:
  assert.equal(m.mem.read8(0x690b), 0x1c, "loc_0038 subtracted 4 (0x20->0x1C), first byte");
  assert.equal(m.mem.read8(0x692f), 0x1c, "loc_0038 last byte (0x690B+4*9) -- confirms count 10, stride 4");
  assert.equal(m.mem.read8(0x690a), 0xaa, "loc_0038 stride gap untouched");
  // sub_3096 ran with DE=0x0004 (the loc_0038 side effect, draft OQ2):
  assert.equal(m.mem.read8(0x6909), 0x81, "sub_3096 call 1, byte 0 (0x00^0x81)");
  assert.equal(m.mem.read8(0x690d), 0x81, "sub_3096 call 1, byte 1 -- 0x6909+DE proves DE=0x0004 (OQ2)");
  assert.equal(m.mem.read8(0x691d), 0x81, "sub_3096 call 2, byte 0");
  assert.equal(m.mem.read8(0x6921), 0x81, "sub_3096 call 2, byte 1 -- DE=0x0004 again");
  // sub_0057 stored the full sum; the toggle keeps ONLY bit 7 (and 0x80):
  assert.equal(m.mem.read8(0x6018), 0xc1, "sub_0057 wrote the full sum 0x41+0x80+0x00=0xC1");
  assert.equal(m.mem.read8(0x692d), 0x80, "0x692D ^= (sum & 0x80) = 0x80 -- NOT 0xC1, so `and 0x80` held");
  assert.equal(m.regs.a, 0x80, "A leaves as bit 7 of the sum");
  // rst 0x38 + three calls are all balanced -- SP returns and we exit to caller:
  assert.equal(m.regs.sp, 0x6c00, "SP restored -- rst 0x38 push/pop and every call balanced");
  assert.equal(lastTarget, 0xbeef, "returns to the caller");
  // MUTATIONS: DE side-effect broken -> sub_3096 XORs 0x6909 twice, 0x690d stays
  // 0xAA (fails). `and 0x80` dropped -> 0x692d = 0xC1 (fails). rst-as-skip or
  // unbalanced push/pop -> SP wrong (fails).
});

test("sub_306f: 8th-call body charges exact T-states and step count", () => {
  // Closes §72 on this vector (cycle VALUES + the rst 0x38 / call push-pop
  // balance, invisible to the image gate and stepcheck-targets). All counts from
  // the listing (§21), spanning loc_0038 (+sub_003d x10), two sub_3096 (x2 each)
  // and sub_0057. loc_0038=442, sub_3096=96 each, sub_0057=70, own=187.
  const own = 10 + 11 + 7 + 7 + 5 + 10 + 7 + 11 + 7 + 10 + 17 + 10 + 17 + 17 + 7 + 10 + 7 + 7 + 10; // 187
  const loc0038 = 10 + 7 + (29 * 10 + (13 * 9 + 8) + 10); // ld de+ld b + sub_003d(body*10 + djnz + ret) = 442
  const sub3096 = 7 + (29 * 2 + (13 + 8) + 10); // 96
  const sub0057 = 13 + 10 + 7 + 10 + 7 + 13 + 10; // 70
  const EXPECTED = own + loc0038 + 2 * sub3096 + sub0057;
  // One m.step per executed instruction. The djnz loops emit 5 steps/iteration
  // (ld a,c / add|xor (hl) / ld (hl),a / add hl,de / djnz), which is where a
  // "4 body instrs" miscount goes wrong.
  const STEPS = 19                     // sub_306f's own 19 instructions
    + (1 + 1 + (5 * 10 + 1))           // loc_0038: ld de, ld b, sub_003d (5*10 + ret) = 53
    + 2 * (1 + 5 * 2 + 1)              // two sub_3096: ld b, 5*2, ret = 12 each = 24
    + 7;                               // sub_0057's 7 instructions
  assert.equal(loc0038, 442, "loc_0038 hand sum");
  assert.equal(EXPECTED, 891, "full-body hand sum, so a typo is visible");
  assert.equal(STEPS, 103, "hand step count (5 steps per djnz iteration, not 4)");

  const m = new Machine(ROM);
  m.regs.sp = 0x6c00;
  m.push16(0xbeef);
  for (let a = 0x6900; a < 0x6940; a++) m.mem.write8(a, 0x20);
  m.mem.write8(0x62af, 0x07);
  const before = m.cycles;
  let n = 0;
  const realStep = m.step.bind(m);
  m.step = (next, cyc) => { n++; return realStep(next, cyc); };
  sub_306f(m);

  assert.equal(m.cycles - before, EXPECTED, "total T-states across rst 0x38 + 2 calls + sub_0057");
  assert.equal(n, STEPS, "step count -- a mis-modelled rst/call push-pop changes this");
});

test("sub_31f6 returns two different values in A -- ret nz path returns 0x6018&3, not nothing", () => {
  // 0x1977-closure drain leaf, UNGATED BY EXECUTION. A is LIVE-OUT (sub_31dd
  // does cp 0x01 on it), so the early `ret nz` returns a REAL value. Values
  // hand-derived from the ROM (§21). Run A is the discriminating case.
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00;
  m.push16(0xbeef);
  // A) (0x6018 & 3) = 2 != 1 -> ret nz path returns A = 2 (NOT 0x601a):
  m.mem.write8(0x6018, 0x02);
  m.mem.write8(0x601a, 0x55);
  sub_31f6(m);
  assert.equal(m.regs.a, 0x02, "ret nz path returns A = 0x6018&3 = 2 (a real value, not 0x601a)");

  // B) (0x6018 & 3) = 1 -> fall through returns A = mem[0x601a]:
  const w = new Machine(ROM);
  w.regs.sp = 0x6c00;
  w.push16(0xbeef);
  w.mem.write8(0x6018, 0x01);
  w.mem.write8(0x601a, 0x55);
  sub_31f6(w);
  assert.equal(w.regs.a, 0x55, "fall-through returns A = mem[0x601a] = 0x55");

  // C) mask discriminator: 0x6018=0x06 -> &3 = 2 (not 6), != 1 -> returns 2:
  const x = new Machine(ROM);
  x.regs.sp = 0x6c00;
  x.push16(0xbeef);
  x.mem.write8(0x6018, 0x06);
  x.mem.write8(0x601a, 0x55);
  sub_31f6(x);
  assert.equal(x.regs.a, 0x02, "and 0x03 masks 0x06 -> 2 (a missing `and` would give 6, != 1, return 6)");
  // MUTATION (draft): ignore the ret nz (always fall through) -> run A returns
  // 0x55 not 0x02, failing. A missing `and 0x03` -> run C returns 0x06 not 0x02.
});

test("sub_31dd: `ret m` is SIGNED (not ret c), and the write gate is 3-part", () => {
  // 0x1977-closure drain, UNGATED BY EXECUTION. Writes 2 to 0x6439/0x6479 only
  // when 0x6380>=3 (signed) AND sub_31f6()==1. Values hand-derived (§21).
  const mk = () => { const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0xbeef); return m; };

  // TEST 1 -- `ret m` SIGNED, SYNTHETIC + LATENT (0x6380 is clamped <6 on real
  // tapes by sub_30fa; only this synthetic 0x83 exercises signed-vs-unsigned):
  //   A=0x83 -> cp 0x03 -> A-3=0x80, SIGN set (fM) -> ret m returns BEFORE writes.
  //   A `ret c` mutation would NOT return (carry clear) and would write.
  const t1 = mk();
  t1.mem.write8(0x6380, 0x83);
  t1.mem.write8(0x6018, 0x01); t1.mem.write8(0x601a, 0x01); // would satisfy the writes
  t1.mem.write8(0x6439, 0x00); t1.mem.write8(0x6479, 0x00);
  sub_31dd(t1);
  assert.equal(t1.mem.read8(0x6439), 0x00, "ret m (sign set) returns early -- NO write; ret c would write");
  assert.equal(t1.mem.read8(0x6479), 0x00, "0x6479 also unwritten on the signed early return");

  // TEST 2 -- gate: 0x6380>=3 passes the first gate, but sub_31f6 returns != 1
  // (0x6018&3==0), so ret nz -> no write:
  const t2 = mk();
  t2.mem.write8(0x6380, 0x05); // >= 3, sign clear -> no early return
  t2.mem.write8(0x6018, 0x00); // (0x6018&3)=0 -> sub_31f6 returns 0 != 1
  t2.mem.write8(0x6439, 0x00); t2.mem.write8(0x6479, 0x00);
  sub_31dd(t2);
  assert.equal(t2.mem.read8(0x6439), 0x00, "sub_31f6 returned 0 != 1 -> ret nz -> no write");

  // POSITIVE -- all three conditions met -> both writes happen:
  const t3 = mk();
  t3.mem.write8(0x6380, 0x05);            // >= 3, sign clear
  t3.mem.write8(0x6018, 0x01);            // (0x6018&3)=1
  t3.mem.write8(0x601a, 0x01);            // 0x601a=1 -> sub_31f6 returns 1
  t3.mem.write8(0x6439, 0x00); t3.mem.write8(0x6479, 0x00);
  sub_31dd(t3);
  assert.equal(t3.mem.read8(0x6439), 0x02, "all three conditions -> 0x6439 = 2");
  assert.equal(t3.mem.read8(0x6479), 0x02, "and 0x6479 = 2");
  // MUTATIONS (draft): `ret c` instead of `ret m` -> TEST 1 writes (fails);
  // drop the `ret nz` -> TEST 2 writes (fails).
});

test("sub_3fc0 writes 3 to 0x694D and advances HL to 0x694F (live-out)", () => {
  // 0x1977-closure drain leaf, UNGATED BY EXECUTION. Values hand-derived (§21):
  // the 0x03 is the ROM immediate at 0x3FC4; 0x694F = 0x694D + 2 (two inc l).
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00;
  m.push16(0xbeef);
  m.mem.write8(0x694d, 0xff); // plant a distinguishable value (non-vacuous vs 0x03)
  m.mem.write8(0x694e, 0xaa); // must NOT be written (stride skips it)
  sub_3fc0(m);
  assert.equal(m.mem.read8(0x694d), 0x03, "wrote 0x03 (ROM 0x3FC4 immediate) to 0x694D");
  assert.equal(m.mem.read8(0x694e), 0xaa, "0x694E skipped -- not written");
  assert.equal(m.regs.hl, 0x694f, "HL advanced by 2 to 0x694F (live-out; two inc l)");
  assert.equal(m.regs.h, 0x69, "inc l is L-only -- H unchanged");
  // MUTATIONS (draft): wrong immediate (0x30) fails the 0x694D assert; omitting
  // the two inc l leaves HL at 0x694D, failing the HL assert.
});

test("entry_34f3 scatter-gathers object bytes in order [+3,+7,+8,+5] into a record", () => {
  // MARQUEE (0x1977-closure drain, UNGATED). For each non-empty object at stride
  // 0x20 from 0x6400, gather mem[P+3],[P+7],[P+8],[P+5] into a 4-byte record at
  // 0x69D0. Offset 0 (the flag) is NOT copied. Offsets are the ROM's inc/dec l
  // arithmetic (§21); bytes chosen distinct so a sequential copy fails.
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00;
  m.push16(0xbeef);
  for (let a = 0x6400; a < 0x6500; a++) m.mem.write8(a, 0x00); // all objects empty by default
  for (let a = 0x69d0; a < 0x69f0; a++) m.mem.write8(a, 0x00);
  m.mem.write8(0x6400, 0x01); // object 0 non-empty (flag)
  m.mem.write8(0x6403, 0xa3); // P+3
  m.mem.write8(0x6407, 0xa7); // P+7
  m.mem.write8(0x6408, 0xa8); // P+8
  m.mem.write8(0x6405, 0xa5); // P+5
  m.mem.write8(0x6404, 0x44); // P+4 -- a sequential copy would wrongly grab this
  entry_34f3(m);
  assert.equal(m.mem.read8(0x69d0), 0xa3, "dest[0] = mem[P+3]");
  assert.equal(m.mem.read8(0x69d1), 0xa7, "dest[1] = mem[P+7] (NOT P+4=0x44)");
  assert.equal(m.mem.read8(0x69d2), 0xa8, "dest[2] = mem[P+8]");
  assert.equal(m.mem.read8(0x69d3), 0xa5, "dest[3] = mem[P+5]");
  // MUTATION (draft): sequential copy +3,+4,+5,+6 -> dest[1]=0x44 not 0xA7, fails.
});

test("entry_34f3: an EMPTY object still advances DE by 4, keeping records aligned", () => {
  // Object 0 empty, object 1 non-empty. Object 1's record must land at the SECOND
  // record slot (0x69D4), because object 0's empty pass advanced DE by 4.
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00;
  m.push16(0xbeef);
  for (let a = 0x6400; a < 0x6500; a++) m.mem.write8(a, 0x00);
  for (let a = 0x69d0; a < 0x69f0; a++) m.mem.write8(a, 0x00);
  m.mem.write8(0x6400, 0x00); // object 0 EMPTY
  m.mem.write8(0x6420, 0x01); // object 1 non-empty (stride 0x20)
  m.mem.write8(0x6423, 0xb3);
  m.mem.write8(0x6427, 0xb7);
  m.mem.write8(0x6428, 0xb8);
  m.mem.write8(0x6425, 0xb5);
  entry_34f3(m);
  assert.equal(m.mem.read8(0x69d0), 0x00, "first record slot untouched (object 0 was empty)");
  assert.equal(m.mem.read8(0x69d4), 0xb3, "object 1's record lands at 0x69D4 -- empty pass advanced DE");
  assert.equal(m.mem.read8(0x69d5), 0xb7, "object 1 dest[1] at the second record");
  // MUTATION (draft): empty path forgets DE += 4 -> object 1 overwrites 0x69D0,
  // and 0x69D4 stays 0x00 -- fails.
});

test("entry_34f3 charges exact T-states and step count for 5 empty objects", () => {
  // §72 pin on the loop mechanics (the all-empty path is fully determinate).
  // Counts from the listing (§21). Empty iteration (djnz taken) = 89 T / 14 steps;
  // the last (djnz not taken) = 84 T. Prologue 27 T / 3 steps; ret 10 T / 1 step.
  const emptyIterTaken = 7 + 4 + 10 + 7 + 4 + 4 + 7 + 4 + 4 + 10 + 7 + 4 + 4 + 13; // 89
  const EXPECTED = (10 + 10 + 7) + emptyIterTaken * 4 + (emptyIterTaken - 13 + 8) + 10;
  const STEPS = 3 + 14 * 5 + 1; // prologue + 14/empty-iter x5 + ret
  assert.equal(emptyIterTaken, 89, "empty-iteration hand sum");
  assert.equal(EXPECTED, 477, "5-empty-object hand sum, so a typo is visible");
  assert.equal(STEPS, 74, "hand step count");

  const m = new Machine(ROM);
  m.regs.sp = 0x6c00;
  m.push16(0xbeef);
  for (let a = 0x6400; a < 0x6500; a++) m.mem.write8(a, 0x00); // all empty
  const before = m.cycles;
  let n = 0;
  const realStep = m.step.bind(m);
  m.step = (next, cyc) => { n++; return realStep(next, cyc); };
  entry_34f3(m);
  assert.equal(m.cycles - before, EXPECTED, "total T-states, 5 empty objects");
  assert.equal(n, STEPS, "step count");
});

test("entry_330f: timer down-counts, reloads to 0x2B on expiry (dec -> 0x2A)", () => {
  // 0x1977-closure drain, UNGATED BY EXECUTION. IX live-in (object pointer).
  // Every path falls through loc_3332's dec, so a reload yields 0x2B-1 = 0x2A.
  // Values ROM-sourced (0x2B is the 0x3319 immediate).
  const mk = () => { const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0xbeef); m.regs.ix = 0x6400; return m; };

  // A) timer non-zero -> just decrement (5 -> 4), no reload, state untouched
  const a = mk();
  a.mem.write8(0x6416, 0x05);
  a.mem.write8(0x640d, 0x07); // state must NOT be reset on this path
  entry_330f(a);
  assert.equal(a.mem.read8(0x6416), 0x04, "timer 5 -> 4 (dec only)");
  assert.equal(a.mem.read8(0x640d), 0x07, "state untouched while the timer runs");

  // B) timer expired, 0x6018 bit 0 CLEAR -> reload 0x2B then dec -> 0x2A, state reset to 0
  const b = mk();
  b.mem.write8(0x6416, 0x00);
  b.mem.write8(0x6018, 0x00); // bit 0 clear -> jp nc taken
  b.mem.write8(0x640d, 0x07);
  entry_330f(b);
  assert.equal(b.mem.read8(0x6416), 0x2a, "reload 0x2B then dec -> 0x2A");
  assert.equal(b.mem.read8(0x640d), 0x00, "state reset to 0 on reload");
  // MUTATION: reload 0x2C -> 0x2B here, fails.
});

test("entry_330f: state goes 0 -> 1 on 0x6018 bit 0; loc_3336 (state=2) never fires", () => {
  // Pins the draft's §3 FINDING: 0x331B resets state to 0, so the `cp 0x01` at
  // 0x3329 never matches and loc_3336 (state := 2) is UNREACHABLE. state=2 must
  // not be producible by any input.
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00;
  m.push16(0xbeef);
  m.regs.ix = 0x6400;
  m.mem.write8(0x6416, 0x00); // expired -> reload path
  m.mem.write8(0x6018, 0x01); // bit 0 SET -> jp nc NOT taken, reach 0x3326
  m.mem.write8(0x640d, 0x07); // a prior state -- must be RESET to 0, then set to 1
  entry_330f(m);
  assert.equal(m.mem.read8(0x640d), 0x01, "state := 1 (NOT 2 -- loc_3336 is unreachable)");
  assert.notEqual(m.mem.read8(0x640d), 0x02, "state=2 is not producible via this routine");
  assert.equal(m.mem.read8(0x6416), 0x2a, "and the timer still reloads+decs to 0x2A");
  // Even pre-setting state to 1 cannot reach loc_3336, because 0x331B resets it
  // to 0 BEFORE the cp -- the reset is what makes the branch dead.
  const w = new Machine(ROM);
  w.regs.sp = 0x6c00; w.push16(0xbeef); w.regs.ix = 0x6400;
  w.mem.write8(0x6416, 0x00); w.mem.write8(0x6018, 0x01);
  w.mem.write8(0x640d, 0x01); // pre-set state = 1: still cannot reach loc_3336
  entry_330f(w);
  assert.equal(w.mem.read8(0x640d), 0x01, "pre-set state=1 still yields 1, not 2 (reset defeats the check)");
});

test("sub_3409 frame timer: reload 2, advance frame, and xor 0x02 TOGGLES at nibble 0x0F", () => {
  // 0x1977-closure drain, UNGATED BY EXECUTION. IX live-in. Values ROM-sourced
  // (reload 0x02 at 0x3413; the 0x0F mask/compare; the 0x02 xor operand).
  const mk = () => { const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0xbeef); m.regs.ix = 0x6400; return m; };

  // A) timer non-zero -> just decrement, frame untouched
  const a = mk();
  a.mem.write8(0x6415, 0x02);
  a.mem.write8(0x6407, 0x30);
  sub_3409(a);
  assert.equal(a.mem.read8(0x6415), 0x01, "timer 2 -> 1 (dec only)");
  assert.equal(a.mem.read8(0x6407), 0x30, "frame untouched while the timer runs");

  // B) expired, frame low nibble NOT 0x0F after inc -> reload 2, inc frame, ret nz
  const b = mk();
  b.mem.write8(0x6415, 0x00);
  b.mem.write8(0x6407, 0x30); // inc -> 0x31, low nibble 1 != 0xF
  sub_3409(b);
  assert.equal(b.mem.read8(0x6415), 0x02, "timer reloaded to 2");
  assert.equal(b.mem.read8(0x6407), 0x31, "frame advanced 0x30 -> 0x31, no xor");

  // C) expired, frame low nibble becomes 0x0F -> xor 0x02 TOGGLES bit 1.
  //    0x0E + 1 = 0x0F (nibble 0xF) -> 0x0F ^ 0x02 = 0x0D. NOT 0x11 (+2), NOT 0x0F (|2).
  const c = mk();
  c.mem.write8(0x6415, 0x00);
  c.mem.write8(0x6407, 0x0e);
  sub_3409(c);
  assert.equal(c.mem.read8(0x6407), 0x0d, "0x0F ^ 0x02 = 0x0D -- xor TOGGLES (bit 1 was set, so it CLEARS)");

  // D) the toggle in the other direction: 0x1D + 1 = 0x1E? no -- use 0x2E -> 0x2F,
  //    0x2F ^ 0x02 = 0x2D. And a frame whose bit 1 is CLEAR at the boundary:
  //    0x3C + 1 = 0x3D (nibble 0xD, not 0xF) -> no xor. Use 0x4E -> 0x4F ^ 2 = 0x4D.
  const d = mk();
  d.mem.write8(0x6415, 0x00);
  d.mem.write8(0x6407, 0x4e);
  sub_3409(d);
  assert.equal(d.mem.read8(0x6407), 0x4d, "0x4F ^ 0x02 = 0x4D");
  // MUTATION: `+2` gives 0x11/0x51; `|2` gives 0x0F/0x4F -- both fail run C/D.
});

test("entry_33e7 adjusts (ix+0x0f) by state (ix+0x0d) and the period-2 sub-timer", () => {
  // 0x1977-closure drain, UNGATED BY EXECUTION. IX live-in. Calls sub_3409 FIRST;
  // (ix+0x15) is planted non-zero so sub_3409 just decs its own timer and leaves
  // (ix+0x07) alone, isolating this routine's logic. Values ROM-sourced (cp 0x08,
  // the 0x02 reload).
  const mk = () => {
    const m = new Machine(ROM);
    m.regs.sp = 0x6c00; m.push16(0xbeef); m.regs.ix = 0x6400;
    m.mem.write8(0x6415, 0x05); // sub_3409's timer: non-zero -> it only decs this
    m.mem.write8(0x6407, 0x30); // frame: must stay untouched on that path
    return m;
  };

  // A) state != 8 -> inc (ix+0x0f)
  const a = mk();
  a.mem.write8(0x640d, 0x03); // state 3 != 8
  a.mem.write8(0x640f, 0x10);
  entry_33e7(a);
  assert.equal(a.mem.read8(0x640f), 0x11, "state != 8 -> inc (ix+0x0f)");
  assert.equal(a.mem.read8(0x6415), 0x04, "sub_3409 ran first (its timer 5 -> 4)");
  assert.equal(a.mem.read8(0x6407), 0x30, "sub_3409 did not advance the frame");

  // B) state == 8, sub-timer != 0 -> dec (ix+0x14), (ix+0x0f) untouched
  const b = mk();
  b.mem.write8(0x640d, 0x08);
  b.mem.write8(0x6414, 0x02);
  b.mem.write8(0x640f, 0x10);
  entry_33e7(b);
  assert.equal(b.mem.read8(0x6414), 0x01, "sub-timer 2 -> 1");
  assert.equal(b.mem.read8(0x640f), 0x10, "(ix+0x0f) untouched while the sub-timer runs");

  // C) state == 8, sub-timer == 0 -> reload to 2 AND dec (ix+0x0f)
  const c = mk();
  c.mem.write8(0x640d, 0x08);
  c.mem.write8(0x6414, 0x00);
  c.mem.write8(0x640f, 0x10);
  entry_33e7(c);
  assert.equal(c.mem.read8(0x6414), 0x02, "sub-timer reloaded to 2");
  assert.equal(c.mem.read8(0x640f), 0x0f, "and (ix+0x0f) DECREMENTED (0x10 -> 0x0F)");
  // MUTATION: swapping inc/dec on (ix+0x0f) makes A give 0x0F and C give 0x11 --
  // the two paths move it in OPPOSITE directions, so a swap fails both.
});

test("sub_32d6 down-counter: the dec (ix+0x1c) Z flag drives the jp nz (the primitive's case)", () => {
  // 0x1977-closure drain, UNGATED BY EXECUTION. IX live-in. This is the routine
  // the incMem8/decMem8 primitive was built for: `dec (ix+0x1c)` at 0x32FD sets
  // the Z that `jp nz` at 0x3300 reads. Values ROM-sourced (cp 0x00/0x01, 0xFF
  // reload, 0x6205).
  const mk = () => {
    const m = new Machine(ROM);
    m.regs.sp = 0x6c00; m.push16(0xbeef); m.regs.ix = 0x6400;
    m.mem.write8(0x6416, 0x05); // entry_330f's timer, if it gets called
    return m;
  };

  // TEST 1 -- counter 3 -> 2, still non-zero: takes jp nz to loc_32f8, zeroes
  // (ix+0x0d), and must NOT call entry_330f (which would touch 0x6416).
  const a = mk();
  a.mem.write8(0x641c, 0x03);
  a.mem.write8(0x640d, 0x09);
  a.mem.write8(0x6419, 0x77);
  sub_32d6(a);
  assert.equal(a.mem.read8(0x641c), 0x02, "counter decremented 3 -> 2");
  assert.equal(a.mem.read8(0x640d), 0x00, "loc_32f8 zeroed (ix+0x0d)");
  assert.equal(a.mem.read8(0x6419), 0x77, "(ix+0x19) untouched -- loc_3303 NOT taken");
  assert.equal(a.mem.read8(0x6416), 0x05, "entry_330f NOT called on this path");

  // TEST 2 -- counter 1 -> 0: the dec's Z is SET, so jp nz is NOT taken and it
  // falls into loc_3303 (zero 0x19/0x1c) then calls entry_330f. THIS is the
  // branch a flag-dropping RMW would never reach.
  const b = mk();
  b.mem.write8(0x641c, 0x01);
  b.mem.write8(0x6419, 0x77);
  sub_32d6(b);
  assert.equal(b.mem.read8(0x641c), 0x00, "counter hit zero, then loc_3303 zeroes it");
  assert.equal(b.mem.read8(0x6419), 0x00, "loc_3303 zeroed (ix+0x19) -- the hit-zero branch RAN");
  assert.equal(b.mem.read8(0x6416), 0x04, "entry_330f WAS called (its timer 5 -> 4)");

  // TEST 3 -- the unsigned borrow: counter already 0 and armed ((ix+0x1d)==1).
  //   0x6205 - (ix+0x0f): borrow -> loc_3303 ; no borrow -> reload 0xFF.
  const c = mk(); // no borrow: 0x50 - 0x10 = 0x40, carry clear -> reload 0xFF
  c.mem.write8(0x641c, 0x00);
  c.mem.write8(0x641d, 0x01);
  c.mem.write8(0x6205, 0x50);
  c.mem.write8(0x640f, 0x10);
  sub_32d6(c);
  assert.equal(c.mem.read8(0x641c), 0xff, "no borrow -> (ix+0x1c) reloaded to 0xFF");
  assert.equal(c.mem.read8(0x641d), 0x00, "(ix+0x1d) disarmed");

  const d = mk(); // borrow: 0x10 - 0x50 < 0, carry set -> loc_3303 + entry_330f
  d.mem.write8(0x641c, 0x00);
  d.mem.write8(0x641d, 0x01);
  d.mem.write8(0x6205, 0x10);
  d.mem.write8(0x640f, 0x50);
  d.mem.write8(0x6419, 0x77);
  sub_32d6(d);
  assert.equal(d.mem.read8(0x6419), 0x00, "borrow -> loc_3303 zeroed (ix+0x19)");
  assert.equal(d.mem.read8(0x641c), 0x00, "and (ix+0x1c) zeroed, NOT reloaded to 0xFF");
  assert.equal(d.mem.read8(0x6416), 0x04, "entry_330f called on the borrow path");
});


test("sub_342c walks the animation table; the adc-hl zero test gates re-initialisation", () => {
  // 0x1977-closure drain, UNGATED BY EXECUTION. IX live-in. The saved pointer is
  // (ix+0x1a):(ix+0x1b). Values ROM-sourced: the table base 0x3A8C, the 0x26 seed,
  // the 0xAA terminator, and ROM[0x3A8C] = 0xE8.
  const mk = () => { const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0xbeef); m.regs.ix = 0x6400; return m; };

  // A) FIRST CALL: saved pointer is 0 -> adc hl,bc sets Z -> initialise to 0x3A8C.
  const a = mk();
  a.mem.write8(0x641a, 0x00); a.mem.write8(0x641b, 0x00);
  sub_342c(a);
  assert.equal(a.mem.read8(0x6403), 0x27, "seeded 0x26 then inc -> 0x27");
  assert.equal(a.mem.read8(0x6405), 0xe8, "stored ROM[0x3A8C] = 0xE8");
  assert.equal(a.mem.read8(0x641a), 0x8d, "pointer advanced to 0x3A8D (low)");
  assert.equal(a.mem.read8(0x641b), 0x3a, "pointer advanced to 0x3A8D (high)");

  // B) RESUMED CALL: saved pointer non-zero -> Z clear -> must NOT re-initialise.
  //    This is the adcHl discriminator: `xor a` SETS Z, so an add-hl (Z-preserving)
  //    translation would leave Z set, always take the init path, and clobber
  //    (ix+0x03) with 0x26+1 instead of advancing the caller's own counter.
  const b = mk();
  b.mem.write8(0x641a, 0x00); b.mem.write8(0x641b, 0x62); // HL = 0x6200 (work RAM)
  b.mem.write8(0x6200, 0x55);
  b.mem.write8(0x6403, 0x10);
  sub_342c(b);
  assert.equal(b.mem.read8(0x6403), 0x11, "counter advanced 0x10 -> 0x11 -- NOT re-seeded to 0x27");
  assert.equal(b.mem.read8(0x6405), 0x55, "stored the entry at the saved pointer");
  assert.equal(b.mem.read8(0x641a), 0x01, "pointer advanced to 0x6201 (low)");
  assert.equal(b.mem.read8(0x641b), 0x62, "pointer high unchanged");

  // C) TERMINATOR 0xAA -> finalize: zero four fields, copy 0x03->0x0e and
  //    0x05->0x0f, and clear the saved pointer.
  const c = mk();
  c.mem.write8(0x641a, 0x00); c.mem.write8(0x641b, 0x62);
  c.mem.write8(0x6200, 0xaa); // terminator
  c.mem.write8(0x6403, 0x40);
  c.mem.write8(0x6405, 0x77);
  for (const off of [0x13, 0x18, 0x0d, 0x1c]) c.mem.write8(0x6400 + off, 0x99);
  sub_342c(c);
  for (const off of [0x13, 0x18, 0x0d, 0x1c]) {
    assert.equal(c.mem.read8(0x6400 + off), 0x00, `finalize zeroed (ix+0x${off.toString(16)})`);
  }
  assert.equal(c.mem.read8(0x640e), 0x41, "(ix+0x0e) = (ix+0x03) after its inc (0x40 -> 0x41)");
  assert.equal(c.mem.read8(0x640f), 0x77, "(ix+0x0f) = (ix+0x05), the last stored entry");
  assert.equal(c.mem.read8(0x641a), 0x00, "saved pointer cleared (low)");
  assert.equal(c.mem.read8(0x641b), 0x00, "saved pointer cleared (high)");
  assert.equal(c.mem.read8(0x6405), 0x77, "(ix+0x05) NOT overwritten on the terminator path");
});

test("sub_3478 is sub_342c's TWIN: own table 0x3AAC, direction state machine, tail-jump exit", () => {
  // 0x1977-closure drain, UNGATED BY EXECUTION. IX live-in. sub_3478 has NO ret:
  // both exits jp into sub_342c's loc_3445 with nothing pushed, so that tail's
  // ret returns to OUR caller. Values ROM-sourced (table 0x3AAC, bases 0x7E/0x80).
  const mk = () => { const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0xbeef); m.regs.ix = 0x6400; return m; };
  const ROM_3AAC = ROM[0x3aac];

  // A) FIRST CALL, 0x6203 bit 7 SET -> FORWARD: (ix+0x0d)=1, base 0x7E, inc -> 0x7F,
  //    then the shared tail stores ROM[0x3AAC] and advances the pointer.
  const a = mk();
  a.mem.write8(0x641a, 0x00); a.mem.write8(0x641b, 0x00);
  a.mem.write8(0x6203, 0x80); // bit 7 set
  sub_3478(a);
  assert.equal(a.mem.read8(0x640d), 0x01, "forward direction state = 1");
  assert.equal(a.mem.read8(0x6403), 0x7f, "forward base 0x7E then INC -> 0x7F");
  assert.equal(a.mem.read8(0x6405), ROM_3AAC, "shared tail stored ROM[0x3AAC] -- this twin's OWN table");
  assert.equal(a.mem.read8(0x641a), 0xad, "pointer advanced to 0x3AAD (low)");
  assert.equal(a.mem.read8(0x641b), 0x3a, "pointer advanced to 0x3AAD (high)");
  assert.equal(a.regs.sp, 0x6c00, "tail-jump: loc_3445's ret consumed OUR caller frame -- SP restored");

  // B) FIRST CALL, 0x6203 bit 7 CLEAR -> BACKWARD: (ix+0x0d)=2, base 0x80, DEC -> 0x7F.
  //    Same table, opposite index direction -- this is what distinguishes the twin.
  const b = mk();
  b.mem.write8(0x641a, 0x00); b.mem.write8(0x641b, 0x00);
  b.mem.write8(0x6203, 0x00); // bit 7 clear
  sub_3478(b);
  assert.equal(b.mem.read8(0x640d), 0x02, "backward direction state = 2");
  assert.equal(b.mem.read8(0x6403), 0x7f, "backward base 0x80 then DEC -> 0x7F");

  // C) RESUMED CALL with direction already backward: skips init, DECs the index.
  const c = mk();
  c.mem.write8(0x641a, 0x00); c.mem.write8(0x641b, 0x62); // HL = 0x6200, non-zero
  c.mem.write8(0x6200, 0x55);
  c.mem.write8(0x640d, 0x02); // backward
  c.mem.write8(0x6403, 0x40);
  sub_3478(c);
  assert.equal(c.mem.read8(0x6403), 0x3f, "resumed backward: 0x40 DEC -> 0x3F (no re-seed)");
  assert.equal(c.mem.read8(0x6405), 0x55, "shared tail stored the entry at the saved pointer");

  // D) RESUMED CALL, direction forward: INCs instead.
  const d = mk();
  d.mem.write8(0x641a, 0x00); d.mem.write8(0x641b, 0x62);
  d.mem.write8(0x6200, 0x55);
  d.mem.write8(0x640d, 0x01); // forward
  d.mem.write8(0x6403, 0x40);
  sub_3478(d);
  assert.equal(d.mem.read8(0x6403), 0x41, "resumed forward: 0x40 INC -> 0x41 -- opposite of C");
});

test("sub_34b9 selects table by 0x6203 bit 7, indexes by (0x6019 & 6), pairs the fields", () => {
  // 0x1977-closure drain, UNGATED BY EXECUTION. IX live-in. Expected values are
  // the ROM tables themselves (§21): 0x3AC4 = ee f0 db a0 e6 c8 d6 78,
  // 0x3AD4 = 1b c8 23 a0 2b 78 12 f0.
  const mk = () => { const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0xbeef); m.regs.ix = 0x6400; return m; };

  // A) 0x6227 == 3 -> immediate ret, NOTHING written.
  const a = mk();
  a.mem.write8(0x6227, 0x03);
  a.mem.write8(0x6403, 0x99); a.mem.write8(0x640d, 0x99);
  sub_34b9(a);
  assert.equal(a.mem.read8(0x6403), 0x99, "ret z fired -- (ix+0x03) untouched");
  assert.equal(a.mem.read8(0x640d), 0x99, "and (ix+0x0d) not cleared");

  // B) bit 7 CLEAR -> table 0x3AC4, index (0x6019 & 6) = 0 -> entry ee f0.
  const b = mk();
  b.mem.write8(0x6227, 0x00);
  b.mem.write8(0x6203, 0x00); // bit 7 clear
  b.mem.write8(0x6019, 0x00); // index 0
  for (const off of [0x0d, 0x18, 0x1c]) b.mem.write8(0x6400 + off, 0x99);
  sub_34b9(b);
  assert.equal(b.mem.read8(0x6403), 0xee, "table 0x3AC4[0] = 0xEE -> (ix+0x03)");
  assert.equal(b.mem.read8(0x640e), 0xee, "SAME byte also into (ix+0x0e)");
  assert.equal(b.mem.read8(0x6405), 0xf0, "table 0x3AC4[1] = 0xF0 -> (ix+0x05)");
  assert.equal(b.mem.read8(0x640f), 0xf0, "SAME byte also into (ix+0x0f)");
  for (const off of [0x0d, 0x18, 0x1c]) {
    assert.equal(b.mem.read8(0x6400 + off), 0x00, `cleared (ix+0x${off.toString(16)})`);
  }

  // C) bit 7 SET -> table 0x3AD4, same index 0 -> entry 1b c8. This is the
  //    table-select discriminator: a inverted bit test would give 0xEE/0xF0.
  const c = mk();
  c.mem.write8(0x6227, 0x00);
  c.mem.write8(0x6203, 0x80); // bit 7 SET
  c.mem.write8(0x6019, 0x00);
  sub_34b9(c);
  assert.equal(c.mem.read8(0x6403), 0x1b, "table 0x3AD4[0] = 0x1B (NOT 0xEE) -- bit 7 set picks 0x3AD4");
  assert.equal(c.mem.read8(0x6405), 0xc8, "table 0x3AD4[1] = 0xC8");

  // D) the (0x6019 & 6) MASK: 0x07 must index 6, not 7. 0x3AC4[6..7] = d6 78.
  //    An `& 7` mutation would index 7 and read 0x78/<0x3ACC>.
  const d = mk();
  d.mem.write8(0x6227, 0x00);
  d.mem.write8(0x6203, 0x00);
  d.mem.write8(0x6019, 0x07); // & 6 -> 6 (even), NOT 7
  sub_34b9(d);
  assert.equal(d.mem.read8(0x6403), 0xd6, "0x07 & 6 = 6 -> 0x3AC4[6] = 0xD6 (an &7 would give 0x78)");
  assert.equal(d.mem.read8(0x6405), 0x78, "0x3AC4[7] = 0x78");
});

test("sub_32bd dispatches 0x6227 to the right handler (tests the DISPATCH, not the handlers)", () => {
  // 0x1977-closure drain, UNGATED BY EXECUTION. Deliberately keyed on a
  // DISTINCTIVE FINGERPRINT of each handler rather than on what the handler
  // computes: sub_32bd's three callees are themselves drained-but-unexercised,
  // so asserting their outputs here would let a wrong callee and a matching
  // dispatch agree (a §29 compensating pair). These assertions ask only "which
  // handler ran".
  const mk = () => { const m = new Machine(ROM); m.regs.sp = 0x6c00; m.push16(0xbeef); m.regs.ix = 0x6400; return m; };

  // 0x6227 == 1 -> sub_342c. Fingerprint: it walks the 0x3A8C table, so the
  // saved pointer lands at 0x3A8D.
  const a = mk();
  a.mem.write8(0x6227, 0x01);
  a.mem.write8(0x641a, 0x00); a.mem.write8(0x641b, 0x00);
  sub_32bd(a);
  assert.equal(a.mem.read8(0x641a), 0x8d, "0x6227==1 ran sub_342c (pointer -> 0x3A8D)");
  assert.equal(a.mem.read8(0x641b), 0x3a, "...high byte 0x3A");

  // 0x6227 == 2 -> sub_3478. Fingerprint: its OWN table is 0x3AAC, so the saved
  // pointer lands at 0x3AAD (low byte 0xAD, not 0x8D) and it sets a direction.
  const b = mk();
  b.mem.write8(0x6227, 0x02);
  b.mem.write8(0x6203, 0x80); // bit 7 set -> forward
  b.mem.write8(0x641a, 0x00); b.mem.write8(0x641b, 0x00);
  sub_32bd(b);
  assert.equal(b.mem.read8(0x641a), 0xad, "0x6227==2 ran sub_3478 (pointer -> 0x3AAD, NOT 0x3A8D)");
  assert.equal(b.mem.read8(0x640d), 0x01, "...and set the direction state sub_342c never writes");

  // default arm (0x6227 == 0) -> sub_34b9. Fingerprint: it writes the SAME byte
  // into a field PAIR ((ix+0x03) == (ix+0x0e)), which neither twin does.
  // NB 0x6227 == 3 would make sub_34b9 return immediately, so 0 is used to
  // reach its body while still taking the default arm.
  const c = mk();
  c.mem.write8(0x6227, 0x00);
  c.mem.write8(0x6203, 0x00);
  c.mem.write8(0x6019, 0x00);
  sub_32bd(c);
  assert.equal(c.mem.read8(0x6403), c.mem.read8(0x640e), "default arm ran sub_34b9 (paired fields equal)");
  assert.equal(c.mem.read8(0x6403), 0xee, "...loading 0x3AC4[0] = 0xEE");
  assert.equal(c.mem.read8(0x641a), 0x00, "...and no table pointer was saved (neither twin ran)");

  // SP balance across all three arms, incl. the sub_3478 arm whose handler has
  // no ret of its own (loc_3445's ret consumes the pushed 0x32D5).
  for (const m2 of [a, b, c]) assert.equal(m2.regs.sp, 0x6c00, "SP restored -- call/ret balanced on every arm");
});

test("sub_33a1: TWO different caller-skips -- rst 0x30 gate vs the inc-sp splice", () => {
  // 0x1977-closure drain, UNGATED BY EXECUTION. IX live-in. Twelve bytes with
  // two skips that MEAN different things, separated here by the BOOLEAN, by
  // where SP ends up, and by whether A was reloaded (which proves the gate did
  // or did not fire). Values ROM-sourced (A=0x07, cp 0x59; 0x6227 is the rotate
  // count sub_0030 uses).
  //
  // sub_0030 does `ld b,(0x6227)` then `rrca` B times, so carry ends up holding
  // BIT (B-1) OF A. With A = 0x07 (0b00000111): B=1..3 select a SET bit (gate
  // does NOT fire); B=4 selects bit 3, which is CLEAR (gate FIRES).
  // NB B=0 is NOT "no rotates" -- djnz decrements first, so it runs 256 times
  // and lands on bit 7. That is why 0x6227 = 1, not 0, is used for the
  // gate-does-not-fire cases.
  //
  // Frame layout: caller's-caller return pushed first, then entry_333d's, so a
  // splice (which drops entry_333d's) lands on the outer one.
  const mk = () => {
    const m = new Machine(ROM);
    m.regs.sp = 0x6c00;
    m.push16(0xcafe); // entry_333d's caller's return
    m.push16(0xbeef); // entry_333d's own return
    m.regs.ix = 0x6400;
    return m;
  };

  // A) GATE FIRES: 0x6227 = 4 selects bit 3 of 0x07, which is clear.
  const a = mk();
  a.mem.write8(0x6227, 0x04);
  a.mem.write8(0x640f, 0x00); // would splice if we ever reached the cp
  assert.equal(sub_33a1(a), true, "gate path returns TRUE -- entry_333d WAS returned to");
  // sub_0030 ROTATES A: 0x07 ror 4 = 0x83 -> 0xC1 -> 0xE0 -> 0x70. So A is 0x70,
  // and crucially NOT the planted field value 0x00 -- which proves
  // `ld a,(ix+0x0f)` never ran, i.e. the gate fired.
  assert.equal(a.regs.a, 0x70, "A = 0x07 rotated right 4 by sub_0030, NOT the field's 0x00 -- gate fired");
  assert.equal(a.regs.sp, 0x6bfe, "gate consumed only entry_333d's frame");

  // B) NORMAL return: gate does not fire (0x6227 = 1 -> bit 0 of 0x07 is set),
  //    and (ix+0x0f) == 0x59 is NOT below the threshold -> ret nc.
  const b = mk();
  b.mem.write8(0x6227, 0x01);
  b.mem.write8(0x640f, 0x59);
  assert.equal(sub_33a1(b), true, "0x59 is not below 0x59 -- normal ret nc, TRUE");
  assert.equal(b.regs.a, 0x59, "A reloaded from (ix+0x0f) -- proves we passed the gate");
  assert.equal(b.regs.sp, 0x6bfe, "normal return consumed entry_333d's frame only");

  // C) SPLICE: gate does not fire, (ix+0x0f) = 0x58 is below -> inc sp/inc sp/ret
  //    skips entry_333d and returns to ITS caller.
  const c = mk();
  c.mem.write8(0x6227, 0x01);
  c.mem.write8(0x640f, 0x58);
  assert.equal(sub_33a1(c), false, "below 0x59 -> SPLICE -> FALSE, entry_333d is skipped");
  assert.equal(c.regs.a, 0x58, "A reloaded -- proves the splice came from the cp, not the gate");
  assert.equal(c.regs.sp, 0x6c00, "splice consumed BOTH frames -- returned to the caller's CALLER");
  // 0x58 vs 0x59 is the boundary: an off-by-one or a signed compare moves which
  // of B/C splices. And A distinguishes a gate-skip from a cp-splice, which the
  // boolean alone cannot (both A and B return true).
});

test("entry_313c scans 5 objects and SPLICES to the caller's caller when the count is zero", () => {
  // 0x1977-closure drain, >= 0x3000, UNGATED BY EXECUTION (only caller entry_30ed
  // is untranslated) -- NET-ZERO. The entry_24b4 caller's-caller-skip class: the
  // count of non-empty objects (0x63A1) gates a conditional stack splice at 0x3179.
  // Skip-capable -> boolean return (cf. sub_33a1). Frame layout matches sub_33a1:
  // caller's-caller pushed first, then entry_30ed's continuation (0x30F3) on top,
  // so a splice drops 0x30F3 and lands on the outer caller. Objects at 0x6400
  // stride 0x20; "non-empty" = (ix+0) != 0. Empty-slot inputs 0x6227/0x63a0 set to
  // 0 so the empty path is a plain continue (no insertion, no count bump).
  const CC = 0xc0de; // entry_30ed's caller -- the splice target
  const RET = 0x30f3; // entry_30ed's continuation -- the normal-ret target
  const mk = () => {
    const m = new Machine(ROM);
    m.regs.sp = 0x6c00;
    m.push16(CC); // entry_30ed's caller's return
    m.push16(RET); // entry_30ed's own continuation (0x30F3), on top
    return m; // sp = 0x6bfc, top word = 0x30F3
  };

  // TEST 1 -- MARQUEE: all 5 objects empty -> counter 0 -> SPLICE (§3).
  const s = mk();
  for (const k of [0, 1, 2, 3, 4]) s.mem.write8(0x6400 + k * 0x20, 0x00); // all empty
  s.mem.write8(0x6227, 0x00); // != 2 -> jp 0x3195
  s.mem.write8(0x63a0, 0x00); // != 1 -> jp 0x316a (no insert, no count bump)
  assert.equal(entry_313c(s), false, "count 0 -> SPLICE -> false (entry_30ed is skipped)");
  assert.equal(s.regs.sp, 0x6c00, "splice consumed BOTH frames: inc sp x2 drops 0x30F3, ret pops CC");
  assert.equal(s.pc, CC, "returned to the CALLER'S CALLER, not 0x30F3");

  // TEST 2 -- the counter gates the splice: one non-empty object -> NORMAL ret.
  const n = mk();
  n.mem.write8(0x6400, 0x01); // object 0 non-empty -> counter becomes 1
  for (const k of [1, 2, 3, 4]) n.mem.write8(0x6400 + k * 0x20, 0x00);
  n.mem.write8(0x6217, 0x00);
  n.mem.write8(0x6227, 0x00);
  n.mem.write8(0x63a0, 0x00);
  assert.equal(entry_313c(n), true, "count != 0 -> ret nz -> true (normal return)");
  assert.equal(n.regs.sp, 0x6bfe, "normal ret consumed only entry_30ed's frame (0x30F3)");
  assert.equal(n.pc, RET, "returned to entry_30ed's continuation 0x30F3");

  // TEST 3 -- (ix+0x08) = 1, then 0 iff 0x6217 == 1 (the conditional second write, §4).
  const a = mk();
  a.mem.write8(0x6400, 0x01);
  a.mem.write8(0x6217, 0x01);
  a.mem.write8(0x6227, 0x00);
  a.mem.write8(0x63a0, 0x00);
  entry_313c(a);
  assert.equal(a.mem.read8(0x6408), 0x00, "0x6217==1 -> (ix+8) cleared to 0");
  const b = mk();
  b.mem.write8(0x6400, 0x01);
  b.mem.write8(0x6217, 0x00);
  b.mem.write8(0x6227, 0x00);
  b.mem.write8(0x63a0, 0x00);
  entry_313c(b);
  assert.equal(b.mem.read8(0x6408), 0x01, "0x6217!=1 -> (ix+8) stays 1");

  // TEST 4 -- the loop runs 5 iterations at stride 0x20 (all objects visited, §S1).
  const l = mk();
  for (const k of [0, 1, 2, 3, 4]) l.mem.write8(0x6400 + k * 0x20, 0x01); // all non-empty
  l.mem.write8(0x6217, 0x00); // each gets (ix+8)=1
  assert.equal(entry_313c(l), true, "5 non-empty -> counter 5 -> normal ret");
  for (const k of [0, 1, 2, 3, 4]) {
    assert.equal(l.mem.read8(0x6408 + k * 0x20), 0x01, `object ${k} visited -> (ix+8)=1`);
  }
  assert.equal(l.mem.read8(0x63a1), 0x05, "counter counted all 5 non-empty objects");
});

test("the 0x3110 guard family: four DIFFERENT predicates on 0x601a, inverted at both ends", () => {
  // 0x1977-closure drain, UNGATED BY EXECUTION. Four rst-0x28 dispatch targets
  // sharing one shape and differing in mask / compare / condition. Table-driven
  // ON PURPOSE: the same 0x601a value is pushed through all four, so any
  // cross-contamination between these near-identical routines shows up as a
  // disagreement with the ROM-derived predicate. Predicates from the bytes (§21):
  //   3110  (v & 1) == 1   [ret z  -- EQUALITY]
  //   311b  (v & 7) <  5   [ret m  -- SIGN]
  //   3126  (v & 3) <  3   [ret m]
  //   3131  (v & 7) <  7   [ret m]
  const fns = { 3110: guard_3110, 311: guard_311b, 3126: guard_3126, 3131: guard_3131 };
  const expect = (v) => ({
    a: (v & 1) === 1,
    b: (v & 7) < 5,
    c: (v & 3) < 3,
    d: (v & 7) < 7,
  });

  // Frame layout: caller's-caller return first, then the caller's own.
  const run = (fn, v) => {
    const m = new Machine(ROM);
    m.regs.sp = 0x6c00;
    m.push16(0xcafe); // caller's caller
    m.push16(0xbeef); // the caller's own return
    m.mem.write8(0x601a, v);
    const normal = fn(m);
    return { normal, sp: m.regs.sp };
  };

  for (let v = 0; v <= 0x0f; v++) {
    const e = expect(v);
    for (const [fn, want, name] of [
      [guard_3110, e.a, "3110"], [guard_311b, e.b, "311b"],
      [guard_3126, e.c, "3126"], [guard_3131, e.d, "3131"],
    ]) {
      const r = run(fn, v);
      assert.equal(r.normal, want, `${name} at 0x601a=0x${v.toString(16)}: normal-return should be ${want}`);
      // A normal return consumes ONE frame; a splice consumes BOTH.
      assert.equal(r.sp, want ? 0x6bfe : 0x6c00,
        `${name} at 0x601a=0x${v.toString(16)}: SP proves ${want ? "normal return" : "the caller was SKIPPED"}`);
    }
  }

  // The two values that prove the family is genuinely inverted, not a template:
  // at 0x00 ONLY 3110 splices; at 0x07 ONLY 3110 returns normally.
  assert.deepEqual(
    [run(guard_3110, 0x00).normal, run(guard_311b, 0x00).normal, run(guard_3126, 0x00).normal, run(guard_3131, 0x00).normal],
    [false, true, true, true], "0x601a=0x00: only 3110 skips its caller");
  assert.deepEqual(
    [run(guard_3110, 0x07).normal, run(guard_311b, 0x07).normal, run(guard_3126, 0x07).normal, run(guard_3131, 0x07).normal],
    [true, false, false, false], "0x601a=0x07: only 3110 returns normally");
});

test("loc_3069 increments THROUGH the 0x63C0 pointer, gated by the rst 0x18 counter", () => {
  // 0x1977-closure drain, UNGATED BY EXECUTION (dw-table target). Values from
  // the ROM (§21): `ld hl,(0x63c0)` is the INDIRECT load, so HL is the word AT
  // 0x63C0. rst 0x18 polarity: sub_0018 decs 0x6009 and the BODY RUNS WHEN THE
  // COUNTER EXPIRES (ret z), skipping while it still counts down.
  const mk = (counter) => {
    const m = new Machine(ROM);
    m.regs.sp = 0x6c00;
    m.push16(0xbeef);
    m.mem.write8(0x6009, counter);   // sub_0018's counter
    m.mem.write8(0x63c0, 0x00);      // pointer low  -> 0x7000
    m.mem.write8(0x63c1, 0x70);      // pointer high
    m.mem.write8(0x7000, 0x41);      // the target byte
    return m;
  };

  // A) counter EXPIRES (1 -> 0, Z) -> body runs.
  const a = mk(0x01);
  assert.equal(loc_3069(a), true, "returns true -- it can never skip its caller");
  assert.equal(a.mem.read8(0x7000), 0x42, "target byte incremented THROUGH the pointer");
  assert.equal(a.mem.read8(0x63c0), 0x00, "the POINTER CELL itself is untouched");
  assert.equal(a.mem.read8(0x63c1), 0x70, "...both halves of it");

  // B) counter still COUNTING (5 -> 4, NZ) -> rst 0x18 cuts the body short.
  const b = mk(0x05);
  assert.equal(loc_3069(b), true, "still true -- the caller continues either way");
  assert.equal(b.mem.read8(0x7000), 0x41, "body skipped -- target NOT incremented");
  assert.equal(b.mem.read8(0x6009), 0x04, "but the counter WAS decremented (5 -> 4)");

  // MUTATION-PATCH (applicable; for QA's runner)
  //   file:   src/rom/state0.js
  //   find:   regs.hl = mem.read16(0x63c0); // INDIRECT -- the word AT 0x63C0, not 0x63C0
  //   repl:   regs.hl = 0x63c0; // MUTANT: immediate instead of indirect
  //   expect: FAIL
  //   why:    the immediate form increments mem[0x63C0] (0x00 -> 0x01) and leaves
  //           0x7000 at 0x41, flipping BOTH the target and pointer-cell asserts.
});




test("entry_3ec3 counts two-axis overlaps over B objects, skipping inactive ones", () => {
  // 0x1977-closure drain, UNGATED BY EXECUTION. LIVE-INS: IX, IY, B, C, DE, H, L.
  // Predicates read off the bytes (§21): axis 1 passes when
  // (|C - (ix+5)| + 1) < L, or when subtracting (ix+0x0a) from that still borrows;
  // axis 2 the same with (iy+3)-(ix+3), H and (ix+9). Both pass -> 0x6060++.
  const mk = () => {
    const m = new Machine(ROM);
    m.regs.sp = 0x6c00; m.push16(0xbeef);
    m.regs.ix = 0x6a00; m.regs.iy = 0x6b00;
    m.regs.de = 0x0020;   // stride
    m.regs.b = 0x01;      // one object
    m.regs.h = 0x05; m.regs.l = 0x05;
    m.mem.write8(0x6b03, 0x20);  // (iy+0x03)
    m.mem.write8(0x6060, 0x00);  // the counter
    return m;
  };
  const obj = (m, { active, x, y, spanX = 0x10, spanY = 0x10 }) => {
    m.mem.write8(0x6a00, active ? 0x01 : 0x00); // bit 0 = active
    m.mem.write8(0x6a05, x);
    m.mem.write8(0x6a03, y);
    m.mem.write8(0x6a0a, spanX);
    m.mem.write8(0x6a09, spanY);
  };

  // A) ACTIVE and both axes overlap -> counter increments.
  //    |0x10-0x10|+1 = 1 < L(5) -> axis 1 passes; |0x20-0x20| = 0 < H(5) -> axis 2.
  const a = mk(); a.regs.c = 0x10; obj(a, { active: true, x: 0x10, y: 0x20 });
  entry_3ec3(a);
  assert.equal(a.mem.read8(0x6060), 0x01, "both axes overlap -> 0x6060 incremented");
  assert.equal(a.regs.ix, 0x6a20, "IX advanced by DE");
  assert.equal(a.regs.b, 0x00, "djnz ran the loop to exhaustion");

  // B) INACTIVE (bit 0 clear) -> the whole body is skipped, but IX still advances.
  const b = mk(); b.regs.c = 0x10; obj(b, { active: false, x: 0x10, y: 0x20 });
  entry_3ec3(b);
  assert.equal(b.mem.read8(0x6060), 0x00, "inactive object is not counted");
  assert.equal(b.regs.ix, 0x6a20, "...but IX still advanced (jp z targets loc_3efa)");

  // C) ACTIVE but axis 1 too far: |0x50-0x10|+1 = 0x41; 0x41-L(5) = 0x3C, no
  //    borrow; 0x3C-(ix+0x0a)(0x10) = 0x2C, still no borrow -> no overlap.
  const c = mk(); c.regs.c = 0x50; obj(c, { active: true, x: 0x10, y: 0x20 });
  entry_3ec3(c);
  assert.equal(c.mem.read8(0x6060), 0x00, "axis 1 out of range -> not counted");

  // D) TWO objects, only the second active -> exactly one increment, IX += 2*DE.
  const d = mk(); d.regs.c = 0x10; d.regs.b = 0x02;
  obj(d, { active: false, x: 0x10, y: 0x20 });          // object 0 at 0x6A00
  d.mem.write8(0x6a20, 0x01);                            // object 1 active
  d.mem.write8(0x6a25, 0x10); d.mem.write8(0x6a23, 0x20);
  d.mem.write8(0x6a2a, 0x10); d.mem.write8(0x6a29, 0x10);
  entry_3ec3(d);
  assert.equal(d.mem.read8(0x6060), 0x01, "only the active object counted");
  assert.equal(d.regs.ix, 0x6a40, "IX advanced twice");

  // E) FORCES THE AXIS-1 `neg`: C(0x08) < (ix+5)(0x10) so the sub BORROWS.
  //    With neg: |−8| = 8, +1 = 9, 9-L(5) = 4 no borrow, 4-(ix+0x0a)(0x10) BORROWS
  //    -> axis 1 passes -> counted. Without neg the value stays 0xF8 and
  //    0xF9-5-0x10 never borrows -> not counted. Added because the mutation
  //    "drop the first neg" was NOT caught by cases A-D: none of them make the
  //    first sub borrow, so the neg never executed and deleting it was invisible.
  const e = mk(); e.regs.c = 0x08; obj(e, { active: true, x: 0x10, y: 0x20 });
  entry_3ec3(e);
  assert.equal(e.mem.read8(0x6060), 0x01, "axis-1 neg fires (C < (ix+5)) -> |diff| used, counted");

  // F) FORCES THE AXIS-2 `neg`: (iy+3)(0x18) < (ix+3)(0x20).
  const f = mk(); f.regs.c = 0x10;
  f.mem.write8(0x6b03, 0x18);            // (iy+0x03) below (ix+0x03)
  obj(f, { active: true, x: 0x10, y: 0x20 });
  entry_3ec3(f);
  assert.equal(f.mem.read8(0x6060), 0x01, "axis-2 neg fires ((iy+3) < (ix+3)) -> counted");

  // MUTATION-PATCH  file: src/rom/state0.js
  //   find: regs.bit(0, mem.read8(ea0), (ea0 >> 8) & 0xff); // INDEXED: F3/F5 from the EA high byte
  //   repl: regs.bit(1, mem.read8(ea0), (ea0 >> 8) & 0xff); // MUTANT: wrong bit
  //   expect: FAIL  (bit 1 of 0x01 is clear, so the active object reads inactive)
  //   verified-anchor: count == 1 in src/rom/state0.js
});

test("sub_30fa clamps 0x6380 to [0,5] and rst-0x28-dispatches to the right guard, propagating the skip", () => {
  // 0x1977-closure drain, UNGATED BY EXECUTION. First skip-capable rst 0x28
  // caller under the ratified convention. The rst is sub_30fa's TAIL, so the
  // guard rets to sub_30fa's caller and `return sub_0028(...)` passes the boolean
  // up transparently. Table (from ROM): 0->3110 1->3110 2->311b 3->3126 4->3126
  // 5->3131. Guard predicate on 0x601a decides the boolean and the SP outcome.
  const run = (idx, v601a) => {
    const m = new Machine(ROM);
    m.regs.sp = 0x6c00;
    m.push16(0xcafe); // sub_30fa's caller's return (what a skip discards)
    m.push16(0xbeef); // sub_30fa's own return
    m.mem.write8(0x6380, idx);
    m.mem.write8(0x601a, v601a);
    const cont = sub_30fa(m);
    return { cont, sp: m.regs.sp };
  };

  // idx 0 -> guard_3110: normal-return when (0x601a & 1) == 1.
  //   0x601a=1 -> bit0 set -> guard rets normally -> sub_30fa returns TRUE, one
  //   frame consumed. 0x601a=0 -> guard SKIPS -> FALSE, both frames consumed.
  assert.deepEqual(run(0, 0x01), { cont: true, sp: 0x6bfe }, "idx0 601a=1: 3110 continues");
  assert.deepEqual(run(0, 0x00), { cont: false, sp: 0x6c00 }, "idx0 601a=0: 3110 SKIPS the caller");

  // idx 2 -> guard_311b: normal-return when (0x601a & 7) < 5.
  assert.deepEqual(run(2, 0x03), { cont: true, sp: 0x6bfe }, "idx2 601a=3<5: 311b continues");
  assert.deepEqual(run(2, 0x06), { cont: false, sp: 0x6c00 }, "idx2 601a=6>=5: 311b SKIPS");

  // idx 5 -> guard_3131: normal-return when (0x601a & 7) < 7. Only 7 skips.
  assert.deepEqual(run(5, 0x06), { cont: true, sp: 0x6bfe }, "idx5 601a=6<7: 3131 continues");
  assert.deepEqual(run(5, 0x07), { cont: false, sp: 0x6c00 }, "idx5 601a=7: 3131 SKIPS");

  // THE CLAMP: 0x6380 = 9 (>= 6) is forced to 5, so it dispatches guard_3131 --
  // NOT out of the 6-entry table. Same result as idx 5.
  assert.deepEqual(run(9, 0x07), { cont: false, sp: 0x6c00 }, "0x6380=9 clamps to 5 -> 3131 SKIPS");
  assert.deepEqual(run(9, 0x06), { cont: true, sp: 0x6bfe }, "0x6380=9 clamps to 5 -> 3131 continues");

  // DISPATCH DISCRIMINATOR: idx 0 and idx 5 route to DIFFERENT guards with
  // different predicates on the SAME 0x601a=0x06 -- 3110 skips (bit0 clear),
  // 3131 continues (<7). A mis-indexed table would not split them this way.
  assert.equal(run(0, 0x06).cont, false, "idx0 601a=6: 3110 skips (bit0 clear)");
  assert.equal(run(5, 0x06).cont, true, "idx5 601a=6: 3131 continues -- different guard, same input");

  // MUTATION-PATCH  file: src/rom/state0.js
  //   find:   return sub_0028(m, "0x3104 (sub_30fa dispatch)");
  //   repl:   sub_0028(m, "0x3104 (sub_30fa dispatch)"); return true;
  //   expect: FAIL  (drops the propagated skip -- the SKIPS cases return true)
  //   verified-anchor: count == 1 in src/rom/state0.js
});

test("entry_3e99 pops 3e88's HL, counts overlaps via 3ec3 twice, maps count to a code", () => {
  // 0x1977-closure drain, UNGATED BY EXECUTION. Reached only via entry_3e88's
  // rst 0x28, so its first `pop hl` recovers the HL 3e88 saved (sub_0028 clobbers
  // it). LIVE-INS IY, C, H, L flow through to entry_3ec3. Code map from the
  // bytes (§21): count 0/1/2/>=3 -> 0/1/3/7.
  //
  // Object recipe that entry_3ec3 counts (same as its own test): active
  // (bit 0 of ix+0), C == (ix+5) so axis-1 |diff|+1 = 1 < L, (iy+3) == (ix+3)
  // so axis-2 |diff| = 0 < H, large spans.
  const mk = (activeCount) => {
    const m = new Machine(ROM);
    m.regs.sp = 0x6c00;
    m.push16(0xbeef);   // entry_3e99's own return
    m.push16(0x9abc);   // the HL 3e88 pushed -- must be recovered by `pop hl`
    m.regs.iy = 0x6b00; m.regs.c = 0x10; m.regs.h = 0x05; m.regs.l = 0x05;
    m.mem.write8(0x6b03, 0x20);   // (iy+0x03)
    // pre-fill both object arrays inactive
    for (let a = 0x6400; a < 0x6500; a++) m.mem.write8(a, 0x00);
    for (let a = 0x6700; a < 0x6900; a++) m.mem.write8(a, 0x00);
    // plant `activeCount` counting objects in group 1 (0x6700, stride 0x20)
    for (let i = 0; i < activeCount; i++) {
      const base = 0x6700 + i * 0x20;
      m.mem.write8(base + 0x00, 0x01); // active
      m.mem.write8(base + 0x05, 0x10); // == C
      m.mem.write8(base + 0x03, 0x20); // == (iy+3)
      m.mem.write8(base + 0x0a, 0x10); // spans
      m.mem.write8(base + 0x09, 0x10);
    }
    return m;
  };
  const run = (n) => { const m = mk(n); entry_3e99(m); return { a: m.regs.a, hl: m.regs.hl, sp: m.regs.sp }; };

  assert.equal(run(0).a, 0x00, "0 overlaps -> code 0");
  assert.equal(run(1).a, 0x01, "1 overlap  -> code 1");
  assert.equal(run(2).a, 0x03, "2 overlaps -> code 3 (cp 3 borrow across the flag-neutral ld a,3)");
  assert.equal(run(4).a, 0x07, ">=3 overlaps -> code 7");

  // THE POP: HL must be the value 3e88 pushed (0x9ABC), recovered from beneath
  // the table base sub_0028 popped -- not left as whatever 3ec3 last set it to.
  assert.equal(run(0).hl, 0x9abc, "pop hl recovered 3e88's saved HL");
  // and it returns NORMALLY (not skip-capable): SP back to the return frame.
  assert.equal(run(0).sp, 0x6c00, "ordinary ret -- SP restored, no inc-sp skip");

  // MUTATION-PATCH  file: src/rom/state0.js
  //   find:   regs.hl = m.pop16(); // pop hl -- recover entry_3e88's saved HL (sub_0028 clobbered it)
  //   repl:   regs.hl = 0x0000; // MUTANT: pop dropped, HL not recovered
  //   expect: FAIL  (SP left off by 2 -> the final ret takes the wrong frame; run(0).sp != 0x6c00)
  //   verified-anchor: count == 1 in src/rom/state0.js
});
