// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for resetPlayfieldAndSeedMushrooms (ROM 0x28bf) vs the frozen translated oracle. The
// routine clears $C2+$88 and the 0x0400-0x07FF pages (dispatching the still-frozen loc_2656), then runs a
// 46-column sweep that builds the grid pointer $8D/$8E from POKEY RANDOM + $8B, bumps the $D7+$88 tally for
// an empty cell, and stamps 0x3F^$EF; it has no RTS and tail-dispatches loc_2932.
//
// The POKEY RANDOM read (0x100A) is CLOCK-DEPENDENT (poly phase = m.cycles delta) and the idiomatic layer
// is clock-free, so a naive capture-replay would diverge only on the RNG timing, not on any logic defect.
// We neutralize that one engine-level variable by holding the poly counter at origin (io.pokeyC0 = null ->
// constant t[0]) on BOTH sides, exactly as the RAM diff skips stack scratch below the entry SP -- the RNG value is then
// identical and deterministic, and the routine's logic (pointer build, seed gating, tally, stamp, sweep)
// is what gets compared. Fidelity = RAM minus stack scratch below the entry SP; the 0x1404 palette write is real hardware
// state but is not in the RAM diff (palette RAM is not dumped). SP-seam tooth for the seated dispatches.
// Run: node --test games/centiped/idiomatic/test/equivalence-28bf.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_28bf as oracleRom } from "../../translated/loc_28bf.js";
import { resetPlayfieldAndSeedMushrooms } from "../resetPlayfieldAndSeedMushrooms.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import {
  loc_88, loc_8b, loc_8d, loc_8e, loc_8f, loc_c2, loc_d7, loc_ef,
  POKEY_RANDOM, loc_0400, loc_0500, loc_0600, loc_0700,
} from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x28bf;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

// Hold the POKEY poly counter at origin so the RANDOM read is the constant t[0] on both sides (the one
// engine-level clock variable the clock-free layer cannot reproduce -- see the header).
function pinRng(m) {
  m.io.pokeyC0 = null;
  return m;
}

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(4, 30) : [];

// A crafted fresh entry (pokeyC0 already null -> RNG pinned), with $88/$EF seated and a caller-return word
// at the entry SP (compared) for the loc_2932 tail dispatch.
function seed({ p88 = 0x00, ef = 0x00 } = {}) {
  const m = new Machine(ROM);
  m.regs.s = 0xfd;
  m.mem.write8(0x0100 | ((0xfd + 1) & 0xff), 0x34); // caller-return (ret-1) lo
  m.mem.write8(0x0100 | ((0xfd + 2) & 0xff), 0x12); // caller-return (ret-1) hi
  m.mem.write8(loc_88, p88);
  m.mem.write8(loc_ef, ef);
  return m;
}

test("CAPTURE: real 0x28bf dispatch -- resetPlayfieldAndSeedMushrooms == oracle in RAM (-stack, RNG pinned)", () => {
  for (const cap of CAPS) {
    const o = pinRng(cap.clone());
    const c = pinRng(cap.clone());
    oracle(o);
    resetPlayfieldAndSeedMushrooms(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked (RNG pinned to t[0])`);
});

test("CRAFTED: clears the pages, seeds the grid, bumps $D7 -- equal to oracle on both $EF branches", () => {
  const cases = [
    { p88: 0x00, ef: 0x00 }, // $EF==0 -> seed where column index < 0x0C
    { p88: 0x03, ef: 0x55 }, // $EF!=0 -> seed where column index >= 0x14 (and a nonzero tally index)
    { p88: 0x10, ef: 0xff },
  ];
  for (const c of cases) {
    const base = seed(c);
    const o = base.clone();
    const cc = base.clone();
    oracle(o);
    resetPlayfieldAndSeedMushrooms(cc);
    const label = `p88=0x${c.p88.toString(16)} ef=0x${c.ef.toString(16)}`;
    assert.equal(ramDiff(o, cc), null, label);
    // Positive controls: the sweep parked its outer counter at 0 and stamped the grid.
    assert.equal(o.mem.read8(loc_8f), 0x00, `oracle left $8f=0 (${label})`);
    assert.notEqual(o.mem.read8(loc_8d), 0x00, `oracle built a grid pointer low byte (${label})`);
  }
  console.log("  CRAFTED: resetPlayfieldAndSeedMushrooms == oracle on 3 arms (both $EF branches)");
});

test("TEETH: a twin that drops the $D7 tally bump diverges in RAM", () => {
  // Broken twin: the real routine minus the empty-cell $D7+$88 increment. Because the pages are cleared
  // first, every seeded column's target cell is empty, so at least one column takes the (dropped) bump.
  const droppedTally = (m) => {
    const mem = m.mem;
    mem.write8(0x1404, 0x0f);
    mem.write8((loc_c2 + mem.read8(loc_88)) & 0xff, 0x00);
    m.regs.x = 0x00;
    m.push16(0x28cd);
    m.call(0x2656);
    let i = 0x00;
    do {
      mem.write8((loc_0400 + i) & 0xffff, 0x00);
      mem.write8((loc_0500 + i) & 0xffff, 0x00);
      mem.write8((loc_0600 + i) & 0xffff, 0x00);
      mem.write8((loc_0700 + i) & 0xffff, 0x00);
      i = (i + 1) & 0xff;
    } while (i !== 0);
    mem.write8((loc_d7 + mem.read8(loc_88)) & 0xff, 0x00);
    mem.write8(loc_8b, 0x1b);
    let col = 0x2d;
    do {
      mem.write8(loc_8d, (mem.read8(POKEY_RANDOM) & 0xe0) | mem.read8(loc_8b));
      mem.write8(loc_8e, (mem.read8(POKEY_RANDOM) & 0x03) | 0x04);
      mem.write8(loc_8f, col);
      // (the $D7+$88 tally increment is intentionally omitted here)
      mem.write8(mem.read16(loc_8d), (0x3f ^ mem.read8(loc_ef)) & 0xff);
      let stride = (mem.read8(loc_8b) - 1) & 0xff;
      if (stride < 0x02) stride = 0x1b;
      mem.write8(loc_8b, stride);
      col = (mem.read8(loc_8f) - 1) & 0xff;
    } while ((col & 0x80) === 0);
    return m.call(0x2932);
  };
  const base = seed({ p88: 0x00, ef: 0x00 });
  const o = base.clone();
  const c = base.clone();
  oracle(o);
  droppedTally(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch the dropped $D7 tally bump");
  assert.equal(d.addr, (loc_d7 + 0x00) & 0xff, "diff should be at the $D7+$88 tally cell");
  console.log("  TEETH: dropped-tally twin caught at the $D7 cell");
});

test("SP-SEAM TOOTH: the seated dispatches place at the seam; a stray push is refused", () => {
  const r = seamPlaceable(withOmittedRet, resetPlayfieldAndSeedMushrooms, TARGET, seed());
  assert.equal(r.placeable, true, `seam refused the tail-dispatch body: ${r.error}`);
  // Null-mutant: an extra push16 with no matching pop must leave SP adrift so the seam THROWS. This
  // routine is a +2 tail-dispatcher (loc_2932's RTS pops the caller slot -> the seated body ends with
  // SP moved +2, pc on the caller slot), so a SINGLE stray push would net to moved 0 -- exactly the
  // seam's legit "omitted-ret leaf" signature, and place vacuously (tooth with no teeth). TWO unmatched
  // pushes leave SP net -2 (moved 0xfe), which is neither 0 nor the +2-on-slot case -> refused.
  const strayPush = (m) => { resetPlayfieldAndSeedMushrooms(m); m.push16(0x9999); m.push16(0x9999); };
  const rm = seamPlaceable(withOmittedRet, strayPush, TARGET, seed());
  assert.equal(rm.placeable, false, "the stray-push mutant placed at the seam (tooth has no teeth)");
  console.log("  SP-SEAM: tail-dispatch body placeable; stray-push mutant refused");
});
