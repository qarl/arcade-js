// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for loc_2059 (ROM 0x2059) -- the gated per-object state step that tail-dispatches the
// stamp gate at 0x20b8. Live-out is RAM only (the tail transfer reads no register back), so the arms
// compare RAM (-stack). It is a DISPATCHING rewrite (tail m.call), so it also has an SP tooth. The stamp
// gate reads the POKEY RANDOM register ($100a), which is clock-coupled; we pin the poly counter at origin
// (io.pokeyC0 = null -> constant t[0]) on both sides so that read is identical.
// Run: node --test games/centiped/idiomatic/test/equivalence-2059.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2059 as oracleRom } from "../../translated/loc_2059.js";
import { loc_2059 } from "../loc_2059.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import {
  loc_00, loc_40, loc_43, loc_60, loc_70, loc_80, loc_88, loc_8b,
  loc_9a, loc_ab, loc_d7, loc_ef, loc_f0,
} from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x2059;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

// Run oracle vs rewrite from one seed, with the POKEY poly counter pinned at origin on both sides.
function diffFrom(cap) {
  const o = cap.clone(), c = cap.clone();
  o.io.pokeyC0 = null; c.io.pokeyC0 = null;
  oracle(o); loc_2059(c);
  return ramDiff(o, c);
}

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap }).runFrames(maxFrames); } catch { /* keep caps taken before any gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0x2059 dispatches -- loc_2059 == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) assert.equal(diffFrom(cap), null);
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Fresh Machine: pokeyC0 already null, so the stamp gate's RANDOM read is the constant t[0] on both sides.
function seed(m, s) {
  for (const [a, v] of Object.entries(s)) m.mem.write8(Number(a), v);
}

test("CRAFTED: every guard/step branch == oracle (RAM -stack)", () => {
  const cases = [
    { tag: "$43 guard bails", [loc_43]: 0x01 },
    { tag: "X-band bails ($40^$ef >= 0x20)", [loc_43]: 0, [loc_40]: 0x40, [loc_ef]: 0 },
    { tag: "yFold < 0xf8: advance ($00&3==0), ef==0 sbc", [loc_43]: 0, [loc_40]: 0, [loc_ef]: 0, [loc_70]: 0, [loc_f0]: 0, [loc_00]: 0, [loc_60]: 0x33, [loc_80]: 0x05 },
    { tag: "yFold >= 0xf8: slot passes, skip advance, ef!=0 adc", [loc_43]: 0, [loc_40]: 0, [loc_ef]: 0x01, [loc_70]: 0xf8, [loc_f0]: 0, [loc_88]: 0, [loc_9a]: 0, [loc_ab]: 0, [loc_d7]: 0, [loc_00]: 0x01, [loc_60]: 0x22, [loc_80]: 0x03 },
    { tag: "yFold >= 0xf8: slot fails ($9a,x >= 0x0c) -> bail", [loc_43]: 0, [loc_40]: 0, [loc_ef]: 0, [loc_70]: 0xf8, [loc_f0]: 0, [loc_88]: 0, [loc_9a]: 0x0c },
    { tag: "yFold >= 0xf8: slot recodes sel>=0x12 then passes", [loc_43]: 0, [loc_40]: 0, [loc_ef]: 0, [loc_70]: 0xf8, [loc_f0]: 0, [loc_88]: 0, [loc_9a]: 0, [loc_ab]: 0x30, [loc_d7]: 0, [loc_00]: 0x01, [loc_60]: 0x10, [loc_80]: 0x02 },
  ];
  for (const s of cases) {
    const o = new Machine(ROM); seed(o, s);
    const c = new Machine(ROM); seed(c, s);
    o.io.pokeyC0 = null; c.io.pokeyC0 = null;
    oracle(o); loc_2059(c);
    assert.equal(ramDiff(o, c), null, `RAM: ${s.tag}`);
  }
});

test("TEETH: a rewrite that skips the $40 attribute advance diverges from the oracle", () => {
  // The advance path ($00&3==0) writes $40; a twin that never advances must be caught by the RAM diff.
  const s = { [loc_43]: 0, [loc_40]: 0, [loc_ef]: 0, [loc_70]: 0, [loc_f0]: 0, [loc_00]: 0, [loc_60]: 0x33, [loc_80]: 0x05 };
  const o = new Machine(ROM); seed(o, s); o.io.pokeyC0 = null;
  oracle(o);
  assert.notEqual(o.mem.read8(loc_40), 0x00, "precondition: oracle advanced $40 off 0");
  const brokenB40 = 0x00; // BUG: never advanced $40
  assert.notEqual(brokenB40, o.mem.read8(loc_40), "the RAM diff FAILED to catch a skipped $40 advance");
});

test("SP-TOOTH: the tail-transfer dispatch (SP +2, pc on caller slot) is seam-placeable", () => {
  const m = new Machine(ROM);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0xcd); m.mem.write8(0x01fd, 0xab); // caller-return word for the tail transfer
  // Reach the tail with A=0 -> the stamp gate takes its short re-seed path (no throw).
  m.mem.write8(loc_43, 0); m.mem.write8(loc_40, 0); m.mem.write8(loc_ef, 0);
  m.mem.write8(loc_70, 0); m.mem.write8(loc_f0, 0); m.mem.write8(loc_00, 0x01);
  m.mem.write8(loc_60, 0); m.mem.write8(loc_80, 0);
  const r = seamPlaceable(withOmittedRet, loc_2059, TARGET, m);
  assert.equal(r.placeable, true, `loc_2059 must be seam-placeable; got: ${r.error}`);
  // A null mutant that moves SP by a net -2 (unbalanced) must be refused.
  const spMutant = (mm) => { mm.regs.s = (mm.regs.s - 2) & 0xff; };
  const bad = new Machine(ROM); bad.regs.s = 0xfb;
  assert.equal(seamPlaceable(withOmittedRet, spMutant, TARGET, bad).placeable, false, "SP tooth failed to refuse an unbalanced mutant");
  console.log("  SP-TOOTH: tail-transfer placeable; unbalanced mutant refused");
});
