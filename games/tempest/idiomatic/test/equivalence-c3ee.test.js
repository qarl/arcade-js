// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for drawFramedCounterSlot (ROM 0xc3ee-0xc422) -- a CALLER that dissolves jsr $df4c/$c43c/$c772/
// $c423/$c3ba into direct idiomatic calls: a two-pass framed draw with the colour live then stepped-back
// uncoloured. Effect is memory (vector RAM via the ($74) cursor plus the $6a-$73 caches). Live-out is the
// stepped-back slot index in X, so each arm compares RAM (dumpState minus stack scratch below the entry SP) AND the returned
// index against the oracle's exit X (fn-return vs oracle-register). Caller: the module omits the ROM ret.
// Run: node --test games/tempest/idiomatic/test/equivalence-c3ee.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_c3ee } from "../../translated/loc_c3ee.js";
import { drawFramedCounterSlot } from "../drawFramedCounterSlot.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xc3ee;
const oracle = atEntry(loc_c3ee);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

test("CAPTURE: real 0xc3ee dispatches -- drawFramedCounterSlot == oracle in RAM (-stack) and exit X", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); const rx = drawFramedCounterSlot(c);
    assert.equal(ramDiff(o, c), null, "RAM equal");
    assert.equal(rx, o.regs.x, "returned index == oracle exit X");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Point the ($74) cursor at vector RAM (0x2000, RW + diffed); seed a slot index in X and a colour in A.
function seed(m) {
  m.mem.write8(0x74, 0x00);
  m.mem.write8(0x75, 0x20);
  m.mem.write8(0x9e, 0x03); // $9e-mode threaded to df4c
  m.regs.x = 0x05;          // slot index -> $37
  m.regs.a = 0x0e;          // colour
}

test("CRAFTED: two-pass framed draw -- RAM equal and returned index is the stepped-back slot", () => {
  const base = new Machine(ROM, OPTS); seed(base);
  const o = base.clone(), c = base.clone();
  oracle(o); const rx = drawFramedCounterSlot(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after draw");
  assert.equal(rx, o.regs.x, "returned index == oracle exit X");
  assert.equal(rx, 0x04, "index stepped back by one from 0x05");
});

test("TEETH: an empty twin (no emit, no step-back) diverges from the oracle in RAM", () => {
  const base = new Machine(ROM, OPTS); seed(base);
  const o = base.clone(), c = base.clone();
  oracle(o);
  const broken = (_m) => { /* BUG: draws nothing */ };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the missing draw");
});

test("TEETH (live-out): a twin returning the un-stepped index diverges from oracle exit X", () => {
  const base = new Machine(ROM, OPTS); seed(base);
  const o = base.clone(), c = base.clone();
  oracle(o);
  const wrong = (m, x = m.regs.x) => x; // BUG: returns the input slot, not the stepped-back one
  const rx = wrong(c);
  assert.notEqual(rx, o.regs.x, "the live-out check FAILED to catch the un-stepped return");
});

test("SP-TOOTH: the omitted-ret caller (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, drawFramedCounterSlot, TARGET, m);
  assert.equal(r.placeable, true, `drawFramedCounterSlot must be seam-placeable; got: ${r.error}`);
});
