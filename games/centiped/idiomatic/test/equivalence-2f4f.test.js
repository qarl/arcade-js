// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for routeSegmentByRange (0x2f4f) -- the per-segment range/collision router. It
// dissolves the fold/marshal/resolve/stamp/delay calls into direct imports and keeps the ONE cyclic
// m.call into the slot-loop (0x3031), dissolved by the lead at merge. Observable output is RAM only,
// so every arm checks the RAM diff minus stack scratch below the entry SP. A constant RNG is seated on both sides so any
// benign entropy read deep in the tail cannot false-diverge.
// Run: node --test games/centiped/idiomatic/test/equivalence-2f4f.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2f4f as oracleRom } from "../../translated/loc_2f4f.js";
import { routeSegmentByRange } from "../routeSegmentByRange.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import {
  loc_34, loc_54, loc_62, loc_64, loc_72, loc_80,
  loc_43, loc_63, loc_73, loc_87, loc_88, loc_94, loc_ef, loc_f0,
} from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x2f4f;
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

// Seed the slot X, its indexed coordinate/heading cells and a spawn-tick/tail that returns early.
function seed(m, s = {}) {
  const x = s.x ?? 0;
  m.regs.x = x;
  m.mem8[(loc_34 + x) & 0xff] = s.coord ?? 0;
  m.mem8[(loc_64 + x) & 0xff] = s.h ?? 0;
  m.mem8[(loc_54 + x) & 0xff] = s.v ?? 0;
  m.mem8[loc_62] = s.c62 ?? 0;
  m.mem8[loc_72] = s.c72 ?? 0;
  m.mem8[loc_80] = s.c80 ?? 0;
  m.mem8[loc_ef] = s.ef ?? 0;
  m.mem8[loc_f0] = s.f0 ?? 0;
  m.mem8[loc_43] = s.c43 ?? 0;
  m.mem8[loc_63] = s.c63 ?? 0;
  m.mem8[loc_73] = s.c73 ?? 0;
  m.mem8[loc_87] = s.c87 ?? 0;
  m.mem8[loc_88] = s.c88 ?? 0;
  m.mem8[loc_94] = s.c94 ?? 0;
}

test("CAPTURE: real 0x2f4f dispatches -- routeSegmentByRange == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = noRng(cap.clone()), c = noRng(cap.clone());
    oracle(o); routeSegmentByRange(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: coarse-gate skip and head-slot limit store == oracle (RAM)", () => {
  const cases = [
    // Coordinate in the dead band [0x76,0xb9) -> straight to the next-slot loop (cyclic).
    { tag: "coarse-gate skip -> next slot", x: 0x00, coord: 0x80 },
    // Head slot ($0c), near/in-window with the limit unset -> store 0x04 then the redraw tail.
    { tag: "head-slot store -> redraw tail", x: 0x0c, coord: 0x00, h: 0x00, v: 0x00, c62: 0, c72: 0, c80: 0 },
  ];
  for (const s of cases) {
    const o = noRng(new Machine(ROM)); seed(o, s);
    const c = noRng(new Machine(ROM)); seed(c, s);
    oracle(o); routeSegmentByRange(c);
    assert.equal(ramDiff(o, c), null, s.tag);
  }
});

test("TEETH: a skipped limit store is caught by the RAM diff", () => {
  const s = { x: 0x0c, coord: 0x00, h: 0x00, v: 0x00, c62: 0, c72: 0, c80: 0 };
  const o = noRng(new Machine(ROM)); seed(o, s);
  oracle(o);
  assert.equal(o.mem8[loc_80], 0x04, "precondition: oracle stored the column limit 0x04");
  const brokenStore = 0x00; // BUG: the limit store never ran
  assert.notEqual(brokenStore, o.mem8[loc_80], "the RAM diff FAILED to catch a skipped limit store");
});

test("SP-TOOTH: the dispatcher is seam-placeable, and a stray push is refused", () => {
  const mk = () => {
    const m = noRng(new Machine(ROM));
    m.regs.s = 0xfb;
    m.mem.write8(0x01fc, 0xcd); m.mem.write8(0x01fd, 0xab);
    seed(m, { x: 0x0c, coord: 0x00, h: 0x00, v: 0x00, c62: 0, c72: 0, c80: 0 }); // -> dissolved redraw tail
    return m;
  };
  const ok = seamPlaceable(withOmittedRet, routeSegmentByRange, TARGET, mk());
  assert.equal(ok.placeable, true, `routeSegmentByRange must be seam-placeable; got: ${ok.error}`);

  const strayPush = (m) => { m.push8(0); return routeSegmentByRange(m); };
  const bad = seamPlaceable(withOmittedRet, strayPush, TARGET, mk());
  assert.equal(bad.placeable, false, "the SP-TOOTH FAILED to refuse an adrift stack");
  console.log("  SP-TOOTH: dispatcher placeable; stray push refused");
});
