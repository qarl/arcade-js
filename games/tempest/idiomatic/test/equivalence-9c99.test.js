// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for the loc_9c99 mid-entry (ROM 0x9c99) -- the SUBTRACT path of the tube-coordinate
// stepper: it subtracts the per-segment delta (low loc_160,y / high loc_165,y) from slot x's 16-bit
// coordinate (low loc_29f,x / high loc_2df,x, with borrow), and floors the high byte to 0xf2 when it
// underflows past 0xf0. Live-out is RAM (dumpState minus STACK_SCRATCH) plus A (the new high byte, or 0xf2),
// which its dispatcher caller reads back. Oracle is the frozen mid-entry export loc_9c99 in translated/loc_9c58.js.
// Run: node --test games/tempest/idiomatic/test/equivalence-9c99.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_9c99 as oracle } from "../../translated/loc_9c58.js";
import { loc_9c99 } from "../loc_9c58.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { u16 } from "../../../../core/int.js";
import { STACK_SCRATCH, loc_160, loc_165, loc_29f, loc_2df } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x9c99;
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

test("CAPTURE: real 0x9c99 dispatches -- loc_9c99 == oracle in RAM (-stack) and A", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); loc_9c99(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.a, o.regs.a, "A live-out matches");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

function seed(m, x, y, lo, hi, loD, hiD) {
  m.regs.x = x; m.regs.y = y; m.regs.a = 0x00;
  m.mem.write8(u16(loc_29f + x), lo);
  m.mem.write8(u16(loc_2df + x), hi);
  m.mem.write8(u16(loc_160 + y), loD);
  m.mem.write8(u16(loc_165 + y), hiD);
}

test("CRAFTED: plain subtract (no underflow) -- RAM and A equal, A is the new high byte", () => {
  const o = new Machine(ROM, OPTS); seed(o, 0x00, 0x02, 0x80, 0x50, 0x10, 0x10);
  const c = new Machine(ROM, OPTS); seed(c, 0x00, 0x02, 0x80, 0x50, 0x10, 0x10);
  oracle(o); loc_9c99(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the subtract");
  assert.equal(c.regs.a, o.regs.a, "A live-out matches");
  assert.equal(c.regs.a, 0x40, "A is the new high byte (0x50 - 0x10)");
  assert.equal(c.mem.read8(u16(loc_2df + 0x00)), 0x40, "high coordinate stepped down");
});

test("CRAFTED: underflow past 0xf0 floors the high byte to 0xf2 -- RAM and A equal", () => {
  const o = new Machine(ROM, OPTS); seed(o, 0x00, 0x02, 0x80, 0x05, 0x10, 0x10);
  const c = new Machine(ROM, OPTS); seed(c, 0x00, 0x02, 0x80, 0x05, 0x10, 0x10);
  oracle(o); loc_9c99(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the floored subtract");
  assert.equal(c.regs.a, o.regs.a, "A live-out matches");
  assert.equal(c.regs.a, 0xf2, "A is the floor value");
  assert.equal(c.mem.read8(u16(loc_2df + 0x00)), 0xf2, "high coordinate floored to 0xf2");
});

test("MUTATION: a twin that skips the 0xf2 floor diverges from the oracle in RAM", () => {
  const o = new Machine(ROM, OPTS); seed(o, 0x00, 0x02, 0x80, 0x05, 0x10, 0x10);
  const c = new Machine(ROM, OPTS); seed(c, 0x00, 0x02, 0x80, 0x05, 0x10, 0x10);
  oracle(o);
  const broken = (m, x = m.regs.x, y = m.regs.y) => {
    const { mem8 } = m;
    const loDiff = mem8[u16(loc_29f + x)] - mem8[u16(loc_160 + y)];
    mem8[u16(loc_29f + x)] = loDiff;
    const borrow = loDiff < 0 ? 1 : 0;
    mem8[u16(loc_2df + x)] = (mem8[u16(loc_2df + x)] - mem8[u16(loc_165 + y)] - borrow) & 0xff;
    // BUG: never floors the underflowed high byte to 0xf2
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped underflow floor");
});
