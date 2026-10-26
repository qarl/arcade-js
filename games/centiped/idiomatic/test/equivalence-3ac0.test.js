// SPDX-License-Identifier: GPL-3.0-only
// Equivalence for tickEaromWriteback (ROM 0x3ac0) -- the periodic EAROM erase/write state machine. The
// contract is RAM (dumpState minus stack scratch below the entry SP: the loc_f9 cursor + loc_fa phase) AND the ER2055 device
// state (control lines, address/data latch, cells), since the routine both reads (readEaromCell) and writes
// (0x1600 / 0x1680 strobes) the EAROM. We diff RAM and the earom object; registers are dead (callers reload).
// Run: node --test games/centiped/idiomatic/test/equivalence-3ac0.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3ac0 as oracleRom } from "../../translated/loc_3ac0.js";
import { tickEaromWriteback } from "../tickEaromWriteback.js";
import { readEaromCell } from "../readEaromCell.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { loc_00, loc_f9, loc_fa, HIGH_SCORE_TABLE } from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x3ac0;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

const EAROM_FIELDS = ["addr", "latch", "cs1", "cs2", "c1", "c2", "ck"];
const earomDiff = (o, c) => {
  const eo = o.io.earom, ec = c.io.earom;
  for (const k of EAROM_FIELDS) if (eo[k] !== ec[k]) return { field: k, o: eo[k], c: ec[k] };
  for (let i = 0; i < eo.cells.length; i++) {
    if (eo.cells[i] !== ec.cells[i]) return { field: `cells[${i}]`, o: eo.cells[i], c: ec.cells[i] };
  }
  return null;
};

// Build a matched oracle/candidate pair from one seeding function.
function seedPair(seedFn) {
  const o = new Machine(ROM), c = new Machine(ROM);
  seedFn(o); seedFn(c);
  return [o, c];
}

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(24, 1500) : [];

test("CAPTURE: real 0x3ac0 dispatches -- tickEaromWriteback == oracle in RAM + EAROM state", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); tickEaromWriteback(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(earomDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: off-phase frame is a pure no-op", () => {
  const [o, c] = seedPair((m) => { m.mem.write8(loc_00, 0x01); m.mem.write8(loc_f9, 0x05); m.mem.write8(loc_fa, 0x03); });
  oracle(o); tickEaromWriteback(c);
  assert.equal(ramDiff(o, c), null);
  assert.equal(earomDiff(o, c), null);
  assert.equal(c.mem.read8(loc_f9), 0x05, "cursor untouched off-phase");
  assert.equal(c.mem.read8(loc_fa), 0x03, "phase untouched off-phase");
});

test("CRAFTED: idle cursor (0xff) returns after releasing control lines", () => {
  const [o, c] = seedPair((m) => { m.mem.write8(loc_00, 0x00); m.mem.write8(loc_f9, 0xff); m.mem.write8(loc_fa, 0x01); });
  oracle(o); tickEaromWriteback(c);
  assert.equal(ramDiff(o, c), null);
  assert.equal(earomDiff(o, c), null);
  assert.equal(c.mem.read8(loc_f9), 0xff, "cursor stays idle");
  assert.equal(c.mem.read8(loc_fa), 0x01, "phase untouched (bmi before lsr)");
});

test("CRAFTED: commit half (phase bit0 set) pulses write strobe and advances the cursor", () => {
  const [o, c] = seedPair((m) => { m.mem.write8(loc_00, 0x00); m.mem.write8(loc_f9, 0x05); m.mem.write8(loc_fa, 0x01); });
  oracle(o); tickEaromWriteback(c);
  assert.equal(ramDiff(o, c), null);
  assert.equal(earomDiff(o, c), null);
  assert.equal(c.mem.read8(loc_f9), 0x04, "cursor decremented");
  assert.equal(c.mem.read8(loc_fa), 0x00, "phase shifted right (0x01 -> 0x00)");
});

test("CRAFTED: scan half finds a dirty slot, parks the cursor, erases the cell, bumps the phase", () => {
  const [o, c] = seedPair((m) => {
    m.mem.write8(loc_00, 0x00); m.mem.write8(loc_f9, 0x05); m.mem.write8(loc_fa, 0x00);
    // slots 5,4 match; slot 3 is dirty (RAM != EAROM) -> first mismatch parks at 3
    for (const [x, v] of [[5, 0x11], [4, 0x22], [3, 0x33]]) { m.mem.write8(HIGH_SCORE_TABLE + x, v); m.io.earom.cells[x] = v; }
    m.io.earom.cells[3] = 0x99; // make slot 3 disagree with RAM (0x33)
  });
  oracle(o); tickEaromWriteback(c);
  assert.equal(ramDiff(o, c), null);
  assert.equal(earomDiff(o, c), null);
  assert.equal(c.mem.read8(loc_f9), 0x03, "cursor parked on the dirty slot");
  assert.equal(c.mem.read8(loc_fa), 0x01, "phase bumped to the commit half");
  assert.equal(c.io.earom.cells[3], 0xff, "dirty cell erased ahead of the commit");
});

test("CRAFTED: scan half with every slot clean runs the cursor to 0xff", () => {
  const [o, c] = seedPair((m) => {
    m.mem.write8(loc_00, 0x00); m.mem.write8(loc_f9, 0x02); m.mem.write8(loc_fa, 0x00);
    for (let x = 0; x <= 2; x++) { m.mem.write8(HIGH_SCORE_TABLE + x, 0x40 + x); m.io.earom.cells[x] = 0x40 + x; }
  });
  oracle(o); tickEaromWriteback(c);
  assert.equal(ramDiff(o, c), null);
  assert.equal(earomDiff(o, c), null);
  assert.equal(c.mem.read8(loc_f9), 0xff, "cursor ran to idle (all slots clean)");
});

test("TEETH: a twin that skips the erase/write strobe is caught by the EAROM device diff", () => {
  // Broken: scans and parks the cursor + bumps the phase, but omits the 0x06 / sta $1600,x / 0x0e strobe,
  // so the dirty cell is never erased and the address/data latch is left at the read state. RAM matches;
  // only the device-state diff fires.
  function tick_broken(m) {
    const { mem8 } = m;
    let a = mem8[loc_00] & 0x03;
    if (a !== 0) return;
    mem8[0x1680] = a;
    let x = mem8[loc_f9];
    if (x & 0x80) return;
    const phase = mem8[loc_fa];
    mem8[loc_fa] = phase >> 1;
    if ((phase & 0x01) !== 0) { mem8[0x1680] = 0x02; mem8[0x1680] = 0x0a; mem8[loc_f9] = (x - 1) & 0xff; return; }
    for (;;) {
      a = readEaromCell(m, a, x);
      if (a !== mem8[HIGH_SCORE_TABLE + x]) {
        mem8[loc_f9] = x;
        mem8[loc_fa] = (mem8[loc_fa] + 1) & 0xff; // BUG: no erase/write strobe before this
        return;
      }
      x = (x - 1) & 0xff;
      if (x & 0x80) break;
    }
    mem8[loc_f9] = x;
  }
  const seed = (m) => {
    m.mem.write8(loc_00, 0x00); m.mem.write8(loc_f9, 0x03); m.mem.write8(loc_fa, 0x00);
    m.mem.write8(HIGH_SCORE_TABLE + 3, 0x22); m.io.earom.cells[3] = 0x11; // dirty slot at the cursor
  };
  const o = new Machine(ROM), c = new Machine(ROM);
  seed(o); seed(c);
  oracle(o); tick_broken(c);
  assert.equal(ramDiff(o, c), null, "RAM is identical (cursor + phase updated the same)");
  assert.notEqual(earomDiff(o, c), null, "the gate FAILED to catch the skipped erase/write strobe");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM);
  m.regs.s = 0xfd;
  m.mem.write16(0x01fe, 0x3f36); // a real caller-return word (loc_3d57 push16 0x3f36) for the seam
  m.mem.write8(loc_00, 0x00); m.mem.write8(loc_f9, 0x00); // proceed into the scan half so the body runs
  const r = seamPlaceable(withOmittedRet, tickEaromWriteback, TARGET, m);
  assert.equal(r.placeable, true, `tickEaromWriteback must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
