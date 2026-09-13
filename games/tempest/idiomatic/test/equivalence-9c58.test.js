// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for loc_9c58 (ROM 0x9c58-0x9c62, the direction selector) -- reads the slot's segment
// (loc_283,x & 7) into Y, then delegates to the ADD path (loc_9c63) when loc_28a,x bit7 is clear or the
// SUBTRACT path (loc_9c99) when it is set. Live-out is RAM (dumpState minus STACK_SCRATCH) plus A/X/Y.
// X is the slot index throughout (never rewritten). Y is the segment index the selector seats (tay).
// A is the delegate's result. On the loc_9c63 -> loc_9d06 sub-path A and Y are INCIDENTAL (loc_9d06's own
// eq test declares A/X/Y incidental), so this compares A/Y only on dispatches that did NOT enter loc_9d06.
// Oracle is the frozen translated loc_9c58. Run: node --test games/tempest/idiomatic/test/equivalence-9c58.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_9c58 as oracle } from "../../translated/loc_9c58.js";
import { loc_9c58, loc_9c99 } from "../loc_9c58.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { u16 } from "../../../../core/int.js";
import {
  STACK_SCRATCH, loc_160, loc_165, loc_202, loc_283, loc_28a, loc_29f, loc_2df,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) { const u = new URL(name, ROM_DIR); return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined; }
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x9c58;
const inDeadStack = (a) => a != null && a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(24, 4000) : [];

test("CAPTURE: real 0x9c58 dispatches -- loc_9c58 == oracle in RAM (-stack), X always, A/Y off the 9d06 sub-path", () => {
  let withAY = 0, ram = 0, path9d06 = 0;
  for (const cap of CAPS) {
    // Run the oracle with a flag-wrapper on 0x9d06 so we can tell whether it entered that sub-call (where
    // A and Y are incidental). The clone shares the routines Map -- copy before wrapping so we don't mutate it.
    const o = cap.clone();
    o.routines = new Map(o.routines);
    let hit9d06 = false;
    const orig = o.routines.get(0x9d06);
    if (orig) o.routines.set(0x9d06, (mm, ...a) => { hit9d06 = true; return orig(mm, ...a); });
    let threw = false;
    try { oracle(o); } catch { threw = true; } // both layers would throw identically; nothing to compare
    if (threw) continue;

    const c = cap.clone();
    loc_9c58(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.x, o.regs.x, "X live-out (the slot index) matches");
    ram++;
    if (hit9d06) { path9d06++; continue; } // A/Y incidental through loc_9d06
    assert.equal(c.regs.a, o.regs.a, "A live-out matches");
    assert.equal(c.regs.y, o.regs.y, "Y live-out (the segment index) matches");
    withAY++;
  }
  console.log(`  CAPTURE: ${ram} RAM+X compared (${withAY} also A/Y, ${path9d06} 9d06-path RAM+X only), ${CAPS.length} total`);
});

// Seed a full loc_9c58 entry: slot x=3, segment 2 (loc_283,x low bits), a +2 low delta. The DIRECTION comes
// from bit7 of loc_28a,x. m.regs.y is dirtied to prove the selector reseats it to the segment index (tay).
function seed(m, { dir }) {
  const X = 3, SEG = 2;
  m.regs.x = X; m.regs.y = 0x77;
  m.mem.write8(u16(loc_283 + X), 0x02);                 // segment 2 (& 7)
  m.mem.write8(u16(loc_28a + X), dir === "sub" ? 0x80 : 0x00); // bit7: sub vs add; low bits 0 (no a06f gate)
  m.mem.write8(u16(loc_160 + SEG), 0x02);               // delta low
  m.mem.write8(u16(loc_165 + SEG), 0x00);               // delta high
  m.mem.write8(u16(loc_29f + X), 0x40);                 // coordinate low
  m.mem.write8(u16(loc_2df + X), 0x30);                 // coordinate high
  m.mem.write8(loc_202, 0x05);                          // below the new hi (0x30) -> plain add path
}

test("CRAFTED: add direction (loc_28a,x bit7 clear) takes loc_9c63 -- RAM and A/X/Y equal", () => {
  const m = new Machine(ROM, OPTS); seed(m, { dir: "add" });
  const o = m.clone(), c = m.clone();
  oracle(o); loc_9c58(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the add path");
  assert.equal(c.regs.a, o.regs.a, "A live-out matches");
  assert.equal(c.regs.a, 0x30, "A is the new hi byte (plain-add exit)");
  assert.equal(c.regs.x, o.regs.x, "X preserved");
  assert.equal(c.regs.x, 3, "X is the slot index");
  assert.equal(c.regs.y, o.regs.y, "Y matches");
  assert.equal(c.regs.y, 2, "Y is the segment index the selector seated");
  assert.equal(c.mem.read8(u16(loc_29f + 3)), 0x42, "coordinate low moved UP by the delta (0x40 -> 0x42)");
});

test("CRAFTED: sub direction (loc_28a,x bit7 set) takes loc_9c99 -- RAM and A/X/Y equal", () => {
  const m = new Machine(ROM, OPTS); seed(m, { dir: "sub" });
  const o = m.clone(), c = m.clone();
  oracle(o); loc_9c58(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the sub path");
  assert.equal(c.regs.a, o.regs.a, "A live-out matches");
  assert.equal(c.regs.a, 0x30, "A is the new hi byte (no underflow floor)");
  assert.equal(c.regs.x, o.regs.x, "X preserved");
  assert.equal(c.regs.y, o.regs.y, "Y matches");
  assert.equal(c.regs.y, 2, "Y is the segment index");
  assert.equal(c.mem.read8(u16(loc_29f + 3)), 0x3e, "coordinate low moved DOWN by the delta (0x40 -> 0x3e)");
});

test("TEETH: a twin that takes the WRONG direction (sub on an add seed) MUST diverge in RAM", () => {
  const m = new Machine(ROM, OPTS); seed(m, { dir: "add" });
  const o = m.clone(), c = m.clone();
  oracle(o);                 // add: coordinate low 0x40 -> 0x42
  loc_9c99(c, 3, 2);         // wrong direction: 0x40 -> 0x3e
  assert.notEqual(ramDiff(o, c), null, "the wrong-direction twin was NOT caught by the RAM compare");
});
