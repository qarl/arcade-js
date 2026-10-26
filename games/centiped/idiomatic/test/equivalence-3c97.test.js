// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for selfTestChecksumPass -- the memory-effecting body of the self-test checksum screen
// at ROM 0x3c97 (loc_3c97 runs it then falls into the non-returning input-test loop). It re-clears the
// pages, folds the program-ROM banks into four checksums it plots through the draw spine, reloads the
// high-score mirror, and runs a packed-BCD countdown into $8d. Reached only from the operator self-test, so
// it is never dispatched in a normal boot; the arms drive it from crafted seeds, comparing against the
// oracle run with its tail loop-back stubbed. It reads the POKEY RANDOM register ($100a) -- clock-coupled
// -- so both sides pin it to a constant. All observable output is RAM (work + video, both in dumpState);
// arms compare RAM minus stack scratch below the entry SP.
// Run: node --test games/centiped/idiomatic/test/equivalence-3c97.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3c97 as oracleRom } from "../../translated/loc_3c97.js";
import { selfTestChecksumPass } from "../loc_3c97.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x3c97;
const NEXT = 0x3d57;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

// Fresh machine: pin POKEY RANDOM to a constant so the clock-free layer reproduces it, stub the tail.
function mk(seed = {}) {
  const m = new Machine(ROM, { overrides: new Map([[NEXT, () => {}]]) });
  m.io.pokeyRandom = () => 0xff;
  for (const [a, v] of Object.entries(seed)) m.mem.write8(Number(a), v);
  return m;
}

const CASES = [
  { tag: "zero header (skips the BCD countdown)", 0x018b: 0, 0x018c: 0, 0x018d: 0, 0xef: 0, 0xf3: 0, 0x91: 0, 0x92: 0, 0x93: 0, 0x94: 0, 0x8e: 0, 0x8f: 0, 0x90: 0 },
  { tag: "nonzero header runs BCD", 0x018b: 0x12, 0x018c: 0x34, 0x018d: 0x56, 0xef: 0, 0xf3: 0, 0x91: 0x99, 0x92: 0x99, 0x93: 0x99, 0x94: 0x99, 0x8e: 0x01, 0x8f: 0, 0x90: 0 },
  { tag: "single-byte header, wide accumulator", 0x018b: 0x01, 0x018c: 0, 0x018d: 0, 0xef: 0, 0xf3: 0, 0x91: 0x50, 0x92: 0, 0x93: 0, 0x94: 0, 0x8e: 0x05, 0x8f: 0, 0x90: 0 },
  { tag: "nonzero draw mask ($ef)", 0x018b: 0x99, 0x018c: 0, 0x018d: 0, 0xef: 0x40, 0xf3: 0, 0x91: 0x33, 0x92: 0, 0x93: 0, 0x94: 0, 0x8e: 0x03, 0x8f: 0, 0x90: 0 },
];

test("CRAFTED: checksum fold, plots, and the BCD countdown == oracle in RAM (-stack)", () => {
  for (const s of CASES) {
    const o = mk(s), c = mk(s);
    oracle(o); selfTestChecksumPass(c);
    assert.equal(ramDiff(o, c), null, `RAM: ${s.tag}`);
  }
});

test("TEETH: a wrong BCD countdown lands a wrong $8d and is caught by the RAM diff", () => {
  const s = CASES[1];
  const o = mk(s);
  oracle(o);
  const broken = mk(s);
  oracle(broken);
  broken.mem8[0x008d] = (broken.mem8[0x008d] + 1) & 0xff; // BUG: wrong iteration count
  assert.notEqual(
    firstStateDiff(o.dumpState(), broken.dumpState(), (off) => broken.stateOffsetToAddr(off), deadStackAtEntry(o, broken)),
    null,
    "the RAM diff FAILED to catch a wrong $8d",
  );
});

test("SP-TOOTH: the fall-through dispatch is seam-placeable, and an unbalanced mutant is refused", () => {
  const m = mk({ 0x018b: 0, 0x018c: 0, 0x018d: 0, 0xef: 0, 0xf3: 0 });
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0xcd); m.mem.write8(0x01fd, 0xab);
  const r = seamPlaceable(withOmittedRet, selfTestChecksumPass, TARGET, m);
  assert.equal(r.placeable, true, `selfTestChecksumPass must be seam-placeable; got: ${r.error}`);
  const nullMutant = (mm) => { mm.push16(0x1234); };
  const bad = seamPlaceable(withOmittedRet, nullMutant, TARGET, new Machine(ROM));
  assert.equal(bad.placeable, false, "the SP-TOOTH FAILED to refuse a stack-adrift mutant");
  console.log("  SP-TOOTH: fall-through placeable; unbalanced mutant refused");
});
