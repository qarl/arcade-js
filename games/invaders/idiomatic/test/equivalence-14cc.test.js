// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for fillScreenRow (ROM 0x14cc) -- "fill a run of rows with A, stepping 0x20 per pass".
// Inputs A (byte), B (row count; 0 means 256), HL (start). Live-out: the filled cells (RAM) AND HL,
// which the caller reads back. Each side runs on a fresh clone; the contract is RAM (dumpState, minus
// STACK_SCRATCH below the entry SP -- the oracle transiently push/pops BC there) plus the HL live-out.
// Run: node --test games/invaders/idiomatic/test/equivalence-14cc.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_14cc as oracleBody } from "../../translated/loc_14cc.js";
import { fillScreenRow } from "../fillScreenRow.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x14cc;

// End pointer the routine leaves in HL: start + (B or 256)*0x20, wrapped to 16 bits.
const endHl = (hl, rows) => (hl + (rows === 0 ? 256 : rows) * 0x20) & 0xffff;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x14cc dispatches -- fillScreenRow == oracle in RAM (-stack) and HL", () => {
  for (const cap of CAPS) {
    // The oracle's per-row `push b` residue sits just below the ENTRY SP, which SI's attract loop walks
    // widely; exclude relative to that SP, not the fixed window. The module drops the save/restore.
    const sp = cap.regs.sp;
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && a >= sp - 0x10 && a < sp);
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); fillScreenRow(c);
    assert.equal(capDiff(o, c), null);
    assert.equal(c.regs.hl, o.regs.hl, "HL live-out matches the oracle");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: the fill lands and HL advances, for several A/B/HL (incl. B=0 => 256 rows)", () => {
  const cases = [
    { a: 0xa5, rows: 4, hl: 0x2100 },
    { a: 0x00, rows: 1, hl: 0x2400 },
    { a: 0xff, rows: 8, hl: 0x2500 },
    { a: 0x3c, rows: 0, hl: 0x2200 }, // B=0 -> 256 passes; last RAM cell 0x3fe0, then 0x4000.. dropped
  ];
  for (const { a, rows, hl } of cases) {
    const o = new Machine(ROM); o.regs.a = a; o.regs.b = rows; o.regs.hl = hl; o.regs.sp = 0x2400;
    const c = new Machine(ROM); c.regs.a = a; c.regs.b = rows; c.regs.hl = hl; c.regs.sp = 0x2400;
    oracle(o); fillScreenRow(c);
    const tag = `A=0x${a.toString(16)} B=0x${rows.toString(16)} HL=0x${hl.toString(16)}`;
    assert.equal(ramDiff(o, c), null, tag);
    assert.equal(c.regs.hl, endHl(hl, rows), `HL advanced: ${tag}`);
    assert.equal(c.regs.hl, o.regs.hl, `HL matches oracle: ${tag}`);
    // spot-check the first filled cell (all four starts are inside diffable RAM 0x2000-0x3fff)
    assert.equal(c.mem.read8(hl), a, `first row filled: ${tag}`);
    if (rows > 0) {
      const last = (hl + (rows - 1) * 0x20) & 0xffff;
      assert.equal(c.mem.read8(last), a, `last row filled: ${tag}`);
    }
  }
});

test("TEETH: a broken twin (wrong 0x21 stride) diverges in RAM and in HL", () => {
  const a = 0xa5, rows = 4, hl = 0x2100;
  const o = new Machine(ROM); o.regs.a = a; o.regs.b = rows; o.regs.hl = hl; o.regs.sp = 0x2400;
  const c = new Machine(ROM); c.regs.a = a; c.regs.b = rows; c.regs.hl = hl; c.regs.sp = 0x2400;
  oracle(o);
  // broken twin of fillScreenRow: steps one byte too far each pass
  let addr = hl, n = rows;
  do { c.mem.write8(addr, a); addr += 0x21; n = (n - 1) & 0xff; } while (n !== 0);
  c.regs.hl = addr;
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong fill stride");
  assert.notEqual(c.regs.hl, o.regs.hl, "the wrong stride also mis-lands HL");
});
