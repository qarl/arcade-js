// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for loc_b230 -- draws one frame: each subsystem bracketed by a setup/teardown pair,
// a conditional carry-chained 40-byte sum into a status cell, then two constants latched into the first
// two display words. The idiomatic side dissolves every jsr into direct idiomatic calls (the setup and
// teardown pair takes its layer id explicitly). Live-out is memory only, so each arm compares RAM
// (dumpState minus STACK_SCRATCH).
// Run: node --test games/tempest/idiomatic/test/equivalence-b230.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_b230 as oracle } from "../../translated/loc_b230.js";
import { loc_b230 } from "../loc_b230.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, loc_114, loc_cec2, loc_cec3, loc_2000, loc_2001 } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xb230;
const inDeadStack = (a) => a != null && a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(12, 6000) : [];

test("CAPTURE: real 0xb230 dispatches -- loc_b230 == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); loc_b230(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// A warm base from a real dispatch: b230 is the frame spine, so a cold machine may boot-gap; the
// captured mid-game state exercises the full subsystem sequence without that risk.
const BASE = () => (CAPS.length ? CAPS[0].clone() : new Machine(ROM, OPTS));

test("CRAFTED: warm frame draw -- full subsystem sequence matches the oracle", () => {
  const o = BASE(); const c = BASE();
  oracle(o); loc_b230(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the frame draw");
  assert.equal(c.mem.read8(loc_2000), c.mem.read8(loc_cec2), "display word 0 latched from its source");
  assert.equal(c.mem.read8(loc_2001), c.mem.read8(loc_cec3), "display word 1 latched from its source");
  assert.equal(c.mem.read8(loc_114), 0x00, "change counter cleared");
});

test("TEETH: a twin that draws nothing diverges from the oracle", () => {
  const o = BASE(); const c = BASE();
  oracle(o);
  const brokenB230 = (m) => { m.mem8[loc_114] = 0x00; /* BUG: never runs any subsystem nor latches display */ };
  brokenB230(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped frame");
});

test("TEETH-LATCH: a twin that latches the wrong display word diverges from the oracle", () => {
  const o = BASE(); const c = BASE();
  oracle(o);
  const brokenB230 = (m) => { loc_b230(m); m.mem8[loc_2000] = (m.mem8[loc_cec2] ^ 0xff) & 0xff; };
  brokenB230(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the corrupted latch");
});

test("SP-TOOTH: the omitted-ret caller (moved 0) is seam-placeable", () => {
  const m = BASE();
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, loc_b230, TARGET, m);
  assert.equal(r.placeable, true, `loc_b230 must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret caller (moved 0) placeable");
});
