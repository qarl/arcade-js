// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for loc_a06f (ROM 0xa06f-0xa0f6) -- retires the enemy in slot Y: clears loc_2df,y,
// drops loc_109 (matched, lane != 4) or loc_108, drops the per-lane loc_142 counter (X parked in loc_35
// and restored, so exit X == entry X), then on (loc_28a,y & 3) != 0 seats loc_2b/loc_2a and spawns a
// replacement via loc_9b07 + loc_994d (twice). Live-out is RAM (dumpState minus STACK_SCRATCH) PLUS A, X,
// Y: both callees restore Y and X is saved/restored, so those match trivially; A is the anded gate value
// on the early return and otherwise whatever the final loc_994d leaves. Oracle is the frozen translated
// loc_a06f. Run: node --test games/tempest/idiomatic/test/equivalence-a06f.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_a06f as oracle } from "../../translated/loc_a06f.js";
import { loc_a06f } from "../loc_a06f.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { u16 } from "../../../../core/int.js";
import {
  STACK_SCRATCH,
  loc_29, loc_35, loc_2a, loc_2b, loc_2d, loc_108, loc_109, loc_10a, loc_10b,
  loc_111, loc_202, loc_283, loc_28a, loc_2b9, loc_2df, loc_142,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xa06f;
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

test("CAPTURE: real 0xa06f dispatches -- loc_a06f == oracle in RAM (-stack), A/X/Y", () => {
  let checked = 0;
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    let threw = false;
    try { oracle(o); } catch { threw = true; } // a real dispatch may route to an unimplemented list-setup arm
    if (threw) continue; // both layers would throw identically there; nothing to compare
    loc_a06f(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.a, o.regs.a, "A live-out matches");
    assert.equal(c.regs.x, o.regs.x, "X live-out matches");
    assert.equal(c.regs.y, o.regs.y, "Y live-out matches");
    checked++;
  }
  console.log(`  CAPTURE: ${checked}/${CAPS.length} dispatch(es) compared`);
});

// Seed a slot Y and the gate cells. The lane index that reaches loc_9a88 (via loc_9b07 when loc_29 >= 0x20)
// is kept to 0 -- gate 1 -> loc_2b = 0 -- so the oracle's dispatch resolves to loc_9a9d (arms 1 and 4 throw).
function seedDraw(m, y) {
  m.regs.y = y; m.regs.x = 0x7a;
  m.mem.write8(u16(loc_2df + y), 0x30); // slotVal -> loc_29 = 0x30 (>= 0x20 -> loc_9b07 dispatches loc_9a88)
  m.mem.write8(loc_202, 0x30);          // match -> take the loc_109 path (lane != 4 below)
  m.mem.write8(u16(loc_283 + y), 0x02); // lane 2 (!= 4): decrement loc_109, then loc_142[2]
  m.mem.write8(u16(loc_28a + y), 0x01); // gate 1 -> loc_2b = 0 (a safe list-setup index)
  m.mem.write8(u16(loc_2b9 + y), 0x05); // seat = (5 - 1) & 0x0f = 4
  m.mem.write8(loc_111, 0x00);          // bit7 clear -> no 0x0f snap
  m.mem.write8(loc_2d, 0x07);           // loc_10b = 7 - 1 = 6
  m.mem.write8(u16(loc_142 + 0x02), 0x05);
  m.mem.write8(loc_108, 0x40);
  m.mem.write8(loc_109, 0x20);
}

test("CRAFTED: draw path (gate != 0) spawns via loc_9b07 + loc_994d -- RAM and A/X/Y equal", () => {
  const Y = 0x02;
  const o = new Machine(ROM, OPTS); seedDraw(o, Y);
  const c = new Machine(ROM, OPTS); seedDraw(c, Y);
  oracle(o); loc_a06f(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the draw path");
  assert.equal(c.regs.a, o.regs.a, "A live-out matches");
  assert.equal(c.regs.x, o.regs.x, "X restored to the entry index");
  assert.equal(c.regs.x, 0x7a, "X is the saved caller index");
  assert.equal(c.regs.y, o.regs.y, "Y preserved across the callees");
  assert.equal(c.regs.y, Y, "Y is the entry slot index");
  assert.equal(c.mem.read8(u16(loc_2df + Y)), 0x00, "the slot was cleared");
});

// Seed the cleared/decrement path: gate 0 -> return after clearing the slot and dropping the counters.
function seedClear(m, y) {
  m.regs.y = y; m.regs.x = 0x7a;
  m.mem.write8(u16(loc_2df + y), 0x10);
  m.mem.write8(loc_202, 0x10);          // match
  m.mem.write8(u16(loc_283 + y), 0x03); // lane 3 (!= 4) -> loc_109 path, then loc_142[3]
  m.mem.write8(u16(loc_28a + y), 0x04); // (0x04 & 3) == 0 -> gate 0, early return
  m.mem.write8(loc_108, 0x40);
  m.mem.write8(loc_109, 0x20);
  m.mem.write8(u16(loc_142 + 0x03), 0x05);
}

test("CRAFTED: cleared path (gate == 0) drops loc_109/loc_142 and returns A=0 -- RAM and A/X/Y equal", () => {
  const Y = 0x02;
  const o = new Machine(ROM, OPTS); seedClear(o, Y);
  const c = new Machine(ROM, OPTS); seedClear(c, Y);
  oracle(o); loc_a06f(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the cleared path");
  assert.equal(c.regs.a, o.regs.a, "A live-out matches");
  assert.equal(c.regs.a, 0x00, "A is the anded gate value (0)");
  assert.equal(c.regs.x, o.regs.x, "X restored");
  assert.equal(c.regs.y, o.regs.y, "Y preserved");
  assert.equal(c.mem.read8(u16(loc_2df + Y)), 0x00, "the slot was cleared");
  assert.equal(c.mem.read8(loc_109), 0x1f, "loc_109 was decremented (matched, lane != 4)");
  assert.equal(c.mem.read8(loc_108), 0x40, "loc_108 untouched on the loc_109 path");
});

test("TEETH: a twin that drops the loc_142,x decrement MUST diverge in RAM", () => {
  const Y = 0x02;
  const o = new Machine(ROM, OPTS); seedClear(o, Y);
  const c = new Machine(ROM, OPTS); seedClear(c, Y);
  oracle(o);
  const broken = (m, y = m.regs.y) => {
    const { mem8 } = m;
    const slotVal = mem8[u16(loc_2df + y)];
    mem8[loc_29] = slotVal;
    let decTotal = true;
    if (slotVal === mem8[loc_202] && (mem8[u16(loc_283 + y)] & 0x07) !== 0x04) {
      mem8[loc_109] = mem8[loc_109] - 1;
      decTotal = false;
    }
    if (decTotal) mem8[loc_108] = mem8[loc_108] - 1;
    mem8[u16(loc_2df + y)] = 0x00;
    mem8[loc_35] = m.regs.x;
    // BUG: drops `mem8[u16(loc_142 + lane)] = mem8[u16(loc_142 + lane)] - 1;`
    const gate = mem8[u16(loc_28a + y)] & 0x03;
    return (m.regs.a = gate); // gate == 0 on this seed
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the dropped loc_142 decrement was NOT caught by the RAM compare");
  assert.equal(c.regs.a, o.regs.a, "the twin still matches in A (the defect is RAM-only)");
});
