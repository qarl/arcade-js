// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for primeTopObjectOnTargetMatch -- guards on a matching live byte and a not-yet-set flag, then dissolves
// the jsr into a direct primeTopPriorityObject(m, x, y) and latches the flag. Live-out is memory (the object table a34b
// seeds plus the flag); the incidental A/X/Y at RTS are not read, so each arm compares RAM (dumpState minus
// stack scratch below the entry SP). Poly is frozen defensively (the a34b path takes no RNG, but keeps arms bit-identical).
// Run: node --test games/tempest/idiomatic/test/equivalence-a1e4.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_a1e4 } from "../../translated/loc_a1e4.js";
import { primeTopObjectOnTargetMatch } from "../primeTopObjectOnTargetMatch.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { u16 } from "../../../../core/int.js";
import { PLAYER_SEGMENT, PLAYER_FINE_ANGLE, TARGET_SEG } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xa1e4;
const oracle = atEntry(loc_a1e4);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));
const freezePokey = (m) => { for (const p of m.io.pokeys) p.skctl &= ~0x03; return m; };

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 4000) : [];

test("CAPTURE: real 0xa1e4 dispatches -- primeTopObjectOnTargetMatch == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = freezePokey(cap.clone()), c = freezePokey(cap.clone());
    oracle(o); primeTopObjectOnTargetMatch(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

const XREG = 0x02, YREG = 0x03;
// Matching live byte + non-negative flag -> the guard passes and a34b runs.
function seedFire(m) {
  freezePokey(m);
  m.regs.x = XREG; m.regs.y = YREG;
  m.mem.write8(PLAYER_SEGMENT, 0x55);
  m.mem.write8(u16(TARGET_SEG + XREG), 0x55); // == $0200 -> equal -> proceed
  m.mem.write8(PLAYER_FINE_ANGLE, 0x00); // non-negative -> proceed
}

test("CRAFTED: matching byte + clear flag -> a34b runs, flag latches to 0x81, RAM equal", () => {
  const o = new Machine(ROM, OPTS); seedFire(o);
  const c = new Machine(ROM, OPTS); seedFire(c);
  oracle(o); primeTopObjectOnTargetMatch(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the dissolved a34b call");
  assert.equal(c.mem.read8(PLAYER_FINE_ANGLE), 0x81, "flag latched");
});

test("TEETH: a twin that skips a34b + the flag latch diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seedFire(o); oracle(o);
  const c = new Machine(ROM, OPTS); seedFire(c);
  const broken = (_m) => { /* BUG: never runs a34b, never latches the flag */ };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped body");
});

// Non-default seed: the live byte does NOT match -> the oracle returns untouched. A twin that runs a34b
// regardless must diverge, proving the equality guard has teeth.
test("TEETH (guard): non-matching byte -> oracle no-ops; a twin that runs anyway diverges", () => {
  const seedNoMatch = (m) => {
    freezePokey(m);
    m.regs.x = XREG; m.regs.y = YREG;
    m.mem.write8(PLAYER_SEGMENT, 0x55);
    m.mem.write8(u16(TARGET_SEG + XREG), 0x66); // != $0200 -> oracle returns unchanged
    m.mem.write8(PLAYER_FINE_ANGLE, 0x00);
  };
  const o = new Machine(ROM, OPTS); seedNoMatch(o); oracle(o);
  const c = new Machine(ROM, OPTS); seedNoMatch(c);
  const alwaysRun = (m, x = m.regs.x) => { m.mem8[PLAYER_FINE_ANGLE] = 0x81; }; // BUG: ignores the guard
  alwaysRun(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the ignored guard");
});

test("SP-TOOTH: the omitted-ret caller (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, primeTopObjectOnTargetMatch, TARGET, m);
  assert.equal(r.placeable, true, `primeTopObjectOnTargetMatch must be seam-placeable; got: ${r.error}`);
});
