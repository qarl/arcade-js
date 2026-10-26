// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for holdSlotPoseUntilTimerExpires (ROM 0x9c0c-0x9c20) -- decrements $0298,x; if still nonzero it
// dissolves the tail m.call($9c17) into a direct followScriptGoto(m) (table-driven $010b step), else bumps
// $010b. Live-out is memory only (dec/inc are RMW; A/X survive unchanged), so each side runs on a
// clone and the contract is RAM (dumpState, minus stack scratch below the entry SP).
// Run: node --test games/tempest/idiomatic/test/equivalence-9c0c.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_9c0c } from "../../translated/loc_9c0c.js";
import { holdSlotPoseUntilTimerExpires } from "../holdSlotPoseUntilTimerExpires.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { loc_298, SCRIPT_CURSOR } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x9c0c;
const oracle = atEntry(loc_9c0c);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0x9c0c dispatches -- holdSlotPoseUntilTimerExpires == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); holdSlotPoseUntilTimerExpires(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: nonzero-after-dec delegates to the step; zero-after-dec bumps $010b", () => {
  // slot x=3, timer decrements to a nonzero value -> followScriptGoto runs (table step on $010b)
  const seedA = (m) => { m.regs.x = 3; m.mem.write8((loc_298 + 3) & 0xffff, 0x05); m.mem.write8(SCRIPT_CURSOR, 0x02); };
  let o = new Machine(ROM, OPTS); seedA(o);
  let c = new Machine(ROM, OPTS); seedA(c);
  oracle(o); holdSlotPoseUntilTimerExpires(c);
  assert.equal(ramDiff(o, c), null, "delegate branch RAM equal");
  assert.equal(c.mem.read8((loc_298 + 3) & 0xffff), 0x04, "timer decremented");

  // slot x=1, timer was 1 -> hits zero -> $010b bumped, no step
  const seedB = (m) => { m.regs.x = 1; m.mem.write8((loc_298 + 1) & 0xffff, 0x01); m.mem.write8(SCRIPT_CURSOR, 0x07); };
  o = new Machine(ROM, OPTS); seedB(o);
  c = new Machine(ROM, OPTS); seedB(c);
  oracle(o); holdSlotPoseUntilTimerExpires(c);
  assert.equal(ramDiff(o, c), null, "counter branch RAM equal");
  assert.equal(c.mem.read8((loc_298 + 1) & 0xffff), 0x00, "timer hit zero");
  assert.equal(c.mem.read8(SCRIPT_CURSOR), 0x08, "$010b bumped");
});

test("TEETH: a twin that skips the step (or the bump) diverges from the oracle", () => {
  const seed = (m) => { m.regs.x = 3; m.mem.write8((loc_298 + 3) & 0xffff, 0x05); m.mem.write8(SCRIPT_CURSOR, 0x02); };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  const broken = (m) => { const e = (loc_298 + m.regs.x) & 0xffff; m.mem.write8(e, (m.mem.read8(e) - 1) & 0xff); }; // BUG: never runs the step
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped step");
});
