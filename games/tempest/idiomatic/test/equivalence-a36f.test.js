// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for retireSpawnedObject (ROM 0xa36f-0xa38d) -- fires the sound gate (gateSound1f), stages the slot's
// source/target ($02db,y -> $29 and $02b5,y -> $2d), re-inserts a zeroed object (insertTimedObjectOfType with A=0), clears
// $02db,y, decrements $a6, and flags $02f2,x. The idiomatic side dissolves the two jsr into direct
// gateSound1f/insertTimedObjectOfType calls, passing the entry X/Y (preserved across both callees). Live-out is memory only
// (A at RTS incidental; X/Y restored to entry), so each arm compares RAM (minus stack scratch below the entry SP) and X/Y.
// Run: node --test games/tempest/idiomatic/test/equivalence-a36f.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_a36f } from "../../translated/loc_a36f.js";
import { retireSpawnedObject } from "../retireSpawnedObject.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { u16 } from "../../../../core/int.js";
import { gateSound1f } from "../gateSound1f.js";
import { insertTimedObjectOfType } from "../insertTimedObjectOfType.js";
import { STATUS_FLAGS, loc_29, COORD_LIST_PTR_HI, ACTIVE_ENEMY_COUNT, loc_2db, loc_2b5, HIT_TALLY } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xa36f;
const oracle = atEntry(loc_a36f);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xa36f dispatches -- retireSpawnedObject == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); retireSpawnedObject(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.x, o.regs.x, "X preserved");
    assert.equal(c.regs.y, o.regs.y, "Y preserved");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

function seed(m) {
  m.regs.x = 0x04; m.regs.y = 0x02;  // Y indexes the slot; X flags the lane
  m.mem.write8(STATUS_FLAGS, 0x80);         // sound enable high bit so the gate runs its body
  m.mem.write8(u16(loc_2db + 0x02), 0x5a); // source at slot Y -> $29
  m.mem.write8(u16(loc_2b5 + 0x02), 0x6b); // target at slot Y -> $2d
  m.mem.write8(ACTIVE_ENEMY_COUNT, 0x09);        // live count to decrement
  m.mem.write8(u16(HIT_TALLY + 0x04), 0x11); // dirty lane flag sentinel
}

test("CRAFTED: sound gate, stage, re-insert, clear and flag -- RAM equal and X/Y preserved", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); retireSpawnedObject(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after retire");
  assert.equal(c.regs.x, o.regs.x, "X preserved");
  assert.equal(c.regs.y, o.regs.y, "Y preserved");
  assert.equal(c.mem.read8(u16(loc_2db + 0x02)), 0x00, "slot cleared");
  assert.equal(c.mem.read8(ACTIVE_ENEMY_COUNT), 0x08, "live count decremented");
  assert.equal(c.mem.read8(u16(HIT_TALLY + 0x04)), 0xff, "lane flagged");
});

test("TEETH: a twin that indexes with a stale Y (and lane X) diverges in RAM", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  const broken = (m, x = m.regs.x, y = m.regs.y) => {
    const { mem8 } = m;
    gateSound1f(m, x, y);
    mem8[loc_29] = mem8[u16(loc_2db + 0x00)]; // BUG: stale Y=0 index
    mem8[COORD_LIST_PTR_HI] = mem8[u16(loc_2b5 + 0x00)];
    insertTimedObjectOfType(m, 0x00, x, y);
    mem8[u16(loc_2db + 0x00)] = 0x00;         // BUG: clears wrong slot
    mem8[ACTIVE_ENEMY_COUNT]--;
    mem8[u16(HIT_TALLY + 0x00)] = 0xff;         // BUG: flags wrong lane
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the stale index");
});

test("SP-TOOTH: the omitted-ret caller (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, retireSpawnedObject, TARGET, m);
  assert.equal(r.placeable, true, `retireSpawnedObject must be seam-placeable; got: ${r.error}`);
});
