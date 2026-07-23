// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_0cd4 (the 25m / board-1 girder-board setup
 * arm at ROM 0x0CD4). loc_0cd4 loads DE with the 25m layout-table pointer
 * (0x3AE4, live-out), queues the 25m background tune (SND_BGM 0x6089 = 0x08), and
 * tail-jumps into the shared board-draw tail loc_0cc6.
 *
 * Five jobs:
 *
 *   1. EQUAL (whole-machine) -- the idiomatic optimized loc_0cd4 reads EQUAL
 *      against its translated oracle, every frame. loc_0cd4 first dispatches at
 *      frame 518 in a plain boot+attract run (the ROM's own attract demo builds
 *      the 25m board), and only ONCE in the window -- so the run is 560 frames to
 *      cover that entry with a healthy 42-frame tail. That tail is not optional:
 *      loc_0cd4 tail-jumps into the heavy 0x0cc6 board-setup chain and a WRONG
 *      cycle total would only surface downstream of frame 518 (the oracle's own
 *      note warns a phantom-T-state bug here was invisible precisely because the
 *      path first runs at frame 518, after the then-517-frame compare finished).
 *
 *   2. EQUAL (unit) -- RAM + every register (incl. F) + pc identical, captured at
 *      the instant loc_0cd4 is first entered. maxFrames is raised to 600 because
 *      the first entry is at frame 518, well past the 240-frame default.
 *
 *   3/4. TEETH (whole + unit) -- a deliberately-broken twin whose own store to
 *      SND_BGM (0x6089) lands the wrong value must be CAUGHT: NOT-EQUAL, naming
 *      0x6089. 0x6089 is loc_0cd4's only memory write and it persists in work RAM
 *      (the per-NMI sound driver reads it but does not clear it), so the diff does
 *      not heal -- a strict-gate catch.
 *
 *   5. CYCLE-TOTAL (collapse teeth) -- loc_0cd4 is ATOMIC (only ever entered
 *      inside the vblank NMI dispatch, mask cleared), so its per-instruction
 *      charges (10+7+13+10) are collapsed to one m.step(0x0cc6, 40). This test
 *      pins the collapsed TOTAL: running oracle vs optimized from the captured
 *      entry state charges the IDENTICAL cycle delta (the downstream 0x0cc6 is the
 *      same m.call on both sides, so any delta difference is loc_0cd4's own
 *      total). A wrong-total twin (charging 41) is shown to diverge, so the
 *      assertion has teeth.
 *
 * WHY COLLAPSE IS SOUND HERE. Unlike a main-loop routine (handler_05c6) or one
 * with an interruptible downstream reached with the mask ENABLED (entry_0611),
 * loc_0cd4 runs entirely with the NMI mask CLEARED -- every call path is inside
 * the NMI (loc_0c92 <- handler_0763 / rst 0x18 tail). The hardware mask is the
 * machine's mutual-exclusion gate, so the vblank NMI cannot fire inside this
 * routine on ANY path; the internal cycle distribution is structurally free. The
 * TOTAL is still preserved (README §2: it is observable via the spin count and
 * the frame-boundary position inside the downstream chain), just as one charge.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0cd4 as translated_0cd4 } from "../../translated/nmi.js";
import { loc_0cd4 as optimized_0cd4 } from "../loc_0cd4.js";
import { unitEquivalence, wholeMachineEquivalence } from "../harness.js";
import { Machine } from "../../machine.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT
  ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR)))
  : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0cd4;
const FRAMES = 560;    // loc_0cd4 first fires at frame 518; +42-frame tail
const MAX_FRAMES = 600; // reach the (late) first entry in the unit + capture paths

// loc_0cd4's only memory write is `ld (0x6089),a` (SND_BGM = 0x08). It is work
// RAM inside the compared state dump and is not cleared downstream, so a wrong
// value persists and the strict gate catches it.
const BROKEN_ADDR = 0x6089;

/**
 * Deliberately-broken twin: behaviourally the optimized handler EXCEPT the first
 * store to 0x6089 lands a wrong value (the correct byte XOR 0xFF, guaranteed to
 * differ). Intercepting exactly that one write lets the rest of the routine and
 * every subroutine it calls run verbatim -- the representative "wrong value to
 * one of the routine's own output addresses" bug the gate must catch.
 */
function broken_0cd4(m) {
  const realWrite = m.mem.write8.bind(m.mem);
  let broke = false;
  m.mem.write8 = (addr, value, busOffset) => {
    if (!broke && addr === BROKEN_ADDR) {
      broke = true;
      return realWrite(addr, value ^ 0xff, busOffset);
    }
    return realWrite(addr, value, busOffset);
  };
  try {
    return optimized_0cd4(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

/** Wrong-total twin: identical to the optimized routine but charges 41 T for the
 *  tail jump instead of the correct 40 -- used only to prove the CYCLE-TOTAL test
 *  has teeth. */
function wrongTotal_0cd4(m) {
  const { regs, mem } = m;
  regs.de = 0x3ae4;
  regs.a = 0x08;
  mem.write8(0x6089, regs.a);
  m.step(0x0cc6, 41); // deliberately wrong (correct is 40)
  return m.call(0x0cc6);
}

/** Capture a pristine clone of the machine at the instant TARGET is first entered
 *  (via the same construction-time snapshot override the unit gate uses), running
 *  the boot+attract host until then. */
function captureEntry() {
  let entry = null;
  const snapshot = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_0cd4(mm); // let the host proceed normally
  }]]);
  const host = new Machine(ROM, { overrides: snapshot });
  host.runFrames(MAX_FRAMES);
  if (entry === null) throw new Error(`0x${TARGET.toString(16)} never entered within ${MAX_FRAMES} frames`);
  return entry;
}

/** Cycle delta charged by running `fn` on a fresh clone of the entry state. */
function cyclesFor(entry, fn) {
  const c = entry.clone();
  const before = c.cycles;
  fn(c);
  return c.cycles - before;
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loc_0cd4 matches translated every frame", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, optimized_0cd4]]));

  // The override must actually have run, or EQUAL would be vacuous.
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
    `  EQUAL/whole: ${r.framesCompared} frames identical, ` +
      `override fired ${r.invocations.get(TARGET)}x (first at frame 518)`,
  );
});

test("EQUAL (unit): idiomatic optimized loc_0cd4 matches translated in RAM + registers", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_0cd4, optimized_0cd4, { maxFrames: MAX_FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong SND_BGM store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, broken_0cd4]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong SND_BGM store is CAUGHT and names 0x6089", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_0cd4, broken_0cd4, { maxFrames: MAX_FRAMES });

  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.ok(r.ram != null, "a caught divergence must name a RAM address");
  assert.equal(
    r.ram.addr,
    BROKEN_ADDR,
    `expected first diff at the broken address 0x${BROKEN_ADDR.toString(16)}, got 0x${r.ram.addr.toString(16)}`,
  );
  console.log(
    `  TEETH/unit: caught at 0x${r.ram.addr.toString(16)} ` +
      `(translated ${r.ram.a} vs broken ${r.ram.b})`,
  );
});

// -- CYCLE TOTAL (collapse teeth) ---------------------------------------------

test("CYCLE-TOTAL: collapsed optimized total equals the oracle's, and a wrong total is caught", () => {
  const entry = captureEntry();

  const oracleCycles = cyclesFor(entry, translated_0cd4);
  const optimizedCycles = cyclesFor(entry, optimized_0cd4);
  const wrongCycles = cyclesFor(entry, wrongTotal_0cd4);

  assert.equal(
    optimizedCycles,
    oracleCycles,
    `collapsed total ${optimizedCycles} must equal oracle total ${oracleCycles}`,
  );
  // Teeth: a 1-T-off total is a DIFFERENT delta, so the equality above is not vacuous.
  assert.notEqual(
    wrongCycles,
    oracleCycles,
    "a deliberately-wrong cycle total was NOT distinguished — the check is toothless",
  );
  assert.equal(wrongCycles, oracleCycles + 1, "wrong-total twin should charge exactly 1 T extra");
  console.log(
    `  CYCLE-TOTAL: oracle=${oracleCycles} == optimized=${optimizedCycles} T ` +
      `(loc_0cd4 own charge 40 collapsed from 10+7+13+10); wrong-total twin=${wrongCycles} caught`,
  );
});
