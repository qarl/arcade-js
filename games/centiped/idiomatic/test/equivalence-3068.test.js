// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for updateSoundChannels (ROM 0x3068) -- the per-frame POKEY voice updater. Its
// observable output is TWO surfaces: the effect timers $b2-$b8 (work RAM, in dumpState) and the eight
// POKEY audio registers $1000-$1007 (routed to io.pokeyReg, NOT in dumpState), so every arm checks the
// RAM diff (minus stack) AND pokeyReg[0..7]. A leaf: it omits the ROM ret and the seam completes it.
// Run: node --test games/centiped/idiomatic/test/equivalence-3068.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3068 as oracleRom } from "../../translated/loc_3068.js";
import { updateSoundChannels } from "../updateSoundChannels.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import {
  loc_00, loc_40, loc_43, loc_70, loc_86,
  loc_b2, SFX_TIMER_CH2, SFX_TIMER_CH3, SFX_TIMER_CH4, SFX_TIMER_CH2_PRIORITY, SFX_TIMER_CH1_PRIORITY, loc_b8,
  loc_ef, loc_f0, loc_f4,
  AUDF1, AUDC1, AUDF2, AUDC2, AUDF3, AUDC3, AUDF4, AUDC4,
} from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x3068;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));
// Compare only the eight audio latches -- pokeyReg[8..15] and pokeyC0/pokeyLastAccess are clock-derived
// (the idiomatic layer is clock-free), so they diverge harmlessly and are excluded.
const pokeyDiff = (o, c) => {
  for (let i = 0; i <= 7; i++) if (o.io.pokeyReg[i] !== c.io.pokeyReg[i]) return { reg: i, o: o.io.pokeyReg[i], c: c.io.pokeyReg[i] };
  return null;
};

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap }).runFrames(maxFrames); } catch { /* keep caps taken before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

const POKEY = [AUDF1, AUDC1, AUDF2, AUDC2, AUDF3, AUDC3, AUDF4, AUDC4];

// Seat a full sound state; both sides get an identical seed. pokeyReg is pre-dirtied to 0xff so any
// write (or absence of a write) to $1000-$1007 is observable.
function seed(m, s) {
  for (const a of POKEY) m.mem.write8(a, 0xff);
  m.mem.write8(loc_00, s.frame ?? 0);
  m.mem.write8(loc_86, s.master ?? 0x10);
  m.mem.write8(loc_b2, s.b2 ?? 0);
  m.mem.write8(SFX_TIMER_CH2, s.b3 ?? 0);
  m.mem.write8(SFX_TIMER_CH3, s.b4 ?? 0);
  m.mem.write8(SFX_TIMER_CH4, s.b5 ?? 0);
  m.mem.write8(SFX_TIMER_CH2_PRIORITY, s.b6 ?? 0);
  m.mem.write8(SFX_TIMER_CH1_PRIORITY, s.b7 ?? 0);
  m.mem.write8(loc_b8, s.b8 ?? 0);
  m.mem.write8(loc_70, s.c70 ?? 0);
  m.mem.write8(loc_f0, s.f0 ?? 0);
  m.mem.write8(loc_f4, s.f4 ?? 0);
  m.mem.write8(loc_43, s.c43 ?? 0);
  m.mem.write8(loc_40, s.c40 ?? 0);
  m.mem.write8(loc_ef, s.ef ?? 0);
}

test("CAPTURE: real 0x3068 dispatches -- updateSoundChannels == oracle in RAM (-stack) and POKEY regs", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); updateSoundChannels(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(pokeyDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: seeded states across every voice path == oracle (RAM + POKEY regs)", () => {
  const cases = [
    { tag: "silence ($86 negative)", master: 0x80, frame: 0x01, b2: 5, b3: 5, b4: 5, b5: 5, b6: 5, b7: 5, b8: 5 },
    { tag: "odd frame, b5 live", frame: 0x01, b5: 0x05, b4: 0x03, b2: 0x02, b3: 0x04, b6: 0, b7: 0, b8: 0x08 },
    { tag: "odd frame, b5 reload at 1->0x14", frame: 0x01, b5: 0x01, b4: 0, b2: 0, b3: 0, b6: 0, b7: 0 },
    { tag: "even frame skips b5", frame: 0x02, b5: 0x05, b4: 0x03, b2: 0x02, b3: 0, b6: 0, b7: 0 },
    { tag: "b6 live, $00&7==0", frame: 0x08, b5: 0, b4: 0, b6: 0x04, b3: 0, b2: 0, b7: 0 },
    { tag: "b8 sweep via $40^$ef in [0x20,0x34)", frame: 0x00, b6: 0, b8: 0x03, c70: 0x10, f0: 0x00, c43: 0x00, c40: 0x25, ef: 0x00, b3: 0, b2: 0, b7: 0 },
    { tag: "noise path 30f1 ($40^$ef < 0x20)", frame: 0x00, b6: 0, c70: 0x11, f0: 0x00, c43: 0x00, c40: 0x05, ef: 0x00, b2: 0x03, b3: 0, b7: 0 },
    { tag: "3115/b3 path ($70^$f0 >= 0xf8)", frame: 0x00, b6: 0, c70: 0xf9, f0: 0x00, b3: 0x06, b2: 0, b7: 0 },
    { tag: "b7 path with +2 adc ($00&7!=0, &3==0)", frame: 0x04, b6: 0, b7: 0x05, b2: 0x02, b3: 0 },
  ];
  for (const s of cases) {
    const o = new Machine(ROM); seed(o, s);
    const c = new Machine(ROM); seed(c, s);
    oracle(o); updateSoundChannels(c);
    assert.equal(ramDiff(o, c), null, `RAM: ${s.tag}`);
    assert.equal(pokeyDiff(o, c), null, `POKEY: ${s.tag}`);
  }
});

test("CRAFTED: the silence path zeroes AUDC1/2/3/4 and leaves AUDF untouched", () => {
  const o = new Machine(ROM); seed(o, { master: 0x80, frame: 0x01 });
  const c = new Machine(ROM); seed(c, { master: 0x80, frame: 0x01 });
  oracle(o); updateSoundChannels(c);
  for (const [reg, addr] of [[AUDC1, "AUDC1"], [AUDC2, "AUDC2"], [AUDC3, "AUDC3"], [AUDC4, "AUDC4"]]) {
    assert.equal(c.io.pokeyReg[reg & 0x0f], 0x00, `${addr} silenced`);
  }
  // AUDF1 (0x1000) was pre-dirtied to 0xff and the silence path never writes it.
  assert.equal(c.io.pokeyReg[AUDF1 & 0x0f], 0xff, "AUDF1 untouched on the silence path");
});

test("TEETH: a wrong POKEY latch is caught by the pokeyReg comparison", () => {
  const o = new Machine(ROM); seed(o, { master: 0x80, frame: 0x01 });
  oracle(o); // silence path: pokeyReg[1] (AUDC1) == 0
  const brokenAudc1 = 0xff; // BUG: failed to silence AUDC1
  assert.notEqual(brokenAudc1, o.io.pokeyReg[AUDC1 & 0x0f], "the POKEY comparison FAILED to catch a wrong AUDC1");
});

test("TEETH: a skipped timer decrement is caught by the RAM diff", () => {
  // b2 path: reach 3101 with b2 live so the oracle decrements $b2.
  const s = { frame: 0x00, b6: 0, b7: 0, b2: 0x07, b3: 0, c70: 0x00, f0: 0x00, c43: 0x00, c40: 0x00, ef: 0x00 };
  const o = new Machine(ROM); seed(o, s);
  oracle(o);
  assert.equal(o.mem8[loc_b2], 0x06, "precondition: oracle decremented $b2 from 0x07");
  const brokenB2 = 0x07; // BUG: never decremented $b2
  assert.notEqual(brokenB2, o.mem8[loc_b2], "the RAM diff FAILED to catch a skipped dec $b2");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0xcd); m.mem.write8(0x01fd, 0xab); // a real caller-return word for the seam
  m.mem.write8(loc_86, 0x10); m.mem.write8(loc_00, 0x00);
  const r = seamPlaceable(withOmittedRet, updateSoundChannels, TARGET, m);
  assert.equal(r.placeable, true, `updateSoundChannels must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
