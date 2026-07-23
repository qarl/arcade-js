// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for sub_0965 (enqueue the attract / how-high string
 * task block: one task 0x0400, then six tasks 0x0314..0x0319 via sub_309f).
 *
 * sub_0965 is a LEAF-ish helper reached only by `m.call` from two callers
 * (loc_08ba @0x08CB, handler_0779 @0x078E) — never a dispatch target. It is entered
 * naturally from an IDLE boot: handler_0779 runs once early in attract (no coin) and
 * calls it, so sub_0965 is first m.call'd at frame 6. The unit gate reaches it via
 * the construction-time snapshot override (installed for m.call'd leaves too), and
 * the whole-machine gate reaches it because handler_0779 (running as the oracle,
 * since only 0x0965 is overridden) calls the override at every `m.call` site.
 *
 * Jobs:
 *
 *   1. EQUAL (whole-machine) — optimized sub_0965 reads EQUAL against its translated
 *      oracle every frame; the override must actually fire (or EQUAL is vacuous).
 *
 *   2. EQUAL (unit) — translated vs optimized leave identical RAM + registers
 *      (incl. F) + pc from the captured entry state.
 *
 *   3. BRANCH COVERAGE — sub_0965 is STRAIGHT-LINE with a FIXED loop count: B is the
 *      immediate 0x06 and DE are immediates, so there is no data-dependent branch and
 *      no loop-0/1/many variability. The single natural path IS full coverage, and
 *      it is reached by both the whole-machine and unit gates above.
 *
 *   4. CYCLE-TOTAL (the collapse's teeth) — because the single branch's cycles are
 *      COLLAPSED to one charge, its TOTAL is pinned explicitly: oracle vs optimized
 *      must consume the identical cycle delta across the whole routine (1205 t incl.
 *      the seven sub_309f callees, of which sub_0965's own share is 253). A twin with
 *      a deliberately-wrong collapsed total is CAUGHT — otherwise a wrong total on
 *      this collapsed arm would have no teeth.
 *
 *   5. TEETH (whole + unit) — a deliberately-broken twin whose FIRST task-ring store
 *      (sub_309f's write of D=0x04 at 0x60CA) lands the wrong value must be CAUGHT:
 *      NOT-EQUAL, the unit gate naming 0x60CA exactly.
 *
 * THE CYCLE FINDING this routine reinforces: sub_0965 is ATOMIC on EVERY call path
 * (both callers run inside the vblank NMI, mask cleared), so its internal cycle
 * distribution is unobservable and the per-instruction m.step charges collapse to one
 * per-branch TOTAL — here the sole branch, 243 + ret(10) = 253 t. The total is still
 * load-bearing (part of the caller's NMI cost -> the main-loop spin count -> the PRNG
 * entropy, README §2), so it is preserved exactly; only the distribution is dropped.
 * sub_0965 makes NO hardware write of its own (every store is sub_309f's work-RAM
 * task-ring write), so there is no write-trace gate to run.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { sub_0965 as translated_0965 } from "../../translated/state0.js";
import { sub_0965 as optimized_0965 } from "../sub_0965.js";
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

const TARGET = 0x0965;
const FRAMES = 30; // sub_0965 is first m.call'd at frame 6 (handler_0779, attract)

// sub_0965's first store into diffed work RAM is sub_309f's write of D=0x04 for
// task 0x0400 — it lands at 0x60CA (0x60C0 + the ring tail after handler_0779's own
// earlier enqueues). The task is consumed later, but the unit gate compares the
// state the instant the routine returns, so the corrupted ring byte is still there.
const BROKEN_ADDR = 0x60ca;

/**
 * Deliberately-broken twin: behaviourally the optimized routine EXCEPT the first
 * store landing in the task ring (0x60C0..0x60FF) gets the wrong value (correct XOR
 * 0xFF, guaranteed to differ). Intercepting exactly that one write lets the rest of
 * the routine and sub_309f run verbatim — the representative "wrong value to one of
 * the routine's own output cells" bug the gate must catch.
 */
function broken_0965(m) {
  const realWrite = m.mem.write8.bind(m.mem);
  let broke = false;
  m.mem.write8 = (addr, value, busOffset) => {
    if (!broke && addr >= 0x60c0 && addr < 0x6100) {
      broke = true;
      return realWrite(addr, value ^ 0xff, busOffset);
    }
    return realWrite(addr, value, busOffset);
  };
  try {
    return optimized_0965(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

/** A twin whose collapsed cycle TOTAL is wrong by 4 t (243 -> 239). RAM + regs stay
 *  correct; ONLY the cycle-delta check can catch it, giving the collapse teeth. */
function wrongTotal_0965(m) {
  const { regs } = m;
  regs.de = 0x0400;
  m.push16(0x096b);
  m.call(0x309f);
  regs.de = 0x0314;
  regs.b = 0x06;
  do {
    m.push16(0x0973);
    m.call(0x309f);
    regs.e = regs.inc8(regs.e);
    regs.b = (regs.b - 1) & 0xff;
  } while (regs.b !== 0);
  m.step(0x0976, 239); // BUG: 4 t short of the oracle's 243
  m.ret();
}

/** Capture the pristine machine the instant sub_0965 is first m.call'd (once, early
 *  in attract). A construction-time snapshot override records the entry; the host run
 *  continues via the translated oracle so it reaches a clean stop. */
function captureEntry(maxFrames = 40) {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_0965(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(maxFrames);
  if (entry === null) throw new Error(`0x${TARGET.toString(16)} never m.call'd in ${maxFrames} frames`);
  return entry;
}

/** Cycle delta consumed by `fn` run on a fresh clone of `entry` (callees included). */
function cycleDelta(entry, fn) {
  const c = entry.clone();
  const c0 = c.cycles;
  fn(c);
  return c.cycles - c0;
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized sub_0965 matches translated every frame", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, optimized_0965]]));

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

test("EQUAL (unit): idiomatic optimized sub_0965 matches translated in RAM + registers", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_0965, optimized_0965);

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical (single straight-line branch)");
});

// -- CYCLE-TOTAL (the collapse's teeth) ---------------------------------------

test("CYCLE-TOTAL: optimized preserves the oracle's exact cycle total; a wrong total is CAUGHT", () => {
  const entry = captureEntry();
  const oracleDelta = cycleDelta(entry, translated_0965);
  const optDelta = cycleDelta(entry, optimized_0965);

  assert.equal(
    optDelta,
    oracleDelta,
    `collapsed total ${optDelta} t != oracle total ${oracleDelta} t`,
  );

  // Teeth: a twin 4 t short must NOT match the oracle's total.
  const wrongDelta = cycleDelta(entry, wrongTotal_0965);
  assert.notEqual(wrongDelta, oracleDelta, "cycle-total check has no teeth — a wrong total passed");
  console.log(
    `  CYCLE-TOTAL: optimized ${optDelta} t == oracle ${oracleDelta} t ` +
      `(own share 253); wrong-total twin (${wrongDelta} t) caught`,
  );
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong task-ring store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, broken_0965]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong task-ring store is CAUGHT and names 0x60CA", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_0965, broken_0965);

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
