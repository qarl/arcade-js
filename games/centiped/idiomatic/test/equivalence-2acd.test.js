// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for returnImmediately (ROM 0x2acd) -- the shared bare-RTS landing pad (loc_2ac7's
// tail; loc_2a92 tail-jumps here). The ROM body is a lone RTS, so the idiomatic module does nothing and
// the withOmittedRet seam supplies the return. A leaf: each side runs on a clone and the contract is RAM
// (dumpState, minus stack scratch below the entry SP -- the oracle's balanced push/pop scratch is excluded). No register is
// threaded (there is nothing to thread), so the arms compare RAM only, NOT pc/SP.
// Run: node --test games/centiped/idiomatic/test/equivalence-2acd.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2acd as oracleRom } from "../../translated/loc_2acd.js";
import { returnImmediately } from "../returnImmediately.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x2acd;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x2acd dispatches -- returnImmediately == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); returnImmediately(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: the no-op leaves RAM byte-for-byte unchanged (and matches the oracle)", () => {
  // Seat a spread of RAM cells; the bare-RTS body must not disturb any of them.
  const seed = (m) => {
    m.regs.s = 0x30;
    for (let a = 0x00; a <= 0xff; a++) m.mem.write8(a, (a * 7 + 3) & 0xff);
    m.mem.write8(0x0400, 0x5a);
    m.mem.write8(0x0700, 0xa5);
  };
  const pristine = new Machine(ROM); seed(pristine);
  const before = pristine.dumpState().slice();

  const o = new Machine(ROM); seed(o);
  const c = new Machine(ROM); seed(c);
  oracle(o); returnImmediately(c);

  // idiomatic changed nothing vs its own pre-image, and matches the oracle in RAM (-stack).
  assert.deepEqual(c.dumpState(), before, "returnImmediately must not touch RAM");
  assert.equal(ramDiff(o, c), null, "returnImmediately == oracle in RAM (-stack)");
});

test("TEETH: a twin that writes a byte is caught by the RAM diff (positive control)", () => {
  const seed = (m) => { m.regs.s = 0x30; m.mem.write8(0x0050, 0x11); };
  const o = new Machine(ROM); seed(o);
  const c = new Machine(ROM); seed(c);
  oracle(o);
  const brokenReturn = (m) => { m.mem8[0x0050] = 0x22; }; // BUG: a bare-RTS pad must write nothing
  brokenReturn(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch a spurious write");
  assert.equal(d.addr, 0x0050);
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); // a real caller-return word (ret-1) for the seam to consume
  m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, returnImmediately, TARGET, m);
  assert.equal(r.placeable, true, `returnImmediately must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
