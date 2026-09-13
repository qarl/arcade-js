// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for loc_df5f (ROM 0xdf5f) -- advance the ($74/$75) little-endian display-list cursor
// by Y+1 (tya; sec; adc $74; sta $74) and carry into $75. Live-out is RAM ($74 + conditionally $75) PLUS A:
// the exit A is the new cursor low byte (adc leaves it in A), threaded up the digit-emit chain to dd0d, so
// the arms compare RAM (-stack) AND A. Plain (non-dispatching) rewrite -- no SP tooth. No POKEY
// read, so the CRAFTED seed diffs are deterministic.
// Run: node --test games/tempest/idiomatic/test/equivalence-df5f.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_df5f as oracle } from "../../translated/loc_df5f.js";
import { loc_df5f } from "../loc_df5f.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, loc_74, loc_75 } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const opt = (name) => {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
};
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xdf5f;
const inDeadStack = (a) => a != null && a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);

// Y (the stride-minus-one) is the only register read on entry; the clone carries it.
// Returns { diff, o, c } so callers can also assert the A live-out (the new cursor low byte).
function runFrom(cap) {
  const o = cap.clone(), c = cap.clone();
  oracle(o); loc_df5f(c, c.regs.y);
  return { diff: ramDiff(o, c), o, c };
}

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps taken before any gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xdf5f dispatches -- loc_df5f == oracle in RAM (-stack) and A live-out", () => {
  for (const cap of CAPS) {
    const { diff, o, c } = runFrom(cap);
    assert.equal(diff, null);
    assert.equal(c.regs.a, o.regs.a, "A live-out (new cursor low byte) matches");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

function seed(m, s) {
  for (const [a, v] of Object.entries(s)) m.mem.write8(Number(a), v);
}

test("CRAFTED: no-carry / carry / boundary cursor advance == oracle (RAM -stack)", () => {
  const cases = [
    { tag: "no carry: $74=0x10 + y+1(0x06)=0x16", y: 0x05, lo: 0x10, hi: 0x30 },
    { tag: "carry: $74=0xf0 + y+1(0x21)=0x111 -> $74=0x11, $75++", y: 0x20, lo: 0xf0, hi: 0x30 },
    { tag: "boundary: $74=0xfe + 0x01=0xff (no carry)", y: 0x00, lo: 0xfe, hi: 0x40 },
    { tag: "boundary: $74=0xff + 0x01=0x100 (carry, $75 wraps 0xff->0x00)", y: 0x00, lo: 0xff, hi: 0xff },
    { tag: "big stride carry: $74=0x80 + y+1(0x80)=0x100", y: 0x7f, lo: 0x80, hi: 0x00 },
  ];
  for (const t of cases) {
    const o = new Machine(ROM, OPTS); seed(o, { [loc_74]: t.lo, [loc_75]: t.hi }); o.regs.y = t.y;
    const c = new Machine(ROM, OPTS); seed(c, { [loc_74]: t.lo, [loc_75]: t.hi }); c.regs.y = t.y;
    oracle(o); loc_df5f(c, c.regs.y);
    assert.equal(ramDiff(o, c), null, `RAM: ${t.tag}`);
    assert.equal(c.regs.a, o.regs.a, `A live-out: ${t.tag}`);
  }
});

test("TEETH: a twin that drops the carry into $75 diverges on the carry case", () => {
  // Carry case with $75 seeded to a NON-default 0x30 so a skipped inc (leaving 0x30) is caught even though
  // the correct result (0x31) is also nonzero. The twin advances $74 identically but never carries.
  const s = { [loc_74]: 0xf0, [loc_75]: 0x30 };
  const o = new Machine(ROM, OPTS); seed(o, s); o.regs.y = 0x20;
  const c = new Machine(ROM, OPTS); seed(c, s); c.regs.y = 0x20;
  const brokenNoCarry = (mm, y = mm.regs.y) => {
    // BUG: commits the low byte but never carries into $75.
    const sum = mm.mem8[loc_74] + y + 1;
    mm.mem8[loc_74] = sum;
  };
  oracle(o);
  brokenNoCarry(c, c.regs.y);
  assert.equal(o.mem.read8(loc_75), 0x31, "precondition: oracle carried $75 0x30 -> 0x31");
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch a dropped carry into $75");
});
