// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for initRoundState (ROM 0x2872) vs the frozen translated oracle. The routine seeds a
// batch of work cells + the sound-control/mode latches, clears the SFX timer bank and the $a8 slot table,
// folds the hardware RNG into $c8, then dissolves its four JSR callees (rebuildSegmentSpriteTables,
// seedSegmentSpawnState, seedWaveState) and tail-dispatches the playfield reset -- it has no RTS of its own.
//
// The routine WRITES SKCTL ($100f = SK_RESET) and reads POKEY RANDOM ($100a), whose value is clock-derived
// (poly phase = pokeyLastAccess - pokeyC0). The oracle advances the clock via m.step; the idiomatic layer is
// clock-free. We neutralize that one engine variable by FREEZING the clock to a constant on both sides so the
// poly phase is a constant origin throughout (the generalization of holding pokeyC0 at null when a routine,
// like this one, re-enables SK_RESET mid-body) -- exactly as the RAM diff skips stack scratch below the entry SP. What then
// gets compared is the routine's logic. SP-seam tooth for the omitted-ret leaf.
// Run: node --test games/centiped/idiomatic/test/equivalence-2872.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2872 as oracleRom } from "../../translated/loc_2872.js";
import { initRoundState } from "../initRoundState.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import {
  loc_53, loc_83, loc_88, loc_9b, loc_9c, loc_9d, loc_9e,
  loc_a2, loc_a3, loc_c8, loc_ff, SPAWN_TIMER,
} from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x2872;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

// Freeze the clock to a constant origin so the POKEY poly counter reads the same t[0] on both sides
// regardless of the SK_RESET write and the read count (the one clock variable the clock-free layer
// cannot reproduce -- see the header).
function pinClock(m) {
  m.mem.clock = () => 0;
  m.io.pokeyC0 = null;
  m.io.pokeyLastAccess = 0;
  return m;
}

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap }).runFrames(maxFrames); } catch { /* keep caps taken before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(8, 4000) : [];

function seed({ ff = 0x5a, c8 = 0x33 } = {}) {
  const m = new Machine(ROM);
  m.regs.s = 0xfd;
  m.mem.write8(0x0100 | ((0xfd + 1) & 0xff), 0x34); // caller-return (ret-1) lo
  m.mem.write8(0x0100 | ((0xfd + 2) & 0xff), 0x12); // caller-return (ret-1) hi
  m.mem.write8(loc_ff, ff);
  m.mem.write8(loc_c8, c8);
  return pinClock(m);
}

test("CAPTURE: real 0x2872 dispatches -- initRoundState == oracle in RAM (-stack, clock pinned)", () => {
  for (const cap of CAPS) {
    const o = pinClock(cap.clone());
    const c = pinClock(cap.clone());
    oracle(o);
    initRoundState(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked (clock pinned to origin)`);
});

test("CRAFTED: seeds cells, clears the timer banks, rebuilds tables and resets the field == oracle", () => {
  const cases = [
    { ff: 0x5a, c8: 0x33 },
    { ff: 0x00, c8: 0x00 },
    { ff: 0xff, c8: 0x80 },
    { ff: 0x3c, c8: 0xa5 },
  ];
  for (const s of cases) {
    const o = seed(s);
    const c = seed(s);
    oracle(o);
    initRoundState(c);
    const label = `ff=0x${s.ff.toString(16)} c8=0x${s.c8.toString(16)}`;
    assert.equal(ramDiff(o, c), null, label);
    // Positive controls: fixed seeds that survive the dissolved downstream chain ($9d/$9e/spawn-timer are
    // stable; $9b/$9c/$88 get rewritten by seedSegmentSpawnState/seedWaveState on some seeds so they are NOT
    // witnesses), and the RNG self-XOR left $c8 unchanged at origin (proves the clock pin cancelled eor $100a).
    assert.equal(o.mem.read8(loc_9d), 0x02, `oracle seeded $9d (${label})`);
    assert.equal(o.mem.read8(loc_9e), 0x02, `oracle seeded $9e (${label})`);
    assert.equal(o.mem.read8(SPAWN_TIMER), 0xc0, `oracle seeded the spawn timer (${label})`);
    assert.equal(o.mem.read8(loc_c8), s.c8, `RNG self-XOR left $c8 unchanged (${label})`);
  }
  console.log("  CRAFTED: initRoundState == oracle on 4 seeds");
});

test("TEETH: a skipped constant seed is caught by the RAM diff", () => {
  const o = seed();
  const c = seed();
  oracle(o);
  initRoundState(c);
  assert.equal(ramDiff(o, c), null, "precondition: initRoundState matches the oracle");
  // Positive control + mutation: the oracle seeded $9c=0x0c; a twin that fails to would diverge here.
  assert.equal(o.mem.read8(loc_9c), 0x0c, "oracle seeded $9c");
  c.mem8[loc_9c] = 0x00; // BUG: never seeded $9c
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch a skipped $9c seed");
  assert.equal(d.addr, loc_9c, "diff should be at the $9c seed cell");
  console.log("  TEETH: skipped-seed twin caught at $9c");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable; a stray push is refused", () => {
  const r = seamPlaceable(withOmittedRet, initRoundState, TARGET, seed());
  assert.equal(r.placeable, true, `initRoundState must be seam-placeable; got: ${r.error}`);
  // Null-mutant: one unmatched push leaves SP net -2 (moved 0xfe), neither the moved-0 leaf nor the
  // +2-on-slot tail-transfer -> the seam must refuse it.
  const strayPush = (m) => { initRoundState(m); m.push16(0x9999); };
  const rm = seamPlaceable(withOmittedRet, strayPush, TARGET, seed());
  assert.equal(rm.placeable, false, "the stray-push mutant placed at the seam (tooth has no teeth)");
  console.log("  SP-TOOTH: omitted-ret leaf placeable; stray-push mutant refused");
});
