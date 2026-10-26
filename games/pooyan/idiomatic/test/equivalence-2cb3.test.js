// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for runHunterMoveScriptStep (ROM 0x2cb3, Pooyan) — hunter dispatch state 1.
 *
 * The routine first steps the record's animation (advanceObjectAnimationFrame), then walks its script cursor
 * (rec+0x16:0x17): leading 0xff bytes latch the sign flag (rec+0x15); a 0x88 byte bumps the
 * state (rec+0x02), arms an animation (rec+0x0c..0x0e) and reseeds the hold (rec+0x11); any
 * other byte is a magnitude added to (rec+0x03:0x04) when the sign flag's bit0 is set, else
 * subtracted. Every ret returns the boolean true (the dispatch "normal" protocol).
 *
 * This is the cycle-free / memory-equivalence gate. The oracle reaches advanceObjectAnimationFrame / 0x381e
 * through m.call trampolines whose transient return-address pushes land in STACK_SCRATCH
 * (sp seated there) and are excluded; the module calls the idiomatic siblings directly. So
 * the contract compared is RAM (dumpState, minus stack scratch below the entry SP) PLUS the boolean live-out.
 * pc/sp/cycles are NOT compared. No register is a live-out here (all scratch is clobbered and
 * the caller reads only the boolean), so the boolean return is the sole non-RAM arm.
 *
 * advanceObjectAnimationFrame is kept on its frame-hold path (rec+0x0e != 0 -> it only decrements) so the
 * animation step is a single deterministic byte write on both sides. Every case is CRAFTED:
 * the leaf is not reached in a plain boot.
 *
 * Jobs:
 *   1. EQUAL — over crafted script cases (0x88 opcode, add-delta, sub-delta, leading-0xff)
 *      oracle == runHunterMoveScriptStep in RAM (−stack) AND both return true.
 *   2. WRITE-SET — the add case's writes all fall inside the 0x18-byte record (bounded
 *      footprint); documents the contract without over-specifying.
 *   3. TEETH — a twin with a wrong (rec+0x03) byte is caught by the RAM diff, and a twin
 *      returning false instead of true is rejected by the boolean live-out check.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-2cb3.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2cb3 as oracle } from "../../translated/loc_2cb3.js";
import { runHunterMoveScriptStep } from "../runHunterMoveScriptStep.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8a80; //   record base (work RAM, clear of STACK_SCRATCH)
const SCRIPT = 0x8b00; // script bytes live here
const REC_LEN = 0x18;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat the record + its script identically on a fresh clone. */
function craft({ script, sign, pos3, pos4, holdE = 0x05, state = 0x40 }) {
  const m = BASE.clone();
  m.regs.ix = REC;
  m.regs.sp = 0x8fe0; // in STACK_SCRATCH: the m.call return-address pushes hit dead RAM
  m.mem.write8(REC + 0x0e, holdE); // advanceObjectAnimationFrame frame-hold path (nonzero -> just decrement)
  m.mem.write8(REC + 0x02, state);
  m.mem.write8(REC + 0x03, pos3 & 0xff);
  m.mem.write8(REC + 0x04, pos4 & 0xff);
  m.mem.write8(REC + 0x15, sign & 0xff);
  m.mem.write8(REC + 0x16, SCRIPT & 0xff);
  m.mem.write8(REC + 0x17, (SCRIPT >> 8) & 0xff);
  for (let i = 0; i < script.length; i++) m.mem.write8(SCRIPT + i, script[i]);
  return m;
}

const CASES = [
  { name: "0x88 opcode", script: [0x88], sign: 0x00, pos3: 0x10, pos4: 0x20 },
  { name: "add delta (carry)", script: [0x10], sign: 0x01, pos3: 0xf8, pos4: 0x20 },
  { name: "sub delta (borrow)", script: [0x10], sign: 0x00, pos3: 0x05, pos4: 0x20 },
  { name: "leading 0xff then add", script: [0xff, 0xff, 0x10], sign: 0x00, pos3: 0xf8, pos4: 0x20 },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted script cases — runHunterMoveScriptStep == oracle in RAM (−stack) + boolean true", () => {
  for (const cs of CASES) {
    const o = craft(cs);
    const c = craft(cs);
    const oRet = oracle(o);
    const cRet = runHunterMoveScriptStep(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${cs.name}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(oRet, true, `[${cs.name}] oracle should return true (dispatch protocol)`);
    assert.equal(cRet, oRet, `[${cs.name}] module boolean live-out must match the oracle`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack + boolean)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the add case's writes all fall inside the 0x18-byte record", () => {
  const o = craft(CASES[1]);
  const before = o.dumpState();
  oracle(o);
  const after = o.dumpState();

  const changed = [];
  for (let off = 0; off < before.length; off++) {
    if (before[off] !== after[off]) {
      const addr = o.stateOffsetToAddr(off);
      if (inDeadStack(addr)) continue; // ignore the transient return-address push
      changed.push(addr);
    }
  }
  assert.ok(changed.length > 0, "expected at least one write");
  for (const addr of changed) {
    assert.ok(addr >= REC && addr < REC + REC_LEN, `write at ${hx(addr)} is outside the record`);
  }
  console.log(`  WRITE-SET: ${changed.length} cell(s), all within ${hx(REC)}..${hx(REC + REC_LEN - 1)}`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong (rec+0x03) byte is CAUGHT by the RAM diff", () => {
  const o = craft(CASES[1]);
  const c = craft(CASES[1]);
  oracle(o);
  runHunterMoveScriptStep(c);
  c.mem.write8(REC + 0x03, (c.mem.read8(REC + 0x03) ^ 0xff) & 0xff); // BUG: corrupt the position low byte

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong position byte — it is worthless");
  assert.equal(d.addr, REC + 0x03, `teeth caught wrong address ${hx(d.addr ?? 0)} (expected ${hx(REC + 0x03)})`);
  console.log(`  TEETH/RAM: wrong (rec+3) caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a false return is REJECTED by the boolean live-out check", () => {
  const o = craft(CASES[0]);
  const oRet = oracle(o);
  assert.equal(oRet, true, "sanity: the oracle returns true");
  const brokenRet = false; // a twin that returns the wrong dispatch verdict
  assert.notEqual(brokenRet, oRet, "the boolean live-out check must reject a false return");
  console.log("  TEETH/return: a false return is rejected against the oracle's true");
});
