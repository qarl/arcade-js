// SPDX-License-Identifier: GPL-3.0-only
// Memory equivalence for seedStateBlockConstants (ROM 0x252a) -- stamp the $ef-$f8 block with its fixed
// startup constants, drive the flip-screen latch + ignored $2400 store with 0x80, clear $bd/$bf. LIVE-OUT
// is RAM only (every caller's next op is a JSR that reloads A), so each side runs on a clone and the
// contract is the RAM diff (dumpState minus stack scratch below the entry SP). The routine is BRANCH-FREE and input-free, so
// the CRAFTED arm is EXHAUSTIVE path coverage; the CAPTURE arm typically finds 0 dispatches because attract
// mode never reaches the coined spawn/respawn spines (loc_23da/loc_2741) that call it.
// Run: node --test games/centiped/idiomatic/test/equivalence-252a.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_252a as oracleRom } from "../../translated/loc_252a.js";
import { seedStateBlockConstants } from "../seedStateBlockConstants.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import {
  loc_ef, loc_f0, loc_f1, loc_f2, loc_f3, loc_f4, loc_f5, loc_f6, loc_f7, loc_f8,
  loc_bd, loc_bf,
} from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x252a;
// The fixed constants the routine seeds (ROM 0x252a-0x2560).
const CONSTS = [
  [loc_f0, 0xf8], [loc_f3, 0xff], [loc_f4, 0xfe], [loc_f8, 0xfc], [loc_f1, 0xe0], [loc_ef, 0xc0],
  [loc_f2, 0x40], [loc_f5, 0xbf], [loc_f7, 0x03], [loc_f6, 0x3f], [loc_bd, 0x00], [loc_bf, 0x00],
];
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2500) : [];

test("CAPTURE: real 0x252a dispatches -- seedStateBlockConstants == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); seedStateBlockConstants(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked (0 = attract never reaches the spawn spines)`);
});

// A pristine crafted machine with SP seated on a real caller-return word and the whole block pre-dirtied to
// 0xAA (not equal to any seeded constant) so every store is observable.
function craft() {
  const m = new Machine(ROM);
  m.regs.s = 0xfd;
  m.push16(0xabcd);
  for (const [cell] of CONSTS) m.mem.write8(cell, 0xaa);
  return m;
}

test("CRAFTED: exhaustive branch-free seed -- every cell holds its constant, $bd/$bf cleared", () => {
  const o = craft(), c = craft();
  oracle(o); seedStateBlockConstants(c);
  assert.equal(ramDiff(o, c), null, "seeded-block RAM (-stack) mismatch");
  for (const [cell, want] of CONSTS) {
    assert.equal(c.mem.read8(cell), want, `cell 0x${cell.toString(16)} == 0x${want.toString(16)}`);
  }
  // 0x80 -> LS259 Q7: flip-screen latch set.
  assert.equal(c.io.flipScreen, true, "flip-screen latch set from 0x80");
});

test("TEETH: a twin that skips the $f4 constant diverges in RAM", () => {
  const brokenLoc252a = (m) => {
    const { mem8 } = m;
    mem8[loc_f0] = 0xf8; mem8[loc_f3] = 0xff;
    // BUG: dropped `mem8[loc_f4] = 0xfe;`
    mem8[loc_f8] = 0xfc; mem8[loc_f1] = 0xe0; mem8[loc_ef] = 0xc0; mem8[loc_f2] = 0x40;
    mem8[loc_f5] = 0xbf; mem8[loc_f7] = 0x03; mem8[loc_f6] = 0x3f;
    mem8[loc_bd] = 0x00; mem8[loc_bf] = 0x00;
  };
  const o = craft(), c = craft();
  oracle(o); brokenLoc252a(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM-diff check FAILED to catch the skipped $f4 constant");
  assert.equal(d.addr, loc_f4 & 0xffff);
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const r = seamPlaceable(withOmittedRet, seedStateBlockConstants, TARGET, craft());
  assert.equal(r.placeable, true, `seedStateBlockConstants must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
