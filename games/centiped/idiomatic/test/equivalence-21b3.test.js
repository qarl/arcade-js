// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for readFdBitsTableByte (ROM 0x21b3) -- take bits 5-4 of $fd as an even index {0,2,4,6}
// and return the 0x21bf ROM-table byte at it. No RAM write, so the RAM diff is vacuously null; the real
// contract is the TWO register live-outs A (the fetched byte) and Y (the index), both consumed by every
// caller (loc_2195/loc_2561 store A and re-index the parallel 0x21c0 table by Y). A leaf: it omits the ROM
// ret and the seam completes it, so the arms compare RAM (-stack) + A + Y, NOT pc/SP.
// Run: node --test games/centiped/idiomatic/test/equivalence-21b3.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_21b3 as oracleRom } from "../../translated/loc_21b3.js";
import { readFdBitsTableByte } from "../readFdBitsTableByte.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { CONFIG_DIP_BYTE } from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x21b3;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x21b3 dispatches -- readFdBitsTableByte == oracle in RAM (-stack), A and Y", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); readFdBitsTableByte(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.a, o.regs.a, "A live-out (0x21bf table byte) matches the oracle");
    assert.equal(c.regs.y, o.regs.y, "Y live-out (index) matches the oracle");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: each of the four $fd bit-5/4 selections -> index {0,2,4,6}, A = ROM[0x21bf+idx]", () => {
  const cases = [
    { fd: 0x00, idx: 0 },
    { fd: 0x10, idx: 2 },
    { fd: 0x20, idx: 4 },
    { fd: 0x30, idx: 6 },
    { fd: 0xcf, idx: 0 }, // bits 5-4 clear despite other bits set -> idx 0 (proves the 0x30 mask)
    { fd: 0xff, idx: 6 }, // bits 5-4 both set -> idx 6
  ];
  for (const { fd, idx } of cases) {
    const o = new Machine(ROM); o.mem.write8(CONFIG_DIP_BYTE, fd);
    const c = new Machine(ROM); c.mem.write8(CONFIG_DIP_BYTE, fd);
    const ret = readFdBitsTableByte(c); oracle(o);
    const tag = `fd=0x${fd.toString(16)}`;
    assert.equal(ramDiff(o, c), null, `no RAM write: ${tag}`);
    assert.equal(c.regs.y, idx, `Y = expected index: ${tag}`);
    assert.equal(c.regs.y, o.regs.y, `Y matches oracle: ${tag}`);
    assert.equal(c.regs.a, o.regs.a, `A (ROM[0x21bf+idx]) matches oracle: ${tag}`);
    assert.equal(ret, o.regs.a, `return value == A live-out: ${tag}`);
  }
});

test("TEETH: a twin that drops the Y live-out leaves the wrong index", () => {
  const o = new Machine(ROM); o.mem.write8(CONFIG_DIP_BYTE, 0x30); // idx 6
  oracle(o);
  const brokenY = 0x00; // BUG: never sets Y from the $fd bits
  assert.notEqual(brokenY, o.regs.y, "the Y live-out check FAILED to catch a dropped index");
});

test("TEETH: a twin that returns the raw index (not the table byte) diverges in A", () => {
  const o = new Machine(ROM); o.mem.write8(CONFIG_DIP_BYTE, 0x30); // idx 6
  oracle(o);
  const brokenA = 6; // BUG: returns the index instead of ROM[0x21bf+6]
  // Only meaningful if the real table byte differs from the index (it does for centiped's 0x21c5 byte).
  assert.notEqual(brokenA, o.regs.a, "the A live-out check FAILED to catch returning the index");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM);
  m.mem.write8(CONFIG_DIP_BYTE, 0x10);
  m.regs.s = 0xff;
  m.push16(0xabcd); // a real caller-return word on the 6502 page-1 stack
  const r = seamPlaceable(withOmittedRet, readFdBitsTableByte, TARGET, m);
  assert.equal(r.placeable, true, `readFdBitsTableByte must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
