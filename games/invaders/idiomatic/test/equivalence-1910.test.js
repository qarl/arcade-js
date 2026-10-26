// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for activePlayerFlagPtr (ROM 0x1910) -- HL := loc_20e7, or one past it when bit0 of ACTIVE_PLAYER_PAGE
// is clear. No memory write; the contract is the HL live-out.
// Run: node --test games/invaders/idiomatic/test/equivalence-1910.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1910 as oracleBody } from "../../translated/loc_1910.js";
import { activePlayerFlagPtr } from "../activePlayerFlagPtr.js";
import { Machine } from "../../machine.js";
import { entered, ramDiff } from "./_liveStack.js";
import { ACTIVE_PLAYER_PAGE, loc_20e7 } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x1910;
const expectHl = (sel) => (sel & 1) ? loc_20e7 : loc_20e7 + 1;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x1910 dispatches -- activePlayerFlagPtr == oracle in HL (and RAM -stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); activePlayerFlagPtr(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.hl, o.regs.hl, "HL live-out matches the oracle");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: HL selects loc_20e7 vs loc_20e7+1 by bit0 of ACTIVE_PLAYER_PAGE", () => {
  for (const sel of [0x00, 0x01, 0xfe, 0xff, 0x10, 0x03]) {
    const o = new Machine(ROM); o.mem.write8(ACTIVE_PLAYER_PAGE, sel);
    const c = new Machine(ROM); c.mem.write8(ACTIVE_PLAYER_PAGE, sel);
    oracle(o); activePlayerFlagPtr(c);
    assert.equal(ramDiff(o, c), null, `sel=0x${sel.toString(16)}`);
    assert.equal(c.regs.hl, o.regs.hl, `HL match, sel=0x${sel.toString(16)}`);
    assert.equal(c.regs.hl, expectHl(sel), `HL value, sel=0x${sel.toString(16)}`);
  }
});

test("TEETH: a wrong returned HL is caught", () => {
  const brokenTwin = (m) => (m.regs.hl = (m.mem8[ACTIVE_PLAYER_PAGE] & 1) ? loc_20e7 + 1 : loc_20e7); // BUG: inverted
  const o = new Machine(ROM); o.mem.write8(ACTIVE_PLAYER_PAGE, 0x01);
  const c = new Machine(ROM); c.mem.write8(ACTIVE_PLAYER_PAGE, 0x01);
  oracle(o); brokenTwin(c);
  assert.notEqual(c.regs.hl, o.regs.hl, "the live-out check FAILED to catch a wrong HL");
});
