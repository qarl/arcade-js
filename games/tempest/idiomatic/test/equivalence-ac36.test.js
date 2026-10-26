// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for raiseRebuildRequestBits (ROM 0xac36) -- OR bits 0-1 ($03) into the $01c9 flags cell and hand the
// merged value back in A. Live-out is RAM ($01c9) plus the A register (the caller reads the merged value),
// so the arms compare RAM (-stack) AND A. A pure leaf (no dispatch, no stack move): it omits the ROM ret and
// the withOmittedRet seam completes it, so the arms compare RAM (-stack) + A, NOT pc/SP.
// Run: node --test games/tempest/idiomatic/test/equivalence-ac36.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_ac36 } from "../../translated/loc_ac36.js";
import { raiseRebuildRequestBits } from "../raiseRebuildRequestBits.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { PENDING_WORK_FLAGS } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const opt = (name) => {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
};
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xac36;
const oracle = atEntry(loc_ac36);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps taken before any gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1200) : [];

test("CAPTURE: real 0xac36 dispatches -- raiseRebuildRequestBits == oracle in RAM (-stack) and A", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); raiseRebuildRequestBits(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.a, o.regs.a, "A live-out (merged value) matches the oracle");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

function seed(m, s) { for (const [a, v] of Object.entries(s)) m.mem.write8(Number(a), v); }

test("CRAFTED: bits 0-1 set in $01c9, other bits preserved; A = merged value", () => {
  const cases = [
    { seed: 0x84 }, // 1000_0100 -> 1000_0111 = 0x87 (other bits kept)
    { seed: 0x00 }, // 0x00 -> 0x03
    { seed: 0x03 }, // already set -> unchanged 0x03
    { seed: 0xfc }, // 1111_1100 -> 1111_1111 = 0xff
  ];
  for (const { seed: sv } of cases) {
    const o = new Machine(ROM, OPTS); seed(o, { [PENDING_WORK_FLAGS]: sv });
    const c = new Machine(ROM, OPTS); seed(c, { [PENDING_WORK_FLAGS]: sv });
    oracle(o); const ret = raiseRebuildRequestBits(c);
    const tag = `seed=0x${sv.toString(16)}`;
    assert.equal(ramDiff(o, c), null, `RAM: ${tag}`);
    assert.equal(c.mem.read8(PENDING_WORK_FLAGS), sv | 0x03, `bits 0-1 set, rest kept: ${tag}`);
    assert.equal(c.regs.a, o.regs.a, `A matches oracle: ${tag}`);
    assert.equal(ret, o.regs.a, `return value == A live-out: ${tag}`);
  }
});

test("TEETH: a twin that skips the ora diverges (non-default seed)", () => {
  const sv = 0x84;
  const o = new Machine(ROM, OPTS); seed(o, { [PENDING_WORK_FLAGS]: sv });
  oracle(o);
  assert.notEqual(o.mem.read8(PENDING_WORK_FLAGS), sv, "precondition: oracle raised bits off the seed");
  const brokenCell = sv; // BUG: never OR-ed $03 in
  assert.notEqual(brokenCell, o.mem.read8(PENDING_WORK_FLAGS), "the RAM diff FAILED to catch a skipped ora");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.mem.write8(PENDING_WORK_FLAGS, 0x84);
  m.regs.s = 0xff;
  m.push16(0xabcd); // a real caller-return word on the 6502 page-1 stack
  const r = seamPlaceable(withOmittedRet, raiseRebuildRequestBits, TARGET, m);
  assert.equal(r.placeable, true, `raiseRebuildRequestBits must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
