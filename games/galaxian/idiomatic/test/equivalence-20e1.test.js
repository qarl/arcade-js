// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_20e1 — equivalent to the frozen oracle at ROM 0x20e1.
 * Pure address computation: writes NO RAM, so ramDiff is vacuous here. The live-outs are all REGISTERS:
 * HL = the tilemap-VRAM cell address, A = the coordinate's post-rotate byte, and the CARRY flag (callers
 * at 0x205e branch on it). ramDiff is blind to registers/flags, so EQUAL asserts a regDiff over HL, A and
 * carry across several coordinates. Teeth: wrong-HL, wrong-A, wrong-carry twins (registers) plus a RAM
 * scribble twin proving ramDiff still bites. Positive control: the oracle really sets HL/A/carry.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent, STUBS } from "./_bootSetup.js";
import { loc_20e1 as cand } from "../loc_20e1.js";
import { loc_20e1 as oracle } from "../../translated/loc_20e1.js";

const SCRATCH_RAM = 0x4100;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

// A crafted entry with A = the coordinate byte and a ret target the oracle's push/pop rides over.
const entry = (coord) => craft((mem8, m) => { m.push16(0x9999); m.regs.a = coord; m.regs.f = 0x00; });

// HL, A and the carry flag are register live-outs; observe them directly (ramDiff is blind).
function regDiff(twin, e) {
  const a = e.clone(); a.routines = STUBS; oracle(a);
  const b = e.clone(); b.routines = STUBS; twin(b);
  if (a.regs.hl !== b.regs.hl) return `HL: 0x${a.regs.hl.toString(16)} vs 0x${b.regs.hl.toString(16)}`;
  if (a.regs.a !== b.regs.a) return `A: 0x${a.regs.a.toString(16)} vs 0x${b.regs.a.toString(16)}`;
  if (a.regs.fC !== b.regs.fC) return `carry: ${a.regs.fC} vs ${b.regs.fC}`;
  return null;
}

const wrongHL = (m) => { cand(m); m.regs.hl = (m.regs.hl + 1) & 0xffff; };
const wrongA = (m) => { cand(m); m.regs.a = (m.regs.a + 1) & 0xff; };
const wrongCarry = (m) => { cand(m); m.regs.fC = !m.regs.fC; };
const scribble = (m) => { cand(m); m.mem8[SCRATCH_RAM] = m.mem8[SCRATCH_RAM] ^ 0xff; };

test("EQUAL (crafted): loc_20e1 == oracle maps coords to HL/A/carry", { skip }, () => {
  for (const coord of [0x00, 0x35, 0x7f, 0x88, 0xff]) {
    assert.equal(regDiff(cand, entry(coord)), null, `loc_20e1 registers diverged (coord=0x${coord.toString(16)})`);
    assert.equal(ramDiff(oracle, cand, entry(coord)), null, `loc_20e1 wrote RAM (coord=0x${coord.toString(16)})`);
  }
  // Positive control: the oracle really sets HL/A/carry to the known 0x35 mapping (and 0x00 gives carry 0).
  const a = entry(0x35); a.routines = STUBS; oracle(a);
  assert.equal(a.regs.hl, 0x514a, "positive control: HL");
  assert.equal(a.regs.a, 0x01, "positive control: A");
  assert.equal(a.regs.fC, true, "positive control: carry set (coord bit 4)");
  const z = entry(0x00); z.routines = STUBS; oracle(z);
  assert.equal(z.regs.hl, 0x500f, "positive control: HL for coord 0");
  assert.equal(z.regs.fC, false, "positive control: carry clear for coord 0");
  console.log("  EQUAL: loc_20e1 == oracle (HL + A + carry), no RAM touched");
});

test("TEETH: broken twins are caught", { skip }, () => {
  assert.ok(regDiff(wrongHL, entry(0x35)), "the wrong-HL twin escaped (register)");
  assert.ok(regDiff(wrongA, entry(0x35)), "the wrong-A twin escaped (register)");
  assert.ok(regDiff(wrongCarry, entry(0x35)), "the wrong-carry twin escaped (flag)");
  assert.ok(ramDiff(oracle, scribble, entry(0x35)), "the scribble twin escaped (ramDiff teeth)");
  console.log("  TEETH: wrong-HL, wrong-A, wrong-carry (registers) + RAM scribble all caught");
});
