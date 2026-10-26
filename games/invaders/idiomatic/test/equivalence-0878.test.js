// SPDX-License-Identifier: GPL-3.0-only
// Equivalence for stageActivePlayerFieldSave (ROM 0x0878) -- B := [loc_2008], DE := the 16-bit word at loc_2009, then
// build HL := the active player's record pointer (activeFieldRecordPointer). Live-out is REGISTERS
// HL/DE/B (A is dead: the sole caller 0x02f8 does `pop psw` then `mvi a` before ever reading A, and
// the oracle's 0x0886 leaves A = the page byte while the module drops it). Neither side writes game
// RAM, so RAM is a guard; the contract is the register image.
// Run: node --test games/invaders/idiomatic/test/equivalence-0878.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0878 as oracleBody } from "../../translated/loc_0878.js";
import { stageActivePlayerFieldSave } from "../stageActivePlayerFieldSave.js";
import { activeFieldRecordPointer } from "../activeFieldRecordPointer.js";
import { Machine } from "../../machine.js";
import { entered, ramDiff } from "./_liveStack.js";
import { loc_2008, loc_2009, ACTIVE_PLAYER_PAGE } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x0878;
const CALLER_RET = 0xabcd;

// Live-out data registers (A is dead, SP/PC excluded).
const OUT = ["hl", "de", "b"];
const regOutDiff = (o, c) => {
  for (const k of OUT) if (o.regs[k] !== c.regs[k]) return { reg: k, o: o.regs[k], c: c.regs[k] };
  return null;
};

function seed(m, count, deWord, page) {
  m.mem.write8(loc_2008, count);
  m.mem.write16(loc_2009, deWord);
  m.mem.write8(ACTIVE_PLAYER_PAGE, page);
}

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x0878 dispatches -- stageActivePlayerFieldSave == oracle in RAM (-stack) and HL/DE/B", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); stageActivePlayerFieldSave(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(regOutDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: B/DE from the cells, HL = (page << 8) | 0xfc", () => {
  for (const [count, deWord, page] of [
    [0x0a, 0x1234, 0x21],
    [0x00, 0x0000, 0x00],
    [0xff, 0xabcd, 0x22],
    [0x07, 0x2101, 0x20],
  ]) {
    const o = new Machine(ROM); o.regs.sp = 0x2400; o.push16(CALLER_RET); o.io.setInte(false);
    const c = new Machine(ROM); c.regs.sp = 0x2400; c.push16(CALLER_RET); c.io.setInte(false);
    seed(o, count, deWord, page); seed(c, count, deWord, page);
    oracle(o); stageActivePlayerFieldSave(c);
    assert.equal(ramDiff(o, c), null, `count=0x${count.toString(16)}`);
    assert.equal(regOutDiff(o, c), null, `count=0x${count.toString(16)}`);
    assert.equal(c.regs.b, count, `B count=0x${count.toString(16)}`);
    assert.equal(c.regs.de, deWord, `DE count=0x${count.toString(16)}`);
    assert.equal(c.regs.hl, ((page << 8) | 0xfc) & 0xffff, `HL count=0x${count.toString(16)}`);
  }
});

test("TEETH: a broken twin (count from the wrong cell) is caught", () => {
  // Real-logic mutation: reads the count from the pointer cell instead of loc_2008.
  const loc_0878_broken = (m) => {
    const b = m.mem8[loc_2009]; // BUG: count from loc_2009, not loc_2008
    const de = m.mem16[loc_2009];
    return [activeFieldRecordPointer(m), m.regs.b = b, m.regs.de = de];
  };
  const o = new Machine(ROM); o.regs.sp = 0x2400; o.push16(CALLER_RET); o.io.setInte(false);
  const c = new Machine(ROM); c.regs.sp = 0x2400; c.push16(CALLER_RET); c.io.setInte(false);
  seed(o, 0x07, 0x1234, 0x21); seed(c, 0x07, 0x1234, 0x21); // [0x2008]=0x07 != [0x2009]=0x34
  oracle(o); loc_0878_broken(c);
  const d = regOutDiff(o, c);
  assert.notEqual(d, null, "the register contract FAILED to catch the wrong count cell");
  assert.equal(d.reg, "b");
});
