// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for resolveShotAndFleetEdge (ROM 0x190a) -- run resolvePlayerShotHit (state-2/landed-prize handler, dissolved to
// a direct call) then tail into reverseFleetAtEdge (fleet edge/direction update, same-batch KEPT m.call -- the LEAD
// dissolves it in reconcile). Live-out (DERIVED FROM THE ORACLE): RAM only -- both callers (loc_081f,
// updateFleetAndDrawCopyright) run straight into the next call and never read its registers/carry. Dispatching tail -> SP-tooth.
// The oracle's internal call return-words sit in dead stack scratch (excluded).
// Run: node --test games/invaders/idiomatic/test/equivalence-190a.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_190a as oracleBody } from "../../translated/loc_190a.js";
import { resolveShotAndFleetEdge } from "../resolveShotAndFleetEdge.js";
import { resolvePlayerShotHit } from "../resolvePlayerShotHit.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable, deadStackBelow } from "../../../../core/equivalence.js";
import { entered, entryFloor } from "./_liveStack.js";
import { STACK_SCRATCH, FLEET_MOVE_DIR, PLAYER_SHOT_STATUS } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x190a;
const SCAN_RIGHT = 0x2524, SCAN_LEFT = 0x3ea4, CELL_200E = 0x200e;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const ramDiff = (ma, mb, excl = deadStackBelow(STACK_SCRATCH, entryFloor(ma, mb))) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), excl);

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(24, 2000) : [];

test("CAPTURE: real 0x190a dispatches -- resolveShotAndFleetEdge == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const sp = cap.regs.sp;
    const excl = (a) => a != null && a >= sp - 0x40 && a < sp; // both sides run translated reverseFleetAtEdge (pushes)
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); resolveShotAndFleetEdge(c);
    assert.equal(ramDiff(o, c, excl), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: with resolvePlayerShotHit idle, sequences into the fleet update (reverseFleetAtEdge)", () => {
  const cases = [
    { dir: 0x01, found: true, scan: SCAN_RIGHT, wantDir: 0x00 },
    { dir: 0x00, found: true, scan: SCAN_LEFT, wantDir: 0x01 },
    { dir: 0x01, found: false, scan: SCAN_RIGHT, wantDir: 0x01 },
  ];
  for (const t of cases) {
    const seed = (m) => {
      m.regs.sp = 0x2400; m.io.setInte(false);
      m.mem.write8(PLAYER_SHOT_STATUS, 0x00); // resolvePlayerShotHit idles (state != 2/5)
      m.mem.write8(FLEET_MOVE_DIR, t.dir);
      m.mem.write8(CELL_200E, 0x7c);
      for (let i = 0; i < 0x17; i++) m.mem.write8(t.scan + i, 0);
      if (t.found) m.mem.write8(t.scan + 0x05, 0x40);
    };
    const o = new Machine(ROM); seed(o);
    const c = new Machine(ROM); seed(c);
    oracle(o); resolveShotAndFleetEdge(c);
    const tag = `dir=${hx(t.dir)} found=${t.found}`;
    assert.equal(ramDiff(o, c), null, tag);
    assert.equal(c.mem.read8(FLEET_MOVE_DIR), t.wantDir, `fleet update applied: ${tag}`);
  }
});

test("TEETH: a twin that drops the reverseFleetAtEdge tail leaves the fleet cells unchanged", () => {
  const seed = (m) => {
    m.regs.sp = 0x2400; m.io.setInte(false);
    m.mem.write8(PLAYER_SHOT_STATUS, 0x00);
    m.mem.write8(FLEET_MOVE_DIR, 0x01);
    m.mem.write8(CELL_200E, 0x7c);
    for (let i = 0; i < 0x17; i++) m.mem.write8(SCAN_RIGHT + i, 0);
    m.mem.write8(SCAN_RIGHT + 0x05, 0x40);
  };
  const o = new Machine(ROM); seed(o);
  const c = new Machine(ROM); seed(c);
  oracle(o);
  function resolveShotAndFleetEdge_noTail(m) { resolvePlayerShotHit(m); /* BUG: drops the reverseFleetAtEdge fleet-update tail */ }
  resolveShotAndFleetEdge_noTail(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch the dropped fleet-update tail");
  assert.notEqual(o.mem.read8(FLEET_MOVE_DIR), c.mem.read8(FLEET_MOVE_DIR), "the twin leaves FLEET_MOVE_DIR unflipped");
});

test("SP-TOOTH: the dispatching tail (moved +2, pc on the caller slot) is seam-placeable", () => {
  const m = new Machine(ROM);
  m.regs.sp = 0x2400;
  m.mem.write16(0x2400, 0x0825); // a real caller-return word (loc_081f's continuation) for the seam
  m.mem.write8(PLAYER_SHOT_STATUS, 0x00);
  m.mem.write8(FLEET_MOVE_DIR, 0x00);
  for (let i = 0; i < 0x17; i++) m.mem.write8(SCAN_LEFT + i, 0); // all-zero -> reverseFleetAtEdge bails, rets clean
  m.io.setInte(false);
  const r = seamPlaceable(withOmittedRet, resolveShotAndFleetEdge, TARGET, m);
  assert.equal(r.placeable, true, `resolveShotAndFleetEdge must be seam-placeable; got: ${r.error}`);
});
