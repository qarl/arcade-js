// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for clearAndReseedObjectSlot (ROM 0x77c8, Pooyan) — clear + re-seed an actor slot behind a
 * colour-RAM integrity check.
 *
 * An actor-slot (re)initialiser read from IX; it writes only record RAM, so the contract is memory
 * (dumpState minus stack scratch below the entry SP) with NO register live-out. The only non-dissolved call is the
 * sum-mismatch tail to the tamper handler 0x2334 (unlifted), a dead arm on an intact colour map.
 *
 * The integrity walk sums ten cells from HUD_INTEGRITY_STRIP_A (0x82bc) up the 0x20 row stride and
 * compares (sum + 0x83) against the sentinel byte at 0x780e (= 0xc9 on the real ROM). Eleven cells set
 * to 7 make every neighbour match and the sum 70 = 0x46, so 0x46 + 0x83 = 0xc9 passes; a mismatched
 * neighbour jumps into a data table (a tamper trap modelled as a throw).
 *
 * SP-TOOTH (R36): the module keeps a `return m.call(0x2334)` tail, so a memory-eq gate is blind to a
 * stack-adrift rewrite; the reachable (intact-ROM) path omits its own ret (SP moved 0) and must be
 * seam-placeable. Null-mutant proof lives once-per-game in sp-seam-tooth.test.js.
 *
 * Jobs:
 *   1. EQUAL — early path ((REC+0x13) < 5 -> clear + return) and normal path (>= 5 -> seed + integrity
 *      pass + return): oracle == clearAndReseedObjectSlot in RAM (−stack).
 *   2. WRITE-SET — the normal path seeds (REC+1)=1, (REC+2)=3, (REC+0x11)=0x80; the early path clears
 *      the slot and leaves them 0.
 *   3. TEETH — a wrong seeded byte is CAUGHT by the RAM diff; a neighbour mismatch THROWS the trap.
 *   4. SP-TOOTH — the reachable normal path (omitted ret, moved 0) is seam-placeable.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-77c8.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_77c8 as oracle } from "../../translated/loc_77c8.js";
import { clearAndReseedObjectSlot } from "../clearAndReseedObjectSlot.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { deadStackBelow, firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8ba0; //     an object-arena record base (work RAM)
const STRIP = 0x82bc; //   HUD_INTEGRITY_STRIP_A: base of the colour-RAM integrity walk
const ROW = 0x20; //       row stride the walk steps up by
const CELLS = 11; //       cells the walk compares (10 summed + one top neighbour)
const PASS_VAL = 0x07; //  cell value that passes: 10*7 = 0x46, +0x83 = 0xc9 = (0x780e)
const SP0 = 0x8ff0; //     inside STACK_SCRATCH
const CALLER_RET = 0xfffc; // sentinel caller-return word the seam consumes

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** spawnIdx: (REC+0x13). >=5 -> normal path; <5 -> early. cellVal floods the integrity strip. */
function craft(spawnIdx, cellVal) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem.write16(SP0, CALLER_RET);
  m.regs.ix = REC;
  m.mem8[REC + 0x13] = spawnIdx & 0xff;
  m.mem8[REC + 0x11] = 0x00; // early path never touches +0x11, so it stays 0
  for (let i = 0; i < CELLS; i++) m.mem8[STRIP - i * ROW] = cellVal & 0xff;
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: early + normal path — clearAndReseedObjectSlot == oracle in RAM (−stack)", () => {
  for (const [label, idx] of [["normal (idx>=5)", 0x05], ["early (idx<5)", 0x03]]) {
    const o = craft(idx, PASS_VAL);
    oracle(o);
    const c = craft(idx, PASS_VAL);
    clearAndReseedObjectSlot(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${label}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: early + normal path identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the normal path seeds the slot; the early path clears it", () => {
  const normal = craft(0x05, PASS_VAL);
  oracle(normal);
  assert.equal(normal.mem8[REC + 0x01], 0x01, "(REC+1) seeded");
  assert.equal(normal.mem8[REC + 0x02], 0x03, "(REC+2) seeded");
  assert.equal(normal.mem8[REC + 0x11], 0x80, "(REC+0x11) seeded");

  const early = craft(0x03, PASS_VAL);
  oracle(early);
  assert.equal(early.mem8[REC + 0x01], 0x00, "early path clears (REC+1)");
  assert.equal(early.mem8[REC + 0x02], 0x00, "early path clears (REC+2)");
  assert.notEqual(normal.mem8[REC + 0x11], early.mem8[REC + 0x11], "normal path must seed (REC+0x11)");
  console.log("  WRITE-SET: normal path seeds (1,2,0x11); early path clears the slot");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong seeded byte is CAUGHT by the RAM diff", () => {
  const o = craft(0x05, PASS_VAL);
  const c = craft(0x05, PASS_VAL);
  oracle(o);
  clearAndReseedObjectSlot(c);
  c.mem8[REC + 0x11] = 0x00; // BUG: the normal path must have seeded (REC+0x11) to 0x80
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong seeded byte — it is worthless");
  assert.equal(d.addr, (REC + 0x11) & 0xffff, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong seeded byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a colour-RAM neighbour mismatch THROWS the tamper trap", () => {
  const c = craft(0x05, PASS_VAL);
  c.mem8[STRIP] = (PASS_VAL + 1) & 0xff; // break the first neighbour comparison
  assert.throws(() => clearAndReseedObjectSlot(c), /tamper trap/, "neighbour mismatch must throw the data-table trap");
  console.log("  TEETH/throw: neighbour mismatch trapped");
});

// -- 4. SP-TOOTH --------------------------------------------------------------

test("SP-TOOTH: the reachable normal path (omitted ret, moved 0) is seam-placeable", () => {
  const r = seamPlaceable(withOmittedRet, clearAndReseedObjectSlot, 0x77c8, craft(0x05, PASS_VAL));
  assert.equal(r.placeable, true, `normal path must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: normal path (moved 0) placeable");
});
