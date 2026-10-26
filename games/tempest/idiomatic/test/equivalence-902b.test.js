// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for resetWorkingRamForStateEntry (ROM 0x902b) -- the new-game reset spine: run six subsystem resets
// (clearActiveShots, clearShotTableAndStateFlags, seedSlotRandomTags, clearEightByteTableAndFlag, clearByte50, buildLevelLayout) in order, then set $0124=$0148=0xff and
// $0123=0x00. Live-out is RAM plus the exit [X, Y] it returns (buildLevelLayout's), so each side runs on a clone
// and the contract is RAM (dumpState, minus stack scratch below the entry SP) plus that pair (compared on the CAPTURE arm). A body-then-return routine: the module omits the ROM
// ret and the seam completes it, so the arms compare RAM (-stack), NOT pc/SP.
//   POKEY coupling: seedSlotRandomTags draws slot tags from $60ca (POKEY1 RANDOM), clock-coupled. We freeze the
// polys (clear SK_RESET) so both arms read the SAME RANDOM byte on every load, keeping the fill
// deterministic on the crafted and captured arms alike.
// Run: node --test games/tempest/idiomatic/test/equivalence-902b.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_902b } from "../../translated/loc_902b.js";
import { resetWorkingRamForStateEntry } from "../resetWorkingRamForStateEntry.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { SPIKED_SEGMENT_COUNT, RIM_COLOR_ANIM, ENEMY_ANIM_ACCUM, FIRE_GATE, loc_9f } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const opt = (name) => {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
};
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x902b;
const oracle = atEntry(loc_902b);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

// Freeze the POKEY polys so the clock-coupled RANDOM index stays put across both arms.
const freezePokey = (m) => { for (const p of m.io.pokeys) p.skctl &= ~0x03; return m; };

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 4000) : [];

test("CAPTURE: real 0x902b dispatches -- resetWorkingRamForStateEntry == oracle in RAM (-stack, poly frozen)", () => {
  for (const cap of CAPS) {
    const o = freezePokey(cap.clone()), c = freezePokey(cap.clone());
    oracle(o); { c.regs.x ^= 0xff; c.regs.y ^= 0xff; // m.regs poisoned: this routine takes no entry X/Y, so its exit must not depend on them
      assert.deepEqual(resetWorkingRamForStateEntry(c), [o.regs.x, o.regs.y], "returned exit [X, Y] = the oracle's"); }
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: full reset spine == oracle (RAM -stack); final three flag bytes set", () => {
  const seed = (m) => {
    freezePokey(m);
    m.mem.write8(FIRE_GATE, 0x04); // slot count for the 9246 fill loop
    m.mem.write8(loc_9f, 0x30);  // table index for the c16e unpack
    m.mem.write8(0x0133, 0x00);
    // dirty sentinels on the three trailing flag bytes so their writes are observable
    m.mem.write8(RIM_COLOR_ANIM, 0x11);
    m.mem.write8(ENEMY_ANIM_ACCUM, 0x22);
    m.mem.write8(SPIKED_SEGMENT_COUNT, 0x33);
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); resetWorkingRamForStateEntry(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after reset");
  assert.equal(c.mem.read8(RIM_COLOR_ANIM), 0xff, "$0124 = 0xff");
  assert.equal(c.mem.read8(ENEMY_ANIM_ACCUM), 0xff, "$0148 = 0xff");
  assert.equal(c.mem.read8(SPIKED_SEGMENT_COUNT), 0x00, "$0123 = 0x00");
});

test("TEETH: a twin that skips the final flag stores diverges from the oracle", () => {
  const seed = (m) => {
    freezePokey(m);
    m.mem.write8(FIRE_GATE, 0x04);
    m.mem.write8(loc_9f, 0x30);
    m.mem.write8(0x0133, 0x00);
    m.mem.write8(RIM_COLOR_ANIM, 0x11);
    m.mem.write8(ENEMY_ANIM_ACCUM, 0x22);
    m.mem.write8(SPIKED_SEGMENT_COUNT, 0x33);
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  // Twin: runs the full spine but then re-dirties the three trailing flags, as if it never stored them.
  const broken = (mm) => {
    resetWorkingRamForStateEntry(mm);
    mm.mem8[RIM_COLOR_ANIM] = 0x11; // BUG: leaves the trailing flags at their pre-reset sentinels
    mm.mem8[ENEMY_ANIM_ACCUM] = 0x22;
    mm.mem8[SPIKED_SEGMENT_COUNT] = 0x33;
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped flag stores");
});

test("SP-TOOTH: the omitted-ret routine (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  freezePokey(m);
  m.mem.write8(FIRE_GATE, 0x04);
  m.mem.write8(loc_9f, 0x30);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, resetWorkingRamForStateEntry, TARGET, m);
  assert.equal(r.placeable, true, `resetWorkingRamForStateEntry must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret routine (moved 0) placeable");
});
