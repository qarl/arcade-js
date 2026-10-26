// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for reverseFleetAtEdge (ROM 0x1597) -- fleet edge / direction reversal. Reads FLEET_MOVE_DIR to
// pick an edge column, scans it (fleetReachedEdge); on a hit flips the direction and republishes the derived cells,
// else bails unchanged. Live-out (DERIVED FROM THE ORACLE): RAM only -- FLEET_MOVE_DIR, loc_2008 (step, via
// fleetStepSize), FLEET_STEP_DY (mirrored from FLEET_DROP_DELTA). Its only caller (resolveShotAndFleetEdge) ignores the result, so no
// register/carry live-out. The oracle's internal call return-words sit in dead stack scratch (excluded).
// Run: node --test games/invaders/idiomatic/test/equivalence-1597.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1597 as oracleBody } from "../../translated/loc_1597.js";
import { reverseFleetAtEdge } from "../reverseFleetAtEdge.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";
import { FLEET_MOVE_DIR, loc_2008, ALIEN_COUNT } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x1597;
const SCAN_RIGHT = 0x2524; // FLEET_MOVE_DIR != 0 arm scans here
const SCAN_LEFT = 0x3ea4;  // FLEET_MOVE_DIR == 0 arm scans here
const CELL_2007 = 0x2007;
const CELL_200E = 0x200e;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(24, 2000) : [];

test("CAPTURE: real 0x1597 dispatches -- reverseFleetAtEdge == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    // The oracle's internal calls push return words just below the ENTRY SP; the module never touches the
    // stack, so exclude relative to that SP (nested captures sit below the fixed STACK_SCRATCH window).
    const sp = cap.regs.sp;
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && a >= sp - 0x20 && a < sp);
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); reverseFleetAtEdge(c);
    assert.equal(capDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: flips direction + republishes on a hit; bails unchanged on all-zero", () => {
  const cases = [
    { dir: 0x01, found: true,  scan: SCAN_RIGHT, aliens: 0x05, wantDir: 0x00, wantStep: 0x02 },
    { dir: 0x01, found: true,  scan: SCAN_RIGHT, aliens: 0x01, wantDir: 0x00, wantStep: 0x03 },
    { dir: 0x01, found: false, scan: SCAN_RIGHT, aliens: 0x05 },
    { dir: 0x00, found: true,  scan: SCAN_LEFT,  aliens: 0x05, wantDir: 0x01, wantStep: 0xfe },
    { dir: 0x00, found: false, scan: SCAN_LEFT,  aliens: 0x05 },
  ];
  for (const t of cases) {
    const seed = (m) => {
      m.regs.sp = 0x2400; m.io.setInte(false);
      m.mem.write8(FLEET_MOVE_DIR, t.dir);
      m.mem.write8(ALIEN_COUNT, t.aliens);
      m.mem.write8(CELL_200E, 0x7c);
      for (let i = 0; i < 0x17; i++) m.mem.write8(t.scan + i, 0);
      if (t.found) m.mem.write8(t.scan + 0x05, 0x40); // a set pixel inside the scanned column
    };
    const o = new Machine(ROM); seed(o);
    const c = new Machine(ROM); seed(c);
    oracle(o); reverseFleetAtEdge(c);
    const tag = `dir=${hx(t.dir)} found=${t.found} aliens=${hx(t.aliens)}`;
    assert.equal(ramDiff(o, c), null, tag);
    if (t.found) {
      assert.equal(c.mem.read8(FLEET_MOVE_DIR), t.wantDir, `direction flipped: ${tag}`);
      assert.equal(c.mem.read8(loc_2008), t.wantStep, `step republished: ${tag}`);
      assert.equal(c.mem.read8(CELL_2007), 0x7c, `FLEET_STEP_DY mirrored from FLEET_DROP_DELTA: ${tag}`);
    } else {
      assert.equal(c.mem.read8(FLEET_MOVE_DIR), t.dir, `direction untouched on bail: ${tag}`);
    }
  }
});

test("TEETH: a twin that drops the fleet update leaves FLEET_MOVE_DIR unflipped", () => {
  const seed = (m) => {
    m.regs.sp = 0x2400; m.io.setInte(false);
    m.mem.write8(FLEET_MOVE_DIR, 0x01);
    m.mem.write8(ALIEN_COUNT, 0x05);
    m.mem.write8(CELL_200E, 0x7c);
    for (let i = 0; i < 0x17; i++) m.mem.write8(SCAN_RIGHT + i, 0);
    m.mem.write8(SCAN_RIGHT + 0x05, 0x40);
  };
  const o = new Machine(ROM); seed(o);
  const c = new Machine(ROM); seed(c);
  oracle(o);
  function loc_1597_noUpdate() { /* BUG: never scans or writes the fleet cells */ }
  loc_1597_noUpdate(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch the dropped fleet update");
  assert.notEqual(o.mem.read8(FLEET_MOVE_DIR), c.mem.read8(FLEET_MOVE_DIR), "the twin leaves FLEET_MOVE_DIR unflipped");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM);
  m.regs.sp = 0x2400;
  m.mem.write16(0x2400, 0x190d); // a real caller-return word (resolveShotAndFleetEdge's continuation) for the seam
  m.mem.write8(FLEET_MOVE_DIR, 0x00);
  for (let i = 0; i < 0x17; i++) m.mem.write8(SCAN_LEFT + i, 0); // all-zero -> bail path
  m.io.setInte(false);
  const r = seamPlaceable(withOmittedRet, reverseFleetAtEdge, TARGET, m);
  assert.equal(r.placeable, true, `reverseFleetAtEdge must be seam-placeable; got: ${r.error}`);
});
