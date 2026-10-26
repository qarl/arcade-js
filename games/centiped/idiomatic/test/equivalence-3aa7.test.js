// SPDX-License-Identifier: GPL-3.0-only
// Equivalence for readEaromCell (ROM 0x3aa7) -- read ER2055 EAROM cell X into A. EVERY access is EAROM I/O
// (0x1600 W / 0x1680 ctrl / 0x1700 R), so the dumpState RAM diff is vacuous; the real contract is the EAROM
// DEVICE STATE (address/latch/control lines/cells) plus register A (= cells[X]). We diff the earom object
// directly and compare A -- not firstRegDiff (Y is scratch, not read back) and not just RAM.
// Run: node --test games/centiped/idiomatic/test/equivalence-3aa7.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3aa7 as oracleRom } from "../../translated/loc_3aa7.js";
import { readEaromCell } from "../readEaromCell.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x3aa7;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

// A is the sole live-out register (Y is scratch, X unchanged).
const regOutDiff = (o, c) => (o.regs.a !== c.regs.a ? { reg: "a", o: o.regs.a, c: c.regs.a } : null);

// EAROM device-state diff -- the real memory-side contract for this routine.
const EAROM_FIELDS = ["addr", "latch", "cs1", "cs2", "c1", "c2", "ck"];
const earomDiff = (o, c) => {
  const eo = o.io.earom, ec = c.io.earom;
  for (const k of EAROM_FIELDS) if (eo[k] !== ec[k]) return { field: k, o: eo[k], c: ec[k] };
  for (let i = 0; i < eo.cells.length; i++) {
    if (eo.cells[i] !== ec.cells[i]) return { field: `cells[${i}]`, o: eo.cells[i], c: ec.cells[i] };
  }
  return null;
};

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x3aa7 dispatches -- readEaromCell == oracle in EAROM state + live-out A", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); readEaromCell(c);
    assert.equal(ramDiff(o, c), null);     // no work-RAM touched (all EAROM I/O)
    assert.equal(earomDiff(o, c), null);   // the device-state contract
    assert.equal(regOutDiff(o, c), null);  // A == the fetched cell
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: reads cells[X] into A and drives the EAROM identically", () => {
  for (const { x, cell, a } of [
    { x: 0x00, cell: 0x00, a: 0x11 },
    { x: 0x3f, cell: 0xff, a: 0x22 },
    { x: 0x10, cell: 0x5a, a: 0x00 },
    { x: 0x2a, cell: 0xa5, a: 0xff },
    { x: 0x01, cell: 0x80, a: 0x7f },
  ]) {
    const o = new Machine(ROM); const c = new Machine(ROM);
    o.io.earom.cells[x] = cell; c.io.earom.cells[x] = cell;
    o.regs.x = x; o.regs.a = a; c.regs.x = x; c.regs.a = a;
    oracle(o); readEaromCell(c);
    const label = `x=0x${x.toString(16)} cell=0x${cell.toString(16)}`;
    assert.equal(ramDiff(o, c), null, label);
    assert.equal(earomDiff(o, c), null, label);
    assert.equal(regOutDiff(o, c), null, label);
    assert.equal(c.regs.a, cell, `A == cells[X] ${label}`);
  }
});

test("TEETH: a broken twin (no control pulse) is caught by the EAROM + register contract", () => {
  // Broken: latches the address then reads without the 0x08/0x09/0x08 CLK pulse, so the data-out latch is
  // never loaded from the cell -- earomRead returns the stale data latch (== A), not cells[X].
  function loc_3aa7_broken(m, a = m.regs.a, x = m.regs.x) {
    const { mem8 } = m;
    mem8[(0x1600 + x) & 0xffff] = a; // BUG: no 0x1680 control pulse before the read
    return (m.regs.a = mem8[(0x1700 + x) & 0xffff]);
  }
  const x = 0x12, cell = 0x3c, a = 0x99;
  const o = new Machine(ROM); const c = new Machine(ROM);
  o.io.earom.cells[x] = cell; c.io.earom.cells[x] = cell;
  o.regs.x = x; o.regs.a = a; c.regs.x = x; c.regs.a = a;
  oracle(o); loc_3aa7_broken(c);
  assert.notEqual(regOutDiff(o, c), null, "the gate FAILED to catch a skipped control pulse (A)");
  assert.notEqual(earomDiff(o, c), null, "the gate FAILED to catch a skipped control pulse (EAROM state)");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM);
  m.regs.s = 0xfd;
  m.mem.write16(0x01fe, 0x3ae1); // a real caller-return word for the seam to consume
  m.regs.x = 0x10; m.regs.a = 0x00; // X in range so the EAROM access decodes
  const r = seamPlaceable(withOmittedRet, readEaromCell, TARGET, m);
  assert.equal(r.placeable, true, `readEaromCell must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
