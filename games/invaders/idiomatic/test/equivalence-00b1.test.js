// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for loadReferenceAlienState (ROM 0x00b1) -- fetch the active record's 16-bit pointer via
// activeFieldRecordPointer (0x0886 dissolved), mirror it to loc_2009 and ALIEN_DRAW_ADDR, then derive the
// count byte at loc_2008 (dropped by one when the byte just below the pointer is 3) and the edge flag
// at FLEET_MOVE_DIR (set when that count reads 0xfe). Live-out is memory only (the sole caller, enterRoundWithFieldReload,
// immediately calls 0x19d1 which reloads A/HL), so each side runs on a clone and the contract is RAM
// (dumpState, minus stack scratch below the entry SP -- the oracle's balanced push/pop scratch is excluded).
// Run: node --test games/invaders/idiomatic/test/equivalence-00b1.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_00b1 as oracleBody } from "../../translated/loc_00b1.js";
import { loadReferenceAlienState } from "../loadReferenceAlienState.js";
import { Machine } from "../../machine.js";
import { entered, ramDiff } from "./_liveStack.js";
import { activeFieldRecordPointer } from "../activeFieldRecordPointer.js";
import { ACTIVE_PLAYER_PAGE, loc_2008, loc_2009, ALIEN_DRAW_ADDR, FLEET_MOVE_DIR } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x00b1;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

// Seat the machine so the record pointer resolves to `page:0xfc`, holds `value`, and the byte below it is `below`.
function seed(page, value, below) {
  const m = new Machine(ROM);
  m.regs.sp = 0x2400;
  m.mem.write8(ACTIVE_PLAYER_PAGE, page);
  const ptr = (page << 8) | 0xfc;
  m.mem.write16(ptr, value);
  m.mem.write8((ptr - 1) & 0xffff, below);
  return m;
}

test("CAPTURE: real 0x00b1 dispatches -- loadReferenceAlienState == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); loadReferenceAlienState(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: pointer mirrored to loc_2009/ALIEN_DRAW_ADDR; count + edge flag derived", () => {
  const cases = [
    { below: 0x03, count: 0x02, flag: 0x00 }, // the one byte the count is dropped for
    { below: 0xfe, count: 0xfe, flag: 0x01 }, // the count that raises the edge flag
    { below: 0x00, count: 0x00, flag: 0x00 },
    { below: 0x55, count: 0x55, flag: 0x00 },
    { below: 0x02, count: 0x02, flag: 0x00 }, // 0x02 != 0x03: no decrement (proves the guard is ==3, not <=3)
  ];
  const value = 0x1234;
  for (const { below, count, flag } of cases) {
    const o = seed(0x21, value, below);
    const c = seed(0x21, value, below);
    oracle(o); loadReferenceAlienState(c);
    const label = `below=0x${below.toString(16)}`;
    assert.equal(ramDiff(o, c), null, label);
    assert.equal(c.mem.read16(loc_2009), value, `loc_2009 ${label}`);
    assert.equal(c.mem.read16(ALIEN_DRAW_ADDR), value, `ALIEN_DRAW_ADDR ${label}`);
    assert.equal(c.mem.read8(loc_2008), count, `loc_2008 count ${label}`);
    assert.equal(c.mem.read8(FLEET_MOVE_DIR), flag, `FLEET_MOVE_DIR edge flag ${label}`);
  }
});

test("TEETH: a module that skips the count decrement is caught by the RAM diff", () => {
  // Broken twin: the real logic minus the `== 3` drop -- stores the raw byte at loc_2008.
  const brokenLoc00b1 = (m) => {
    const { mem8, mem16 } = m;
    const ptr = activeFieldRecordPointer(m);
    const value = mem16[ptr];
    mem16[loc_2009] = value;
    mem16[ALIEN_DRAW_ADDR] = value;
    const below = mem8[(ptr - 1) & 0xffff];
    mem8[loc_2008] = below;                       // BUG: no decrement when below == 3
    mem8[FLEET_MOVE_DIR] = below === 0xfe ? 0x01 : 0x00;
  };
  const o = seed(0x21, 0x1234, 0x03);
  const c = seed(0x21, 0x1234, 0x03);
  oracle(o); brokenLoc00b1(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch the skipped decrement");
  assert.equal(d.addr, loc_2008 & 0xffff);
});
