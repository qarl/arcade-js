// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for clearScreenStrip (ROM 0x14cb) -- zero A, then fall through into fillScreenRow (0x14cc):
// fill B rows with 0, stepping 0x20 per pass, leaving HL one stride past. The 0x14cc fall-through is
// DISSOLVED into a direct fillScreenRow(m, 0). Inputs B (row count; 0 => 256), HL (start); A at entry is
// dead (zeroed). Live-out: the filled cells (RAM) AND HL. Each side runs on a fresh clone; the contract
// is RAM (dumpState, minus stack scratch below the entry SP -- the oracle transiently push/pops BC) plus the HL live-out.
// Run: node --test games/invaders/idiomatic/test/equivalence-14cb.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_14cb as oracleBody } from "../../translated/loc_14cb.js";
import { clearScreenStrip } from "../clearScreenStrip.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x14cb;

// End pointer left in HL: start + (B or 256)*0x20, wrapped to 16 bits.
const endHl = (hl, rows) => (hl + (rows === 0 ? 256 : rows) * 0x20) & 0xffff;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x14cb dispatches -- clearScreenStrip == oracle in RAM (-stack) and HL", () => {
  for (const cap of CAPS) {
    // The oracle's per-row `push b` residue sits just below the ENTRY SP; exclude relative to that SP.
    // The module drops the save/restore.
    const sp = cap.regs.sp;
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && a >= sp - 0x10 && a < sp);
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); clearScreenStrip(c);
    assert.equal(capDiff(o, c), null);
    assert.equal(c.regs.hl, o.regs.hl, "HL live-out matches the oracle");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: the column fills with 0 (A at entry ignored) and HL advances", () => {
  const cases = [
    { rows: 4, hl: 0x2100 },
    { rows: 1, hl: 0x2400 },
    { rows: 8, hl: 0x2500 },
    { rows: 0, hl: 0x2200 }, // B=0 -> 256 passes
  ];
  for (const { rows, hl } of cases) {
    // seed A nonzero on both to prove clearScreenStrip zeroes it before filling
    const o = new Machine(ROM); o.regs.a = 0xa5; o.regs.b = rows; o.regs.hl = hl; o.regs.sp = 0x2400;
    const c = new Machine(ROM); c.regs.a = 0xa5; c.regs.b = rows; c.regs.hl = hl; c.regs.sp = 0x2400;
    oracle(o); clearScreenStrip(c);
    const tag = `B=0x${rows.toString(16)} HL=0x${hl.toString(16)}`;
    assert.equal(ramDiff(o, c), null, tag);
    assert.equal(c.regs.hl, endHl(hl, rows), `HL advanced: ${tag}`);
    assert.equal(c.regs.hl, o.regs.hl, `HL matches oracle: ${tag}`);
    assert.equal(c.mem.read8(hl), 0x00, `first row zeroed: ${tag}`);
    if (rows > 0) {
      const last = (hl + (rows - 1) * 0x20) & 0xffff;
      assert.equal(c.mem.read8(last), 0x00, `last row zeroed: ${tag}`);
    }
  }
});

test("TEETH: a module-mutating twin (fails to zero A) diverges in RAM", () => {
  // Broken twin of clearScreenStrip: passes A through instead of zeroing it -- the whole point of clearScreenStrip.
  const loc_14cb_broken = (m) => fillScreenRowBroken(m);
  // inline a fill that uses A (m.regs.a) as the value, matching fillScreenRow's shape
  function fillScreenRowBroken(m) {
    let addr = m.regs.hl, rows = m.regs.b, value = m.regs.a; // BUG: value = A, not 0
    do {
      m.mem8[addr] = value;
      addr = (addr + 0x20) & 0xffff;
      rows = (rows - 1) & 0xff;
    } while (rows !== 0);
    return (m.regs.hl = addr);
  }
  const o = new Machine(ROM); o.regs.a = 0xa5; o.regs.b = 4; o.regs.hl = 0x2100; o.regs.sp = 0x2400;
  const c = new Machine(ROM); c.regs.a = 0xa5; c.regs.b = 4; c.regs.hl = 0x2100; c.regs.sp = 0x2400;
  oracle(o); loc_14cb_broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch an unzeroed fill value");
  assert.equal(d.addr, 0x2100 & 0xffff);
});
