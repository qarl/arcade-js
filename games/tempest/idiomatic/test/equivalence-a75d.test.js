// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for stepVelocityTowardZero (ROM 0xa75d-0xa787) -- step a signed 16-bit velocity (whole in Y, low in
// A) one fixed increment toward zero, saturating to zero (and bumping a counter) on the crossing. Live-out
// is RAM ($29/$2a/$2b) PLUS the returned register pair [A=low, Y=whole], so the arms compare RAM (-stack)
// AND the returned pair against the oracle's regs. A leaf: the module omits the ROM ret and the seam
// completes it. The fixed step is a ROM byte (deterministic, no POKEY).
// Run: node --test games/tempest/idiomatic/test/equivalence-a75d.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_a75d } from "../../translated/loc_a75d.js";
import { stepVelocityTowardZero } from "../stepVelocityTowardZero.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { loc_29, loc_2a, loc_2b } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xa75d;
const oracle = atEntry(loc_a75d);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xa75d dispatches -- returned [A,Y] == oracle regs, RAM (-stack) equal", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o);
    const [a, y] = stepVelocityTowardZero(c);
    assert.equal(a, o.regs.a, "returned A matches oracle's regs.a");
    assert.equal(y, o.regs.y, "returned Y matches oracle's regs.y");
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// [whole(Y), low(A)] inputs exercising: subtract-keep, subtract-cross, add-keep, add-cross.
const CASES = [
  [0x05, 0x30], // positive whole, no crossing -> subtract
  [0x00, 0x10], // positive whole, crossing zero -> saturate
  [0xff, 0x00], // negative whole, no crossing -> add
  [0xff, 0xf0], // negative whole, crossing zero -> saturate
];

test("CRAFTED: step toward zero over a dirty $29 counter == oracle (RAM + [A,Y])", () => {
  for (const [y, a] of CASES) {
    const setup = (m) => { m.regs.y = y; m.regs.a = a; m.mem.write8(loc_29, 0x40); };
    const o = new Machine(ROM, OPTS); setup(o);
    const c = new Machine(ROM, OPTS); setup(c);
    oracle(o);
    const [ra, ry] = stepVelocityTowardZero(c);
    const tag = `y=0x${y.toString(16)} a=0x${a.toString(16)}`;
    assert.equal(ramDiff(o, c), null, `RAM equal: ${tag}`);
    assert.equal(ra, o.regs.a, `A matches oracle: ${tag}`);
    assert.equal(ry, o.regs.y, `Y matches oracle: ${tag}`);
    assert.equal(c.mem.read8(loc_2b), y, `$2b holds the input whole: ${tag}`);
  }
});

test("TEETH: a twin that skips the zero-crossing saturation diverges (RAM + regs)", () => {
  const y = 0x00, a = 0x10; // crosses zero on the subtract
  const setup = (m) => { m.regs.y = y; m.regs.a = a; m.mem.write8(loc_29, 0x40); };
  const o = new Machine(ROM, OPTS); setup(o);
  const c = new Machine(ROM, OPTS); setup(c);
  oracle(o);
  const brokenA75d = (m, aIn, yIn) => {
    const mem8 = m.mem8;
    mem8[loc_2b] = yIn;
    const step = mem8[0xa788];
    const low = aIn - step;             // BUG: never detects the borrow / never saturates
    mem8[loc_2a] = low;
    const whole = yIn - (low < 0 ? 1 : 0);
    return [low & 0xff, whole & 0xff];
  };
  const [ra, ry] = brokenA75d(c, a, y);
  const ramBad = ramDiff(o, c) != null;
  const regBad = ra !== o.regs.a || ry !== o.regs.y;
  assert.ok(ramBad || regBad, "the checks FAILED to catch the skipped saturation");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, stepVelocityTowardZero, TARGET, m);
  assert.equal(r.placeable, true, `stepVelocityTowardZero must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
