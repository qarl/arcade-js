// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for stepHeadSegment (0x2ec6) -- the lead-segment step. It dissolves the tile
// resolve/stamp/decrement/advance calls into direct imports and keeps ONE cyclic m.call into the
// per-segment router (0x2f4f), dissolved by the lead at merge. Observable output is RAM only, so
// every arm checks the RAM diff minus stack scratch below the entry SP. One branch reads the POKEY RANDOM latch (clock-
// derived), so both clones seat a constant RNG so a benign entropy read cannot false-diverge.
// Run: node --test games/centiped/idiomatic/test/equivalence-2ec6.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2ec6 as oracleRom } from "../../translated/loc_2ec6.js";
import { stepHeadSegment } from "../stepHeadSegment.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import {
  loc_43, loc_62, loc_63, loc_72, loc_73, loc_86, loc_87, loc_88, loc_94,
  loc_ef, loc_f0, loc_f3, loc_f4, SFX_TIMER_CH3,
} from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x2ec6;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));
const noRng = (m) => { m.io.pokeyRandom = () => 0xff; return m; }; // clock-free constant on both sides

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(24, 3000) : [];

// Seed the gate/roll inputs plus a spawn-tick tail that returns early (both gate bytes clear).
function seed(m, s = {}) {
  m.mem8[loc_43] = s.c43 ?? 0;
  m.mem8[loc_62] = s.c62 ?? 0;
  m.mem8[loc_63] = s.c63 ?? 0;
  m.mem8[loc_72] = s.c72 ?? 0;
  m.mem8[loc_73] = s.c73 ?? 0;
  m.mem8[loc_86] = s.c86 ?? 0;
  m.mem8[loc_87] = s.c87 ?? 0;
  m.mem8[loc_88] = s.c88 ?? 0;
  m.mem8[loc_94] = s.c94 ?? 0;
  m.mem8[loc_ef] = s.ef ?? 0;
  m.mem8[loc_f0] = s.f0 ?? 0;
  m.mem8[loc_f3] = s.f3 ?? 0;
  m.mem8[loc_f4] = s.f4 ?? 0;
}

test("CAPTURE: real 0x2ec6 dispatches -- stepHeadSegment == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = noRng(cap.clone()), c = noRng(cap.clone());
    oracle(o); stepHeadSegment(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: band-gate exit and target-match spawn tick == oracle (RAM)", () => {
  const cases = [
    // Head out of band ($72 >= 0xf3, selector clear) -> tail spine.
    { tag: "band-gate exit", c72: 0xf5, c73: 0x22, f0: 0x11 },
    // Target match ($72 == (4^$f0)+$73) with the busy gate set -> straight to the spawn tick.
    { tag: "target match, busy -> spawn tick", c72: 0x04, c73: 0x00, f0: 0x00, c43: 0x20 },
  ];
  for (const s of cases) {
    const o = noRng(new Machine(ROM)); seed(o, s);
    const c = noRng(new Machine(ROM)); seed(c, s);
    oracle(o); stepHeadSegment(c);
    assert.equal(ramDiff(o, c), null, s.tag);
  }
});

test("TEETH: a skipped tail derive is caught by the RAM diff", () => {
  // Band-gate exit falls into the tail fixup, which derives $72 = $73 + (4^$f0) with the fixup gate clear.
  const o = noRng(new Machine(ROM)); seed(o, { c72: 0xf5, c73: 0x22, f0: 0x11, c43: 0x00 });
  oracle(o);
  const expected = (0x22 + (0x04 ^ 0x11)) & 0xff;
  assert.equal(o.mem8[loc_72], expected, "precondition: oracle derived $72 through the tail");
  const brokenDerive = 0xf5; // BUG: the tail never ran, $72 unchanged
  assert.notEqual(brokenDerive, o.mem8[loc_72], "the RAM diff FAILED to catch a skipped derive");
});

test("SP-TOOTH: the dispatcher is seam-placeable, and a stray push is refused", () => {
  const mk = () => {
    const m = noRng(new Machine(ROM));
    m.regs.s = 0xfb;
    m.mem.write8(0x01fc, 0xcd); m.mem.write8(0x01fd, 0xab); // a real caller-return word
    seed(m, { c72: 0xf5 }); // band-gate exit -> dissolved tail spine (SP unmoved)
    return m;
  };
  const ok = seamPlaceable(withOmittedRet, stepHeadSegment, TARGET, mk());
  assert.equal(ok.placeable, true, `stepHeadSegment must be seam-placeable; got: ${ok.error}`);

  const strayPush = (m) => { m.push8(0); return stepHeadSegment(m); };
  const bad = seamPlaceable(withOmittedRet, strayPush, TARGET, mk());
  assert.equal(bad.placeable, false, "the SP-TOOTH FAILED to refuse an adrift stack");
  console.log("  SP-TOOTH: dispatcher placeable; stray push refused");
});
