// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for seedFrameControlTimers (ROM 0x921b) -- seeds five constant cells ($0200=0x0e, $51=0xf0,
// $0106=0x00, $0201=0x0f, $0202=0x10). Pure constant-store leaf: live-out is RAM only, so every arm checks
// the RAM diff minus dead stack. No inputs, no POKEY/clock coupling. $0106 sits low in page 1 but well
// clear of the live stack (S ~ 0xfd..0xef), so it is a genuine live-out, not dead scratch.
// Run: node --test games/tempest/idiomatic/test/equivalence-921b.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_921b } from "../../translated/loc_921b.js";
import { seedFrameControlTimers } from "../seedFrameControlTimers.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { RIM_ROT_OFFSET, SPIKE_ACTIVE_FLAG, PLAYER_SEGMENT, PLAYER_FINE_ANGLE, PLAYER_SHOT_DEPTH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const opt = (name) => { const u = new URL(name, ROM_DIR); return existsSync(u) ? new Uint8Array(readFileSync(u)) : null; };
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x921b;
const oracle = atEntry(loc_921b);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

const CELLS = [RIM_ROT_OFFSET, SPIKE_ACTIVE_FLAG, PLAYER_SEGMENT, PLAYER_FINE_ANGLE, PLAYER_SHOT_DEPTH];
// Pre-dirty the target cells with a non-default pattern so a seed that misses any of them is caught.
function seed(m, fill = 0xa5) { for (const a of CELLS) m.mem8[a] = fill; }

test("CAPTURE: real 0x921b dispatches -- seedFrameControlTimers == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); seedFrameControlTimers(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: the five constant seeds == oracle (RAM -stack)", () => {
  for (const fill of [0xa5, 0x00, 0xff]) {
    const o = new Machine(ROM, OPTS); seed(o, fill);
    const c = new Machine(ROM, OPTS); seed(c, fill);
    oracle(o); seedFrameControlTimers(c);
    assert.equal(ramDiff(o, c), null, `fill=0x${fill.toString(16)}`);
  }
  const c = new Machine(ROM, OPTS); seed(c, 0xa5); seedFrameControlTimers(c);
  assert.equal(c.mem8[PLAYER_SEGMENT], 0x0e, "$0200");
  assert.equal(c.mem8[RIM_ROT_OFFSET], 0xf0, "$51");
  assert.equal(c.mem8[SPIKE_ACTIVE_FLAG], 0x00, "$0106");
  assert.equal(c.mem8[PLAYER_FINE_ANGLE], 0x0f, "$0201");
  assert.equal(c.mem8[PLAYER_SHOT_DEPTH], 0x10, "$0202");
});

test("TEETH: a rewrite that skips the $51 seed diverges from the oracle (non-default pre-fill)", () => {
  const o = new Machine(ROM, OPTS); seed(o, 0xa5);
  const c = new Machine(ROM, OPTS); seed(c, 0xa5);
  const broken = (m) => { // BUG: never seeds $51 (leaves the 0xa5 pre-fill)
    m.mem8[PLAYER_SEGMENT] = 0x0e; m.mem8[SPIKE_ACTIVE_FLAG] = 0x00; m.mem8[PLAYER_FINE_ANGLE] = 0x0f; m.mem8[PLAYER_SHOT_DEPTH] = 0x10;
  };
  oracle(o); broken(c);
  assert.equal(o.mem8[RIM_ROT_OFFSET], 0xf0, "precondition: oracle seeded $51");
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch a skipped $51 seed");
});

test("SP-TOOTH: the pure leaf omits its ROM ret (SP unmoved) and is seam-placeable", () => {
  const mk = () => {
    const m = new Machine(ROM, OPTS);
    m.regs.s = 0xfb;
    m.mem.write8(0x01fc, 0xcd); m.mem.write8(0x01fd, 0xab); // a real caller-return word for the seam's ret
    return m;
  };
  const ok = seamPlaceable(withOmittedRet, seedFrameControlTimers, TARGET, mk());
  assert.equal(ok.placeable, true, `seedFrameControlTimers must be seam-placeable; got: ${ok.error}`);
  const spMutant = (m) => { m.push16(0x0000); };
  assert.equal(seamPlaceable(withOmittedRet, spMutant, TARGET, mk()).placeable, false, "SP tooth failed to refuse an unbalanced mutant");
  console.log("  SP-TOOTH: pure leaf placeable; unbalanced mutant refused");
});
