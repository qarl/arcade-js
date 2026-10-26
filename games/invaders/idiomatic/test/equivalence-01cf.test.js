// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for drawBottomLine (ROM 0x01cf) -- seat A=0x01/B=0xe0/HL=play-field base and delegate
// to the shared row-fill (0x14cc, lifted as fillScreenRow). Live-out: the filled cells (RAM) AND HL,
// which the fill leaves one stride past the end. Each side runs on a fresh clone; the contract is RAM
// (dumpState, minus the oracle's per-row `push b` residue below the entry SP) plus the HL live-out.
// Run: node --test games/invaders/idiomatic/test/equivalence-01cf.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_01cf as oracleBody } from "../../translated/loc_01cf.js";
import { drawBottomLine } from "../drawBottomLine.js";
import { fillScreenRow } from "../fillScreenRow.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";
import { PLAYFIELD_VRAM_BASE } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x01cf;

// End pointer the fill leaves in HL: base + 0xe0*0x20, wrapped to 16 bits.
const END_HL = (PLAYFIELD_VRAM_BASE + 0xe0 * 0x20) & 0xffff;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x01cf dispatches -- drawBottomLine == oracle in RAM (-stack) and HL", () => {
  for (const cap of CAPS) {
    // The oracle's per-row `push b` residue sits just below the ENTRY SP (the delegated 0x14cc block);
    // exclude relative to that SP, not the fixed window. The module drops the save/restore.
    const sp = cap.regs.sp;
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && a >= sp - 0x10 && a < sp);
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); drawBottomLine(c);
    assert.equal(capDiff(o, c), null);
    assert.equal(c.regs.hl, o.regs.hl, "HL live-out matches the oracle");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: fills 0xe0 rows of the play-field column with 0x01 and lands HL past the end", () => {
  const o = new Machine(ROM); o.regs.sp = 0x2400;
  const c = new Machine(ROM); c.regs.sp = 0x2400;
  oracle(o); drawBottomLine(c);
  assert.equal(ramDiff(o, c), null, "RAM diverged from the oracle");
  assert.equal(c.regs.hl, END_HL, "HL advanced base + 0xe0*0x20");
  assert.equal(c.regs.hl, o.regs.hl, "HL matches oracle");
  assert.equal(c.mem.read8(PLAYFIELD_VRAM_BASE), 0x01, "first row filled");
  const last = (PLAYFIELD_VRAM_BASE + 0xdf * 0x20) & 0xffff;
  assert.equal(c.mem.read8(last), 0x01, "last row filled");
});

test("TEETH: a broken twin (wrong fill byte) is caught", () => {
  // mutate the marshalled fill value 0x01 -> 0x02; the real fillScreenRow still runs.
  function loc_01cf_broken(m) {
    return fillScreenRow(m, 0x02, 0xe0, PLAYFIELD_VRAM_BASE); // BUG: wrong lit byte
  }
  const o = new Machine(ROM); o.regs.sp = 0x2400;
  const c = new Machine(ROM); c.regs.sp = 0x2400;
  oracle(o); loc_01cf_broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong fill byte");
  assert.equal(d.addr, PLAYFIELD_VRAM_BASE & 0xffff);
});
