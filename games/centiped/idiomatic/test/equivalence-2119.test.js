// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for loc_2119 (ROM 0x2119) -- runs only while $86 is flagged active: primes the
// layout-draw cells, drives the row writers, clamps the $53/$83 targets through their spine steppers, runs
// the tail-writer pass, and folds a checksum into $fe. Live-out is RAM only, so the arms compare RAM
// (-stack). It is a DISPATCHING rewrite (one dissolved sub-call + kept spine calls), so it also has an SP
// tooth. None of the kept spine callees read a clock-coupled register, so no RNG pin is needed.
// Run: node --test games/centiped/idiomatic/test/equivalence-2119.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2119 as oracleRom } from "../../translated/loc_2119.js";
import { loc_2119 } from "../loc_2119.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import {
  loc_00, loc_43, loc_53, loc_63, loc_73, loc_83, loc_86, loc_fe, loc_0600,
} from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x2119;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap }).runFrames(maxFrames); } catch { /* keep caps taken before any gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0x2119 dispatches -- loc_2119 == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); loc_2119(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

function seed(m, s) { for (const [a, v] of Object.entries(s)) m.mem.write8(Number(a), v); }

test("CRAFTED: every activation/clamp branch == oracle (RAM -stack)", () => {
  const cases = [
    { tag: "$86 positive -> inactive, no-op" , [loc_86]: 0x00 },
    { tag: "active, draw ($00==0), $00 bit7 clear, $43 clear -> full path", [loc_86]: 0x80, [loc_00]: 0, [loc_43]: 0, [loc_63]: 0x10, [loc_73]: 0x10, [loc_53]: 0x50, [loc_83]: 0x50, [loc_0600]: 0 },
    { tag: "active, skip draw ($00!=0), $00 bit7 set -> early after writers", [loc_86]: 0x80, [loc_00]: 0x80, [loc_43]: 0, [loc_0600]: 0 },
    { tag: "active, $43 nonzero -> tail writers only", [loc_86]: 0x80, [loc_00]: 0, [loc_43]: 0x01, [loc_0600]: 0 },
    { tag: "active, $63 low band ($53:=1), $73 high band ($83:=0xff)", [loc_86]: 0x80, [loc_00]: 0, [loc_43]: 0, [loc_63]: 0x05, [loc_73]: 0x40, [loc_53]: 0x11, [loc_83]: 0x22, [loc_0600]: 0 },
    { tag: "active, $63 high band ($53:=0xff), $73 low band ($83:=1)", [loc_86]: 0x80, [loc_00]: 0, [loc_43]: 0, [loc_63]: 0xf0, [loc_73]: 0x05, [loc_53]: 0x11, [loc_83]: 0x22, [loc_0600]: 0 },
    { tag: "active, both mid band ($53/$83 kept)", [loc_86]: 0x80, [loc_00]: 0, [loc_43]: 0, [loc_63]: 0x40, [loc_73]: 0x20, [loc_53]: 0x30, [loc_83]: 0x60, [loc_0600]: 0 },
  ];
  for (const s of cases) {
    const o = new Machine(ROM); seed(o, s);
    const c = new Machine(ROM); seed(c, s);
    oracle(o); loc_2119(c);
    assert.equal(ramDiff(o, c), null, `RAM: ${s.tag}`);
  }
});

test("TEETH: a rewrite that skips the $fe checksum fold diverges from the oracle", () => {
  // Active ($86 bit7 set) with $00 bit7 CLEAR so the `and #$80; bne $218c` gate falls through to the
  // clamp/tail spine and reaches the $fe checksum fold ($43 nonzero routes straight to 0x217d). The fold
  // is an EOR self-check over ROM 0x2120..0x2133 that validates to 0, so we pre-seed $fe to a nonzero
  // sentinel: the fold overwriting it with 0 is the observable write a skipping rewrite would omit.
  const s = { [loc_86]: 0x80, [loc_00]: 0, [loc_43]: 0x01, [loc_0600]: 0, [loc_fe]: 0xaa };
  const o = new Machine(ROM); seed(o, s);
  const base = o.mem.read8(loc_fe);
  oracle(o);
  assert.notEqual(o.mem.read8(loc_fe), base, "precondition: oracle wrote the checksum into $fe");
  const brokenFe = base; // BUG: never folded the checksum -> $fe keeps the seeded sentinel
  assert.notEqual(brokenFe, o.mem.read8(loc_fe), "the RAM diff FAILED to catch a skipped checksum fold");
});

test("SP-TOOTH: the omitted-ret dispatch (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0xcd); m.mem.write8(0x01fd, 0xab); // caller-return word for the seam
  // Active with $00 bit7 set: exercises the kept spine dispatches (0x2195/0x3825) then returns cleanly.
  m.mem.write8(loc_86, 0x80); m.mem.write8(loc_00, 0x80); m.mem.write8(loc_43, 0); m.mem.write8(loc_0600, 0);
  const r = seamPlaceable(withOmittedRet, loc_2119, TARGET, m);
  assert.equal(r.placeable, true, `loc_2119 must be seam-placeable; got: ${r.error}`);
  // A null mutant that moves SP by a net -2 (unbalanced) must be refused.
  const spMutant = (mm) => { mm.regs.s = (mm.regs.s - 2) & 0xff; };
  const bad = new Machine(ROM); bad.regs.s = 0xfb;
  assert.equal(seamPlaceable(withOmittedRet, spMutant, TARGET, bad).placeable, false, "SP tooth failed to refuse an unbalanced mutant");
  console.log("  SP-TOOTH: moved-0 dispatch placeable; unbalanced mutant refused");
});
