// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for emitSlotIndexDigit (ROM 0xaa9e-0xaaa7) -- advance the slot index (inx), publish it through
// the pointer byte $61, set the pointer base (A=0x61) and count (Y=1), then tail-jmp emitNibbleDigitRun to emit that
// one-byte run. The idiomatic side dissolves the tail jmp into a direct emitNibbleDigitRun(m, 0x61, 0x01) call.
// dfb1 takes its base/count as args and clobbers X internally, so X is NOT a live-out; the contract is
// memory only -- each arm compares RAM (dumpState minus stack scratch below the entry SP).
// Run: node --test games/tempest/idiomatic/test/equivalence-aa9e.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_aa9e } from "../../translated/loc_aa9e.js";
import { emitSlotIndexDigit } from "../emitSlotIndexDigit.js";
import { emitNibbleDigitRun } from "../emitNibbleDigitRun.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { u8 } from "../../../../core/int.js";
import { PROJ_Y_LO } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xaa9e;
const oracle = atEntry(loc_aa9e);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xaa9e dispatches -- emitSlotIndexDigit == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); emitSlotIndexDigit(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

const XREG = 0x05;
function seed(m) { m.regs.x = XREG; }

test("CRAFTED: $61 <- x+1 and RAM equal after the one-byte emit", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); emitSlotIndexDigit(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after emit");
  assert.equal(c.mem.read8(PROJ_Y_LO), u8(XREG + 1), "$61 took the advanced slot index");
});

test("TEETH: a twin that publishes x (not x+1) diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seed(o); oracle(o);
  const c = new Machine(ROM, OPTS); seed(c);
  const brokenAa9e = (m, x = m.regs.x) => {
    const { mem8 } = m;
    mem8[PROJ_Y_LO] = x; // BUG: forgot the increment -> wrong pointer byte AND wrong emitted run
    return emitNibbleDigitRun(m, 0x61, 0x01);
  };
  brokenAa9e(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the missing increment");
});

test("SP-TOOTH: the omitted-ret caller (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, emitSlotIndexDigit, TARGET, m);
  assert.equal(r.placeable, true, `emitSlotIndexDigit must be seam-placeable; got: ${r.error}`);
});
