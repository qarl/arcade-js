// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for drawSpriteColumn16 -- preserve BC, force a 0x10 row count, and delegate a sprite-column
// draw (dissolved into drawSpriteColumn). Live-out: the drawn column RAM PLUS the advanced HL; BC is
// left untouched. DE/A/flags the delegate leaves stale are DEAD -- the script walker re-derives them via
// fetchNextDrawRecord before any read -- so only RAM (minus stack scratch below the entry SP), HL, and the preserved BC are asserted.
// Run: node --test games/invaders/idiomatic/test/equivalence-1844.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1844 as oracleBody } from "../../translated/loc_1844.js";
import { drawSpriteColumn16 } from "../drawSpriteColumn16.js";
import { drawSpriteColumn } from "../drawSpriteColumn.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x1844;
const CALLER_RET = 0xabcd;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x1844 dispatches -- drawSpriteColumn16 == oracle in RAM (-stack), HL and BC", () => {
  for (const cap of CAPS) {
    // The oracle's `push b` + `call 0x1439` residue sits just below the ENTRY SP, which in real
    // dispatches is not the STACK_SCRATCH window -- exclude it relative to that SP (as stepFleetMarchSound does).
    const sp = cap.regs.sp;
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && a >= sp - 0x10 && a < sp);
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); drawSpriteColumn16(c);
    assert.equal(capDiff(o, c), null);
    assert.equal(c.regs.hl, o.regs.hl, "HL live-out matches the oracle");
    assert.equal(c.regs.bc, o.regs.bc, "BC is preserved like the oracle");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Seat a fresh Machine: a caller return on the stack, a source stream at DE, a dest base at HL, and a
// caller BC the routine must leave untouched.
function seat(m, { hl, de, bc, src }) {
  m.regs.sp = 0x2400; m.push16(CALLER_RET); m.io.setInte(false);
  m.regs.hl = hl; m.regs.de = de; m.regs.bc = bc;
  src.forEach((v, i) => m.mem.write8((de + i) & 0xffff, v));
}

test("CRAFTED: 16 rows copied down the column; HL += 0x200, BC preserved", () => {
  const CASE = {
    hl: 0x2100, de: 0x3000, bc: 0x1234,
    src: [0x01, 0x03, 0x07, 0x0f, 0x1f, 0x3f, 0x7f, 0xff,
          0xfe, 0xfc, 0xf8, 0xf0, 0xe0, 0xc0, 0x80, 0x00],
  };
  const o = new Machine(ROM); seat(o, CASE);
  const c = new Machine(ROM); seat(c, CASE);
  oracle(o); drawSpriteColumn16(c);

  assert.equal(ramDiff(o, c), null, "oracle and module leave identical RAM (-stack)");
  for (let i = 0; i < 0x10; i++) {
    assert.equal(c.mem.read8((CASE.hl + 0x20 * i) & 0xffff), CASE.src[i], `row ${i} copied`);
  }
  assert.equal(c.regs.hl, (CASE.hl + 0x200) & 0xffff, "HL := base + 0x20*0x10");
  assert.equal(c.regs.hl, o.regs.hl, "HL matches the oracle");
  assert.equal(c.regs.bc, CASE.bc, "BC untouched");
  assert.equal(o.regs.bc, CASE.bc, "oracle also preserves BC");
});

// A module-mutating twin: it forces a 15-row count instead of 16, so the last row is never drawn.
function loc_1844_broken(m, hl = m.regs.hl, de = m.regs.de) {
  return drawSpriteColumn(m, hl, de, 0x0f); // BUG: 15 rows, not 16
}

test("TEETH: a twin that draws one row short is caught by the RAM diff", () => {
  const CASE = {
    hl: 0x2100, de: 0x3000, bc: 0x1234,
    src: [0x01, 0x03, 0x07, 0x0f, 0x1f, 0x3f, 0x7f, 0xff,
          0xfe, 0xfc, 0xf8, 0xf0, 0xe0, 0xc0, 0x80, 0x11],
  };
  const o = new Machine(ROM); seat(o, CASE);
  const c = new Machine(ROM); seat(c, CASE);
  oracle(o); loc_1844_broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch a one-row-short draw");
  assert.equal(d.addr, (CASE.hl + 0x20 * 0x0f) & 0xffff, "first divergence is the un-drawn 16th row");
});
