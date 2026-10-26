// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for insertType1WithHeadFlag (ROM 0xa34d) -- the $013b-seed mid-entry: stores the caller's A into the
// head flag $013b, then falls into the shared insert tail with a fixed type byte 0x01 (so $2c = 0x01),
// copying $0202->$29 / $0200->$2d, firing the sound gate and table insert with the entry X/Y, and raising
// the ready flags. The idiomatic side dissolves the fall-through into a direct insertObjectAndSignalReady call. Live-out is
// memory (X/Y preserved); each arm compares RAM (dumpState minus stack scratch below the entry SP) and checks X/Y unchanged.
// Run: node --test games/tempest/idiomatic/test/equivalence-a34d.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_a34d } from "../../translated/loc_a34b.js";
import { insertType1WithHeadFlag } from "../primeTopPriorityObject.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { STATUS_FLAGS, COORD_LIST_PTR_LO, OBJECT_ANIM_PHASE, OBJECT_ANIM_TIMER, PLAYER_SEGMENT, PLAYER_FINE_ANGLE, PLAYER_SHOT_DEPTH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xa34d;
const oracle = atEntry(loc_a34d);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xa34d dispatches -- insertType1WithHeadFlag == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); insertType1WithHeadFlag(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.x, o.regs.x, "X preserved");
    assert.equal(c.regs.y, o.regs.y, "Y preserved");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

function seed(m, a) {
  m.regs.a = a; m.regs.x = 0x05; m.regs.y = 0x03; // A = head-flag value; X/Y bridge to the callees
  m.mem.write8(STATUS_FLAGS, 0x80);
  m.mem.write8(PLAYER_SHOT_DEPTH, 0x77);
  m.mem.write8(PLAYER_SEGMENT, 0x88);
}

test("CRAFTED: head flag seeded, then the type-1 insert runs -- RAM equal and X/Y preserved", () => {
  const o = new Machine(ROM, OPTS); seed(o, 0x09);
  const c = new Machine(ROM, OPTS); seed(c, 0x09);
  oracle(o); insertType1WithHeadFlag(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after setup");
  assert.equal(c.regs.x, o.regs.x, "X preserved");
  assert.equal(c.regs.y, o.regs.y, "Y preserved");
  assert.equal(c.mem.read8(OBJECT_ANIM_PHASE), 0x09, "$013b = A (head flag)");
  assert.equal(c.mem.read8(COORD_LIST_PTR_LO), 0x01, "$2c = 0x01 (fixed type)");
  assert.equal(c.mem.read8(PLAYER_FINE_ANGLE), 0x81, "$0201 ready flag");
  assert.equal(c.mem.read8(OBJECT_ANIM_TIMER), 0x01, "$013c ready flag");
});

test("TEETH: a twin that stores the wrong head flag / skips the tail diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seed(o, 0x09);
  const c = new Machine(ROM, OPTS); seed(c, 0x09);
  oracle(o);
  const broken = (m, a = m.regs.a) => { m.mem8[OBJECT_ANIM_PHASE] = (a ^ 0xff); /* BUG: wrong head flag + skips insert */ };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the wrong head flag / skipped tail");
});
