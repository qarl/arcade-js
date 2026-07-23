// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for sub_07ad (draw two coin-requirement digits on the
 * attract screen, with a "10" -> "1" + "0" tens-split). It is a LEAF subroutine,
 * reached ONLY via handler_0779 (game state 1 / attract, sub-state 0), which calls
 * it TWICE by the call-then-fall-into idiom at ROM 0x07AA. handler_0779 runs inside
 * the vblank NMI and fires EXACTLY ONCE early in the attract ramp, so sub_07ad runs
 * exactly twice per boot (first pass: the DIP coin digits at VRAM 0x756C/0x756E;
 * second pass: the fixed "1 2" at VRAM 0x768C/0x768E).
 *
 * Six jobs:
 *
 *   1. EQUAL (whole-machine) — the idiomatic optimized sub_07ad (optimized/sub_07ad.js)
 *      reads EQUAL against its translated oracle every frame. sub_07ad is reached only
 *      by m.call from handler_0779 (itself the oracle on both sides of this test), so
 *      the swap layer routes handler_0779's `m.call(0x07ad)` to the override.
 *
 *   2. DISPATCH — the override must actually fire, or EQUAL is vacuous. sub_07ad is
 *      invoked exactly TWICE from boot (the two passes). A 30-frame window covers it.
 *
 *   3. EQUAL (unit) — translated vs optimized leave identical RAM + registers (incl. F)
 *      + pc from the captured FIRST-pass entry state.
 *
 *   4. BRANCH COVERAGE — the one data-dependent branch is `sub 0x0a / jp nz`: the high
 *      digit D == 10 (tens-split) vs D != 10 (leave as written). The natural passes
 *      both take D != 10, so the D == 10 arm is SYNTHESISED by poking register D
 *      identically on BOTH sides. Each arm is proven EQUAL in RAM+regs+pc AND its
 *      COLLAPSED cycle TOTAL is asserted against the oracle (77 t for NZ, 101 t for Z),
 *      so the collapse has teeth on the arm the whole-machine run does not reach.
 *
 *   5. TEETH (whole + unit) — a deliberately-broken twin whose first digit store (to
 *      VRAM 0x756C) lands the wrong value must be CAUGHT: NOT-EQUAL, naming the address.
 *
 * THE CYCLE FINDING this routine adds: sub_07ad is a LEAF whose atomicity is decided
 * PER CALL PATH. Its only callers are the two m.call(0x07ad) inside handler_0779, an
 * NMI game-state handler that clears io.nmiMask on entry — so the NMI cannot re-fire
 * inside sub_07ad, and (since the NMI fires just after a frame boundary and completes
 * far short of the next) no boundary crosses mid-routine. It is therefore ATOMIC and
 * its per-instruction m.step charges collapse to one per-branch TOTAL (NZ 77, Z 101),
 * folded into the closing m.ret(total). The TOTAL is still load-bearing (part of the
 * NMI's cost -> the main-loop spin count -> the PRNG entropy), so it is preserved
 * exactly; only the distribution is dropped. sub_07ad makes NO hardware (0x7Dxx)
 * writes — every store is video RAM — so there is no write-trace consequence.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { sub_07ad as translated_07ad } from "../../translated/state0.js";
import { sub_07ad as optimized_07ad } from "../sub_07ad.js";
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

const TARGET = 0x07ad;
const FRAMES = 30; // handler_0779 fires once early in attract -> sub_07ad twice

// The routine's first store is the low digit into VRAM 0x756C (first pass). It is
// written once and not rewritten in the window, so a corrupted value persists.
const BROKEN_ADDR = 0x756c;

// Oracle cycle totals per executed branch (per-instruction sums the collapse preserves):
//   NZ (D != 10): 37 prefix + 10 (jp nz) + 30 (ld de/ld hl/ret)            = 77 t
//   Z  (D == 10): 77 + 24 (ld(hl),a 7 + inc a 4 + ld(0x758e),a 13)         = 101 t
const CYCLES_NZ = 77;
const CYCLES_Z = 101;

/**
 * Deliberately-broken twin: behaviourally the optimized routine EXCEPT the first
 * store to 0x756C lands a wrong value (correct value XOR 0xFF, guaranteed to differ).
 * Breaking exactly that one write lets the rest run verbatim — the representative
 * "wrong value to one of the routine's own output cells" bug the gate must catch.
 */
function broken_07ad(m) {
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
    return optimized_07ad(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

/** Wrap a routine so it sets register D (the high digit) identically on both sides
 *  before running — sub_07ad reads D from the register file, not RAM. */
function withD(dVal, fn) {
  return (m) => {
    m.regs.d = dVal;
    return fn(m);
  };
}

/** Capture the pristine machine the instant sub_07ad is first entered (first pass,
 *  via m.call from handler_0779). A constructor override snapshots the entry; the
 *  host run continues via the translated oracle so it reaches a clean stop. */
function captureEntry(maxFrames = 60) {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_07ad(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(maxFrames);
  if (entry === null) throw new Error(`0x${TARGET.toString(16)} never entered in ${maxFrames} frames`);
  return entry;
}

/** Run `fn` on a fresh clone of `entry` with register D set to `dVal`, and return
 *  the T-states it charged (clone() neutralises the frame/NMI machinery, so cycles
 *  accumulate only the routine's own charges). */
function cyclesFor(entry, dVal, fn) {
  const c = entry.clone();
  c.regs.d = dVal;
  const c0 = c.cycles;
  fn(c);
  return c.cycles - c0;
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized sub_07ad matches translated every frame", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, optimized_07ad]]));

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

test("EQUAL (unit): idiomatic optimized sub_07ad matches translated in RAM + registers", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_07ad, optimized_07ad);

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

// -- BRANCH COVERAGE (RAM+regs+pc EQUAL and the collapsed cycle TOTAL) ---------

test("BRANCH (unit): D != 10 — jp nz taken (digit left as written) EQUAL + 77 t", () => {
  const r = unitEquivalence(
    ROM,
    {},
    TARGET,
    withD(0x02, translated_07ad),
    withD(0x02, optimized_07ad),
    { maxFrames: 60 },
  );
  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);

  const entry = captureEntry();
  const cyOracle = cyclesFor(entry, 0x02, translated_07ad);
  const cyOpt = cyclesFor(entry, 0x02, optimized_07ad);
  assert.equal(cyOracle, CYCLES_NZ, `oracle NZ total should be ${CYCLES_NZ} t, got ${cyOracle}`);
  assert.equal(cyOpt, cyOracle, `optimized NZ total ${cyOpt} != oracle ${cyOracle}`);
  console.log(`  BRANCH/NZ: D=2 -> jp nz taken, EQUAL, cycle total ${cyOpt} t (oracle ${cyOracle})`);
});

test("BRANCH (unit): D == 10 — tens-split (0x758E carry) EQUAL + 101 t", () => {
  const r = unitEquivalence(
    ROM,
    {},
    TARGET,
    withD(0x0a, translated_07ad),
    withD(0x0a, optimized_07ad),
    { maxFrames: 60 },
  );
  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);

  const entry = captureEntry();
  const cyOracle = cyclesFor(entry, 0x0a, translated_07ad);
  const cyOpt = cyclesFor(entry, 0x0a, optimized_07ad);
  assert.equal(cyOracle, CYCLES_Z, `oracle Z total should be ${CYCLES_Z} t, got ${cyOracle}`);
  assert.equal(cyOpt, cyOracle, `optimized Z total ${cyOpt} != oracle ${cyOracle}`);
  console.log(`  BRANCH/Z: D=10 -> tens-split (0x758E=1), EQUAL, cycle total ${cyOpt} t (oracle ${cyOracle})`);
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong digit store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, broken_07ad]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong digit store is CAUGHT and names 0x756C", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_07ad, broken_07ad);

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
