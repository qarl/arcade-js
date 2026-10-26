// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for insertObjectAndSignalReady (ROM 0xa352) -- the shared object-insert tail reached with the caller's
// A as the type byte: stores A->$2c, copies $0202->$29 and $0200->$2d, fires the sound gate (gateSound5f) and
// the table insert (insertTimedObject) with the entry X/Y, then raises the ready flags $0201=0x81 / $013c=1. The
// idiomatic side dissolves the two jsr into direct calls. Live-out is memory (X/Y preserved across both
// callees); each arm compares RAM (dumpState minus stack scratch below the entry SP) and checks X/Y unchanged.
// Run: node --test games/tempest/idiomatic/test/equivalence-a352.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_a352 } from "../../translated/loc_a34b.js";
import { insertObjectAndSignalReady } from "../primeTopPriorityObject.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { STATUS_FLAGS, loc_29, COORD_LIST_PTR_LO, COORD_LIST_PTR_HI, OBJECT_ANIM_TIMER, PLAYER_SEGMENT, PLAYER_FINE_ANGLE, PLAYER_SHOT_DEPTH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xa352;
const oracle = atEntry(loc_a352);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xa352 dispatches -- insertObjectAndSignalReady == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); insertObjectAndSignalReady(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.x, o.regs.x, "X preserved");
    assert.equal(c.regs.y, o.regs.y, "Y preserved");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

function seed(m, a) {
  m.regs.a = a; m.regs.x = 0x05; m.regs.y = 0x03; // A = type byte; X/Y bridge to $31/$32 + $35/$36
  m.mem.write8(STATUS_FLAGS, 0x80);   // sound enable high bit set so the gate runs its body
  m.mem.write8(PLAYER_SHOT_DEPTH, 0x77); // source byte -> $29
  m.mem.write8(PLAYER_SEGMENT, 0x88); // target byte -> $2d
}

test("CRAFTED: type byte seated, gate + insert run -- RAM equal and X/Y preserved", () => {
  const o = new Machine(ROM, OPTS); seed(o, 0x05);
  const c = new Machine(ROM, OPTS); seed(c, 0x05);
  oracle(o); insertObjectAndSignalReady(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after setup");
  assert.equal(c.regs.x, o.regs.x, "X preserved");
  assert.equal(c.regs.y, o.regs.y, "Y preserved");
  assert.equal(c.mem.read8(COORD_LIST_PTR_LO), 0x05, "$2c = A (type byte)");
  assert.equal(c.mem.read8(loc_29), 0x77, "$29 = $0202 source");
  assert.equal(c.mem.read8(COORD_LIST_PTR_HI), 0x88, "$2d = $0200 target");
  assert.equal(c.mem.read8(PLAYER_FINE_ANGLE), 0x81, "$0201 ready flag");
  assert.equal(c.mem.read8(OBJECT_ANIM_TIMER), 0x01, "$013c ready flag");
});

test("TEETH: a twin that seats the wrong type byte into $2c diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seed(o, 0x05);
  const c = new Machine(ROM, OPTS); seed(c, 0x05);
  oracle(o);
  const broken = (m, a = m.regs.a) => { m.mem8[COORD_LIST_PTR_LO] = (a + 1) & 0xff; /* BUG: wrong type + skips the rest */ };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the wrong type byte / skipped body");
});
