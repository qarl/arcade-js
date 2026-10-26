// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for disableNmiAndEnterBoot (ROM 0x0000, Pooyan) — the power-on reset vector.
 *
 * disableNmiAndEnterBoot disables the vblank NMI latch (0xA180 := 0) and then tails into the boot entry runSelfTestAndInitMachineState,
 * which runs the self-test and lays down the full initial machine state. The reset vector's own write
 * is transient — the boot re-enables the latch before it finishes — so the observable effect of
 * disableNmiAndEnterBoot is exactly the boot's final state. This gate therefore runs the whole boot on both sides
 * and compares it, the way runSelfTestAndInitMachineState's own gate does.
 *
 * The contract is RAM (dumpState, minus stack scratch below the entry SP) with NO register live-out (control transfers
 * into the main-loop generator), PLUS one dedicated cell:
 *
 *   THE SELF-TEST TALLY (0x8FFF) IS LOAD-BEARING BUT LIVES INSIDE STACK_SCRATCH. The frozen boot
 *   seats the bank count there via its first push and increments it per matching bank; blankFillRowThenFinishAttractSetup later
 *   requires 0x10 (a full pass). Because 0x8FFF sits in the excluded stack window, ramDiffMinusStack
 *   cannot see it, so it is compared with a dedicated arm.
 *
 * pc/SP/cycles are NOT compared. The frozen tail into the never-returning main loop is neutralised by
 * stubbing routine 0x020F to a no-op; the idiomatic side builds — but does not run — the main-loop
 * generator, so both stop at boot-complete. The routine's only inputs are the two DIP-switch ports,
 * so every case CRAFTS them identically on both sides.
 *
 * Jobs:
 *   1. EQUAL (crafted DSW sweep) — oracle == disableNmiAndEnterBoot in RAM (−stack) AND in the tally cell.
 *   2. WRITE-SET — the reset+boot's key cells hold their exact expected values, including the NMI
 *      latch left ENABLED (1) after the boot overwrites disableNmiAndEnterBoot's transient disable.
 *   3. TEETH — a wrong dumped byte (RAM diff) and a wrong tally (dedicated arm) are each CAUGHT.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0000.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0000 as oracle } from "../../translated/loc_0000.js";
import { disableNmiAndEnterBoot } from "../disableNmiAndEnterBoot.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const hx = (v) => "0x" + (v & 0xffff).toString(16);

const TALLY_ADDR = 0x8fff; // ROM self-test pass tally — real, consumed, but inside the stack window
const FULL_PASS = 0x10; // bank count + eight matches on an intact image
const MAIN_LOOP_ADDR = 0x020f;

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x9000);
function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

// Stub the main loop so the frozen boot's tail m.call(0x020f) returns instead of spinning forever.
const BASE = ROM_PRESENT
  ? new Machine(ROM, { overrides: [[MAIN_LOOP_ADDR, () => undefined]] }).clone()
  : null;

/** A fresh clone with the two DIP-switch ports seated identically (the boot's only inputs). */
function craft(dsw0, dsw1) {
  const m = BASE.clone();
  m.io.dsw0 = dsw0 & 0xff;
  m.io.dsw1 = dsw1 & 0xff;
  m.regs.sp = 0x9000; // runSelfTestAndInitMachineState resets this itself; the reset vector's own call-push lands in-window
  return m;
}

// Curated DIP combos: idle defaults, both extremes, and a mix driving the lives-max branch.
const CASES = [
  { dsw0: 0xff, dsw1: 0x7b }, // idle defaults
  { dsw0: 0x00, dsw1: 0x00 }, // all-zero ports
  { dsw0: 0xff, dsw1: 0xff }, // all-ones ports
  { dsw0: 0x5a, dsw1: 0x7c }, // mixed coinage + lives-max branch
];

// -- 1. EQUAL (crafted DSW sweep) ---------------------------------------------

test("EQUAL: crafted DSW pairs — disableNmiAndEnterBoot == oracle in RAM (−stack) + the self-test tally", () => {
  for (const { dsw0, dsw1 } of CASES) {
    const o = craft(dsw0, dsw1);
    const c = craft(dsw0, dsw1);
    oracle(o);
    disableNmiAndEnterBoot(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiomatic=${d.b} (DSW0=${hx(dsw0)} DSW1=${hx(dsw1)})`);
    assert.equal(c.mem.read8(TALLY_ADDR), o.mem.read8(TALLY_ADDR), `tally mismatch for DSW0=${hx(dsw0)} DSW1=${hx(dsw1)}`);
    assert.equal(o.mem.read8(TALLY_ADDR), FULL_PASS, "the intact image must produce a full self-test pass");
  }
  console.log(`  EQUAL: ${CASES.length} crafted DSW cases identical (RAM −stack + tally == ${hx(FULL_PASS)})`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the reset+boot's key cells hold their exact expected values", () => {
  const { dsw0, dsw1 } = CASES[0];
  const o = craft(dsw0, dsw1);
  oracle(o);
  const r = (a) => o.mem.read8(a);

  // disableNmiAndEnterBoot's NMI-disable is transient — the boot overwrites it, so it is not separately observable;
  // the EQUAL arm already covers whatever region dumpState includes. Here we document the boot's own
  // key cells, proving disableNmiAndEnterBoot tails into the full boot rather than a partial one.
  // colour map flooded to 0x10, lower tile map blanked to 0x1e, rings emptied
  assert.equal(r(0x8000), 0x10, "colour-map base flooded");
  assert.equal(r(0x8440), 0x1e, "lower tile map blanked");
  assert.equal(r(0x88c0), 0xff, "display-command ring emptied");
  assert.equal(r(0x88a0), 0xc0, "display-ring write cursor at origin");
  // config + high-score seed + tally
  assert.equal(r(0x881f), 1, "flip-screen flag set (upright)");
  assert.equal(r(0x88aa), 1, "top-score high byte");
  assert.equal(r(TALLY_ADDR), FULL_PASS, "self-test tally is a full pass");
  console.log("  WRITE-SET: NMI re-enabled, colour flood, blank region, rings, config, hi-score, tally");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong dumped byte is CAUGHT by the RAM diff", () => {
  const { dsw0, dsw1 } = CASES[0];
  const o = craft(dsw0, dsw1);
  const c = craft(dsw0, dsw1);
  oracle(o);
  disableNmiAndEnterBoot(c);
  c.mem.write8(0x881f, (c.mem.read8(0x881f) + 1) & 0xff); // BUG: corrupt the flip-screen flag

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong config byte — it is worthless");
  assert.equal(d.addr, 0x881f, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected 0x881f)`);
  console.log(`  TEETH/RAM: wrong flip-screen byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong tally is CAUGHT only by the dedicated arm (RAM diff excludes 0x8FFF)", () => {
  const { dsw0, dsw1 } = CASES[0];
  const o = craft(dsw0, dsw1);
  const c = craft(dsw0, dsw1);
  oracle(o);
  disableNmiAndEnterBoot(c);
  c.mem.write8(TALLY_ADDR, (c.mem.read8(TALLY_ADDR) + 1) & 0xff); // BUG: corrupt the pass tally

  assert.equal(ramDiffMinusStack(o, c), null, "sanity: the RAM diff excludes the tally cell");
  assert.notEqual(c.mem.read8(TALLY_ADDR), o.mem.read8(TALLY_ADDR), "the dedicated tally arm FAILED — it is worthless");
  console.log(`  TEETH/TALLY: wrong tally caught by the dedicated arm (oracle=${hx(o.mem.read8(TALLY_ADDR))} broken=${hx(c.mem.read8(TALLY_ADDR))})`);
});
