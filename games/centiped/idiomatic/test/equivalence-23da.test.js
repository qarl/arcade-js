// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for advanceDeathRespawnSequence (0x23da) -- the per-frame death/respawn dispatcher. It
// ticks the $87 countdown (gated by $db), and once it clears runs one of several branches: blank a flagged
// cell, hand off to the rebuild spine, run the object-update chain, restart the wave, or step a spawn slot.
// A +2 dispatcher whose exits are either the machine's own RTS (moved 0) or a tail-transfer into the still-
// translated spawn/rebuild spine (moved +2). Dissolved leaf callees run idiomatic on the candidate side and
// translated on the oracle side; the spine callees run translated on both. POKEY poly sits at origin, so
// every RNG read reproduces on the clock-free side.
// Run: node --test games/centiped/idiomatic/test/equivalence-23da.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_23da as oracleRom } from "../../translated/loc_23da.js";
import { advanceDeathRespawnSequence } from "../advanceDeathRespawnSequence.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import {
  loc_87, FIELD_SCAN_PTR_HI, loc_d6, loc_43, loc_86, loc_01, loc_89, loc_88,
  loc_a7, loc_ee, loc_ad, loc_ef, loc_c1, loc_c2, loc_a4, loc_a5, loc_a6, loc_ab,
} from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x23da;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 6000) : [];

test("CAPTURE: real 0x23da dispatches -- advanceDeathRespawnSequence == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); advanceDeathRespawnSequence(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Fresh Machine (poly at origin). $a4[0..2] alias the $a4/$a5/$a6 cells, so the object-timer array is
// seeded through them. abVal seeds the per-slot selector the wave/spawn seeders read.
function seed(m, s) {
  const w = (a, v) => m.mem.write8(a, v);
  w(loc_87, s.c87 ?? 0);
  w(FIELD_SCAN_PTR_HI, s.db ?? 0);
  w(loc_d6, s.d6 ?? 0);
  w(loc_43, s.c43 ?? 0);
  w(loc_86, s.c86 ?? 0);
  w(loc_01, s.c01 ?? 0);
  w(loc_89, s.c89 ?? 0);
  w(loc_88, s.c88 ?? 0);
  w(loc_a7, s.a7 ?? 0);
  w(loc_ee, s.ee ?? 0);
  w(loc_ad, s.ad ?? 0);
  w(loc_ef, s.ef ?? 0);
  w(loc_c1, s.c1 ?? 0);
  w(loc_c2, s.c2 ?? 0);
  w(loc_a4, s.a4_0 ?? 0); // $a4[0]
  w(loc_a5, s.a5 ?? 0);   // $a4[1] / $a5
  w(loc_a6, s.a6 ?? 0);   // $a4[2] / $a6
  if (s.abVal !== undefined) w((loc_ab + (s.c88 ?? 0)) & 0xff, s.abVal);
}

test("CRAFTED: every reachable dispatch branch == oracle (RAM -stack)", () => {
  const cases = [
    { tag: "idle ($87==0)", c87: 0 },
    { tag: "still counting ($87>=2)", c87: 3 },
    { tag: "paused ($db!=0)", c87: 1, db: 0x01 },
    { tag: "flagged blank ($d6!=0)", c87: 1, d6: 0x05 },
    { tag: "-> rebuild spine ($43&0xaf==0)", c87: 1, c43: 0x00 },
    { tag: "-> reseed tail ($86 neg, $01 pos)", c87: 1, c43: 0x01, c86: 0x80, c01: 0x00 },
    // $ef stays 0: it is not part of this branch's gate ($86 neg + $01 neg), and a nonzero $ef re-strides
    // the transpose pointer walk (0x20^$ef) past video RAM (0x07BF) into the unmapped 0x08xx decode hole.
    { tag: "transpose + fan + reseed ($86 neg, $01 neg)", c87: 1, c43: 0x01, c86: 0x80, c01: 0x80, ef: 0x00 },
    { tag: "wave restart ($a5|$a6==0, $ef==0)", c87: 1, c43: 0x01, c86: 0x10, a5: 0, a6: 0, ef: 0x00, abVal: 0x06 },
    { tag: "arm empty slot ($a4[$88]==0, $a7==0)", c87: 1, c43: 0x01, c86: 0x10, a5: 0x01, c89: 0x03, c88: 0x00, a4_0: 0x00, a7: 0x00 },
  ];
  for (const s of cases) {
    const o = new Machine(ROM); seed(o, s);
    const c = new Machine(ROM); seed(c, s);
    oracle(o); advanceDeathRespawnSequence(c);
    assert.equal(ramDiff(o, c), null, `RAM: ${s.tag}`);
  }
});

test("CRAFTED: mushroom-reset branch carries the wrapped column index live-out ($c1, not $c4)", () => {
  // $88=1 -> mirror=2; $a4[1],$a4[2] live and $a4[2]==$a4[0], $ad==0 -> the reset runs, and its column
  // sweep leaves the index wrapped one past zero, so $c2,X lands on $c1 (0xc2+0xff & 0xff), not $c4.
  const s = {
    c87: 1, c43: 0x01, c86: 0x10, a5: 0x01, a6: 0x05, c89: 0x03,
    c88: 0x01, a4_0: 0x05, ee: 0x00, ad: 0x00, c1: 0x00,
  };
  const o = new Machine(ROM); seed(o, s);
  const c = new Machine(ROM); seed(c, s);
  oracle(o); advanceDeathRespawnSequence(c);
  assert.equal(ramDiff(o, c), null, "reset branch matches");
  // Positive control: the wrapped index set bit6 on $c1 and left $c4 (the un-wrapped slot) untouched.
  assert.equal(o.mem.read8(loc_c1) & 0x40, 0x40, "X wrapped to 0xff -> $c1 got bit6");
  assert.equal(o.mem.read8(0xc4) & 0x40, 0x00, "the un-wrapped slot $c4 was NOT modified");
});

test("TEETH: a single-byte $c1 divergence on the reset branch is caught by the RAM diff", () => {
  const s = {
    c87: 1, c43: 0x01, c86: 0x10, a5: 0x01, a6: 0x05, c89: 0x03,
    c88: 0x01, a4_0: 0x05, ee: 0x00, ad: 0x00, c1: 0x00,
  };
  const o = new Machine(ROM); seed(o, s);
  const c = new Machine(ROM); seed(c, s);
  oracle(o); advanceDeathRespawnSequence(c);
  assert.equal(ramDiff(o, c), null, "precondition: matched before mutation");
  c.mem.write8(loc_c1, c.mem.read8(loc_c1) ^ 0x40); // mutate the wrapped-index target
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch a $c1 divergence");
  assert.equal(d.addr, loc_c1 & 0xffff, "first divergence is $c1");
});

test("SP-TOOTH: the +2 dispatcher is seam-placeable; an SP-adrift mutant is refused", () => {
  // Branch to the rebuild-spine tail (a +2 dispatch): $87=1 -> dec 0, $db/$d6 clear, $43&0xaf==0.
  const m = new Machine(ROM); seed(m, { c87: 1, c43: 0x00 });
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0xcd); m.mem.write8(0x01fd, 0xab); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, advanceDeathRespawnSequence, TARGET, m);
  assert.equal(r.placeable, true, `advanceDeathRespawnSequence must be seam-placeable; got: ${r.error}`);

  const m2 = new Machine(ROM); seed(m2, { c87: 1, c43: 0x00 });
  m2.regs.s = 0xfb;
  m2.mem.write8(0x01fc, 0xcd); m2.mem.write8(0x01fd, 0xab);
  const mutant = (mm) => { mm.push16(0x2505); }; // pushes, never dispatches/rets through it -> SP adrift
  const rm = seamPlaceable(withOmittedRet, mutant, TARGET, m2);
  assert.equal(rm.placeable, false, "the SP-tooth FAILED to refuse an SP-adrift mutant");
  console.log("  SP-TOOTH: +2 dispatcher placeable, adrift mutant refused");
});
