// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for cueSpikeCollisionSound -- a trampoline that raises the fixed sound id 0xcf and tail-runs the
// sound gate (register the sound only when the $0005 enable high bit is set). Live-out is memory only
// (A/X/Y at RTS are incidental), so each arm compares RAM (dumpState, minus stack scratch below the entry SP). The gate
// leaf preserves caller X/Y into $31/$32, so those are the readable near-side effect.
// Run: node --test games/tempest/idiomatic/test/equivalence-cd06.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_cd06 } from "../../translated/loc_cd06.js";
import { cueSpikeCollisionSound } from "../cueSpikeCollisionSound.js";
import { requestSoundIfEnabled } from "../requestSoundIfEnabled.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { STATUS_FLAGS, loc_31, loc_32 } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xcd06;
const oracle = atEntry(loc_cd06);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 4000) : [];

test("CAPTURE: real 0xcd06 dispatches -- cueSpikeCollisionSound == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); cueSpikeCollisionSound(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: gate open ($0005 bit7 set) -- sound id 0xcf registered, X/Y mirrored into $31/$32", () => {
  const seed = (m) => {
    m.regs.s = 0xfb; m.regs.x = 0x24; m.regs.y = 0x59;
    m.mem.write8(STATUS_FLAGS, 0x80);   // enable high bit
    m.mem.write8(loc_31, 0xaa);  // sentinel != X
    m.mem.write8(loc_32, 0xbb);  // sentinel != Y
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); cueSpikeCollisionSound(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after run");
  assert.equal(c.mem.read8(loc_31), 0x24, "$31 <- X");
  assert.equal(c.mem.read8(loc_32), 0x59, "$32 <- Y");
});

test("CRAFTED: gate closed ($0005 bit7 clear) -- nothing registered, RAM unchanged", () => {
  const seed = (m) => {
    m.regs.s = 0xfb; m.regs.x = 0x24; m.regs.y = 0x59;
    m.mem.write8(STATUS_FLAGS, 0x00);   // enable high bit clear
    m.mem.write8(loc_31, 0xaa);
    m.mem.write8(loc_32, 0xbb);
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); cueSpikeCollisionSound(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after gate-closed run");
  assert.equal(c.mem.read8(loc_31), 0xaa, "$31 untouched (gate closed)");
});

test("TEETH: a twin that skips the gated call (non-default seed) diverges from the oracle", () => {
  const seed = (m) => {
    m.regs.s = 0xfb; m.regs.x = 0x24; m.regs.y = 0x59;
    m.mem.write8(STATUS_FLAGS, 0x80);   // gate open so the skipped work shows
    m.mem.write8(loc_31, 0xaa);
    m.mem.write8(loc_32, 0xbb);
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  const broken = (_m) => { /* BUG: never runs the sound gate, so $31/$32 keep their sentinels */ };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped call");
});

test("TEETH: passing the wrong id (0x00) diverges from the oracle", () => {
  const seed = (m) => {
    m.regs.s = 0xfb; m.regs.x = 0x24; m.regs.y = 0x59;
    m.mem.write8(STATUS_FLAGS, 0x80);
    m.mem.write8(loc_31, 0xaa);
    m.mem.write8(loc_32, 0xbb);
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  requestSoundIfEnabled(c, 0x00); // BUG: wrong sound id walks a different table window
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the wrong sound id");
});

test("SP-TOOTH: the omitted-ret trampoline is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, cueSpikeCollisionSound, TARGET, m);
  assert.equal(r.placeable, true, `cueSpikeCollisionSound must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret trampoline placeable");
});
