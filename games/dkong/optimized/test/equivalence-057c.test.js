// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for sub_057c (a BCD digit renderer: unpack 3 source
 * bytes into 6 nibbles up a VRAM column). ROM 0x057C-0x0592.
 *
 * sub_057c is a LEAF routine reached ONLY through `m.call(0x057c)` from sub_1486
 * (the on-board bonus-item display, GAME_SUBSTATE phase 21), during its sprite-
 * animate step (0x158A): whenever the animation timer 0x6032 expires, sub_1486
 * loads IX from the item's sprite pointer and calls sub_057c to repaint the 6
 * value digits. sub_1486 dispatches from INSIDE the vblank NMI, so this whole path
 * runs mask-cleared — sub_057c is ATOMIC. It is kept PER-INSTRUCTION regardless
 * (see optimized/sub_057c.js's header for why), so it is byte-identical to the
 * oracle and preserves every path total for free.
 *
 * It is NOT reached from boot in a plain run (harness.js drives no input and pokes
 * nothing, so it never reaches a credited game's phase 21). This test therefore
 * calls the CORE engine directly with a custom factory that drives BOTH sides
 * identically — a coin+start inputTape plus a phase-21 poke (the exact driver
 * equivalence-1486 uses) — so sub_1486 runs and calls sub_057c on its animate
 * step. The snapshot override is installed at CONSTRUCTION, which is what reaches
 * a routine entered only via m.call.
 *
 * Five jobs:
 *   1. EQUAL (whole-machine) -- the idiomatic optimized sub_057c reads EQUAL against
 *      its translated oracle every frame; the override fires each animate step.
 *   2. EQUAL (unit)          -- EQUAL in RAM + every register (F, A, SP, IX, IY) + pc.
 *   3/4. TEETH (whole + unit) -- a deliberately-broken twin lands a wrong value at
 *      the FIRST digit cell (the correct byte XOR 0xFF) and is CAUGHT, naming that
 *      VRAM cell.
 *   5. BRANCH COVERAGE -- sub_057c has a SINGLE control path (the loop always runs
 *      exactly 3 times; no data-dependent branch). It is synthesised from a real
 *      captured entry with hand-chosen source bytes (distinct high/low nibbles per
 *      byte) so a nibble-swap / dropped-step transcription bug is caught, proven
 *      EQUAL (RAM + all registers + pc) AND carrying the oracle's exact cycle total.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { sub_057c as translated_057c } from "../../translated/state0.js";
import { sub_057c as optimized_057c } from "../sub_057c.js";
import { Machine } from "../../machine.js";
import {
  wholeMachineEquivalence,
  unitEquivalence,
  firstStateDiff,
  firstRegDiff,
} from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT
  ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR)))
  : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x057c;
const FRAMES = 200; // phase 21 forced from frame 70; the animate step calls sub_057c ~8x
const MAX_FRAMES = 140; // first animate-timer expiry (0x6032: 0x10 down-counter) after frame 70

// Credit + start a game (identical to equivalence-1486's tape).
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 10, dur: 6 }, // coin  (IN2 bit7)
  { port: 0x7d00, bits: 0x04, frame: 30, dur: 6 }, // start (IN2 bit2)
];

// Force phase 21: hold GAME_STATE(0x6005)=3 (in-game) and GAME_SUBSTATE(0x600A)=0x15
// (sub_1486) from frame 70. The extra one-frame SUBSTATE_TIMER(0x6009)=0 at frame 70
// makes that first dispatch take sub_1486's INIT branch, which seeds the item-state
// block + the item-slot pointer 0x6038; without it every dispatch stays on the raw
// main-loop path (0x6038 == 0) and the animate step never calls sub_057c. Released
// after one frame so the anim timer 0x6032 counts down (0x10 -> 0) and the animate
// step fires ~every 16 frames, calling sub_057c to repaint the 6 digits. Applied by
// the SHARED factory, so BOTH sides see the identical sequence.
const PHASE21_POKE = [
  { addr: 0x6005, val: 0x03, frame: 70, dur: null },
  { addr: 0x600a, val: 0x15, frame: 70, dur: null },
  { addr: 0x6009, val: 0x00, frame: 70, dur: 1 }, // one-frame: force the INIT branch
];

function makeMachine(overrides) {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  m.pokes = PHASE21_POKE.map((p) => ({ ...p }));
  return m;
}

// VRAM tilemap window (the compared state dump's video region). sub_057c's digit
// cells (via 0x0593's `ld (ix+0),a`, IX a VRAM pointer) land here; its OTHER writes
// are the m.call(0x0593) return-address pushes into stack RAM (0x6Bxx), which the
// very next push overwrites — so a twin that corrupts the FIRST write of any kind
// would heal harmlessly. We must corrupt the first write that reaches a DIGIT cell.
const VRAM_LO = 0x7400;
const VRAM_HI = 0x77ff;

/**
 * Deliberately-broken twin: behaviourally optimized_057c EXCEPT the first write
 * that lands in VRAM (the first digit cell of the column) gets a wrong value (the
 * correct byte XOR 0xFF). Every later digit, every stack push and every 0x0593
 * call run verbatim: the representative "wrong value to one of the routine's own
 * output cells" bug the gate must catch. Each digit cell is written exactly once
 * per call, so the corruption is not overwritten and survives to the frame
 * boundary. The address it hit is recorded for the unit assertion.
 */
let lastBrokenAddr = null;
function broken_057c(m) {
  const realWrite = m.mem.write8.bind(m.mem);
  let broke = false;
  m.mem.write8 = (addr, value, busOffset) => {
    if (!broke && addr >= VRAM_LO && addr <= VRAM_HI) {
      broke = true;
      lastBrokenAddr = addr;
      return realWrite(addr, value ^ 0xff, busOffset);
    }
    return realWrite(addr, value, busOffset);
  };
  try {
    return optimized_057c(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized sub_057c matches translated every frame", () => {
  const r = wholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_057c]]));

  assert.ok(
    r.invocations.get(TARGET) >= 1,
    `override at 0x${TARGET.toString(16)} never dispatched (invocations=${r.invocations.get(TARGET)})`,
  );
  assert.equal(
    r.equal,
    true,
    r.equal ? "" : `diverged at frame ${r.frame}, addr 0x${(r.addr ?? 0).toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
  assert.equal(r.framesCompared, FRAMES);
  console.log(
    `  EQUAL/whole: ${r.framesCompared} frames identical, override fired ` +
      `${r.invocations.get(TARGET)}x (phase-21 animate step, 6-digit repaint)`,
  );
});

test("EQUAL (unit): idiomatic optimized sub_057c matches translated in RAM + registers", () => {
  const r = unitEquivalence(makeMachine, TARGET, translated_057c, optimized_057c, { maxFrames: MAX_FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg} (${r.regs.a} vs ${r.regs.b})` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F, A, SP, IX, IY) + pc identical");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong digit store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(makeMachine, MAX_FRAMES, new Map([[TARGET, broken_057c]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong digit store is CAUGHT and names the corrupted VRAM cell", () => {
  lastBrokenAddr = null;
  const r = unitEquivalence(makeMachine, TARGET, translated_057c, broken_057c, { maxFrames: MAX_FRAMES });

  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.ok(r.ram != null, "a caught divergence must name a RAM address");
  assert.ok(lastBrokenAddr != null, "the broken twin must have hit a write");
  assert.equal(
    r.ram.addr,
    lastBrokenAddr,
    `expected first diff at the broken digit cell 0x${(lastBrokenAddr ?? 0).toString(16)}, ` +
      `got 0x${r.ram.addr.toString(16)}`,
  );
  console.log(
    `  TEETH/unit: caught at 0x${r.ram.addr.toString(16)} (translated ${r.ram.a} vs broken ${r.ram.b})`,
  );
});

// -- BRANCH COVERAGE (single path; synthesised hand-picked data + cycle total) --

/**
 * Capture ONE real entry to sub_057c (its first m.call from sub_1486's animate
 * step) via the core unit gate's construction-time snapshot override, so the
 * synthesised arm inherits a valid stack (the return address the CALL pushed) and
 * a realistic IX (a live VRAM cell).
 */
function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_057c(mm); // let the host run proceed to a clean stop
  }]]);
  const host = makeMachine(snap);
  host.runFrames(MAX_FRAMES);
  if (entry === null) throw new Error(`sub_057c never m.call'd within ${MAX_FRAMES} frames`);
  return entry;
}

/** T-states a fn consumes on a fresh clone (clone() neutralises the frame machinery). */
function cyclesOf(seed, fn) {
  const c = seed.clone();
  const before = c.cycles;
  fn(c);
  return c.cycles - before;
}

test("BRANCH COVERAGE: the single 3-byte path renders EQUAL for hand-picked data (RAM + regs + pc + cycle)", () => {
  const entry = captureEntry();

  // Re-point the source into WORK RAM we control and seed distinct high/low nibbles
  // per byte, so a nibble-swap or dropped-step bug diverges. sub_057c reads the
  // source DESCENDING (src, src-1, src-2) and emits high-then-low nibble of each.
  // Keep the captured IX (a real VRAM cell) so writes land in the compared dump.
  const SRC = 0x6100;
  const seed = entry.clone();
  seed.regs.de = SRC; // DE = source pointer (ex de,hl moves it into HL)
  seed.mem.write8(SRC, 0x12); // -> digits 1, 2
  seed.mem.write8(SRC - 1, 0x34); // -> digits 3, 4
  seed.mem.write8(SRC - 2, 0x56); // -> digits 5, 6

  const a = seed.clone(); // translated oracle
  const b = seed.clone(); // optimized
  translated_057c(a);
  optimized_057c(b);

  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  const regs = firstRegDiff(a.regs, b.regs);
  assert.equal(ram, null, ram ? `RAM diff at 0x${ram.addr.toString(16)} (${ram.a} vs ${ram.b})` : "");
  assert.equal(regs, null, regs ? `reg diff at ${regs.reg} (${regs.a} vs ${regs.b})` : "");
  assert.equal(a.pc, b.pc, "pc must match");

  // The path total must match the oracle exactly (per-instruction preserves it; a
  // wrong collapse or a dropped instruction would not consume the same T-states).
  const cycT = cyclesOf(seed, translated_057c);
  const cycO = cyclesOf(seed, optimized_057c);
  assert.ok(cycT > 0, "oracle must consume cycles");
  assert.equal(cycO, cycT, `cycle total ${cycO} != oracle ${cycT}`);

  // The six nibbles must land, high-then-low, climbing the column by -0x20 from IX.
  const ix = seed.regs.ix;
  const got = [0, 1, 2, 3, 4, 5].map((i) => a.mem.read8((ix - i * 0x20) & 0xffff));
  assert.deepEqual(got, [1, 2, 3, 4, 5, 6], `expected digits 1..6 up the column, got ${got}`);

  console.log(`  ARM single-path: EQUAL (RAM+regs+pc); cycle total ${cycO}; digits ${got.join("")}`);
});
