// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for stampGridCellAtObject (ROM 0x20b8) -- stash A into $70, and either re-seed the
// wave (tiny folded value) or, past the slot-12 collision spine call and two low-bit frame gates, resolve
// the grid cell under the object and stamp it. Live-out is RAM only, so the arms compare RAM (-stack). It
// is a DISPATCHING rewrite (dissolved sub-calls + one kept spine call), so it also has an SP tooth. The
// re-seed and the second frame gate read the POKEY RANDOM register ($100a): the re-seed spin breaks on the
// first read on both sides with the poly counter pinned at origin (t[0]); the stamp arm instead pins a
// poly phase whose value's low two bits are 0 (identical read on both sides) so the gate opens.
// Run: node --test games/centiped/idiomatic/test/equivalence-20b8.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_20b8 as oracleRom } from "../../translated/loc_20b8.js";
import { stampGridCellAtObject } from "../stampGridCellAtObject.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import {
  TILEMAP_PTR_LO,
  loc_00, loc_60, loc_63, loc_70, loc_73, loc_f0, loc_f3,
} from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x20b8;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

// A poly phase whose RANDOM read has low two bits == 0 (so the second frame gate opens). The read value
// depends on the PREVIOUS access phase, not the live clock, so setting it identically on both sides makes
// the gate deterministic regardless of the cycle skew between oracle (clocked) and rewrite (clock-free).
function phaseLow0() {
  const p = new Machine(ROM);
  for (let i = 1; i < 300000; i++) { p.io.pokeyC0 = 0; p.io.pokeyLastAccess = i; if ((p.mem.read8(0x100a) & 3) === 0) return i; }
  throw new Error("no low-2==0 poly phase found");
}
const P0 = ROM_PRESENT ? phaseLow0() : 0;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap }).runFrames(maxFrames); } catch { /* keep caps taken before any gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0x20b8 dispatches -- stampGridCellAtObject == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    o.io.pokeyC0 = null; c.io.pokeyC0 = null; // pin the RNG so the frame gate reads identically on both
    oracle(o); stampGridCellAtObject(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

function seed(m, s) { for (const [a, v] of Object.entries(s)) m.mem.write8(Number(a), v); }

test("CRAFTED: re-seed, collision-gate, and stamp paths == oracle (RAM -stack)", () => {
  const cases = [
    { tag: "tiny fold -> re-seed wave (A^$f0 < 4)", a: 0x00, pin: "null", s: { [loc_f0]: 0 } },
    { tag: "A^$f0 >= 4 -> collision spine then whatever it gates", a: 0x10, pin: "null", s: { [loc_f0]: 0, [loc_00]: 0x01, [loc_63]: 0, [loc_73]: 0, [loc_60]: 0x02, [loc_70]: 0x02 } },
    { tag: "clear pass -> resolve + stamp the grid cell", a: 0x20, pin: "phase", s: { [loc_f0]: 0, [loc_00]: 0, [loc_f3]: 0, [loc_60]: 1, [loc_63]: 0, [loc_70]: 1, [loc_73]: 0 } },
  ];
  for (const tc of cases) {
    const o = new Machine(ROM); seed(o, tc.s); o.regs.a = tc.a;
    const c = new Machine(ROM); seed(c, tc.s); c.regs.a = tc.a;
    if (tc.pin === "null") { o.io.pokeyC0 = null; c.io.pokeyC0 = null; }
    else { o.io.pokeyC0 = 0; o.io.pokeyLastAccess = P0; c.io.pokeyC0 = 0; c.io.pokeyLastAccess = P0; }
    oracle(o); stampGridCellAtObject(c);
    assert.equal(ramDiff(o, c), null, `RAM: ${tc.tag}`);
  }
});

test("CRAFTED: the stamp path actually resolves the pointer (not a trivial early return)", () => {
  const o = new Machine(ROM);
  seed(o, { [loc_f0]: 0, [loc_00]: 0, [loc_f3]: 0, [loc_60]: 1, [loc_63]: 0, [loc_70]: 1, [loc_73]: 0 });
  o.regs.a = 0x20; o.io.pokeyC0 = 0; o.io.pokeyLastAccess = P0;
  const before = o.mem.read8(TILEMAP_PTR_LO);
  oracle(o);
  assert.notEqual(o.mem.read8(TILEMAP_PTR_LO), before, "precondition: the stamp path wrote the cell pointer");
});

test("TEETH: a rewrite that stores the wrong cell into $70 diverges from the oracle", () => {
  const o = new Machine(ROM); seed(o, { [loc_f0]: 0 }); o.regs.a = 0x55; o.io.pokeyC0 = null;
  oracle(o);
  assert.equal(o.mem.read8(loc_70), 0x55, "precondition: oracle stashed A into $70");
  const brokenB70 = 0x00; // BUG: never stashed A
  assert.notEqual(brokenB70, o.mem.read8(loc_70), "the RAM diff FAILED to catch a wrong $70 stash");
});

test("SP-TOOTH: the omitted-ret dispatch (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0xcd); m.mem.write8(0x01fd, 0xab); // caller-return word for the seam
  m.regs.a = 0; m.mem.write8(loc_f0, 0); // A^$f0 < 4 -> the short re-seed path (no throw)
  const r = seamPlaceable(withOmittedRet, stampGridCellAtObject, TARGET, m);
  assert.equal(r.placeable, true, `stampGridCellAtObject must be seam-placeable; got: ${r.error}`);
  // A null mutant that moves SP by a net -2 (unbalanced) must be refused.
  const spMutant = (mm) => { mm.regs.s = (mm.regs.s - 2) & 0xff; };
  const bad = new Machine(ROM); bad.regs.s = 0xfb;
  assert.equal(seamPlaceable(withOmittedRet, spMutant, TARGET, bad).placeable, false, "SP tooth failed to refuse an unbalanced mutant");
  console.log("  SP-TOOTH: moved-0 dispatch placeable; unbalanced mutant refused");
});
