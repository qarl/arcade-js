// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for sub_0593 (ROM 0x0593-0x059A): the one-BCD-digit
 * store shared by the vertical string/score renderers -- `and 0x0f` /
 * `ld (ix+0),a` / `add ix,de` / `ret`. A LEAF (calls nothing), reached only via
 * `m.call` from the render cluster (loop_0583 <- draw_0578, sub_0616 <-
 * entry_0611) and from sub_057c <- sub_1486.
 *
 * Five jobs:
 *
 *   1. EQUAL (whole-machine) -- the idiomatic optimized sub_0593 reads EQUAL
 *      against its translated oracle every frame. It first fires reaching frame 5
 *      (the initial score/high-score BCD draw) and fires 14x within the window,
 *      so the override is far from vacuous.
 *
 *   2. EQUAL (unit) -- RAM + full register file (incl. F) + pc identical on the
 *      captured first-entry state, via the standard unitEquivalence harness
 *      (which installs the snapshot override at CONSTRUCTION so it reaches this
 *      m.call-only leaf).
 *
 *   3. TEETH (whole + unit) -- a deliberately-wrong digit store is CAUGHT and
 *      NOT-EQUAL, naming the diverging VRAM address.
 *
 *   4. FULL BRANCH COVERAGE -- sub_0593 has no control-flow branches, but its
 *      observable output has two data-dependent axes: the `and 0x0f` mask (high
 *      nibble discarded) and the `add ix,de` CARRY (set/clear from the 16-bit
 *      result). Natural runs only ever exercise the CARRY-SET case (IX~0x76xx +
 *      0xFFE0 always overflows). The CARRY-CLEAR case is SYNTHESISED, and each
 *      synthesised branch is proven EQUAL in RAM+regs+pc AND in total cycle cost
 *      (per-instruction was kept, so the total 7+19+15+10 = 51 t must match).
 *
 *   5. FLAG TEETH -- the specific bug the oracle warns about: doing the address
 *      arithmetic with plain JS (`ix = (ix+de)&0xffff`) instead of `add ix,de`
 *      leaves H/N/C wrong. The oracle notes that carry is live three returns up,
 *      so this MUST be caught -- and the unit gate catches it on register F.
 *
 * ATOMICITY FINDING: sub_0593 is NOT atomic. All its callers are main-loop /
 * interruptible (NMI mask enabled), so the vblank NMI can land between its three
 * instructions and its internal cycle distribution is observable. A flat cycle-
 * collapse HAPPENS to pass a 240-frame attract run (the NMI never lands in the
 * ~51-cycle window on that trajectory) -- but that is not proof of atomicity, so
 * the optimized routine keeps per-instruction charges, the always-correct choice.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { sub_0593 as translated_0593 } from "../../translated/mainloop.js";
import { sub_0593 as optimized_0593 } from "../sub_0593.js";
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

const TARGET = 0x0593;
const FRAMES = 12; // sub_0593 first fires reaching frame 5, 14x within this window

// sub_0593's first natural entry writes the low nibble of A to the VRAM cell IX
// addresses. We capture that entry (below) so the whole-machine broken twin knows
// which VRAM address to corrupt and the unit teeth knows which address to expect.

/**
 * Capture the pristine machine state at sub_0593's first natural entry, exactly
 * as unitEquivalence does internally, so synthesised branch tests can clone a
 * machine with a VALID stack (m.ret pops a real return address) and the teeth
 * tests know the concrete VRAM destination.
 */
function captureEntry(maxFrames = 240) {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_0593(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(maxFrames);
  if (entry === null) throw new Error("sub_0593 never entered within the window");
  return entry;
}

/**
 * Deliberately-broken twin: behaviourally the optimized routine EXCEPT it stores
 * the WRONG digit (correct nibble XOR 0x0F, guaranteed to differ) to the VRAM
 * cell. Registers/flags are left correct, isolating the fault to the one output
 * store -- the representative "wrong value to the routine's own output address"
 * bug the gate must catch. Corrupts every call so any per-frame redraw stays
 * corrupted and the diff persists to a frame boundary.
 */
function brokenStore_0593(m) {
  const { regs, mem } = m;
  regs.and(0x0f);
  m.step(0x0595, 7);
  mem.write8(regs.ix, (regs.a ^ 0x0f) & 0xff); // WRONG digit stored
  m.step(0x0598, 19);
  regs.addIx(regs.de);
  m.step(0x059a, 15);
  m.ret();
}

/**
 * Flag-broken twin: arithmetically correct (IX advances by DE, correct digit
 * stored) but does the pointer add with plain JS instead of `add ix,de`, so H/N/C
 * and F3/F5 are left at whatever the `and` set -- the exact bug the oracle's note
 * warns about. Must be caught on register F.
 */
function brokenFlags_0593(m) {
  const { regs, mem } = m;
  regs.and(0x0f);
  m.step(0x0595, 7);
  mem.write8(regs.ix, regs.a);
  m.step(0x0598, 19);
  regs.ix = (regs.ix + regs.de) & 0xffff; // WRONG: leaves flags from `and`
  m.step(0x059a, 15);
  m.ret();
}

/** Run `fn` on a clone of `entry` after forcing A/IX/DE; return {dump, regs, pc, cycles}. */
function runOn(entry, fn, { a, ix, de }) {
  const c = entry.clone();
  c.regs.a = a;
  c.regs.ix = ix;
  c.regs.de = de;
  const before = c.cycles;
  fn(c);
  return { dump: c.dumpState(), regs: c.regs, pc: c.pc, cycles: c.cycles - before, stateOffsetToAddr: (o) => c.stateOffsetToAddr(o) };
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized sub_0593 matches translated every frame", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, optimized_0593]]));

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

test("EQUAL (unit): idiomatic optimized sub_0593 matches translated in RAM + registers", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_0593, optimized_0593);

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

// -- TEETH (value) ------------------------------------------------------------

test("TEETH (whole-machine): a wrong digit store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, brokenStore_0593]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong digit store is CAUGHT and names the VRAM cell", () => {
  const entry = captureEntry();
  const expectAddr = entry.regs.ix & 0xffff; // where the first store lands

  const r = unitEquivalence(ROM, {}, TARGET, translated_0593, brokenStore_0593);

  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.ok(r.ram != null, "a caught divergence must name a RAM address");
  assert.equal(
    r.ram.addr,
    expectAddr,
    `expected first diff at the stored VRAM cell 0x${expectAddr.toString(16)}, got 0x${r.ram.addr.toString(16)}`,
  );
  console.log(
    `  TEETH/unit: caught at 0x${r.ram.addr.toString(16)} (translated ${r.ram.a} vs broken ${r.ram.b})`,
  );
});

// -- FULL BRANCH COVERAGE (synthesised) + FLAG TEETH --------------------------

test("BRANCH COVERAGE: mask + add-carry set/clear each EQUAL in RAM, regs, pc and cycles", () => {
  const entry = captureEntry();

  // Cases spanning both data-dependent axes:
  //   carry-set   : IX 0x7641 + DE 0xFFE0 = 0x17621 -> carry SET  (the natural case)
  //   carry-clear : IX 0x6A00 + DE 0x0040 = 0x06A40 -> carry CLEAR (synthesised)
  // Each A has a non-zero HIGH nibble so the `and 0x0f` mask is exercised too.
  const cases = [
    { name: "carry-set/high-nibble",  a: 0xb7, ix: 0x7641, de: 0xffe0 },
    { name: "carry-clear/high-nibble", a: 0x3c, ix: 0x6a00, de: 0x0040 },
    { name: "zero-digit",              a: 0xf0, ix: 0x7600, de: 0xffe0 },
  ];

  for (const cs of cases) {
    const o = runOn(entry, translated_0593, cs);
    const p = runOn(entry, optimized_0593, cs);

    const ram = firstStateDiff(o.dump, p.dump, o.stateOffsetToAddr);
    assert.equal(ram, null, ram ? `[${cs.name}] RAM diff at 0x${(ram.addr ?? ram.offset).toString(16)}` : "");
    const rd = firstRegDiff(o.regs, p.regs);
    assert.equal(rd, null, rd ? `[${cs.name}] reg diff at ${rd.reg} (${rd.a} vs ${rd.b})` : "");
    assert.equal(o.pc, p.pc, `[${cs.name}] pc must match`);
    // Per-instruction was kept -> the branch's TOTAL cycle cost must match the oracle.
    assert.equal(p.cycles, o.cycles, `[${cs.name}] cycle total must match oracle (${o.cycles})`);
    assert.equal(o.cycles, 7 + 19 + 15 + 10, `[${cs.name}] oracle total should be 51 t (and+ld+add+ret)`);
  }
  console.log(`  BRANCH: ${cases.length} synthesised cases EQUAL (RAM+regs+pc), each 51 t`);
});

test("FLAG TEETH: pointer-add without `add ix,de` flags is CAUGHT on register F", () => {
  const entry = captureEntry();
  const cs = { name: "carry-set", a: 0xb7, ix: 0x7641, de: 0xffe0 };

  const o = runOn(entry, translated_0593, cs);
  const bad = runOn(entry, brokenFlags_0593, cs);

  // RAM is identical (same digit, same IX advance) -- the ONLY divergence is F.
  const ram = firstStateDiff(o.dump, bad.dump, o.stateOffsetToAddr);
  assert.equal(ram, null, ram ? `unexpected RAM diff at 0x${(ram.addr ?? ram.offset).toString(16)}` : "");
  const rd = firstRegDiff(o.regs, bad.regs);
  assert.ok(rd != null, "flag-wrong pointer add MUST be caught — the oracle says carry is live 3 returns up");
  assert.equal(rd.reg, "f", `expected the divergence on F, got ${rd.reg}`);
  console.log(`  FLAG TEETH: caught on F (oracle 0x${o.regs.f.toString(16)} vs flag-broken 0x${bad.regs.f.toString(16)})`);
});
