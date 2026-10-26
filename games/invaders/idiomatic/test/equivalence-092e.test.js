// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for readActivePlayerPageTopByte (ROM 0x092e) -- build the active player's page base (0x1611, dissolved),
// force the low byte to 0xff, and load A from that top-of-page status byte. No input register (the page
// byte lives in RAM); writes NO game RAM. Live-out: HL = (page<<8)|0xff AND A = mem[HL]. The oracle's
// call to 0x1611 leaves a return-address residue in the stack scratch below the entry SP -- CAPTURE
// excludes relative to that SP, CRAFTED excludes STACK_SCRATCH below the entry SP.
// Run: node --test games/invaders/idiomatic/test/equivalence-092e.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_092e as oracleBody } from "../../translated/loc_092e.js";
import { readActivePlayerPageTopByte } from "../readActivePlayerPageTopByte.js";
import { activePlayerPageBase } from "../activePlayerPageBase.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";
import { ACTIVE_PLAYER_PAGE } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x092e;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x092e dispatches -- readActivePlayerPageTopByte == oracle in RAM (-stack), HL and A", () => {
  for (const cap of CAPS) {
    const sp = cap.regs.sp; // the oracle's call-0x1611 return-address residue sits below the entry SP
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && a >= sp - 0x10 && a < sp);
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); readActivePlayerPageTopByte(c);
    assert.equal(capDiff(o, c), null);
    assert.equal(c.regs.hl, o.regs.hl, "HL live-out matches the oracle");
    assert.equal(c.regs.a, o.regs.a, "A live-out matches the oracle");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: HL := (page<<8)|0xff and A := mem[HL] for several pages", () => {
  // pages kept clear of the stack scratch (page 0x23 would put HL at 0x23ff, aliasing the push residue)
  const cases = [
    { page: 0x20, val: 0xa5 },
    { page: 0x21, val: 0x00 },
    { page: 0x22, val: 0xff },
  ];
  for (const { page, val } of cases) {
    const ptr = (page << 8) | 0xff;
    const o = new Machine(ROM); o.regs.sp = 0x2400; o.mem8[ACTIVE_PLAYER_PAGE] = page; o.mem8[ptr] = val;
    const c = new Machine(ROM); c.regs.sp = 0x2400; c.mem8[ACTIVE_PLAYER_PAGE] = page; c.mem8[ptr] = val;
    oracle(o); readActivePlayerPageTopByte(c);
    const tag = `page=0x${page.toString(16)} val=0x${val.toString(16)}`;
    assert.equal(ramDiff(o, c), null, tag);
    assert.equal(c.regs.hl, o.regs.hl, `HL matches oracle: ${tag}`);
    assert.equal(c.regs.hl, ptr, `HL value: ${tag}`);
    assert.equal(c.regs.a, o.regs.a, `A matches oracle: ${tag}`);
    assert.equal(c.regs.a, val, `A value: ${tag}`);
  }
});

test("TEETH: dropping the low-byte force (reads mem[page<<8], not mem[(page<<8)|0xff]) is caught", () => {
  const page = 0x21;
  const base = page << 8, ptr = base | 0xff;
  // module-mutating broken twin: omits the | 0xff, so it reads the wrong cell and mis-lands HL
  const brokenTwin = (m) => {
    const p = activePlayerPageBase(m); // BUG: no | 0xff
    return [(m.regs.hl = p), (m.regs.a = m.mem8[p])];
  };
  const o = new Machine(ROM); o.regs.sp = 0x2400; o.mem8[ACTIVE_PLAYER_PAGE] = page; o.mem8[base] = 0x11; o.mem8[ptr] = 0xa5;
  const c = new Machine(ROM); c.regs.sp = 0x2400; c.mem8[ACTIVE_PLAYER_PAGE] = page; c.mem8[base] = 0x11; c.mem8[ptr] = 0xa5;
  oracle(o); brokenTwin(c);
  assert.notEqual(c.regs.a, o.regs.a, "the check FAILED to catch the wrong status cell");
  assert.notEqual(c.regs.hl, o.regs.hl, "the check FAILED to catch the mis-landed HL");
});
