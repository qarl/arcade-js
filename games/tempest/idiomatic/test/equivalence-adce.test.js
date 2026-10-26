// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for foldStepIntoFraction (ROM 0xadce-0xade9) -- folds the signed step $50 (times eight) into the
// low cell $51 (= $50*8 + $51), carries the fold's carry plus the sign of $50 up into A, then clears $50.
// Live-out is the $50/$51 stores plus A (the running high byte, returned). It is a pure leaf (pha/pla only
// save/restore A, no dispatch); the seam completes it by omitting the ROM ret. No POKEY reads.
// Run: node --test games/tempest/idiomatic/test/equivalence-adce.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_adce } from "../../translated/loc_adce.js";
import { foldStepIntoFraction } from "../foldStepIntoFraction.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { SPINNER_ACCUM, RIM_ROT_OFFSET } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xadce;
const oracle = atEntry(loc_adce);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xadce dispatches -- foldStepIntoFraction == oracle in RAM (-stack) and in A", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); const a = foldStepIntoFraction(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(a, o.regs.a, "returned A matches the oracle");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

function seed(m, s) {
  m.regs.a = s.a;
  m.mem8[SPINNER_ACCUM] = s.step;
  m.mem8[RIM_ROT_OFFSET] = s.lo;
}

test("CRAFTED: fold and sign-carry over various step/lo/A == oracle (RAM -stack, and A)", () => {
  const cases = [
    { tag: "positive step, no fold carry", a: 0x10, step: 0x02, lo: 0x03 },
    { tag: "positive step, fold carries", a: 0x10, step: 0x20, lo: 0x10 },
    { tag: "negative step (sign -> 0xff)", a: 0x10, step: 0x84, lo: 0x00 },
    { tag: "negative step with fold carry", a: 0x00, step: 0xff, lo: 0xff },
    { tag: "zero step", a: 0x7f, step: 0x00, lo: 0x40 },
  ];
  for (const s of cases) {
    const o = new Machine(ROM, OPTS); seed(o, s);
    const c = new Machine(ROM, OPTS); seed(c, s);
    oracle(o); const a = foldStepIntoFraction(c);
    assert.equal(ramDiff(o, c), null, `RAM: ${s.tag}`);
    assert.equal(a, o.regs.a, `A: ${s.tag}`);
  }
});

test("TEETH: a twin that forgets to clear the step cell diverges from the oracle", () => {
  // Non-default seed so the mutation bites: a nonzero step means the oracle zeroes $50 while the twin leaves it.
  const s = { a: 0x10, step: 0x0c, lo: 0x03 };
  const o = new Machine(ROM, OPTS); seed(o, s);
  const c = new Machine(ROM, OPTS); seed(c, s);
  oracle(o);
  const brokenAdce = (m) => {
    const mem = m.mem8;
    mem[RIM_ROT_OFFSET] = ((mem[SPINNER_ACCUM] << 3) & 0xff) + mem[RIM_ROT_OFFSET]; // BUG: never clears $50
  };
  brokenAdce(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the uncleared step cell");
});

test("SP-TOOTH: the omitted-ret leaf is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, foldStepIntoFraction, TARGET, m);
  assert.equal(r.placeable, true, `foldStepIntoFraction must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf placeable");
});
