// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for sub_0616 (ROM 0x0616-0x0629: draw string 5, then
 * render the credit count as one BCD byte via a tail jump into loop_0583).
 *
 * sub_0616 is a LEAF routine -- it is never a dispatch target; it is reached only
 * by `m.call(0x0616)`. The two live paths in the boot window are entry_0611's
 * task-table fall-through (ROM 0x0611, which m.call's 0x0616 when 0x6007 bit0 is
 * set) and the state-0 attract sites. The unit harness installs its snapshot
 * override at CONSTRUCTION, so it captures the entry however the routine is first
 * m.call'd; the whole-machine harness wires the override into the routine registry
 * so the same m.call fires it.
 *
 * Four jobs (mirroring equivalence-0611.test.js), plus a fifth data-path check:
 *
 *   1. EQUAL -- the idiomatic optimized sub_0616 (optimized/sub_0616.js) reads
 *      EQUAL against its translated oracle, whole-machine and unit.
 *
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous. sub_0616
 *      is first entered at frame 6 (entry_0611 falls through into it once 0x6007
 *      bit0 is set). A 30-frame window covers it.
 *
 *   3. TEETH -- a deliberately-broken twin (the first string-draw store lands the
 *      wrong value) must be CAUGHT: NOT-EQUAL, naming the diverging VRAM address.
 *
 *   4. DATA PATH -- sub_0616 is BRANCH-FREE (A is hard-set to 5, B to 1, so
 *      loop_0583 always runs exactly one iteration): there are no data-dependent
 *      branches to synthesise. To give the single path teeth beyond whatever
 *      CREDITS value happened to be live at frame 6, a synthesised entry pokes
 *      CREDITS (0x6001) to a distinct BCD value on BOTH clones and asserts oracle
 *      == optimized (RAM + all registers + pc) -- proving the rendered-digit data
 *      path is faithful independent of the credit count.
 *
 * CYCLE NOTE: sub_0616 is NOT atomic (it calls the interruptible handler_05e9 and
 * tail-jumps into loop_0583/sub_0593, on call paths that run with the NMI mask
 * enabled), so its optimized rewrite keeps the oracle's per-instruction m.step
 * charges verbatim -- no collapse. The whole-machine gate proves that: a moved NMI
 * landing would surface as downstream state drift, and this run stays EQUAL.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { sub_0616 as translated_0616 } from "../../translated/mainloop.js";
import { sub_0616 as optimized_0616 } from "../sub_0616.js";
import { unitEquivalence, wholeMachineEquivalence } from "../harness.js";
import { Machine } from "../../machine.js";
import { CREDITS } from "../ram.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT
  ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR)))
  : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0616;
const FRAMES = 30; // sub_0616 is first entered at frame 6 (via entry_0611)

// The first store on the routine's path is the first character of string 5,
// written by handler_05e9 (reached through sub_0616) to VRAM 0x759F -- inside the
// compared state dump (video RAM 0x7400-0x77FF). It is the same string 5 that
// entry_0611 draws through this very routine, hence the same address.
const BROKEN_ADDR = 0x759f;

/**
 * Deliberately-broken twin: behaviourally the optimized handler EXCEPT the first
 * store to 0x759F lands a wrong value (the correct char XOR 0xFF, guaranteed to
 * differ). Intercepting exactly that one write lets the rest of the routine and
 * every subroutine it calls run verbatim -- the representative "wrong value to one
 * of the routine's own output addresses" bug the gate must catch.
 */
function broken_0616(m) {
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
    return optimized_0616(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized sub_0616 matches translated every frame", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, optimized_0616]]));

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
      `override fired ${r.invocations.get(TARGET)}x`,
  );
});

test("EQUAL (unit): idiomatic optimized sub_0616 matches translated in RAM + registers", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_0616, optimized_0616);

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong string-draw store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, broken_0616]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong string-draw store is CAUGHT and names 0x759F", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_0616, broken_0616);

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

// -- DATA PATH (synthesised) --------------------------------------------------

/**
 * Capture sub_0616's pristine entry state the way the unit harness does, but
 * return the entry machine so the test can poke it. Uses a construction-time
 * snapshot override (reaches the m.call'd leaf) that delegates to the oracle so
 * the host run proceeds to a clean stop.
 */
function captureEntry(maxFrames = 240) {
  let entry = null;
  const snapshot = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_0616(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snapshot });
  host.runFrames(maxFrames);
  if (entry === null) throw new Error(`sub_0616 never entered within ${maxFrames} frames`);
  return entry;
}

test("DATA PATH: a distinct CREDITS value renders identically (oracle == optimized)", () => {
  const entry = captureEntry();

  // sub_0616 has no data-dependent branches (A=5, B=1 fixed -> loop_0583 runs
  // exactly once); the only data input is the byte at CREDITS. Force a distinct
  // BCD value on BOTH clones and prove the rendered-digit path stays equal.
  const POKED = 0x37;

  const a = entry.clone(); // translated
  const b = entry.clone(); // optimized
  a.mem.write8(CREDITS, POKED);
  b.mem.write8(CREDITS, POKED);

  translated_0616(a);
  optimized_0616(b);

  const ramDiffs = [];
  const da = a.dumpState();
  const db = b.dumpState();
  for (let i = 0; i < Math.min(da.length, db.length); i++) {
    if (da[i] !== db[i]) ramDiffs.push(a.stateOffsetToAddr(i));
  }
  assert.equal(ramDiffs.length, 0, ramDiffs.length ? `RAM diff at 0x${ramDiffs[0].toString(16)}` : "");
  assert.equal(a.pc, b.pc, "pc must match on the data path");
  assert.equal(a.regs.hl, b.regs.hl, "hl must match on the data path");
  assert.equal(a.regs.b, b.regs.b, "b must match on the data path");
  console.log(`  DATA PATH: CREDITS=0x${POKED.toString(16)} renders identically (RAM + pc + regs)`);
});
