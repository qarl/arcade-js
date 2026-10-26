// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for stepSpikeTableCollapse (ROM 0xa7d2-0xa830) -- remap the 8-entry $03fe table against the $0115
// reference, OR-folding the results into $29; if every entry becomes zero, $0115 is cleared. No-op when
// $0115 starts zero. Each side runs on a clone and the contract is RAM (dumpState, minus stack scratch below the entry SP)
// plus the returned exit Y, which dispatchFramePhaseHandler hands to the mode handler. A leaf: the module
// omits the ROM ret and the seam completes it, so the arms compare RAM (-stack) and Y, NOT pc/SP.
// Run: node --test games/tempest/idiomatic/test/equivalence-a7d2.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_a7d2 } from "../../translated/loc_a7d2.js";
import { stepSpikeTableCollapse } from "../stepSpikeTableCollapse.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { loc_29, SLOT_LOOP_INDEX, SPIKE_TABLE_GUARD, loc_3fe } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xa7d2;
const oracle = atEntry(loc_a7d2);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

const seedTable = (m, ref, vals) => {
  m.mem.write8(SPIKE_TABLE_GUARD, ref);
  for (let i = 0; i < 8; i++) m.mem.write8(loc_3fe + i, vals[i]);
  m.mem.write8(loc_29, 0x33); // dirty accumulator
};

test("CAPTURE: real 0xa7d2 dispatches -- stepSpikeTableCollapse == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); const y = stepSpikeTableCollapse(c, c.regs.y);
    assert.equal(ramDiff(o, c), null);
    assert.equal(y, o.regs.y, "returned exit Y = the oracle's Y");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: negative reference -- shrink/rail/neighbour mix leaves a nonzero fold (ref kept)", () => {
  const vals = [0x30, 0x00, 0x50, 0x05, 0x00, 0xe0, 0x10, 0x00];
  const o = new Machine(ROM, OPTS); seedTable(o, 0x80, vals);
  const c = new Machine(ROM, OPTS); seedTable(c, 0x80, vals);
  oracle(o); assert.equal(stepSpikeTableCollapse(c, c.regs.y), o.regs.y, "returned exit Y = the oracle's Y");
  assert.equal(ramDiff(o, c), null, "RAM equal after remap");
  assert.equal(c.mem.read8(SLOT_LOOP_INDEX), 0xff, "$37 loop counter ran to 0xff");
  assert.equal(c.mem.read8(SPIKE_TABLE_GUARD), 0x80, "$0115 kept (fold was nonzero)");
});

test("CRAFTED: positive reference, all mid entries -> every result 0 -> $0115 cleared", () => {
  const vals = [0x03, 0x05, 0x02, 0x06, 0x04, 0x01, 0x07, 0x03];
  const o = new Machine(ROM, OPTS); seedTable(o, 0x40, vals);
  const c = new Machine(ROM, OPTS); seedTable(c, 0x40, vals);
  oracle(o); assert.equal(stepSpikeTableCollapse(c, c.regs.y), o.regs.y, "returned exit Y = the oracle's Y");
  assert.equal(ramDiff(o, c), null, "RAM equal after remap");
  assert.equal(c.mem.read8(loc_29), 0x00, "fold is zero");
  assert.equal(c.mem.read8(SPIKE_TABLE_GUARD), 0x00, "$0115 cleared");
});

test("CRAFTED: positive reference, empty lowest slot -> exit Y = the guard (0x40), not the entry Y", () => {
  const vals = [0x00, 0x40, 0x40, 0x40, 0x40, 0x40, 0x40, 0x40];
  const o = new Machine(ROM, OPTS); seedTable(o, 0x40, vals); o.regs.y = 0x5a;
  const c = new Machine(ROM, OPTS); seedTable(c, 0x40, vals); c.regs.y = 0x33; // poisoned
  oracle(o);
  assert.equal(o.regs.y, 0x40, "control: the oracle loaded the guard into Y on the empty slot");
  assert.equal(stepSpikeTableCollapse(c, 0x5a), 0x40, "returned exit Y = the oracle's Y");
  assert.equal(ramDiff(o, c), null, "RAM equal after remap");
});

test("CRAFTED: zero reference is a no-op (RAM untouched)", () => {
  const vals = [0x30, 0x11, 0x50, 0x05, 0x22, 0xe0, 0x10, 0x77];
  const o = new Machine(ROM, OPTS); seedTable(o, 0x00, vals);
  const c = new Machine(ROM, OPTS); seedTable(c, 0x00, vals);
  oracle(o); assert.equal(stepSpikeTableCollapse(c, c.regs.y), o.regs.y, "returned exit Y = the oracle's Y");
  assert.equal(ramDiff(o, c), null, "RAM equal (both no-op)");
  assert.equal(c.mem.read8(loc_29), 0x33, "accumulator untouched");
});

test("TEETH: a twin that never clears $0115 on an all-zero fold diverges", () => {
  const vals = [0x03, 0x05, 0x02, 0x06, 0x04, 0x01, 0x07, 0x03];
  const o = new Machine(ROM, OPTS); seedTable(o, 0x40, vals);
  const c = new Machine(ROM, OPTS); seedTable(c, 0x40, vals);
  oracle(o);
  const brokenA7d2 = (m) => {
    const mem8 = m.mem8;
    if (mem8[SPIKE_TABLE_GUARD] === 0) return;
    let acc = 0;
    for (let x = 7; x >= 0; x--) {
      const entry = mem8[(loc_3fe + x) & 0xffff];
      let result;
      if (entry === 0) result = (mem8[SPIKE_TABLE_GUARD] & 0x80) ? 0xf0 : 0; // (neighbour path elided for the mutation)
      else if (entry >= 0x17) result = entry - 7;
      else result = mem8[SPIKE_TABLE_GUARD] & 0x80 ? 0xf0 : 0;
      mem8[(loc_3fe + x) & 0xffff] = result;
      acc |= result;
    }
    mem8[loc_29] = acc;
    mem8[SLOT_LOOP_INDEX] = 0xff;
    // BUG: never clears $0115 even when acc === 0
  };
  brokenA7d2(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the missing $0115 clear");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, stepSpikeTableCollapse, TARGET, m);
  assert.equal(r.placeable, true, `stepSpikeTableCollapse must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
