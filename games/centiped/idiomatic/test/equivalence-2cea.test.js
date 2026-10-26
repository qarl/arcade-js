// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for enterArmBlockUnlessValueHigh (ROM 0x2cea) vs the frozen translated oracle. This is
// the compare-first entry into the loc_2cc2 arm/clear block: CMP #$0E sets carry = (A >= 0x0E), then JMP
// $2cc2, whose opening BCS consumes that carry (set -> bail without arming, clear -> arm). It is a pure tail
// delegate: loc_2cc2 is still frozen, reads the carry AND X through the register bridge, and its RTS returns
// to this routine's caller. Fidelity = RAM minus stack scratch below the entry SP; the routine has no register live-out of its
// own beyond what loc_2cc2 leaves. Real dispatches are captured and replayed, both carry branches are
// crafted, and an SP-seam tooth confirms the tail-transfer places (both branches). Teeth include a
// wrong-threshold twin (flips the branch) and an X-clobber twin (proves X must flow through unchanged).
// Run: node --test games/centiped/idiomatic/test/equivalence-2cea.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2cea as oracleRom } from "../../translated/loc_2cea.js";
import { enterArmBlockUnlessValueHigh } from "../enterArmBlockUnlessValueHigh.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { loc_34, loc_42, loc_87 } from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x2cea;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(8, 380) : [];

// A crafted entry: A is the compared value, X the index loc_2cc2 stamps ($34,X), plus a caller-return word
// at the entry SP (compared) for the tail transfer.
function seed(a, x) {
  const m = new Machine(ROM);
  m.regs.s = 0xfd;
  m.mem.write8(0x0100 | ((0xfd + 1) & 0xff), 0x34); // caller-return (ret-1) lo
  m.mem.write8(0x0100 | ((0xfd + 2) & 0xff), 0x12); // caller-return (ret-1) hi
  m.regs.a = a & 0xff;
  m.regs.x = x & 0xff;
  return m;
}

test("CAPTURE: real 0x2cea dispatches -- enterArmBlockUnlessValueHigh == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    enterArmBlockUnlessValueHigh(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: both carry branches -- A<0x0E arms the block, A>=0x0E bails, equal to oracle", () => {
  // A < 0x0E -> carry clear -> loc_2cc2 arms the cells.
  for (const a of [0x00, 0x07, 0x0d]) {
    const base = seed(a, 0x05);
    const o = base.clone();
    const c = base.clone();
    oracle(o);
    enterArmBlockUnlessValueHigh(c);
    assert.equal(ramDiff(o, c), null, `arm branch A=0x${a.toString(16)}`);
    // Positive control: loc_2cc2 armed the block ($87=0x30, $42=0x28, $34+X=0xff; the #$20 store
    // lands in $43, not $42 -- see loc_2cc2's `lda #$20 / sta $43` then `lda #$28 / sta $42`).
    assert.equal(o.mem.read8(loc_87), 0x30, `armed $87 (A=0x${a.toString(16)})`);
    assert.equal(o.mem.read8(loc_42), 0x28, `armed $42 (A=0x${a.toString(16)})`);
    assert.equal(o.mem.read8((loc_34 + 0x05) & 0xff), 0xff, `stamped $34+X (A=0x${a.toString(16)})`);
  }
  // A >= 0x0E -> carry set -> loc_2cc2 bails, nothing armed.
  for (const a of [0x0e, 0x40, 0xff]) {
    const base = seed(a, 0x05);
    const o = base.clone();
    const c = base.clone();
    oracle(o);
    enterArmBlockUnlessValueHigh(c);
    assert.equal(ramDiff(o, c), null, `bail branch A=0x${a.toString(16)}`);
    assert.equal(o.mem.read8(loc_87), 0x00, `bail left $87 untouched (A=0x${a.toString(16)})`);
  }
  console.log("  CRAFTED: enterArmBlockUnlessValueHigh == oracle on both carry branches");
});

test("TEETH: wrong-threshold and X-clobber twins are caught", () => {
  // Wrong-threshold twin: compares against 0x00, so carry is always set -> always bails. On the arm branch
  // (A < 0x0E) it fails to arm -> diverges.
  const wrongThreshold = (m) => { m.regs.cmp(0x00); return m.call(0x2cc2); };
  {
    const base = seed(0x05, 0x05); // arm branch
    const o = base.clone();
    const c = base.clone();
    oracle(o);
    wrongThreshold(c);
    assert.notEqual(ramDiff(o, c), null, "wrong-threshold twin escaped (arm branch)");
  }
  // X-clobber twin: zeroes X before delegating, so loc_2cc2 stamps $34 instead of $34+X -> diverges when
  // X != 0 (the R37 register-bridge tooth: X must flow through unchanged).
  const clobberX = (m) => { m.regs.cmp(0x0e); m.regs.x = 0x00; return m.call(0x2cc2); };
  {
    const base = seed(0x05, 0x05); // arm branch, X=5
    const o = base.clone();
    const c = base.clone();
    oracle(o);
    clobberX(c);
    assert.notEqual(ramDiff(o, c), null, "X-clobber twin escaped (X must pass through)");
  }
  console.log("  TEETH: wrong-threshold and X-clobber twins caught");
});

test("SP-SEAM TOOTH: the tail transfer places at the seam (both branches); a stray push is refused", () => {
  for (const a of [0x05 /* arm */, 0x40 /* bail */]) {
    const r = seamPlaceable(withOmittedRet, enterArmBlockUnlessValueHigh, TARGET, seed(a, 0x05));
    assert.equal(r.placeable, true, `seam refused the tail transfer (A=0x${a.toString(16)}): ${r.error}`);
  }
  // The base is a +2 tail transfer (loc_2cc2's RTS lands pc on the caller slot), so a SINGLE stray
  // push16 would net SP back to 0 -- the seam's legit omitted-ret leaf case -- and slip through. Two
  // extra pushes with no matching pop move SP net-nonzero (moved 254), which the seam MUST refuse.
  const strayPush = (m) => { enterArmBlockUnlessValueHigh(m); m.push16(0x9999); m.push16(0x8888); };
  const rm = seamPlaceable(withOmittedRet, strayPush, TARGET, seed(0x05, 0x05));
  assert.equal(rm.placeable, false, "the stray-push mutant placed at the seam (tooth has no teeth)");
  console.log("  SP-SEAM: tail transfer placeable on both branches; stray-push mutant refused");
});
