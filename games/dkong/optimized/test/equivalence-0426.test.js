// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_0426 (the colour-cycle animation's frame-
 * counter advance, ROM 0x0426-0x044F). loc_0426 is the body the per-frame gate
 * loc_0413 falls into while the animation "active" latch (0x6391) is set: it
 * bumps the private counter 0x6390 and, on a 32-frame boundary, reloads the
 * animation table (block-copy 0x004e) + fires a sound trigger, then tail-calls
 * the colour tail (loc_0450 -> loc_0486 / loc_0464).
 *
 * IT DOES NOT RUN IN ATTRACT. The colour cycle only turns over once a game is
 * credited, and the counter-advance body (as opposed to the idle redraw) is
 * reached only when FRAME (0x601a) wraps to 0 during gameplay. So every test
 * here DRIVES a coin+start input tape (coin IN2 bit7 @f10, start1 bit2 @f30),
 * applied IDENTICALLY to the baseline and optimized sides through a shared
 * tape-injecting factory. Under that tape the cascade first dispatches at frame
 * ~1033 and loc_0426 proper first fires at frame ~1802 (the first in-game FRAME
 * wrap), then for the 128 frames of that cycle.
 *
 * Jobs:
 *   1. EQUAL (whole + unit) -- idiomatic optimized loc_0426 reads EQUAL against
 *      its translated oracle in RAM and the full register file (+ pc). The whole-
 *      machine run spans the first full 128-frame cycle so the counter reaches
 *      0x80 (the loc_0464 reset) live.
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous (asserted).
 *   3. FULL BRANCH COVERAGE -- loc_0426 has five data-dependent exits (counter
 *      ==0x80; 0x6393 suppress set; not-a-32-boundary; 32-boundary bit5 set /
 *      bit5 clear). The driven run reaches only the first three (0x6393 is set
 *      throughout gameplay, so the two table-copy arms are COLD), so each is
 *      SYNTHESISED from a captured entry (poke the counter + the suppress flag)
 *      and proven EQUAL in RAM+regs+pc AND cycle total.
 *   4. TEETH (whole + unit) -- a wrong output store (the 0x6390 counter, loc_0426's
 *      first and every-path store) is CAUGHT, naming the diverging address.
 *
 * THE CYCLE DECISION this routine records: loc_0426 is kept PER-INSTRUCTION, NOT
 * collapsed. It is a LEAF reached only via m.call, and its sole caller loc_0413
 * is interruptible (main-loop cascade loc_197a->entry_03fb, + the dispatchTask
 * entry_0400) with the NMI mask ENABLED -- so by the atomicity-is-per-call-path
 * rule the vblank NMI can land inside it and push a live PC into diffed stack RAM.
 * Collapsing its charges is therefore forbidden; the per-branch cycle totals are
 * asserted equal (and shown to have teeth) but they are the oracle's own per-
 * instruction sums, not a collapse. loc_0426 makes NO 0x7Dxx hardware-latch write
 * on any path (0x6082 is the work-RAM sound-trigger counter, not the 0x7D02
 * latch), so there is no write-trace concern.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0426 as translated_0426 } from "../../translated/state0.js";
import { loc_0426 as optimized_0426 } from "../loc_0426.js";
import { Machine } from "../../machine.js";
import {
  wholeMachineEquivalence as coreWholeMachineEquivalence,
  unitEquivalence as coreUnitEquivalence,
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

const TARGET = 0x0426;

// Colour-cycle work RAM the branch synthesiser pokes. HEX on purpose: the world
// verifier left the 0x6390/0x6391/0x6393 block unnamed (see ram.js), so loc_0426
// keeps them hex too. 0x6390 is loc_0426's own first-and-every-path output store.
const CYCLE_COUNTER = 0x6390; // colour-cycle frame counter (UNNAMED in ram.js)
const TABLE_SUPPRESS = 0x6393; // "skip table copy this cycle" flag (UNNAMED)

// coin+start tape: a coin pulse on IN2 bit7 (MAME's 6-frame hold) then start1 on
// IN2 bit2, so the ROM's own credit/start logic runs a game and the colour cycle
// turns over. A fresh copy per machine keeps each run's tape independent.
const IN2 = 0x7d00;
const COIN1 = 0x80;
const START1 = 0x04;
const TAPE = [
  { port: IN2, bits: COIN1, frame: 10, dur: 6 },
  { port: IN2, bits: START1, frame: 30, dur: 6 },
];

/**
 * The shared tape-injecting factory the equivalence engine drives. harness.js
 * drives no input, so this test builds the DK Machine directly and installs the
 * SAME coin+start tape on every side (baseline, optimized, and the unit host).
 */
const makeGameMachine = (overrides) => {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.inputTape = TAPE.map((t) => ({ ...t }));
  return m;
};

// loc_0426 proper first fires at ~frame 1802 (the first in-game FRAME wrap) and
// runs for the 128 frames of that cycle. Span the whole cycle so the counter
// reaches 0x80 (the loc_0464 reset arm) inside the compared window.
const FRAMES = 1950;
const UNIT_MAXFRAMES = 1900;

// loc_0426's own output store the teeth corrupt: the counter 0x6390, written
// (inc (hl)) on EVERY path as the routine's first store and sitting in the
// compared work-RAM dump. A first-write flip is not corrected until the next
// frame's write, so it is captured at the boundary in between -- the
// representative "wrong value to one of the routine's own output addresses" bug.
const BROKEN_ADDR = CYCLE_COUNTER;

function broken_0426(m) {
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
    return optimized_0426(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- pristine-entry capture (for the isolated branch / cycle checks) ----------

/** Capture the machine the instant loc_0426 is FIRST entered under the tape. */
function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_0426(mm);
  }]]);
  const host = makeGameMachine(snap);
  host.runFrames(UNIT_MAXFRAMES);
  if (entry === null) throw new Error("loc_0426 never entered within the run window");
  return entry;
}

const ENTRY = ROM_PRESENT ? captureEntry() : null;

/**
 * A synthetic entry that forces one branch: clone the captured entry and poke the
 * deciding work RAM (the counter that `inc (hl)` will bump, and the suppress
 * flag). Cloned again per side so oracle and optimized start byte-identical.
 */
function branchEntry(spec) {
  const c = ENTRY.clone();
  c.mem.write8(CYCLE_COUNTER, spec.counter); // value BEFORE the routine's inc
  c.mem.write8(TABLE_SUPPRESS, spec.suppress);
  return c;
}

/** Run `fn` on a fresh clone of `entry`; return {m, cycles}. */
function runClone(entry, fn) {
  const c = entry.clone();
  const c0 = c.cycles;
  fn(c);
  return { m: c, cycles: c.cycles - c0 };
}

// The five data-dependent exits of loc_0426. `counter` is the value BEFORE the
// routine's `inc (hl)`, so the routine sees counter+1.
const BRANCHES = [
  { name: "counter->0x80 (loc_0464 reset)", spec: { counter: 0x7f, suppress: 1 } },
  { name: "table-copy suppressed (loc_0486)", spec: { counter: 0x05, suppress: 1 } },
  { name: "not a 32-boundary (loc_0486)", spec: { counter: 0x05, suppress: 0 } },
  { name: "32-boundary, bit5 set -> table 0x39cf", spec: { counter: 0x1f, suppress: 0 } },
  { name: "32-boundary, bit5 clr -> table 0x39f7", spec: { counter: 0x3f, suppress: 0 } },
];

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loc_0426 matches translated every frame", () => {
  const r = coreWholeMachineEquivalence(makeGameMachine, FRAMES, new Map([[TARGET, optimized_0426]]));

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
    `  EQUAL/whole: ${r.framesCompared} frames identical, override fired ${r.invocations.get(TARGET)}x`,
  );
});

test("EQUAL (unit): idiomatic optimized loc_0426 matches translated in RAM + registers", () => {
  const r = coreUnitEquivalence(makeGameMachine, TARGET, translated_0426, optimized_0426, { maxFrames: UNIT_MAXFRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

// -- FULL BRANCH COVERAGE + CYCLE TOTALS --------------------------------------

test("BRANCH COVERAGE: every data-dependent exit is EQUAL in RAM+regs+pc and cycle total", () => {
  for (const b of BRANCHES) {
    const entry = branchEntry(b.spec);
    const a = runClone(entry, translated_0426);
    const o = runClone(entry, optimized_0426);

    const ram = firstStateDiff(a.m.dumpState(), o.m.dumpState(), (off) => a.m.stateOffsetToAddr(off));
    const regs = firstRegDiff(a.m.regs, o.m.regs);
    assert.equal(ram, null, ram ? `[${b.name}] RAM diff at 0x${ram.addr.toString(16)} (t ${ram.a} vs o ${ram.b})` : "");
    assert.equal(regs, null, regs ? `[${b.name}] reg diff at ${regs.reg} (t ${regs.a} vs o ${regs.b})` : "");
    assert.equal(a.m.pc, o.m.pc, `[${b.name}] pc must match`);

    // loc_0426 is kept per-instruction, so the totals match the oracle's own sums;
    // both sides also run identical oracle callees via m.call.
    assert.equal(o.cycles, a.cycles, `[${b.name}] cycle total drifted: optimized ${o.cycles} vs oracle ${a.cycles}`);
    console.log(`  BRANCH ${b.name}: EQUAL, total ${a.cycles}t, pc 0x${a.m.pc.toString(16)}`);
  }
});

test("CYCLE teeth: a wrong per-instruction charge is CAUGHT (cycle assertion is not vacuous)", () => {
  const entry = branchEntry({ counter: 0x05, suppress: 0 }); // the not-a-boundary arm
  const a = runClone(entry, translated_0426);
  const wrong = runClone(entry, (m) => {
    const realStep = m.step.bind(m);
    m.step = (addr, cyc) => realStep(addr, addr === 0x0486 ? cyc - 1 : cyc);
    try { return optimized_0426(m); } finally { m.step = realStep; }
  });
  assert.notEqual(wrong.cycles, a.cycles, "cycle-total assertion has no teeth");
  console.log(`  CYCLE teeth: oracle ${a.cycles}t vs wrong-charge ${wrong.cycles}t caught`);
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong counter (0x6390) store is CAUGHT and NOT-EQUAL", () => {
  const r = coreWholeMachineEquivalence(makeGameMachine, FRAMES, new Map([[TARGET, broken_0426]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong counter store is CAUGHT and names 0x6390", () => {
  const r = coreUnitEquivalence(makeGameMachine, TARGET, translated_0426, broken_0426, { maxFrames: UNIT_MAXFRAMES });

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
