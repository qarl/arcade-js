// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for emitCountDigitRun (ROM 0xaa97-0xaa9d) -- emits a zero header run via emitScaleWordIfChanged(a=0),
// then tail-enters emitSlotIndexDigit with X = the slot byte at $3d. Both m.calls are dissolved to direct
// idiomatic calls. Live-out is memory only (vector cursor + published slot pointer; the tail return is
// incidental), so each arm compares RAM (dumpState minus stack scratch below the entry SP).
// Run: node --test games/tempest/idiomatic/test/equivalence-aa97.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_aa97 } from "../../translated/loc_aa97.js";
import { emitCountDigitRun } from "../emitCountDigitRun.js";
import { emitSlotIndexDigit } from "../emitSlotIndexDigit.js";
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

const TARGET = 0xaa97;
const oracle = atEntry(loc_aa97);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xaa97 dispatches -- emitCountDigitRun == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); emitCountDigitRun(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

function seed(m) {
  m.mem.write8(0x3d, 0x05);   // slot byte -> aa9e's X input
  m.mem.write8(0x61, 0x02);   // slot pointer base
  m.mem.write8(0x72, 0x33);   // != 0 so b0dd actually stores + emits
  m.mem.write8(0x73, 0x04);
  m.mem.write8(0x74, 0x00); m.mem.write8(0x75, 0x28); // cursor -> 0x2800 (vector RAM, diffed)
}

test("CRAFTED: zero header + slot run -- emitCountDigitRun == oracle in RAM", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); emitCountDigitRun(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after emit");
  assert.equal(c.mem.read8(0x72), 0x00, "$72 latched to the zero header");
  assert.equal(c.mem.read8(0x61), 0x06, "$61 advanced past the slot byte");
});

test("TEETH: a twin that skips the header emit (emitScaleWordIfChanged) diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seed(o); oracle(o);
  const c = new Machine(ROM, OPTS); seed(c);
  const broken = (m) => {
    // BUG: never publishes the zero header run; jumps straight to the slot run
    return emitSlotIndexDigit(m, m.mem8[0x3d]);
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped header emit");
});

function seedMut(m) {
  m.mem.write8(0x3d, 0x11);   // different slot
  m.mem.write8(0x61, 0x40);
  m.mem.write8(0x72, 0x00);   // == 0 so b0dd short-returns (other branch)
  m.mem.write8(0x73, 0x1a);
  m.mem.write8(0x74, 0x80); m.mem.write8(0x75, 0x24); // cursor -> 0x2480
}

test("MUTATION: non-default seed -- emitCountDigitRun == oracle in RAM", () => {
  const o = new Machine(ROM, OPTS); seedMut(o);
  const c = new Machine(ROM, OPTS); seedMut(c);
  oracle(o); emitCountDigitRun(c);
  assert.equal(ramDiff(o, c), null, "RAM equal on the non-default seed");
});

test("SP-TOOTH: the omitted-ret caller (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, emitCountDigitRun, TARGET, m);
  assert.equal(r.placeable, true, `emitCountDigitRun must be seam-placeable; got: ${r.error}`);
});
