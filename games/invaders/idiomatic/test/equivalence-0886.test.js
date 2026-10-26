// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for activeFieldRecordPointer (ROM 0x0886) -- "build HL = (mem[0x2067] << 8) | 0xfc". Input is the
// high-byte cell 0x2067; live-out is the register HL (not RAM), so each craft asserts HL directly, and
// RAM (dumpState, minus stack scratch below the entry SP) must stay identical between oracle and module.
// Run: node --test games/invaders/idiomatic/test/equivalence-0886.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0886 as oracleBody } from "../../translated/loc_0886.js";
import { activeFieldRecordPointer } from "../activeFieldRecordPointer.js";
import { Machine } from "../../machine.js";
import { entered, ramDiff } from "./_liveStack.js";
import { ACTIVE_PLAYER_PAGE } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x0886;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x0886 dispatches -- activeFieldRecordPointer == oracle in RAM (-stack) and HL", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); activeFieldRecordPointer(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.hl, o.regs.hl, "HL live-out mismatch");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: HL = (mem[0x2067] << 8) | 0xfc for several high bytes", () => {
  for (const hi of [0x00, 0x01, 0x20, 0x7f, 0xff, 0xa5]) {
    const o = new Machine(ROM); o.mem.write8(ACTIVE_PLAYER_PAGE, hi);
    const c = new Machine(ROM); c.mem.write8(ACTIVE_PLAYER_PAGE, hi);
    oracle(o); activeFieldRecordPointer(c);
    assert.equal(ramDiff(o, c), null, `hi=0x${hi.toString(16)}`);
    assert.equal(c.regs.hl, ((hi << 8) | 0xfc), `HL for hi=0x${hi.toString(16)}`);
    assert.equal(c.regs.hl, o.regs.hl, `HL vs oracle for hi=0x${hi.toString(16)}`);
  }
});

test("TEETH: a wrong low byte in HL is caught", () => {
  const brokenLoc0886 = (m) => (m.regs.hl = (m.mem8[ACTIVE_PLAYER_PAGE] << 8) | 0x00); // BUG: 0x00 not 0xfc
  const o = new Machine(ROM); o.mem.write8(ACTIVE_PLAYER_PAGE, 0xa5);
  const c = new Machine(ROM); c.mem.write8(ACTIVE_PLAYER_PAGE, 0xa5);
  oracle(o); brokenLoc0886(c);
  assert.equal(ramDiff(o, c), null, "RAM alone cannot see the register live-out");
  assert.notEqual(c.regs.hl, o.regs.hl, "the HL check FAILED to catch a wrong low byte");
});
