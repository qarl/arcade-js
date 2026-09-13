// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for loc_df1f (ROM 0xdf1f) -- index = (A & 0x0f) + 1 into the $31e4 word table, copy
// the two-byte entry through the ($74) display-list cursor, then advance the cursor by 2 (dissolved:
// idiomatic calls loc_df5f directly with y=1). loc_df24 is the shared tail (entry with the index already
// in A); it is exercised via loc_df1f plus a direct arm. X/Y are scratch and php/plp restores the flags, but
// exit A (live-out) is loc_df5f's returned cursor value, threaded up the chain to dd0d; the arms compare RAM
// (dumpState -stack) AND A. No POKEY read -> deterministic seeds.
// Run: node --test games/tempest/idiomatic/test/equivalence-df1f.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_df1f as oracle, loc_df24 as oracle24 } from "../../translated/loc_df1f.js";
import { loc_df1f, loc_df24 } from "../loc_df1f.js";
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

const TARGET = 0xdf1f;
const inDeadStack = (a) => a != null && a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);

// A (the value whose low nibble drives the index) is the only register read on entry; the clone carries it.
// Returns { diff, o, c } so callers can also assert the A live-out (the cursor value df5f propagates up).
function runFrom(cap) {
  const o = cap.clone(), c = cap.clone();
  oracle(o); loc_df1f(c, c.regs.a);
  return { diff: ramDiff(o, c), o, c };
}

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(24, 4000) : [];

test("CAPTURE: real 0xdf1f dispatches -- loc_df1f == oracle in RAM (-stack) and A live-out", () => {
  for (const cap of CAPS) {
    const { diff, o, c } = runFrom(cap);
    assert.equal(diff, null);
    assert.equal(c.regs.a, o.regs.a, "A live-out (df5f cursor value) matches");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: index = (A&0x0f)+1 copies the right table entry == oracle (RAM -stack)", () => {
  const cases = [
    { tag: "A=0x00 -> idx 1", a: 0x00 },
    { tag: "A=0x05 -> idx 6", a: 0x05 },
    { tag: "high bits ignored: A=0xf7 -> idx 8", a: 0xf7 },
    { tag: "A=0x0f -> idx 16", a: 0x0f },
  ];
  for (const t of cases) {
    const o = new Machine(ROM, OPTS); o.mem.write8(loc_74, 0x00); o.mem.write8(loc_75, 0x24); o.regs.a = t.a;
    const c = new Machine(ROM, OPTS); c.mem.write8(loc_74, 0x00); c.mem.write8(loc_75, 0x24); c.regs.a = t.a;
    oracle(o); loc_df1f(c, c.regs.a);
    assert.equal(ramDiff(o, c), null, `RAM: ${t.tag}`);
    assert.equal(c.regs.a, o.regs.a, `A live-out: ${t.tag}`);
  }
});

test("CRAFTED (df24 tail): the index-in-A entry point == oracle (RAM -stack)", () => {
  for (const idx of [0x00, 0x03, 0x08]) {
    const o = new Machine(ROM, OPTS); o.mem.write8(loc_74, 0x00); o.mem.write8(loc_75, 0x24); o.regs.a = idx;
    const c = new Machine(ROM, OPTS); c.mem.write8(loc_74, 0x00); c.mem.write8(loc_75, 0x24); c.regs.a = idx;
    oracle24(o); loc_df24(c, c.regs.a);
    assert.equal(ramDiff(o, c), null, `df24 idx=${idx}`);
    assert.equal(c.regs.a, o.regs.a, `df24 A live-out idx=${idx}`);
  }
});

test("TEETH: a twin that drops the +1 picks the wrong entry and diverges", () => {
  const seedA = 0x00; // correct idx=1 (offset 2); the bug uses idx=0 (offset 0)
  const o = new Machine(ROM, OPTS); o.mem.write8(loc_74, 0x00); o.mem.write8(loc_75, 0x24); o.regs.a = seedA;
  const c = new Machine(ROM, OPTS); c.mem.write8(loc_74, 0x00); c.mem.write8(loc_75, 0x24); c.regs.a = seedA;
  oracle(o);
  const broken = (m, a) => {
    const { mem8, mem16 } = m;
    const idx = a & 0x0f; // BUG: missing the +1
    const src = (0x31e4 + (idx << 1)) & 0xffff;
    const dst = mem16[loc_74];
    mem8[dst & 0xffff] = mem8[src];
    mem8[(dst + 1) & 0xffff] = mem8[(src + 1) & 0xffff];
  };
  broken(c, c.regs.a);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the dropped +1");
});
