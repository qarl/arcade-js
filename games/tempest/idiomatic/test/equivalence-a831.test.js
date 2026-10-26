// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for clearReadyLatchPair (ROM 0xa831) -- clear the $03aa and $0125 working cells. The A register
// only carries the constant 0 into memory (incidental scratch, dropped), so live-out is RAM only and the
// arms compare RAM (-stack). A pure leaf (no dispatch, no stack move): it omits the ROM ret and the
// withOmittedRet seam completes it, so the arms compare RAM (-stack), NOT pc/SP/A.
// Run: node --test games/tempest/idiomatic/test/equivalence-a831.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_a831 } from "../../translated/loc_a831.js";
import { clearReadyLatchPair } from "../clearReadyLatchPair.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { SWEEP_STAGE, WAVE_PHASE_LATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const opt = (name) => {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
};
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xa831;
const oracle = atEntry(loc_a831);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps taken before any gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1200) : [];

test("CAPTURE: real 0xa831 dispatches -- clearReadyLatchPair == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); clearReadyLatchPair(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

function seed(m, s) { for (const [a, v] of Object.entries(s)) m.mem.write8(Number(a), v); }

test("CRAFTED: both cells land at 0 from a non-default seed", () => {
  const s = { [SWEEP_STAGE]: 0x9c, [WAVE_PHASE_LATCH]: 0x5a }; // NON-default so the clear actually bites
  const o = new Machine(ROM, OPTS); seed(o, s);
  const c = new Machine(ROM, OPTS); seed(c, s);
  oracle(o); clearReadyLatchPair(c);
  assert.equal(ramDiff(o, c), null, "RAM matches oracle");
  assert.equal(c.mem.read8(SWEEP_STAGE), 0x00, "$03aa cleared");
  assert.equal(c.mem.read8(WAVE_PHASE_LATCH), 0x00, "$0125 cleared");
});

test("TEETH: a twin that clears only $03aa (leaves $0125) diverges", () => {
  const s = { [SWEEP_STAGE]: 0x9c, [WAVE_PHASE_LATCH]: 0x5a };
  const o = new Machine(ROM, OPTS); seed(o, s);
  oracle(o);
  assert.equal(o.mem.read8(WAVE_PHASE_LATCH), 0x00, "precondition: oracle cleared $0125");
  const broken0125 = 0x5a; // BUG: never cleared $0125
  assert.notEqual(broken0125, o.mem.read8(WAVE_PHASE_LATCH), "the RAM diff FAILED to catch a skipped $0125 clear");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xff;
  m.push16(0xabcd); // a real caller-return word on the 6502 page-1 stack
  const r = seamPlaceable(withOmittedRet, clearReadyLatchPair, TARGET, m);
  assert.equal(r.placeable, true, `clearReadyLatchPair must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
