// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for alienGridCellPtr (ROM 0x1581) -- "compute a record pointer". Inputs B (index) and C
// (offset); reads the page cell ACTIVE_PLAYER_PAGE. Live-out: HL = (page << 8) | (RLCx3(B) + 3B + C - 1) & 0xff,
// which the caller reads back to address a record (the oracle's trailing A = L is dead). No RAM write,
// so the contract is the HL live-out (RAM diff stays null and is checked for accidental writes).
// Run: node --test games/invaders/idiomatic/test/equivalence-1581.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1581 as oracleBody } from "../../translated/loc_1581.js";
import { alienGridCellPtr } from "../alienGridCellPtr.js";
import { Machine } from "../../machine.js";
import { entered, ramDiff } from "./_liveStack.js";
import { ACTIVE_PLAYER_PAGE } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x1581;

// The record pointer the routine builds in HL.
const expectHl = (page, b, c) => {
  const rot = ((b << 3) | (b >> 5)) & 0xff;
  const low = (rot + 3 * b + c - 1) & 0xff;
  return (page << 8) | low;
};

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x1581 dispatches -- alienGridCellPtr == oracle in RAM (-stack) and HL", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); alienGridCellPtr(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.hl, o.regs.hl, "HL live-out matches the oracle");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: HL := (page << 8) | (RLCx3(B) + 3B + C - 1) for several B/C/page", () => {
  const cases = [
    { b: 0x00, c: 0x00, page: 0x21 },
    { b: 0x01, c: 0x00, page: 0x20 },
    { b: 0x05, c: 0x02, page: 0x25 }, // matches the frozen translated test: L=0x38, H=0x25
    { b: 0x05, c: 0x03, page: 0x2f },
    { b: 0xff, c: 0xff, page: 0x30 }, // rotate wraps: RLCx3(0xff)=0xff
  ];
  for (const { b, c, page } of cases) {
    const o = new Machine(ROM); o.regs.b = b; o.regs.c = c; o.mem.write8(ACTIVE_PLAYER_PAGE, page);
    const cc = new Machine(ROM); cc.regs.b = b; cc.regs.c = c; cc.mem.write8(ACTIVE_PLAYER_PAGE, page);
    oracle(o); alienGridCellPtr(cc);
    const tag = `B=0x${b.toString(16)} C=0x${c.toString(16)} page=0x${page.toString(16)}`;
    assert.equal(ramDiff(o, cc), null, tag);
    assert.equal(cc.regs.hl, expectHl(page, b, c), `HL computed: ${tag}`);
    assert.equal(cc.regs.hl, o.regs.hl, `HL matches oracle: ${tag}`);
  }
});

test("TEETH: a broken twin (drops the -1) mis-computes HL", () => {
  const b = 0x05, c = 0x02, page = 0x25;
  const o = new Machine(ROM); o.regs.b = b; o.regs.c = c; o.mem.write8(ACTIVE_PLAYER_PAGE, page);
  oracle(o);
  // broken twin of alienGridCellPtr: forgets the trailing decrement
  const rot = ((b << 3) | (b >> 5)) & 0xff;
  const brokenLow = (rot + 3 * b + c) & 0xff; // BUG: no `- 1`
  const brokenHl = (page << 8) | brokenLow;
  assert.notEqual(brokenHl, o.regs.hl, "the HL live-out check FAILED to catch the missing -1");
});
