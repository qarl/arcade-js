// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for gateSound8f (ROM 0xccbd-0xccc0) -- a sound trampoline: loads the fixed sound id 0x8f
// and tail-calls the gate-register routine, carrying the caller's X/Y. The idiomatic side dissolves the
// jsr $ccc3 into a direct requestSoundIfEnabled(m, 0x8f, x, y) call. Live-out is memory only (RAM incl. $31/$32 and the
// per-slot sound cells $c0+/$e0+/$f0+), so each arm compares RAM (dumpState minus stack scratch below the entry SP); A/X/Y at
// RTS are incidental and not asserted. Reads the $cb01 sound table (ROM, deterministic); no POKEY randoms.
// Run: node --test games/tempest/idiomatic/test/equivalence-ccbd.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_ccbd } from "../../translated/loc_ccbd.js";
import { gateSound8f } from "../gateSound8f.js";
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

const TARGET = 0xccbd;
const oracle = atEntry(loc_ccbd);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xccbd dispatches -- gateSound8f == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); gateSound8f(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Register the sound with distinct X/Y so the $31/$32 stamp is observable, and $31/$32 pre-dirtied to a
// different value so the stamp is a real change.
function seed(m) {
  m.regs.x = 0x12; m.regs.y = 0x34;
  m.mem.write8(STATUS_FLAGS, 0x80);   // open the ccc3 enable gate so registration actually runs
  m.mem.write8(loc_31, 0xaa);
  m.mem.write8(loc_32, 0xbb);
}

test("CRAFTED: sound 0x8f -- RAM equal and $31/$32 stamped with the caller's X/Y", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); gateSound8f(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after registration");
  assert.equal(c.mem.read8(loc_31), 0x12, "$31 = X");
  assert.equal(c.mem.read8(loc_32), 0x34, "$32 = Y");
});

test("TEETH: a twin that never registers the sound diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  const brokenCcbd = (_m) => { /* BUG: never stamps $31/$32 nor claims any slot */ };
  brokenCcbd(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped registration");
});

// Non-default X/Y (mutation arm): a twin that carries the wrong X/Y into the register routine must diverge,
// proving the marshalling of the caller's X/Y through the dissolved call is checked.
test("TEETH (marshalling): a twin that swaps X/Y into the register routine diverges", () => {
  const o = new Machine(ROM, OPTS); seed(o); oracle(o);
  const c = new Machine(ROM, OPTS); seed(c);
  const swappedTwin = (m, x = m.regs.x, y = m.regs.y) => {
    // BUG: X and Y swapped into $31/$32
    m.mem8[loc_31] = y; m.mem8[loc_32] = x;
  };
  swappedTwin(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the swapped X/Y marshalling");
});

test("SP-TOOTH: the omitted-ret caller (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, gateSound8f, TARGET, m);
  assert.equal(r.placeable, true, `gateSound8f must be seam-placeable; got: ${r.error}`);
});
