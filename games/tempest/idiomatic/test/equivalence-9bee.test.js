// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for skipScriptOperandWhenFlagClear (ROM 0x9bee) -- the attract/demo step tick: if the gate $010c != 0 do
// nothing, else advance the step counter $010b by two. Live-out is RAM only, so each arm compares RAM
// (dumpState, minus stack scratch below the entry SP). No POKEY read -> crafted diffs are deterministic.
// Run: node --test games/tempest/idiomatic/test/equivalence-9bee.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_9bee } from "../../translated/loc_9bee.js";
import { skipScriptOperandWhenFlagClear } from "../skipScriptOperandWhenFlagClear.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { SCRIPT_CURSOR, SCRIPT_BRANCH_FLAG } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const rd = (n) => new Uint8Array(readFileSync(new URL(n, ROM_DIR)));
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? rd("maincpu.bin") : null;
const opt = (n) => (existsSync(new URL(n, ROM_DIR)) ? rd(n) : undefined);
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x9bee;
const oracle = atEntry(loc_9bee);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0x9bee dispatches -- skipScriptOperandWhenFlagClear == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); skipScriptOperandWhenFlagClear(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

function seeded(gate, step) {
  const m = new Machine(ROM, OPTS);
  m.mem.write8(SCRIPT_BRANCH_FLAG, gate);
  m.mem.write8(SCRIPT_CURSOR, step);
  return m;
}

test("CRAFTED: gate held -> no change; gate clear -> $010b += 2 (== oracle, RAM)", () => {
  const cases = [
    { tag: "gate held ($010c=1)", gate: 0x01, step: 0x40, expect: 0x40 },
    { tag: "gate held ($010c=0xff)", gate: 0xff, step: 0x40, expect: 0x40 },
    { tag: "gate clear -> +2", gate: 0x00, step: 0x40, expect: 0x42 },
    { tag: "gate clear -> +2 wraps", gate: 0x00, step: 0xff, expect: 0x01 },
  ];
  for (const { tag, gate, step, expect } of cases) {
    const o = seeded(gate, step), c = seeded(gate, step);
    oracle(o); skipScriptOperandWhenFlagClear(c);
    assert.equal(ramDiff(o, c), null, tag);
    assert.equal(c.mem.read8(SCRIPT_CURSOR), expect, tag);
  }
});

test("TEETH: a twin that advances by ONE (not two) diverges when the gate is clear", () => {
  // Non-default seed so the mutation bites: $010b starts at 0x40, oracle -> 0x42, a +1 twin -> 0x41.
  const o = seeded(0x00, 0x40);
  oracle(o);
  assert.equal(o.mem.read8(SCRIPT_CURSOR), 0x42, "precondition: oracle advanced by two");
  const c = seeded(0x00, 0x40);
  skipScriptOperandWhenFlagClear(c);
  c.mem.write8(SCRIPT_CURSOR, 0x41); // BUG: advanced by one
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch a +1 (should be +2) advance");
});
