// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for writeMaskedByteAndAdvancePointer (ROM 0x3836) -- store A (XOR'd with loc_ef
// unless A==0) through the (loc_91/loc_92) cursor, then advance the cursor by (0x20 ^ loc_ef) low and
// loc_f3 + carry high. The CAPTURE arm checks real dispatches; the CRAFTED arm drives the mask, the
// stride, a low->high page-cross carry, and the A==0 unmasked case; TEETH proves the RAM diff catches a
// twin that skips the XOR mask; the SP-tooth proves the rewrite is seam-placeable.
// Run: node --test games/centiped/idiomatic/test/equivalence-3836.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3836 as oracleRom } from "../../translated/loc_3836.js";
import { writeMaskedByteAndAdvancePointer } from "../writeMaskedByteAndAdvancePointer.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { loc_91, loc_92, loc_ef, loc_f3 } from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x3836;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

// Seat the cursor (loc_91/loc_92) at `ptr`, the mask/high-adjust cells, and A.
function seed(ptr, mask, f3, a) {
  const m = new Machine(ROM);
  m.mem.write16(loc_91, ptr & 0xffff); // loc_91 low, loc_92 high
  m.mem.write8(loc_ef, mask & 0xff);
  m.mem.write8(loc_f3, f3 & 0xff);
  m.regs.a = a & 0xff;
  return m;
}

test("CAPTURE: real 0x3836 dispatches -- writeMaskedByteAndAdvancePointer == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); writeMaskedByteAndAdvancePointer(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: masked store + cursor advance match the oracle across mask/stride/carry/zero", () => {
  const cases = [
    { ptr: 0x0300, mask: 0x00, f3: 0x00, a: 0x55 }, // unflipped: stride 0x20, no high carry
    { ptr: 0x0300, mask: 0x0f, f3: 0x00, a: 0x55 }, // masked byte (0x55 ^ 0x0f), stride 0x2f
    { ptr: 0x0450, mask: 0xff, f3: 0xff, a: 0x3c }, // flipped screen: mask 0xff, high-adjust 0xff
    { ptr: 0x02f0, mask: 0x00, f3: 0x00, a: 0x7e }, // low 0xf0 + 0x20 -> carries into the high byte
    { ptr: 0x0300, mask: 0x0f, f3: 0x00, a: 0x00 }, // A==0: stored UNMASKED (the BEQ guard), byte stays 0
    { ptr: 0x07b0, mask: 0x00, f3: 0x00, a: 0xa1 }, // write near the top of video RAM
  ];
  for (const { ptr, mask, f3, a } of cases) {
    const o = seed(ptr, mask, f3, a);
    const c = seed(ptr, mask, f3, a);
    oracle(o); writeMaskedByteAndAdvancePointer(c);
    const label = `ptr=0x${ptr.toString(16)} mask=0x${mask.toString(16)} a=0x${a.toString(16)}`;
    assert.equal(ramDiff(o, c), null, label);
    // The byte landed at the pre-advance target, masked unless A was 0.
    assert.equal(c.mem.read8(ptr), a === 0 ? 0 : (a ^ mask) & 0xff, `stored byte ${label}`);
    // The cursor advanced: low += (0x20 ^ mask), high += f3 + carry.
    const lowSum = (ptr & 0xff) + ((0x20 ^ mask) & 0xff);
    assert.equal(c.mem.read8(loc_91), lowSum & 0xff, `loc_91 ${label}`);
    const carry = lowSum > 0xff ? 1 : 0;
    assert.equal(c.mem.read8(loc_92), (((ptr >> 8) & 0xff) + f3 + carry) & 0xff, `loc_92 ${label}`);
  }
});

test("TEETH: a twin that skips the XOR mask is caught by the RAM diff", () => {
  const brokenWrite = (m, a = m.regs.a) => {
    const { mem } = m;
    const av = a & 0xff;
    const target = mem.read16(loc_91) & 0xffff;
    mem.write8(target, av); // BUG: writes the raw byte, never XORs loc_ef
    const lowSum = mem.read8(loc_91) + ((0x20 ^ mem.read8(loc_ef)) & 0xff);
    mem.write8(loc_91, lowSum & 0xff);
    const carry = lowSum > 0xff ? 1 : 0;
    mem.write8(loc_92, (mem.read8(loc_f3) + mem.read8(loc_92) + carry) & 0xff);
  };
  const o = seed(0x0300, 0x0f, 0x00, 0x55);
  const c = seed(0x0300, 0x0f, 0x00, 0x55);
  oracle(o); brokenWrite(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch the skipped XOR mask");
  assert.equal(d.addr, 0x0300);
});

test("TEETH(SP): the rewrite is seam-placeable; a twin that pushes is not", () => {
  const entry = CAPS.length ? CAPS[0].clone() : seed(0x0300, 0x00, 0x00, 0x40);
  assert.equal(
    seamPlaceable(withOmittedRet, writeMaskedByteAndAdvancePointer, TARGET, entry.clone()).placeable,
    true,
  );
  const spLeak = (m) => { m.push8(0x00); };
  assert.equal(seamPlaceable(withOmittedRet, spLeak, TARGET, entry.clone()).placeable, false);
});
