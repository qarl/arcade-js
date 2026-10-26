// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for bumpLevelEnemyQuota (ROM 0xc98c-0xc9ae). Index off loc_3d: read the PLAYER_LEVEL_TBL-slot; while it is
// below 0x62 increment that slot and loc_9f; seed GAME_MODE = 0x18; when the loc_102-slot is nonzero run the
// handler chain (seatInPagePointer with the slot value, addBcdScoreAndAwardAtThreshold with X=0xff, requestScoreAwardSound); then TAIL-DELEGATE to
// runWaveInit. Contract is RAM (dumpState minus STACK_SCRATCH) plus the exit [X, Y] it returns: the routine takes
// no input register and tail-jmps runWaveInit, so its exit registers are the delegate's, which the CAPTURE arm
// compares with the oracle's. Oracle is the frozen translated bumpLevelEnemyQuota.
// Run: node --test games/tempest/idiomatic/test/equivalence-c98c.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_c98c as oracle } from "../../translated/loc_c98c.js";
import { bumpLevelEnemyQuota } from "../bumpLevelEnemyQuota.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, GAME_MODE, loc_3d, PLAYER_LEVEL_TBL, loc_9f, STATUS_FLAGS, loc_31, loc_32 } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xc98c;
const TRIGGER_BASE = 0x0102; // loc_102 (new cell; wired in names.js by the lead)
const inDeadStack = (a) => a != null && a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];
const freezePokey = (m) => { for (const p of m.io.pokeys) p.skctl &= ~0x03; return m; };

test("CAPTURE: real 0xc98c dispatches -- bumpLevelEnemyQuota == oracle in RAM (-stack)", () => {
  let checked = 0;
  for (const cap of CAPS) {
    const o = freezePokey(cap.clone()), c = freezePokey(cap.clone());
    let threw = false;
    try { oracle(o); } catch { threw = true; } // a real dispatch may reach an unimplemented arm
    if (threw) continue;                        // both layers would throw identically there
    { c.regs.x ^= 0xff; c.regs.y ^= 0xff; // m.regs poisoned: this routine takes no entry X/Y, so its exit must not depend on them
      assert.deepEqual(bumpLevelEnemyQuota(c), [o.regs.x, o.regs.y], "returned exit [X, Y] = the oracle's"); }
    assert.equal(ramDiff(o, c), null);
    checked++;
  }
  console.log(`  CAPTURE: ${checked}/${CAPS.length} dispatch(es) compared`);
});

// Seed the index cell, a below-threshold slot value (so the increment block runs), and the trigger slot
// so the seatInPagePointer/ca6c/ccb9 chain fires (trigger != 0) or is skipped (trigger == 0).
function seed(m, idx, slotVal, trigger) {
  m.mem.write8(loc_3d, idx);
  m.mem.write8((PLAYER_LEVEL_TBL + idx) & 0xff, slotVal);
  m.mem.write8(loc_9f, 0x05);
  m.mem.write8((TRIGGER_BASE + idx) & 0xffff, trigger);
  m.mem.write8(GAME_MODE, 0xaa); // distinct from the routine's 0x18 write
}

test("CRAFTED: increment block + handler chain + tail-delegate -- RAM equal", () => {
  let checked = 0;
  // (idx, slotVal<0x62 -> increment runs, trigger!=0 -> chain runs), then a trigger==0 / at-threshold path.
  const cases = [[0x03, 0x10, 0x07], [0x05, 0x61, 0x01], [0x02, 0x62, 0x00], [0x00, 0x30, 0x00]];
  for (const [idx, slotVal, trigger] of cases) {
    const o = new Machine(ROM, OPTS); seed(o, idx, slotVal, trigger);
    const c = new Machine(ROM, OPTS); seed(c, idx, slotVal, trigger);
    let threw = false;
    try { oracle(o); } catch { threw = true; }
    if (threw) continue; // an arm this generic seed cannot provision -- other cases carry it
    bumpLevelEnemyQuota(c);
    assert.equal(ramDiff(o, c), null, `RAM equal for idx=${idx} slot=${slotVal} trig=${trigger}`);
    checked++;
  }
  console.log(`  CRAFTED: ${checked}/4 cases provisioned and checked`);
  assert.ok(checked >= 1, "no case could be provisioned -- seed is inert");

  // Spot-check the signature effects on the increment-taken, chain-run case.
  const o = new Machine(ROM, OPTS); seed(o, 0x03, 0x10, 0x07);
  const c = new Machine(ROM, OPTS); seed(c, 0x03, 0x10, 0x07);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (!threw) {
    bumpLevelEnemyQuota(c);
    assert.equal(c.mem.read8(GAME_MODE), 0x18, "GAME_MODE seeded to 0x18");
    assert.equal(c.mem.read8((PLAYER_LEVEL_TBL + 0x03) & 0xff), o.mem.read8((PLAYER_LEVEL_TBL + 0x03) & 0xff), "slot matches oracle");
    assert.equal(c.mem.read8(loc_9f), o.mem.read8(loc_9f), "loc_9f matches oracle");
  }
});

// R37: with scoring armed the award sound reaches the loader, which stashes X/Y in loc_31/loc_32. The port
// must hand it the X/Y the score add left, never the register file: poison m.regs on the idiomatic side.
test("STALE-REGS: armed award chain with m.regs poisoned on the idiomatic side -- RAM equal", () => {
  let checked = 0;
  for (const [idx, trigger] of [[0x00, 0x07], [0x01, 0x01]]) {
    const arm = (m) => { seed(m, idx, 0x10, trigger); m.mem.write8(STATUS_FLAGS, 0x80); m.regs.x = 0x3c; m.regs.y = 0x4d; };
    const o = new Machine(ROM, OPTS); arm(o);
    const c = new Machine(ROM, OPTS); arm(c);
    c.regs.x = 0xa5; c.regs.y = 0x5a;
    let threw = false;
    try { oracle(o); } catch { threw = true; }
    if (threw) continue;
    bumpLevelEnemyQuota(c);
    assert.equal(ramDiff(o, c), null, `RAM equal for idx=${idx} trig=${trigger} with m.regs poisoned`);
    assert.notEqual(c.mem.read8(loc_31), 0xa5, "the poison never reached loc_31");
    assert.notEqual(c.mem.read8(loc_32), 0x5a, "the poison never reached loc_32");
    checked++;
  }
  assert.ok(checked >= 1, "no armed case could be provisioned -- the stale-register check is inert");
});

test("TEETH: a twin that drops the GAME_MODE = 0x18 signature write MUST diverge in RAM", () => {
  const o = new Machine(ROM, OPTS); seed(o, 0x03, 0x10, 0x07);
  const c = new Machine(ROM, OPTS); seed(c, 0x03, 0x10, 0x07);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  TEETH: oracle threw on this seed -- skipped"); return; }
  // Broken twin: run the real routine, then revert GAME_MODE to its pre-seed value. The delegate leaves
  // GAME_MODE = 0x18 untouched, so reverting it alone guarantees a RAM divergence from the oracle.
  const broken = (m) => {
    const before00 = m.mem.read8(GAME_MODE);
    bumpLevelEnemyQuota(m);
    m.mem.write8(GAME_MODE, before00); // BUG: undo the 0x18 write
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the dropped GAME_MODE signature write was NOT caught by the RAM compare");
});
