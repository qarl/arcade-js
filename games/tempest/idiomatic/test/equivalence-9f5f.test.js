// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for maybeFireEnemyStep (per-slot fire gate). The oracle m.calls the translated
// step routines; the idiomatic calls their idiomatic twins (flipEnemyLaneRandomSide / flipEnemyLaneTowardTarget) directly.
// Both are memory-equivalent, so the contract is RAM (dumpState, minus stack scratch below the entry SP). The
// slot index X is a register input (default from m.regs.x on both sides). POKEY RANDOM
// ($60da here, $60ca inside the callees) is deterministic on identical fresh machine state,
// so CRAFTED arms run twin fresh Machines; CAPTURE replays real dispatch clones.
// Run: node --test games/tempest/idiomatic/test/equivalence-9f5f.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_9f5f } from "../../translated/loc_9f5f.js";
import { maybeFireEnemyStep } from "../maybeFireEnemyStep.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { ENEMY_DEPTH, ENEMY_FIRE_THRESHOLD, ENEMY_FIRE_SELECT } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x9f5f;
const oracle = atEntry(loc_9f5f);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0x9f5f dispatches -- maybeFireEnemyStep == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); maybeFireEnemyStep(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Seed the gate to pass for slot x with a chosen $0159 bit6, then compare RAM after the
// dissolved call runs on twin fresh machines.
function fireArm(x, flag159) {
  const seed = (m) => {
    m.regs.x = x;
    m.mem.write8((ENEMY_DEPTH + x) & 0xffff, 0x20); // fire bit set
    m.mem.write8(ENEMY_FIRE_THRESHOLD, 0x00);                // threshold 0 -> random passes
    m.mem.write8(ENEMY_FIRE_SELECT, flag159);
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); maybeFireEnemyStep(c);
  return ramDiff(o, c);
}

test("CRAFTED: bit6 clear -> flipEnemyLaneRandomSide path (even slot), RAM equal", () => {
  assert.equal(fireArm(0x04, 0x00), null, "flipEnemyLaneRandomSide dissolve must match oracle");
});

test("CRAFTED: bit6 set + odd slot -> flipEnemyLaneTowardTarget path, RAM equal", () => {
  assert.equal(fireArm(0x05, 0x40), null, "flipEnemyLaneTowardTarget dissolve must match oracle");
});

test("CRAFTED: fire bit clear -> both no-op, RAM equal", () => {
  const seed = (m) => {
    m.regs.x = 0x03;
    m.mem.write8((ENEMY_DEPTH + 0x03) & 0xffff, 0x00); // fire bit clear
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); maybeFireEnemyStep(c);
  assert.equal(ramDiff(o, c), null, "gated-off path leaves RAM untouched on both");
});

test("TEETH: a twin that skips the dissolved fire call diverges from the oracle", () => {
  const x = 0x04;
  const seed = (m) => {
    m.regs.x = x;
    m.mem.write8((ENEMY_DEPTH + x) & 0xffff, 0x20);
    m.mem.write8(ENEMY_FIRE_THRESHOLD, 0x00);
    m.mem.write8(ENEMY_FIRE_SELECT, 0x00);
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  const broken = (m) => { /* BUG: gate passes but never runs the step call */ };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "RAM diff FAILED to catch the skipped fire step");
});
