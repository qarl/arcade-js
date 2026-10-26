// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for writeScriptConstantToSlot (ROM 0x9bd0-0x9bdc) -- advance the $010b cursor, read the $a0f7 ROM
// table at the new index, and store that byte into the per-object slot $0298,x. Live-out is RAM only (A/Y
// are scratch no caller reads), so every arm compares RAM (-stack). Pure leaf (no dispatch), no POKEY.
// Run: node --test games/tempest/idiomatic/test/equivalence-9bd0.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_9bd0 } from "../../translated/loc_9bd0.js";
import { writeScriptConstantToSlot } from "../writeScriptConstantToSlot.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { SCRIPT_CURSOR, loc_298 } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const opt = (name) => {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
};
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x9bd0;
const oracle = atEntry(loc_9bd0);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0x9bd0 dispatches -- writeScriptConstantToSlot == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); writeScriptConstantToSlot(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Seed the $010b cursor and the object slot index X.
function seed(m, s) {
  m.mem8[SCRIPT_CURSOR] = s.cur;
  m.regs.x = s.x;
}

test("CRAFTED: cursor advance + $a0f7 lookup -> $0298,x == oracle across seeds", () => {
  const cases = [
    { tag: "x=0, cur mid", cur: 0x04, x: 0x00 },
    { tag: "x=5, cur mid", cur: 0x10, x: 0x05 },
    { tag: "cur wraps 0xff->0x00", cur: 0xff, x: 0x03 },
    { tag: "x large", cur: 0x20, x: 0x40 },
  ];
  for (const s of cases) {
    const o = new Machine(ROM, OPTS); seed(o, s);
    const c = new Machine(ROM, OPTS); seed(c, s);
    oracle(o); writeScriptConstantToSlot(c);
    assert.equal(ramDiff(o, c), null, `RAM: ${s.tag}`);
  }
});

test("TEETH: a twin that skips the $010b increment (wrong index) diverges from the oracle", () => {
  // Non-default seed so the mutation bites: at cur=0x10 the oracle indexes the table at 0x11, the twin at
  // 0x10 -- and it also fails to advance $010b. Either mismatch trips the RAM diff.
  const s = { cur: 0x10, x: 0x05 };
  const o = new Machine(ROM, OPTS); seed(o, s);
  oracle(o);
  const broken = (m, x = m.regs.x) => { // BUG: never increments $010b; indexes at the stale cursor
    const idx = m.mem8[SCRIPT_CURSOR];
    m.mem8[(loc_298 + x) & 0xffff] = m.mem8[(0xa0f7 + idx) & 0xffff];
  };
  const c = new Machine(ROM, OPTS); seed(c, s);
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch a skipped cursor increment");
});
