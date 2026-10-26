// SPDX-License-Identifier: GPL-3.0-only
// Memory equivalence for broadcastByteToStateBlock (ROM 0x2509) -- fan the byte in $fe across $bd/$bf and
// the $ef-$f8 block (plus the flip-screen latch + the ignored $2400 store). LIVE-OUT is RAM only (every
// caller's next op is a JSR that reloads A), so each side runs on a clone and the contract is the RAM diff
// (dumpState minus stack scratch below the entry SP). The routine is BRANCH-FREE, so the CRAFTED arm over several $fe values is
// EXHAUSTIVE path coverage; the CAPTURE arm typically finds 0 dispatches because attract mode never reaches
// the coined spawn/respawn spines (loc_23da/loc_2741/loc_2561) that call it -- CRAFTED carries correctness.
// Run: node --test games/centiped/idiomatic/test/equivalence-2509.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2509 as oracleRom } from "../../translated/loc_2509.js";
import { broadcastByteToStateBlock } from "../broadcastByteToStateBlock.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import {
  loc_ef, loc_f0, loc_f1, loc_f2, loc_f3, loc_f4, loc_f5, loc_f6, loc_f7, loc_f8,
  loc_bd, loc_bf, loc_fe,
} from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x2509;
const BLOCK = [loc_bd, loc_bf, loc_ef, loc_f0, loc_f1, loc_f2, loc_f3, loc_f4, loc_f5, loc_f6, loc_f7, loc_f8];
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2500) : [];

test("CAPTURE: real 0x2509 dispatches -- broadcastByteToStateBlock == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); broadcastByteToStateBlock(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked (0 = attract never reaches the spawn spines)`);
});

// A pristine crafted machine with SP seated on a real caller-return word and $fe holding the broadcast byte.
function craft(v) {
  const m = new Machine(ROM);
  m.regs.s = 0xfd;
  m.push16(0xabcd);
  m.mem.write8(loc_fe, v);
  return m;
}

test("CRAFTED: exhaustive branch-free broadcast -- every block cell mirrors $fe", () => {
  for (const v of [0x00, 0xff, 0xfe, 0x55, 0x80, 0x01]) {
    const o = craft(v), c = craft(v);
    oracle(o); broadcastByteToStateBlock(c);
    const label = `$fe=0x${v.toString(16)}`;
    assert.equal(ramDiff(o, c), null, `RAM ${label}`);
    for (const cell of BLOCK) {
      assert.equal(c.mem.read8(cell), v, `cell 0x${cell.toString(16)} ${label}`);
    }
    // Flip-screen latch bit7 of v was broadcast to Q7.
    assert.equal(c.io.flipScreen, !!(v & 0x80), `flip-screen latch ${label}`);
  }
});

test("TEETH: a twin that skips the $f4 store diverges in RAM", () => {
  const brokenLoc2509 = (m) => {
    const { mem8 } = m;
    const v = mem8[loc_fe];
    mem8[loc_bd] = v; mem8[loc_bf] = v;
    mem8[loc_f5] = v; mem8[loc_f7] = v; mem8[loc_f6] = v; mem8[loc_f0] = v;
    mem8[loc_ef] = v; mem8[loc_f1] = v; mem8[loc_f2] = v; mem8[loc_f3] = v;
    // BUG: dropped `mem8[loc_f4] = v;`
    mem8[loc_f8] = v;
  };
  const o = craft(0x5a), c = craft(0x5a);
  o.mem.write8(loc_f4, 0x00); c.mem.write8(loc_f4, 0x00); // ensure $f4 starts != 0x5a so the drop shows
  oracle(o); brokenLoc2509(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM-diff check FAILED to catch the skipped $f4 store");
  assert.equal(d.addr, loc_f4 & 0xffff);
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const r = seamPlaceable(withOmittedRet, broadcastByteToStateBlock, TARGET, craft(0xfe));
  assert.equal(r.placeable, true, `broadcastByteToStateBlock must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
