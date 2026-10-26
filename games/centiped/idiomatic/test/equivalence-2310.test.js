// SPDX-License-Identifier: GPL-3.0-only
// Memory+register equivalence for loadObjectTileInputs (ROM 0x2310) -- copy $54,x into $8b, derive the
// ±1 step from the sign of $44,x into Y, load $64,x into A. LIVE-OUT is RAM $8b PLUS the registers A and
// Y (both read back by the frozen caller loc_2c2b), so each arm asserts the RAM diff (minus stack scratch below the entry SP)
// AND o.regs.a/o.regs.y. Flags are not live-out (loc_2c2b's lsr a overwrites them).
// Run: node --test games/centiped/idiomatic/test/equivalence-2310.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2310 as oracleRom } from "../../translated/loc_2310.js";
import { loadObjectTileInputs } from "../loadObjectTileInputs.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { u8 } from "../../../../core/int.js";
import { loc_44, loc_54, loc_64, loc_8b } from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x2310;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(32, 1500) : [];

test("CAPTURE: real 0x2310 dispatches -- loadObjectTileInputs == oracle in RAM (-stack) + A/Y", () => {
  assert.ok(CAPS.length > 0, "gameplay must dispatch 0x2310 at least once");
  const signs = new Set();
  for (const cap of CAPS) {
    signs.add(cap.mem.read8(u8(loc_44 + cap.regs.x)) & 0x80 ? "neg" : "pos");
    const o = cap.clone(), c = cap.clone();
    oracle(o); loadObjectTileInputs(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.a, o.regs.a, "A live-out ($64,x)");
    assert.equal(c.regs.y, o.regs.y, "Y live-out (±1 step)");
  }
  // Positive control: the captures must exercise BOTH sign branches, else the Y path is untested.
  assert.deepEqual([...signs].sort(), ["neg", "pos"], "captures must cover both $44,x sign branches");
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked, signs=${[...signs].sort().join(",")}`);
});

// A pristine crafted machine with SP seated on a real caller-return word (so the oracle's ret pops cleanly
// into the excluded dead scratch), the slot index in X, and the three source cells for that slot seeded.
function craft(x, base, heading, coord) {
  const m = new Machine(ROM);
  m.regs.s = 0xfd;
  m.push16(0xabcd);
  m.regs.x = x;
  m.mem.write8(u8(loc_54 + x), base);
  m.mem.write8(u8(loc_44 + x), heading);
  m.mem.write8(u8(loc_64 + x), coord);
  return m;
}

test("CRAFTED: both sign branches + the $8b/A/Y outputs are exact", () => {
  const cases = [
    { x: 0x00, base: 0x11, heading: 0x80, coord: 0x22, y: 0xff }, // bit7 set -> Y=0xff
    { x: 0x00, base: 0x11, heading: 0x00, coord: 0x33, y: 0x01 }, // bit7 clear -> Y=0x01
    { x: 0x03, base: 0x7e, heading: 0xff, coord: 0x40, y: 0xff }, // negative heading
    { x: 0x05, base: 0x01, heading: 0x7f, coord: 0x00, y: 0x01 }, // 0x7f is non-negative (bit7 clear)
    { x: 0x37, base: 0x99, heading: 0x00, coord: 0x44, y: 0x01 }, // x=0x37: $54,x aliases $8b (read-before-write)
  ];
  for (const { x, base, heading, coord, y } of cases) {
    const o = craft(x, base, heading, coord);
    const c = craft(x, base, heading, coord);
    oracle(o); loadObjectTileInputs(c);
    const label = `x=0x${x.toString(16)} heading=0x${heading.toString(16)}`;
    assert.equal(ramDiff(o, c), null, `RAM ${label}`);
    assert.equal(c.regs.y, y, `Y ${label}`);
    assert.equal(c.regs.y, o.regs.y, `Y==oracle ${label}`);
    assert.equal(c.regs.a, coord, `A=$64,x ${label}`);
    assert.equal(c.regs.a, o.regs.a, `A==oracle ${label}`);
    assert.equal(c.mem.read8(loc_8b), c.mem.read8(u8(loc_54 + x)), `$8b=$54,x ${label}`);
  }
});

test("TEETH: a twin that ignores the heading sign (always Y=0x01) is caught by the Y check", () => {
  // Broken twin: real $8b/A logic but drops the bmi -- always writes Y=0x01.
  const brokenLoc2310 = (m, x = m.regs.x) => {
    const { mem8, regs } = m;
    mem8[loc_8b] = mem8[u8(loc_54 + x)];
    return [(regs.y = 0x01), (regs.a = mem8[u8(loc_64 + x)])]; // BUG: no sign check
  };
  const o = craft(0x00, 0x11, 0x80, 0x22); // negative heading -> oracle Y=0xff
  const c = craft(0x00, 0x11, 0x80, 0x22);
  oracle(o); brokenLoc2310(c);
  assert.equal(ramDiff(o, c), null, "RAM alone cannot see the Y divergence"); // Y is register-only
  assert.notEqual(c.regs.y, o.regs.y, "the Y live-out check FAILED to catch the dropped sign branch");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const r = seamPlaceable(withOmittedRet, loadObjectTileInputs, TARGET, craft(0x00, 0x11, 0x80, 0x22));
  assert.equal(r.placeable, true, `loadObjectTileInputs must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
