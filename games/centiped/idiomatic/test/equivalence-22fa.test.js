// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for tickColumnCountdown (ROM 0x22fa) -- decrement the $a1 column countdown; return early
// while it is non-zero, and on wrap reload $a1 from the POKEY RNG ((rng & 0x2f) | 0x0f), set $b5 = 0x14 and
// $41 = 0x14 ^ $f2. A leaf: it omits the ROM ret and the seam completes it. Live-out is RAM only ($a1 always;
// $b5/$41 on wrap) -- the caller chain (loc_2202) leaves inconsistent A across exit paths, so A is scratch.
// The single $100a read is equivalence-safe: pokeyRandom's value keys on the PREVIOUS access clock, so the
// oracle (reading after m.step) and the clock-free rewrite (reading at entry) return the identical byte.
// Run: node --test games/centiped/idiomatic/test/equivalence-22fa.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_22fa as oracleRom } from "../../translated/loc_22fa.js";
import { tickColumnCountdown } from "../tickColumnCountdown.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { loc_a1, SFX_TIMER_CH4, loc_41, loc_f2 } from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x22fa;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x22fa dispatches -- tickColumnCountdown == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); tickColumnCountdown(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: early-return path ($a1 stays non-zero) touches only $a1", () => {
  const seed = (m) => { m.mem.write8(loc_a1, 0x05); m.mem.write8(SFX_TIMER_CH4, 0x99); m.mem.write8(loc_41, 0x77); };
  const o = new Machine(ROM); seed(o);
  const c = new Machine(ROM); seed(c);
  oracle(o); tickColumnCountdown(c);
  assert.equal(ramDiff(o, c), null, "RAM matches on the early path");
  assert.equal(c.mem.read8(loc_a1), 0x04, "$a1 decremented");
  assert.equal(c.mem.read8(SFX_TIMER_CH4), 0x99, "$b5 untouched on the early path");
  assert.equal(c.mem.read8(loc_41), 0x77, "$41 untouched on the early path");
});

test("CRAFTED: wrap path ($a1 == 1 -> 0) reloads $a1 and re-arms $b5/$41", () => {
  const seed = (m) => { m.mem.write8(loc_a1, 0x01); m.mem.write8(loc_f2, 0x33); };
  const o = new Machine(ROM); seed(o);
  const c = new Machine(ROM); seed(c);
  oracle(o); tickColumnCountdown(c);
  assert.equal(ramDiff(o, c), null, "RAM matches on the wrap path");
  assert.equal(c.mem.read8(loc_a1), (0xff & 0x2f) | 0x0f, "$a1 reloaded from RNG (default 0xff -> 0x2f)");
  assert.equal(c.mem.read8(SFX_TIMER_CH4), 0x14, "$b5 armed to 0x14");
  assert.equal(c.mem.read8(loc_41), 0x14 ^ 0x33, "$41 = 0x14 ^ $f2");
});

test("TEETH: a twin that never re-arms on wrap (only decrements) diverges in $a1", () => {
  function tickColumnCountdown_broken(m) {
    const { mem8 } = m;
    mem8[loc_a1] = (mem8[loc_a1] - 1) & 0xff; // BUG: no wrap reload / $b5 / $41
  }
  const seed = (m) => { m.mem.write8(loc_a1, 0x01); m.mem.write8(loc_f2, 0x33); };
  const o = new Machine(ROM); seed(o);
  const c = new Machine(ROM); seed(c);
  oracle(o); tickColumnCountdown_broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch the missing wrap re-arm");
  // First divergence is $41 or $b5 or $a1 -- all part of the dropped re-arm; assert it is one of them.
  assert.ok([loc_a1 & 0xffff, SFX_TIMER_CH4 & 0xffff, loc_41 & 0xffff].includes(d.addr), `first divergence in the re-arm set (got 0x${(d.addr ?? 0).toString(16)})`);
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM);
  m.mem.write8(loc_a1, 0x05); // early path: a clean leaf, no RNG read
  m.regs.s = 0xff;
  m.push16(0xabcd); // a real caller-return word on the 6502 page-1 stack
  const r = seamPlaceable(withOmittedRet, tickColumnCountdown, TARGET, m);
  assert.equal(r.placeable, true, `tickColumnCountdown must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
