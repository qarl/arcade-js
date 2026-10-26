// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for followScriptGoto (ROM 0x9c17-0x9c20) -- advances the $010b sequence index through the
// $a0f8 ROM table (mem[$010b] = table[mem[$010b]]). Live-out is RAM only (A/Y are scratch no caller reads:
// holdSlotPoseUntilTimerExpires tail-jumps here and reads neither), so every arm compares RAM (-stack). Pure leaf, no POKEY.
// Run: node --test games/tempest/idiomatic/test/equivalence-9c17.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_9c17 } from "../../translated/loc_9c17.js";
import { followScriptGoto } from "../followScriptGoto.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { SCRIPT_CURSOR } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const opt = (name) => {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
};
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x9c17;
const oracle = atEntry(loc_9c17);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0x9c17 dispatches -- followScriptGoto == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); followScriptGoto(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: $010b <- $a0f8[$010b] == oracle across index seeds", () => {
  for (const idx of [0x00, 0x01, 0x05, 0x7f, 0xff]) {
    const o = new Machine(ROM, OPTS); o.mem8[SCRIPT_CURSOR] = idx;
    const c = new Machine(ROM, OPTS); c.mem8[SCRIPT_CURSOR] = idx;
    oracle(o); followScriptGoto(c);
    assert.equal(ramDiff(o, c), null, `idx=0x${idx.toString(16)}`);
  }
});

test("TEETH: a twin that leaves $010b unchanged diverges from the oracle", () => {
  // Non-default seed so the mutation bites: pick an index whose table byte differs from the index itself.
  const c0 = new Machine(ROM, OPTS);
  let idx = 0x01;
  for (let i = 0; i <= 0xff; i++) { c0.mem8[SCRIPT_CURSOR] = i; const t = new Machine(ROM, OPTS); t.mem8[SCRIPT_CURSOR] = i; oracle(t); if (t.mem8[SCRIPT_CURSOR] !== i) { idx = i; break; } }
  const o = new Machine(ROM, OPTS); o.mem8[SCRIPT_CURSOR] = idx;
  oracle(o);
  assert.notEqual(o.mem8[SCRIPT_CURSOR], idx, "precondition: oracle advanced $010b off its seed");
  const broken = (m) => { /* BUG: never advances $010b */ };
  const c = new Machine(ROM, OPTS); c.mem8[SCRIPT_CURSOR] = idx;
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch a skipped $010b advance");
});
