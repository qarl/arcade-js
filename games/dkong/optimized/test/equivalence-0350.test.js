// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for sub_0350 (the once-per-player EXTRA-LIFE award
 * check). A LEAF routine -- not a dispatch target -- reached only via
 * `m.call(0x0350)` from the MAIN LOOP's per-frame work path (ROM 0x02CA), where
 * it runs on every wait-for-vblank spin iteration (~140x/frame). The unit gate
 * reaches it because the snapshot override is installed at CONSTRUCTION, so it
 * fires however the routine is entered (dispatch OR m.call).
 *
 * Seven jobs:
 *
 *   1. EQUAL (whole-machine) -- the idiomatic optimized sub_0350
 *      (optimized/sub_0350.js) reads EQUAL against its translated oracle every
 *      frame. The override resolves through the routine registry, so it swaps at
 *      every `m.call(0x0350)` site; inert when the map is empty.
 *
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous. sub_0350
 *      fires thousands of times within the 30-frame window (it runs each spin
 *      iteration). The AWARD branch fires ONCE, on the very first invocation:
 *      before handler_01c3 unpacks DSW0, DIP_BONUS_LIFE (0x6021) is still 0 and
 *      the (zero) score's thousands pair is `>= 0`, so the threshold is met and
 *      the extra life is granted. The one-shot latch 0x622D then stays set, so
 *      every later call takes `ret nz`. The natural run thus covers the AWARD and
 *      RET-NZ branches by itself; the RET-C arms are synthesised below.
 *
 *   3. EQUAL (unit) -- translated vs optimized leave identical RAM + registers
 *      (incl. F, B, HL and SP) + pc from the captured entry state. That first
 *      entry IS the AWARD-P1 branch (per job 2), so the unit EQUAL exercises the
 *      full award path including the entry_06b8 tail jump.
 *
 *   4. BRANCH + CONTRACT COVERAGE -- every data-dependent branch is SYNTHESISED
 *      by poking the deciding bytes identically on BOTH sides, then diffed
 *      RAM + regs + pc AND checked for the exact SP and CYCLE TOTAL:
 *        - 0x622D != 0                         (already awarded):  ret nz,  28 t
 *        - 0x622D=0, 0x600D=0, score<thresh    (P1 below):        ret c,  147 t
 *        - 0x622D=0, 0x600D!=0, score<thresh   (P2 below):        ret c,  152 t
 *        - 0x622D=0, 0x600D=0, score>=thresh   (P1 award):        tail,   632 t
 *        - 0x622D=0, 0x600D!=0, score>=thresh  (P2 award):        tail,   637 t
 *      The award totals include entry_06b8's tail (440 t) -- the harness machine
 *      resolves 0x06b8 to the frozen oracle (no manifest is loaded here), so the
 *      total is deterministic. A dropped m.step charge is CAUGHT (job below).
 *
 *   5. BRANCH-TEETH (cycles) -- a variant that drops one m.step charge yields a
 *      wrong total and is CAUGHT, proving the cycle-total assertion has teeth.
 *
 *   6+7. TEETH (whole + unit) -- a deliberately-broken twin whose first store to
 *      BONUS_LIFE_AWARDED (0x622D) lands the wrong value must be CAUGHT: NOT-EQUAL,
 *      naming the diverging address. The award branch fires on the natural first
 *      invocation, so this store actually executes.
 *
 * THE CYCLE DECISION this routine records: sub_0350 stays PER-INSTRUCTION (its
 * charges are NOT collapsed). It is NOT atomic -- called every frame from the
 * MAIN LOOP with the NMI mask ENABLED, and the vblank NMI lands INSIDE its
 * 0x0350-0x0372 read/compute region heavily in real gameplay (among the most-hit
 * NMI-landing PCs in the measured landing histogram). Collapsing its
 * per-instruction m.step charges to one per-branch lump would move where the NMI
 * lands and change the PC pushed into diffed stack RAM (README §2's "NMI lands
 * mid-logic" caveat; the same reason sub_0020 / handler_05e9 keep per-instruction).
 * So the oracle's charge-for-charge distribution is preserved; the path TOTALS
 * (28 / 147 / 152 / 632 / 637 t) are the oracle's by construction and are
 * asserted below.
 *
 * NO write-trace test: sub_0350's only stores are 0x622D and 0x6228 (LIVES), both
 * WORK RAM (0x6000-0x6BFF), not 0x7Dxx hardware latches -- they do not appear in
 * the emit.js --writes trace, so there is no hardware bus cycle to pin.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { sub_0350 as translated_0350 } from "../../translated/mainloop.js";
import { sub_0350 as optimized_0350 } from "../sub_0350.js";
import { unitEquivalence, wholeMachineEquivalence } from "../harness.js";
import { firstStateDiff, firstRegDiff } from "../../../../core/equivalence.js";
import { Machine } from "../../machine.js";
import { BONUS_LIFE_AWARDED, CURRENT_PLAYER, DIP_BONUS_LIFE, LIVES } from "../ram.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT
  ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR)))
  : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built -- run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0350;
const FRAMES = 30; // sub_0350 fires thousands of times; award once (frame 0), rest ret nz

// The score bytes the routine reads are the +1 MIDDLE byte of each score base
// (not named in ram.js -- see handler_05c6 for the same convention).
const P1_SCORE_MID = 0x60b3; // P1_SCORE (0x60B2) + 1
const P2_SCORE_MID = 0x60b6; // P2_SCORE (0x60B5) + 1

// The routine's first store into diffed RAM (on the award path) is
// BONUS_LIFE_AWARDED; the broken twin corrupts exactly that store.
const BROKEN_ADDR = BONUS_LIFE_AWARDED; // 0x622D

/**
 * Deliberately-broken twin: behaviourally the optimized routine EXCEPT the first
 * store to BONUS_LIFE_AWARDED lands a wrong value (correct value XOR 0xFF,
 * guaranteed to differ). The `inc (LIVES)` and every subroutine call still run
 * verbatim -- only the one output byte is corrupted -- so the gate is catching a
 * "wrong value to the routine's own output address" bug, not a control-flow bug.
 */
function broken_0350(m) {
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
    return optimized_0350(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized sub_0350 matches translated every frame", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, optimized_0350]]));

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

test("EQUAL (unit): idiomatic optimized sub_0350 matches translated in RAM + registers", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_0350, optimized_0350);

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F, B, HL, SP) + pc identical (award-P1 entry)");
});

// -- BRANCH + CONTRACT COVERAGE ----------------------------------------------

/** Capture the pristine machine the instant sub_0350 is first entered (via m.call).
 *  A constructor override snapshots the entry, then delegates to the translated
 *  oracle so the host run proceeds normally to a clean stop. */
function captureEntry(maxFrames = FRAMES) {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_0350(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(maxFrames);
  if (entry === null) throw new Error(`0x${TARGET.toString(16)} never entered in ${maxFrames} frames`);
  return entry;
}

/** Clone `entry`, apply identical pokes, run `fn`, and report the full contract:
 *  the resulting SP + PC, the RAM/reg state, and the cycles the routine charged
 *  (relative to entry, so it is base-independent). */
function runBranch(entry, pokes, fn) {
  const c = entry.clone();
  for (const [addr, val] of pokes) c.mem.write8(addr, val);
  const c0 = c.cycles;
  const ret = fn(c);
  return { ret, cycles: c.cycles - c0, sp: c.regs.sp, pc: c.pc, machine: c };
}

/** Prove one synthesised branch EQUAL across the WHOLE contract: RAM, registers,
 *  pc, the SP, and the cycle total. `expect` pins the cycle total as absolute
 *  (structural, entry-independent) so a wrong total on this arm has committed
 *  teeth. */
function assertBranchEqual(label, pokes, expect) {
  const entry = captureEntry();
  const o = runBranch(entry, pokes, translated_0350);
  const p = runBranch(entry, pokes, optimized_0350);

  const ram = firstStateDiff(o.machine.dumpState(), p.machine.dumpState(), (off) => o.machine.stateOffsetToAddr(off));
  assert.equal(ram, null, ram ? `RAM diff at 0x${(ram.addr ?? 0).toString(16)}` : "");
  const regs = firstRegDiff(o.machine.regs, p.machine.regs);
  assert.equal(regs, null, regs ? `reg diff at ${regs.reg}` : "");
  assert.equal(o.pc, p.pc, "pc must match between oracle and optimized");

  // SP + cycle-total contract (cycles are NOT in the RAM+regs dump the unit gate
  // compares; SP is, but assert it explicitly for the tail-jump's stack balance).
  assert.equal(o.sp, p.sp, "SP must match the oracle");
  assert.equal(o.cycles, p.cycles, "cycle total must match the oracle");
  assert.equal(o.cycles, expect.cycles, `oracle cycle total should be ${expect.cycles} on this arm`);
  console.log(
    `  BRANCH/${label}: EQUAL -- SP 0x${p.sp.toString(16)}, ${p.cycles} t, ` +
      `0x622D=${p.machine.mem.read8(BONUS_LIFE_AWARDED)}, LIVES=${p.machine.mem.read8(LIVES)}`,
  );
}

test("BRANCH (unit): 0x622D != 0 -- already awarded, ret nz, 28 t", () => {
  assertBranchEqual("ret-nz", [[BONUS_LIFE_AWARDED, 1]], { cycles: 28 });
});

test("BRANCH (unit): P1 below threshold -- jr z taken, ret c, 147 t", () => {
  assertBranchEqual(
    "P1-below",
    [[BONUS_LIFE_AWARDED, 0], [CURRENT_PLAYER, 0], [P1_SCORE_MID, 0], [P1_SCORE_MID + 1, 0], [DIP_BONUS_LIFE, 0x07]],
    { cycles: 147 },
  );
});

test("BRANCH (unit): P2 below threshold -- jr z NOT taken, ret c, 152 t", () => {
  assertBranchEqual(
    "P2-below",
    [[BONUS_LIFE_AWARDED, 0], [CURRENT_PLAYER, 1], [P2_SCORE_MID, 0], [P2_SCORE_MID + 1, 0], [DIP_BONUS_LIFE, 0x07]],
    { cycles: 152 },
  );
});

test("BRANCH (unit): P1 at/above threshold -- award + tail-jump 0x06b8, 632 t", () => {
  assertBranchEqual(
    "P1-award",
    [[BONUS_LIFE_AWARDED, 0], [CURRENT_PLAYER, 0], [P1_SCORE_MID, 0xf0], [P1_SCORE_MID + 1, 0x0f], [DIP_BONUS_LIFE, 0x07]],
    { cycles: 632 },
  );
});

test("BRANCH (unit): P2 at/above threshold -- award via P2 + tail-jump 0x06b8, 637 t", () => {
  assertBranchEqual(
    "P2-award",
    [[BONUS_LIFE_AWARDED, 0], [CURRENT_PLAYER, 1], [P2_SCORE_MID, 0xf0], [P2_SCORE_MID + 1, 0x0f], [DIP_BONUS_LIFE, 0x07]],
    { cycles: 637 },
  );
});

test("BRANCH-TEETH (cycles): a dropped m.step charge yields a wrong total and is CAUGHT", () => {
  const entry = captureEntry();
  const pokes = [[BONUS_LIFE_AWARDED, 0], [CURRENT_PLAYER, 0], [P1_SCORE_MID, 0], [P1_SCORE_MID + 1, 0], [DIP_BONUS_LIFE, 0x07]];
  const good = runBranch(entry, pokes, optimized_0350);
  // A variant of the P1-below path that drops the `cp (hl)` 7 t charge -- same
  // RAM/regs, wrong total.
  const dropped = runBranch(entry, pokes, (m) => {
    const { regs, mem } = m;
    regs.a = mem.read8(BONUS_LIFE_AWARDED); m.step(0x0353, 13);
    regs.and(regs.a); m.step(0x0354, 4);
    if (regs.fNZ) { m.ret(11); return; }
    m.step(0x0355, 5);
    regs.hl = 0x60b3; m.step(0x0358, 10);
    regs.a = mem.read8(CURRENT_PLAYER); m.step(0x035b, 13);
    regs.and(regs.a); m.step(0x035c, 4);
    if (regs.fZ) { m.step(0x0361, 12); } else { m.step(0x035e, 7); regs.hl = 0x60b6; m.step(0x0361, 10); }
    regs.a = mem.read8(regs.hl); m.step(0x0362, 7);
    regs.and(0xf0); m.step(0x0364, 7);
    regs.b = regs.a; m.step(0x0365, 4);
    regs.hl = (regs.hl + 1) & 0xffff; m.step(0x0366, 6);
    regs.a = mem.read8(regs.hl); m.step(0x0367, 7);
    regs.and(0x0f); m.step(0x0369, 7);
    regs.or(regs.b); m.step(0x036a, 4);
    for (const pc of [0x036b, 0x036c, 0x036d, 0x036e]) { regs.rrca(); m.step(pc, 4); }
    regs.hl = DIP_BONUS_LIFE; m.step(0x0371, 10);
    regs.cp(mem.read8(regs.hl)); // (0x0372 charge intentionally dropped)
    if (regs.fC) { m.ret(11); return; }
    m.step(0x0373, 5);
  });
  assert.equal(good.cycles, 147, "the correct P1-below total is 147 t");
  assert.notEqual(dropped.cycles, good.cycles, "cycle-total assertion has no teeth");
  console.log(`  BRANCH-TEETH: correct 147 t vs dropped-charge ${dropped.cycles} t -- caught`);
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong BONUS_LIFE_AWARDED store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, broken_0350]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store -- it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong BONUS_LIFE_AWARDED store is CAUGHT and names 0x622D", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_0350, broken_0350);

  assert.equal(r.equal, false, "harness FAILED to catch a wrong store -- it is worthless");
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
