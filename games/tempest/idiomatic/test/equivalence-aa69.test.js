// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for prepCountThenComposeFrame -- runs the shared prep aa92 then tail-dispatches the per-frame driver
// a8e7. Dissolves both m.calls into direct idiomatic calls; the oracle m.calls the frozen callees, the
// idiomatic calls the idiomatic ones. Output is RAM, so each arm compares the RAM diff (minus the dead
// stack). An omitted-ret rewrite.
// Run: node --test games/tempest/idiomatic/test/equivalence-aa69.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_aa69 } from "../../translated/loc_aa69.js";
import { prepCountThenComposeFrame } from "../prepCountThenComposeFrame.js";
import { composeFrameDisplayList } from "../composeFrameDisplayList.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { GAME_MODE, STATUS_FLAGS } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) { const u = new URL(name, ROM_DIR); return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined; }
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xaa69;
// Prime the object-render pipeline these routines dive into (ab17/ab14/a8b4 read a list-pointer table
// via ($ac),x and emit vector words through ($74)). A fresh Machine leaves $ac/$74 = 0, so the list
// pointer resolves into the unmapped 0x8000 hole. Point $ac at a synthetic pointer table in work RAM
// whose every slot targets a one-entry, bit7-terminated list, and $74 at a writable output buffer.
function seedPipe(m) {
  const w = (a, v) => m.mem.write8(a, v);
  w(0xac, 0x00); w(0xad, 0x04); // list-pointer table base -> 0x0400
  w(0x74, 0x00); w(0x75, 0x05); // vector-word output buffer -> 0x0500
  for (let i = 0; i < 0x80; i += 2) { w(0x0400 + i, 0x20); w(0x0400 + i + 1, 0x04); } // every slot -> 0x0420
  w(0x0420, 0x00); w(0x0421, 0x80); // list: one entry then a bit7 terminator
}
const oracle = atEntry(loc_aa69);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

test("CAPTURE: real 0xaa69 dispatches -- prepCountThenComposeFrame == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); prepCountThenComposeFrame(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: idle and active driver states == oracle (RAM)", () => {
  const cases = [
    { tag: "idle: $00==4", c00: 0x04, c05: 0x00 },
    { tag: "active: $00==0x18, $05<0", c00: 0x18, c05: 0x80 },
  ];
  for (const s of cases) {
    const seat = (m) => { seedPipe(m); m.mem.write8(GAME_MODE, s.c00); m.mem.write8(STATUS_FLAGS, s.c05); };
    const o = new Machine(ROM, OPTS); seat(o);
    const c = new Machine(ROM, OPTS); seat(c);
    oracle(o); prepCountThenComposeFrame(c);
    assert.equal(ramDiff(o, c), null, s.tag);
  }
});

test("TEETH: a twin that omits the aa92 prep and only runs the driver MUST diverge", () => {
  const seat = (m) => { seedPipe(m); m.mem.write8(GAME_MODE, 0x04); m.mem.write8(STATUS_FLAGS, 0x00); };
  const o = new Machine(ROM, OPTS); seat(o);
  const c = new Machine(ROM, OPTS); seat(c);
  oracle(o);
  const broken = (m) => { composeFrameDisplayList(m); }; // BUG: skips the aa92 prep call
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped aa92 prep");
});

test("SP-TOOTH: the omitted-ret rewrite is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  seedPipe(m);
  m.mem.write8(GAME_MODE, 0x04);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, prepCountThenComposeFrame, TARGET, m);
  assert.equal(r.placeable, true, `prepCountThenComposeFrame must be seam-placeable; got: ${r.error}`);
});
