// SPDX-License-Identifier: GPL-3.0-only
// Equivalence for loadHighScoreTableFromEarom (ROM 0x3a99) -- read EAROM cells 0x3f..0 into the RAM mirror
// at HIGH_SCORE_TABLE.. and park loc_f9 at 0xff. The contract is RAM (dumpState minus stack scratch below the entry SP: the mirror +
// loc_f9) AND the ER2055 device state, since every fetch drives the EAROM (0x1600 W / 0x1680 ctrl / 0x1700 R).
// We diff RAM and the earom object directly; A/X are dead (both callers reload), so no register diff.
// Run: node --test games/centiped/idiomatic/test/equivalence-3a99.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3a99 as oracleRom } from "../../translated/loc_3a99.js";
import { loadHighScoreTableFromEarom } from "../loadHighScoreTableFromEarom.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { HIGH_SCORE_TABLE, loc_f9 } from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x3a99;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

// ER2055 device-state diff -- the memory-side contract for an EAROM routine.
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

test("CAPTURE: real 0x3a99 dispatches -- loadHighScoreTableFromEarom == oracle in RAM + EAROM state", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); loadHighScoreTableFromEarom(c);
    assert.equal(ramDiff(o, c), null);   // the mirror + loc_f9
    assert.equal(earomDiff(o, c), null); // the device drive
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: cells[X] land at HIGH_SCORE_TABLE+X for all 64 slots; loc_f9 parked at 0xff", () => {
  const patterns = [
    (i) => (i * 3 + 1) & 0xff,
    (i) => (0xff - i) & 0xff,
    (i) => (i & 1 ? 0x00 : 0xff),
  ];
  for (const pat of patterns) {
    const o = new Machine(ROM), c = new Machine(ROM);
    for (let i = 0; i < 64; i++) { o.io.earom.cells[i] = pat(i); c.io.earom.cells[i] = pat(i); }
    oracle(o); loadHighScoreTableFromEarom(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(earomDiff(o, c), null);
    for (let i = 0; i < 64; i++) {
      assert.equal(c.mem.read8(HIGH_SCORE_TABLE + i), pat(i) & 0xff, `mirror[${i}]`);
    }
    assert.equal(c.mem.read8(loc_f9), 0xff, "loc_f9 == 0xff");
  }
});

test("TEETH: a twin that copies cells without driving the EAROM is caught by the device-state diff", () => {
  // Broken: reads the cells array directly (correct RAM result) but never touches the ports, so the EAROM
  // address/data latch is left at its defaults -- the RAM diff is clean, only the device-state diff fires.
  function loadHighScoreTableFromEarom_broken(m) {
    const { mem8 } = m;
    for (let x = 0x3f; x >= 0; x--) mem8[HIGH_SCORE_TABLE + x] = m.io.earom.cells[x]; // BUG: no EAROM I/O
    mem8[loc_f9] = 0xff;
  }
  const o = new Machine(ROM), c = new Machine(ROM);
  for (let i = 0; i < 64; i++) { o.io.earom.cells[i] = (i * 5) & 0xff; c.io.earom.cells[i] = (i * 5) & 0xff; }
  oracle(o); loadHighScoreTableFromEarom_broken(c);
  assert.equal(ramDiff(o, c), null, "the RAM result is identical (both fill the mirror)");
  assert.notEqual(earomDiff(o, c), null, "the gate FAILED to catch the un-driven EAROM device");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM);
  m.regs.s = 0xfd;
  m.mem.write16(0x01fe, 0x3b43); // a real caller-return word (loc_3b04 push16 0x3b43) for the seam
  const r = seamPlaceable(withOmittedRet, loadHighScoreTableFromEarom, TARGET, m);
  assert.equal(r.placeable, true, `loadHighScoreTableFromEarom must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
