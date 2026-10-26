// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for runMathboxDivide -- primes the mathbox operand/count registers from A,X, kicks a divide,
// then scans for the first ready slot and returns its low/high result pair. The mathbox lives outside the RAM
// dump, so the RAM contract reduces to $0073 and $0414 both cleared; registers A/X/Y are the real product and
// are compared directly. A leaf: the module omits the ROM ret and the seam completes it.
// Run: node --test games/tempest/idiomatic/test/equivalence-dce6.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_dce6 } from "../../translated/loc_dce6.js";
import { runMathboxDivide } from "../runMathboxDivide.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { VG_RECORD_HEADER, loc_414 } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xdce6;
const oracle = atEntry(loc_dce6);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xdce6 dispatches -- runMathboxDivide == oracle in RAM (-stack) and registers", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); runMathboxDivide(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.a, o.regs.a, "A live-out");
    assert.equal(c.regs.x, o.regs.x, "X live-out");
    assert.equal(c.regs.y, o.regs.y, "Y live-out");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: $0073 and $0414 clear to 0x00 and the register result pair matches", () => {
  const seed = (m) => {
    m.regs.a = 0x37; m.regs.x = 0x29; // non-default operands
    m.mem.write8(VG_RECORD_HEADER, 0xaa);
    m.mem.write8(loc_414, 0x55);
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); runMathboxDivide(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after run");
  assert.equal(c.mem.read8(VG_RECORD_HEADER), 0x00, "$0073 cleared");
  assert.equal(c.mem.read8(loc_414), 0x00, "$0414 cleared");
  assert.equal(c.regs.a, o.regs.a, "A live-out matches");
  assert.equal(c.regs.x, o.regs.x, "X live-out matches");
  assert.equal(c.regs.y, o.regs.y, "Y live-out matches");
});

test("TEETH: a twin that leaves $0414 untouched diverges from the oracle", () => {
  const seed = (m) => {
    m.regs.a = 0x37; m.regs.x = 0x29;
    m.mem.write8(VG_RECORD_HEADER, 0xaa);
    m.mem.write8(loc_414, 0x55); // non-default so the skipped store shows
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  const broken = (m) => { m.mem8[VG_RECORD_HEADER] = 0x00; }; // BUG: never clears $0414
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped store");
});

test("SP-TOOTH: the omitted-ret leaf is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, runMathboxDivide, TARGET, m);
  assert.equal(r.placeable, true, `runMathboxDivide must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf placeable");
});
