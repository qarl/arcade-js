// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for advanceSegmentSlotLoop (0x3031) -- decrement the slot index and route: on
// underflow it dissolves into the spawn-cadence tick; otherwise it keeps the ONE cyclic m.call back
// into the per-segment router (0x2f4f), dissolved by the lead at merge. Observable output is RAM
// only, so every arm checks the RAM diff minus stack scratch below the entry SP; a constant RNG is seated on both sides.
// Run: node --test games/centiped/idiomatic/test/equivalence-3031.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3031 as oracleRom } from "../../translated/loc_3031.js";
import { advanceSegmentSlotLoop } from "../advanceSegmentSlotLoop.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { loc_34, loc_87, loc_88, loc_94 } from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x3031;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));
const noRng = (m) => { m.io.pokeyRandom = () => 0xff; return m; };

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(24, 3000) : [];

// Seed the slot X, one router coordinate (dead band -> quick loop exit) and a spawn tick that returns early.
function seed(m, s = {}) {
  m.regs.x = s.x ?? 0;
  m.mem8[loc_34] = s.coord0 ?? 0x80; // slot-0 coordinate parked in the dead band
  m.mem8[loc_87] = s.c87 ?? 0;
  m.mem8[loc_88] = s.c88 ?? 0;
  m.mem8[loc_94] = s.c94 ?? 0;
}

test("CAPTURE: real 0x3031 dispatches -- advanceSegmentSlotLoop == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = noRng(cap.clone()), c = noRng(cap.clone());
    oracle(o); advanceSegmentSlotLoop(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: underflow-to-tick and loop-to-router == oracle (RAM)", () => {
  const cases = [
    // X == 0 -> dex underflows -> finish the sweep at the spawn tick.
    { tag: "underflow -> spawn tick", x: 0x00 },
    // X == 1 -> dex to 0 -> back into the router, whose slot-0 coord is dead-banded -> straight back
    // to the loop -> underflow -> spawn tick.
    { tag: "loop -> router (cyclic)", x: 0x01, coord0: 0x80 },
  ];
  for (const s of cases) {
    const o = noRng(new Machine(ROM)); seed(o, s);
    const c = noRng(new Machine(ROM)); seed(c, s);
    oracle(o); advanceSegmentSlotLoop(c);
    assert.equal(ramDiff(o, c), null, s.tag);
  }
});

test("TEETH: a skipped spawn-tick arm is caught by the RAM diff", () => {
  const o = noRng(new Machine(ROM)); seed(o, { x: 0x00 });
  oracle(o);
  assert.equal(o.mem8[loc_87], 0x40, "precondition: the underflow tick armed the shared gate to 0x40");
  const brokenArm = 0x00; // BUG: the spawn tick never ran
  assert.notEqual(brokenArm, o.mem8[loc_87], "the RAM diff FAILED to catch a skipped spawn-tick arm");
});

test("SP-TOOTH: the dispatcher is seam-placeable, and a stray push is refused", () => {
  const mk = () => {
    const m = noRng(new Machine(ROM));
    m.regs.s = 0xfb;
    m.mem.write8(0x01fc, 0xcd); m.mem.write8(0x01fd, 0xab);
    seed(m, { x: 0x00 }); // underflow -> dissolved spawn tick (SP unmoved)
    m.regs.s = 0xfb;
    return m;
  };
  const ok = seamPlaceable(withOmittedRet, advanceSegmentSlotLoop, TARGET, mk());
  assert.equal(ok.placeable, true, `advanceSegmentSlotLoop must be seam-placeable; got: ${ok.error}`);

  const strayPush = (m) => { m.push8(0); return advanceSegmentSlotLoop(m); };
  const bad = seamPlaceable(withOmittedRet, strayPush, TARGET, mk());
  assert.equal(bad.placeable, false, "the SP-TOOTH FAILED to refuse an adrift stack");
  console.log("  SP-TOOTH: dispatcher placeable; stray push refused");
});
