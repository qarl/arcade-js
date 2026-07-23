// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for sub_03a2 -- the main loop's once-per-serviced-
 * frame periodic-event service (ROM 0x03A2). It is called UNCONDITIONALLY from
 * mainLoop (ROM 0x02DE) on the per-frame-work path, so it is reached mask-ENABLED
 * and its cycle charges are KEPT PER-INSTRUCTION and never collapsed (README
 * §"ATOMICITY IS PER-CALL-PATH"; the same reason sub_0030/loc_197a stay per-instr).
 *
 * WHAT THE ATTRACT RUN REACHES (measured, so the coverage claims are honest):
 * sub_03a2 fires every frame, but for the first ~580 frames it SKIPS at the very
 * first gate -- the rst-0x30 BOARD bit-select returns false (the demo isn't on a
 * board 1-2 gameplay frame), so the routine is a pure no-op and stores no work
 * RAM. The attract demo then enters gameplay and the deeper paths light up:
 *   frame 585  first prescaler store (0x62B8 dec/reload)  -- gates 1-3 passed
 *   frame 808  first BODY store (0x66A9/0x66AA arm split, 0x62BA countdown)
 *   frame 868  first arm-B UNDERFLOW (0x62B9:=1, 0x63A0:=1)
 * So a 900-frame whole-machine window exercises the rst-skip path AND the prescaler
 * AND both arms AND the arm-B underflow NATURALLY -- not just synthetically.
 *
 * Six jobs:
 *   1. EQUAL (whole-machine, 900f) -- optimized == translated every frame; the
 *      override fires ~890×.
 *   2. EQUAL (unit) -- identical RAM + full register file (incl F) + pc at the
 *      first natural entry (the rst-0x30 skip path, frame ~5).
 *   3. TEETH (whole-machine) -- a deliberately-wrong prescaler store (0x62B8) is
 *      CAUGHT and NOT-EQUAL, naming the address. This is a genuine routine output
 *      reached at frame 585.
 *   4. TEETH (unit) -- the first natural entry is the board-gated SKIP path, which
 *      stores NO work RAM; its only observable output is the register file (as with
 *      sub_0030). So the broken twin flips the carry flag and the unit gate CATCHES
 *      it, naming register F.
 *   5. BRANCH COVERAGE (synthesized) -- clone the captured entry and force the gate
 *      inputs to drive EACH data-dependent branch (both rst skips, all three ret-cc
 *      early exits, arm A, arm B not-yet-zero, arm B underflow), diffing RAM + regs
 *      + pc + per-branch CYCLE TOTAL. Every branch thus has committed teeth.
 *   6. TEETH (branch store) -- a wrong BODY store (the (ix+0x0A) object write at
 *      0x66AA, which the arms differ on) is CAUGHT on a synthesized arm-B entry,
 *      naming the address -- store teeth on the arm the whole-machine 0x62B8 break
 *      does not cover.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { sub_03a2 as translated_03a2 } from "../../translated/mainloop.js";
import { sub_03a2 as optimized_03a2 } from "../sub_03a2.js";
import { unitEquivalence, wholeMachineEquivalence } from "../harness.js";
import { Machine } from "../../machine.js";
import { firstStateDiff, firstRegDiff } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT
  ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR)))
  : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x03a2;
const FRAMES = 900; // rst-skip + prescaler(585) + body(808) + arm-B underflow(868)
const F_C = 0x01;   // Z80 carry-flag bit (core/cpu/z80.js)

// Gate/RAM addresses sub_03a2 reads or writes (all on ram.js's deliberately-
// unnamed list, so hex here too).
const BOARD = 0x6227;         // rst-0x30 rotate count: 1-2 proceed, 3-4 skip
const MARIO_ACTIVE = 0x6200;  // rst-0x10 gate: bit0 set to proceed
const SCRATCH_6350 = 0x6350;  // bit0 clear to proceed (ret c)
const PRESCALE_62B8 = 0x62b8; // /4 prescaler (dec/reload)
const CTRL_62B9 = 0x62b9;     // bit0 enable, bit1 arm-select
const COUNT_62BA = 0x62ba;    // arm-B countdown
const OBJ_IX0A = 0x66aa;      // (ix+0x0A) with ix=0x66A0 -- the arm-distinguishing body store

/**
 * Deliberately-broken twin (whole-machine): behaves like the optimized routine
 * EXCEPT the FIRST work-RAM store to the prescaler 0x62B8 lands a wrong value
 * (correct XOR 0xFF, guaranteed to differ). One clean corruption across the whole
 * run; the per-frame state diff catches it at the frame the store is first made.
 */
let brokeWhole = false;
function brokenWhole_03a2(m) {
  const realWrite = m.mem.write8.bind(m.mem);
  m.mem.write8 = (addr, value, busOffset) => {
    if (!brokeWhole && addr === PRESCALE_62B8) {
      brokeWhole = true;
      return realWrite(addr, value ^ 0xff, busOffset);
    }
    return realWrite(addr, value, busOffset);
  };
  try {
    return optimized_03a2(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

/**
 * Deliberately-broken twin (unit): the routine's first natural entry is the
 * board-gated SKIP path, which makes NO work-RAM store -- its observable output
 * is the register file. So invert the carry flag (as sub_0030's twin does): the
 * unit register diff must catch F.
 */
function brokenFlag_03a2(m) {
  const ret = optimized_03a2(m);
  m.regs.f ^= F_C;
  return ret;
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized sub_03a2 matches translated every frame", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, optimized_03a2]]));

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

test("EQUAL (unit): idiomatic optimized sub_03a2 matches translated in RAM + registers", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_03a2, optimized_03a2);

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong prescaler store is CAUGHT and NOT-EQUAL", () => {
  brokeWhole = false;
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, brokenWhole_03a2]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.ok(brokeWhole, "the broken store was never reached — TEETH would be vacuous");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): an inverted carry flag is CAUGHT and names register F", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_03a2, brokenFlag_03a2);

  assert.equal(r.equal, false, "harness FAILED to catch a wrong flag — it is worthless");
  // First natural entry is the board-gated skip path: no RAM store, so the diff is a register.
  assert.equal(r.ram, null, "the skip path makes no RAM store, so the diff must be a register");
  assert.ok(r.regs != null, "a caught divergence must name a register");
  assert.equal(
    r.regs.reg,
    "f",
    `expected the diff on the carry flag F, got register '${r.regs?.reg}'`,
  );
  console.log(
    `  TEETH/unit: caught at register ${r.regs.reg} ` +
      `(translated 0x${r.regs.a.toString(16)} vs broken 0x${r.regs.b.toString(16)})`,
  );
});

// -- BRANCH COVERAGE (synthesized) --------------------------------------------

/**
 * Capture a pristine machine at the first natural entry of sub_03a2, exactly as
 * unitEquivalence does, so synthesized branches start from a real clonable state.
 */
function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_03a2(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(30);
  assert.ok(entry !== null, "failed to capture a sub_03a2 entry");
  return entry;
}

/** Force every gate input on a clone so the routine takes a deterministic path. */
function poke(c, g) {
  c.mem.write8(BOARD, g.board & 0xff);
  c.mem.write8(MARIO_ACTIVE, g.marioActive & 0xff);
  c.mem.write8(SCRATCH_6350, g.scratch & 0xff);
  c.mem.write8(PRESCALE_62B8, g.prescale & 0xff);
  c.mem.write8(CTRL_62B9, g.ctrl & 0xff);
  c.mem.write8(COUNT_62BA, g.count & 0xff);
}

/**
 * Force the gate inputs on two clones of the captured entry, run oracle vs
 * optimized, and diff RAM + registers + pc + per-branch cycle total.
 */
function diffBranch(entry, g) {
  const ca = entry.clone();
  const cb = entry.clone();
  poke(ca, g);
  poke(cb, g);

  const cycA0 = ca.cycles;
  const cycB0 = cb.cycles;
  translated_03a2(ca);
  optimized_03a2(cb);

  return {
    ram: firstStateDiff(ca.dumpState(), cb.dumpState(), (off) => ca.stateOffsetToAddr(off)),
    regs: firstRegDiff(ca.regs, cb.regs),
    pc: ca.pc === cb.pc ? null : { a: ca.pc, b: cb.pc },
    cyclesA: ca.cycles - cycA0,
    cyclesB: cb.cycles - cycB0,
  };
}

// Gate presets. `board`:1-2 proceeds past rst-0x30; `marioActive` bit0 past
// rst-0x10; `scratch` bit0 clear past 0x03AA; `prescale`==1 dec->0 proceeds;
// `ctrl` bit0 enables, bit1 selects arm; `count` is arm-B's 0x62BA countdown.
const PASS = { board: 1, marioActive: 1, scratch: 0, prescale: 1, ctrl: 0x03, count: 5 };
const CASES = [
  ["rst-0x30 skip (board 4: bit-select clear)", { ...PASS, board: 4 }],
  ["rst-0x10 skip (MARIO_ACTIVE bit0 clear)", { ...PASS, marioActive: 0 }],
  ["ret c  (0x6350 bit0 set)", { ...PASS, scratch: 1 }],
  ["ret nz (prescaler not yet zero)", { ...PASS, prescale: 3 }],
  ["ret nc (0x62B9 enable bit0 clear)", { ...PASS, ctrl: 0x00 }],
  ["arm A  (0x62B9 bit1 clear)", { ...PASS, ctrl: 0x01 }],
  ["arm B  countdown not yet zero", { ...PASS, ctrl: 0x03, count: 5 }],
  ["arm B  underflow (0x62B9:=1, 0x63A0:=1)", { ...PASS, ctrl: 0x03, count: 1 }],
];

test("BRANCH COVERAGE: every data-dependent branch is EQUAL (RAM + regs + pc + cycles)", () => {
  const entry = captureEntry();
  for (const [label, g] of CASES) {
    const d = diffBranch(entry, g);
    assert.equal(d.ram, null, `${label}: RAM diff at 0x${d.ram?.addr?.toString(16)}`);
    assert.equal(d.regs, null, `${label}: reg diff at ${d.regs?.reg} (${d.regs?.a} vs ${d.regs?.b})`);
    assert.equal(d.pc, null, `${label}: pc diff ${JSON.stringify(d.pc)}`);
    assert.equal(
      d.cyclesA,
      d.cyclesB,
      `${label}: cycle total diverged (oracle ${d.cyclesA} vs optimized ${d.cyclesB})`,
    );
  }
  console.log(`  BRANCH: ${CASES.length} synthesized branches EQUAL (RAM + regs + pc + cycle total)`);
});

test("TEETH (branch store): a wrong body store (0x66AA) is CAUGHT on a synthesized arm-B entry", () => {
  const entry = captureEntry();
  // Arm B underflow reaches the richest store set; break the (ix+0x0A) object write.
  const g = { ...PASS, ctrl: 0x03, count: 1 };

  const ca = entry.clone(); // oracle
  const cb = entry.clone(); // optimized, with the 0x66AA store corrupted once
  poke(ca, g);
  poke(cb, g);

  translated_03a2(ca);

  let broke = false;
  const realWrite = cb.mem.write8.bind(cb.mem);
  cb.mem.write8 = (addr, value, busOffset) => {
    if (!broke && addr === OBJ_IX0A) {
      broke = true;
      return realWrite(addr, value ^ 0xff, busOffset);
    }
    return realWrite(addr, value, busOffset);
  };
  try {
    optimized_03a2(cb);
  } finally {
    cb.mem.write8 = realWrite;
  }

  assert.ok(broke, "the arm-B body store 0x66AA was never reached — TEETH would be vacuous");
  const ram = firstStateDiff(ca.dumpState(), cb.dumpState(), (off) => ca.stateOffsetToAddr(off));
  assert.ok(ram != null, "harness FAILED to catch a wrong body store — it is worthless");
  assert.equal(
    ram.addr,
    OBJ_IX0A,
    `expected first diff at the broken store 0x${OBJ_IX0A.toString(16)}, got 0x${ram.addr?.toString(16)}`,
  );
  console.log(
    `  TEETH/branch: caught at 0x${ram.addr.toString(16)} (oracle ${ram.a} vs broken ${ram.b})`,
  );
});
