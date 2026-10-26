// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for emitVectorTailRecord (ROM 0xb896) -- publish the 16-bit cursor into AVG vector RAM
// ($2ffc/$2ffd/$2fff) and step it down by 0x20 (with a borrow into $013a). A is incidental (its exit value
// is also the stored $0139), so live-out is RAM only and the arms compare RAM (-stack). Binary subtract; no
// POKEY/clock coupling, so the CRAFTED diff is deterministic. A pure leaf (no dispatch, no stack move):
// omits the ROM ret and the withOmittedRet seam completes it.
// Run: node --test games/tempest/idiomatic/test/equivalence-b896.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_b896 } from "../../translated/loc_b896.js";
import { emitVectorTailRecord } from "../emitVectorTailRecord.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { VECRAM_TAIL_CURSOR_LO, VECRAM_TAIL_CURSOR_HI, VEC_LIST_JMP_LO, VEC_LIST_JMP_HI, VEC_LIST_HALT } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const opt = (name) => {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
};
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xb896;
const oracle = atEntry(loc_b896);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps taken before any gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1200) : [];

test("CAPTURE: real 0xb896 dispatches -- emitVectorTailRecord == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); emitVectorTailRecord(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

function seed(m, s) { for (const [a, v] of Object.entries(s)) m.mem.write8(Number(a), v); }

test("CRAFTED: both the no-borrow and borrow paths == oracle (RAM -stack)", () => {
  const cases = [
    { tag: "no borrow ($0139>=0x20): keep low, hi unchanged", [VECRAM_TAIL_CURSOR_LO]: 0x50, [VECRAM_TAIL_CURSOR_HI]: 0x03 },
    { tag: "borrow ($0139<0x20): wrap low to 0x00-0x7f, dec hi", [VECRAM_TAIL_CURSOR_LO]: 0x10, [VECRAM_TAIL_CURSOR_HI]: 0x03 },
    { tag: "exact edge ($0139==0x20): result 0, no borrow", [VECRAM_TAIL_CURSOR_LO]: 0x20, [VECRAM_TAIL_CURSOR_HI]: 0x03 },
  ];
  for (const s of cases) {
    const o = new Machine(ROM, OPTS); seed(o, s);
    const c = new Machine(ROM, OPTS); seed(c, s);
    oracle(o); emitVectorTailRecord(c);
    assert.equal(ramDiff(o, c), null, `RAM: ${s.tag}`);
  }
});

test("TEETH: a twin that skips the $013a borrow diverges on the borrow path", () => {
  const s = { [VECRAM_TAIL_CURSOR_LO]: 0x10, [VECRAM_TAIL_CURSOR_HI]: 0x03 }; // borrow path: oracle decrements $013a to 0x02
  const o = new Machine(ROM, OPTS); seed(o, s);
  oracle(o);
  assert.equal(o.mem.read8(VECRAM_TAIL_CURSOR_HI), 0x02, "precondition: oracle carried the borrow into $013a");
  const brokenHi = 0x03; // BUG: never decremented $013a on borrow
  assert.notEqual(brokenHi, o.mem.read8(VECRAM_TAIL_CURSOR_HI), "the RAM diff FAILED to catch a skipped $013a borrow");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xff;
  m.push16(0xabcd); // a real caller-return word on the 6502 page-1 stack
  const r = seamPlaceable(withOmittedRet, emitVectorTailRecord, TARGET, m);
  assert.equal(r.placeable, true, `emitVectorTailRecord must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
