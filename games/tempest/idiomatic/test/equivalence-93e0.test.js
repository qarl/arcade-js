// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for partitionByteToFineCoarseSeed (ROM 0x93e0-0x93f9) -- folds A's top three bits (MSB first) into a 0xff
// seed stored at $29, then derives X = ((seed ^ 0xff) + 0x0d) >> 1 across a pha/pla that preserves the SHIFTED
// A (input << 3), not the input. The live-outs are memory ($29) plus registers X (derived), Y (= the seed) and
// A (= input shifted left 3x; each caller writes regs.a to memory after the call, so A is genuine). Each side
// runs on a clone; the contract is RAM (dumpState, minus stack scratch below the entry SP) plus X/Y/A. A leaf: the module omits
// the ROM ret and the seam completes it, so the arms compare RAM (-stack) + regs, NOT pc/SP. No POKEY read.
// Run: node --test games/tempest/idiomatic/test/equivalence-93e0.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_93e0 } from "../../translated/loc_93e0.js";
import { partitionByteToFineCoarseSeed } from "../partitionByteToFineCoarseSeed.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { loc_29 } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x93e0;
const oracle = atEntry(loc_93e0);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 4000) : [];

test("CAPTURE: real 0x93e0 dispatches -- partitionByteToFineCoarseSeed == oracle in RAM (-stack) and X/Y/A", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); partitionByteToFineCoarseSeed(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.x, o.regs.x, "X (derived index) diverged");
    assert.equal(c.regs.y, o.regs.y, "Y (the seed) diverged");
    assert.equal(c.regs.a, o.regs.a, "A (preserved) diverged");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: seed at $29, X and the shifted A match the oracle across the A range", () => {
  for (const ain of [0x00, 0x1f, 0x20, 0x60, 0x80, 0xa0, 0xc0, 0xe0, 0xff]) {
    const o = new Machine(ROM, OPTS); o.regs.a = ain;
    const c = new Machine(ROM, OPTS); c.regs.a = ain;
    oracle(o);
    const [ra, rx, ry] = partitionByteToFineCoarseSeed(c);
    assert.equal(ramDiff(o, c), null, `A_in=0x${ain.toString(16)}: RAM ($29) diverged`);
    assert.equal(c.regs.x, o.regs.x, `A_in=0x${ain.toString(16)}: X diverged`);
    assert.equal(c.regs.y, o.regs.y, `A_in=0x${ain.toString(16)}: Y (seed) diverged`);
    assert.equal(c.regs.a, o.regs.a, `A_in=0x${ain.toString(16)}: A (shifted) diverged`);
    assert.equal(ra, o.regs.a, `A_in=0x${ain.toString(16)}: return[0] != A`);
    assert.equal(rx, o.regs.x, `A_in=0x${ain.toString(16)}: return[1] != X`);
    assert.equal(ry, o.regs.y, `A_in=0x${ain.toString(16)}: return[2] != Y`);
  }
});

test("TEETH: a twin that skips the >>1 on X diverges from the oracle", () => {
  const ain = 0xe0; // top bits set -> non-trivial seed and a non-zero X
  const o = new Machine(ROM, OPTS); o.regs.a = ain; oracle(o);
  const seed = o.mem.read8(loc_29);
  const brokenX = ((seed ^ 0xff) + 0x0d) & 0xff; // BUG: never shifts right
  assert.notEqual(brokenX, o.regs.x, "the X compare FAILED to catch the missing >>1");
  // A live-out tooth: the oracle leaves A = input << 3, NOT the preserved input.
  assert.notEqual(ain, o.regs.a, "the A compare would FALSELY pass a preserve-input twin");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, partitionByteToFineCoarseSeed, TARGET, m);
  assert.equal(r.placeable, true, `partitionByteToFineCoarseSeed must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
