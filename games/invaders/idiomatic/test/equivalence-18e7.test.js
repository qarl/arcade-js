// SPDX-License-Identifier: GPL-3.0-only
// Memory+register equivalence for otherPlayerFlagPtr -- HL := base + bit0 of the select byte; the caller reads
// [HL]. Neither side writes RAM, so the observable live-out is HL: each side runs on a clone and the
// contract is RAM (dumpState, minus stack scratch below the entry SP) AND the returned HL.
// Run: node --test games/invaders/idiomatic/test/equivalence-18e7.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_18e7 as oracleBody } from "../../translated/loc_18e7.js";
import { otherPlayerFlagPtr } from "../otherPlayerFlagPtr.js";
import { Machine } from "../../machine.js";
import { entered, ramDiff } from "./_liveStack.js";
import { ACTIVE_PLAYER_PAGE, loc_20e7 } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x18e7;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x18e7 dispatches -- otherPlayerFlagPtr == oracle in RAM (-stack) and HL", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); otherPlayerFlagPtr(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.hl, o.regs.hl, "live-out HL");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: HL := 0x20e7 + bit0 of (ACTIVE_PLAYER_PAGE)", () => {
  for (const v of [0x00, 0x01, 0x02, 0x03, 0xfe, 0xff]) {
    const o = new Machine(ROM); o.mem.write8(ACTIVE_PLAYER_PAGE, v);
    const c = new Machine(ROM); c.mem.write8(ACTIVE_PLAYER_PAGE, v);
    oracle(o);
    const ret = otherPlayerFlagPtr(c);
    assert.equal(ramDiff(o, c), null, `(ACTIVE_PLAYER_PAGE)=0x${v.toString(16)}`);
    const want = loc_20e7 + (v & 1);
    assert.equal(o.regs.hl, want, `oracle HL for 0x${v.toString(16)}`);
    assert.equal(c.regs.hl, want, `module HL for 0x${v.toString(16)}`);
    assert.equal(ret, want, `module returns HL for 0x${v.toString(16)}`);
  }
});

test("TEETH: a wrong HL (bit0 bump dropped) is caught", () => {
  const o = new Machine(ROM); o.mem.write8(ACTIVE_PLAYER_PAGE, 0x01); // bit0=1 -> HL should bump
  const c = new Machine(ROM); c.mem.write8(ACTIVE_PLAYER_PAGE, 0x01);
  oracle(o);
  otherPlayerFlagPtr(c); c.regs.hl = loc_20e7; // BUG: dropped the +1 bump
  assert.notEqual(o.regs.hl, c.regs.hl, "the live-out check FAILED to catch a wrong HL");
});
