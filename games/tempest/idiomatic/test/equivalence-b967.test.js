// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for selectPointerPair (ROM 0xb967) -- select an (A,X) pair from two ROM slots by the RAM flag
// POINTER_PARITY: flag==0 -> (ALT_DRAW_PTR_CLR_HI, ALT_DRAW_PTR_CLR_LO), else (ALT_DRAW_PTR_SET_HI, ALT_DRAW_PTR_SET_LO). No RAM write, so the RAM diff is
// vacuously null; the real contract is the TWO register live-outs A and X. A leaf: it omits the ROM ret and
// the seam completes it, so the arms compare RAM (-stack) + A + X, NOT pc/SP. No POKEY/clock read.
// Run: node --test games/tempest/idiomatic/test/equivalence-b967.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_b967 } from "../../translated/loc_b967.js";
import { selectPointerPair } from "../selectPointerPair.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { POINTER_PARITY, ALT_DRAW_PTR_CLR_LO, ALT_DRAW_PTR_CLR_HI, ALT_DRAW_PTR_SET_LO, ALT_DRAW_PTR_SET_HI } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const rd = (f) => (existsSync(new URL(f, ROM_DIR)) ? new Uint8Array(readFileSync(new URL(f, ROM_DIR))) : null);
const ROM = rd("maincpu.bin");
const opt = (f) => rd(f);
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
const ROM_PRESENT = ROM !== null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xb967;
const oracle = atEntry(loc_b967);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xb967 dispatches -- selectPointerPair == oracle in RAM (-stack), A and X", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); selectPointerPair(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.a, o.regs.a, "A live-out matches the oracle");
    assert.equal(c.regs.x, o.regs.x, "X live-out matches the oracle");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: flag==0 -> (ce87,ce86); flag!=0 -> (ce6f,ce6e)", () => {
  const cases = [
    { tag: "flag 0 -> then-arm", flag: 0 },
    { tag: "flag 1 -> else-arm", flag: 1 },
    { tag: "flag 0xff -> else-arm", flag: 0xff },
  ];
  for (const { tag, flag } of cases) {
    const o = new Machine(ROM, OPTS); o.mem.write8(POINTER_PARITY, flag);
    const c = new Machine(ROM, OPTS); c.mem.write8(POINTER_PARITY, flag);
    oracle(o); const ret = selectPointerPair(c);
    assert.equal(ramDiff(o, c), null, `no RAM write: ${tag}`);
    assert.equal(c.regs.a, o.regs.a, `A matches oracle: ${tag}`);
    assert.equal(c.regs.x, o.regs.x, `X matches oracle: ${tag}`);
    assert.deepEqual(ret, [o.regs.a, o.regs.x], `return == [A,X]: ${tag}`);
  }
});

test("TEETH: a twin that ignores the flag (always the then-arm) diverges in A/X on the else path", () => {
  const o = new Machine(ROM, OPTS); o.mem.write8(POINTER_PARITY, 1); // non-default flag: oracle takes the ELSE arm
  oracle(o);
  const thenA = new Machine(ROM, OPTS).mem.read8(ALT_DRAW_PTR_CLR_HI);
  const thenX = new Machine(ROM, OPTS).mem.read8(ALT_DRAW_PTR_CLR_LO);
  assert.notEqual(thenA, o.regs.a, "the A live-out check FAILED to catch an ignored flag");
  assert.notEqual(thenX, o.regs.x, "the X live-out check FAILED to catch an ignored flag");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xff;
  m.push16(0xabcd); // a real caller-return word on the 6502 page-1 stack
  const r = seamPlaceable(withOmittedRet, selectPointerPair, TARGET, m);
  assert.equal(r.placeable, true, `selectPointerPair must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
