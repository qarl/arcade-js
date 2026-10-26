// SPDX-License-Identifier: GPL-3.0-only
// also gates: 0xa347 insertObjectHeadTag7
// Memory-equivalence for insertObjectHeadTag9 / insertObjectHeadTag7 -- two seed entries that stamp the head flag ($013b)
// with a per-entry tag (0x09 / 0x07), then tail-JMP into the shared insert (insertType1WithHeadFlag). Each side
// dissolves the jmp into a direct insertType1WithHeadFlag call, passing the entry X/Y (preserved across the callee).
// Output is RAM, so each arm compares the RAM diff (minus the dead stack) and checks X/Y preserved.
// Run: node --test games/tempest/idiomatic/test/equivalence-a343.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_a343, loc_a347 } from "../../translated/loc_a343.js";
import { insertObjectHeadTag9, insertObjectHeadTag7 } from "../insertObjectHeadTag9.js";
import { insertType1WithHeadFlag } from "../primeTopPriorityObject.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { STATUS_FLAGS, COORD_LIST_PTR_LO, PLAYER_SEGMENT, PLAYER_SHOT_DEPTH, OBJECT_ANIM_PHASE, OBJECT_ANIM_TIMER } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) { const u = new URL(name, ROM_DIR); return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined; }
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const oracle343 = atEntry(loc_a343);
const oracle347 = atEntry(loc_a347);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(target, oracleFn, K, maxFrames) {
  const caps = [];
  const snap = new Map([[target, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracleFn(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps */ }
  return caps;
}
const CAPS343 = ROM_PRESENT ? captureDispatches(0xa343, oracle343, 16, 2000) : [];
const CAPS347 = ROM_PRESENT ? captureDispatches(0xa347, oracle347, 16, 2000) : [];

function seed(m) {
  m.regs.x = 0x05; m.regs.y = 0x03;
  m.mem.write8(STATUS_FLAGS, 0x80);
  m.mem.write8(PLAYER_SHOT_DEPTH, 0x77);
  m.mem.write8(PLAYER_SEGMENT, 0x88);
}

test("CAPTURE: real 0xa343 dispatches -- insertObjectHeadTag9 == oracle in RAM (-stack)", () => {
  for (const cap of CAPS343) {
    const o = cap.clone(), c = cap.clone();
    oracle343(o); insertObjectHeadTag9(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.x, o.regs.x, "X preserved");
    assert.equal(c.regs.y, o.regs.y, "Y preserved");
  }
  console.log(`  CAPTURE a343: ${CAPS343.length} dispatch(es) checked`);
});

test("CAPTURE: real 0xa347 dispatches -- insertObjectHeadTag7 == oracle in RAM (-stack)", () => {
  for (const cap of CAPS347) {
    const o = cap.clone(), c = cap.clone();
    oracle347(o); insertObjectHeadTag7(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE a347: ${CAPS347.length} dispatch(es) checked`);
});

test("CRAFTED: a343 stamps $013b=0x09, a347 stamps 0x07 -- RAM equal, X/Y preserved", () => {
  for (const [name, oracleFn, idFn, tag] of [
    ["a343", oracle343, insertObjectHeadTag9, 0x09],
    ["a347", oracle347, insertObjectHeadTag7, 0x07],
  ]) {
    const o = new Machine(ROM, OPTS); seed(o);
    const c = new Machine(ROM, OPTS); seed(c);
    oracleFn(o); idFn(c);
    assert.equal(ramDiff(o, c), null, `${name} RAM equal`);
    assert.equal(c.regs.x, o.regs.x, `${name} X preserved`);
    assert.equal(c.regs.y, o.regs.y, `${name} Y preserved`);
    assert.equal(c.mem.read8(OBJECT_ANIM_PHASE), tag, `${name} head flag`);
    assert.equal(c.mem.read8(COORD_LIST_PTR_LO), 0x01, `${name} $2c type-1`);
    assert.equal(c.mem.read8(OBJECT_ANIM_TIMER), 0x01, `${name} $013c ready flag`);
  }
});

test("TEETH: a twin that stamps the wrong head-flag tag diverges in RAM", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle343(o);
  const broken = (m, x = m.regs.x, y = m.regs.y) => insertType1WithHeadFlag(m, 0x07, x, y); // BUG: 0x07 not 0x09
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the wrong head-flag tag");
});

test("SP-TOOTH: the omitted-ret tail-callers (moved 0) are seam-placeable", () => {
  for (const [target, idFn] of [[0xa343, insertObjectHeadTag9], [0xa347, insertObjectHeadTag7]]) {
    const m = new Machine(ROM, OPTS);
    m.regs.s = 0xfb;
    m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
    const r = seamPlaceable(withOmittedRet, idFn, target, m);
    assert.equal(r.placeable, true, `${target.toString(16)} must be seam-placeable; got: ${r.error}`);
  }
});
