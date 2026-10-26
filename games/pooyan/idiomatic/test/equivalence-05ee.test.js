// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for drawCreditCountAndTamperCheck (ROM 0x05ee) — draw the credit count as two HUD digit
 * tiles, then a hidden ROM-checksum tripwire.
 *
 * The one crafted input is the credit count (0x8802): it is clamped to 99, converted to packed
 * BCD, the high nibble written as the tens tile (skipped when zero) and the low nibble as the
 * units tile. Only when the units digit is exactly 2 does a 31-byte ROM checksum run; against the
 * intact ROM it matches its sentinel and writes nothing.
 *
 * Contract compared: RAM (dumpState, minus stack scratch below the entry SP). pc/SP/cycles are NOT compared, and
 * there is NO register live-out — this is a dispatch target whose exit registers differ per path
 * and are not consumed.
 *
 * All cases are CRAFTED: the credit count is poked identically on both sides, sp seated inside
 * STACK_SCRATCH so the oracle's push/call/ret stay there. The field draw (drawStackedCharField) and checksum
 * read the intact ROM identically on both sides.
 *
 * Jobs:
 *   1. EQUAL — over several credit values (incl. the clamp, tens-present, and tripwire paths),
 *      oracle == drawCreditCountAndTamperCheck in RAM (−stack).
 *   2. WRITE-SET — the two HUD nibble cells hold the expected tens/units digit tiles.
 *   3. TEETH — a wrong units tile is caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-05ee.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_05ee as oracle } from "../../translated/loc_05ee.js";
import { drawCreditCountAndTamperCheck } from "../drawCreditCountAndTamperCheck.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, CREDIT_COUNT, CREDIT_HUD_TENS_VRAM, CREDIT_HUD_UNITS_VRAM } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone with the credit count seated. */
function craft(credit) {
  const m = BASE.clone();
  m.mem.write8(CREDIT_COUNT, credit & 0xff);
  m.regs.sp = 0x8fe0; // inside STACK_SCRATCH; the oracle's push/call/ret stay there
  return m;
}

// (label, credit) — BCD in comments
const CASES = [
  { label: "zero: no tens, units 0", credit: 0x00 },
  { label: "10: tens present, units 0", credit: 0x0a },
  { label: "2: no tens, units 2 -> checksum runs", credit: 0x02 },
  { label: "12: tens present, units 2 -> checksum runs", credit: 0x0c },
  { label: "99: max", credit: 0x63 },
  { label: "over cap -> clamps to 99", credit: 0x80 },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted credit values — drawCreditCountAndTamperCheck == oracle in RAM (−stack)", () => {
  for (const { label, credit } of CASES) {
    const o = craft(credit);
    const c = craft(credit);
    oracle(o);
    drawCreditCountAndTamperCheck(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b} ("${label}")`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted credit values identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: credit 12 (BCD 0x12) writes tens tile 1 and units tile 2", () => {
  const o = craft(0x0c); // decimal 12 -> BCD 0x12
  oracle(o);
  assert.equal(o.mem.read8(CREDIT_HUD_TENS_VRAM), 0x01, "tens HUD cell must hold digit tile 1");
  assert.equal(o.mem.read8(CREDIT_HUD_UNITS_VRAM), 0x02, "units HUD cell must hold digit tile 2");
  console.log(`  WRITE-SET: tens ${hx(CREDIT_HUD_TENS_VRAM)}=1, units ${hx(CREDIT_HUD_UNITS_VRAM)}=2`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong units tile is CAUGHT by the RAM diff", () => {
  const o = craft(0x0c);
  const c = craft(0x0c);
  oracle(o);
  drawCreditCountAndTamperCheck(c);
  c.mem.write8(CREDIT_HUD_UNITS_VRAM, 0x07); // BUG: units tile must be 2, not 7
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong units tile — it is worthless");
  assert.equal(d.addr, CREDIT_HUD_UNITS_VRAM, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong units tile caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
