// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for emitPrimedHeaderAndClearVectorSlots (ROM 0xdb7e-0xdb83) -- primes X=0xb6/A=0x32 and, since the value is
// always nonzero, tail-calls the shared block-clear entry emitVectorHeaderAndClearSlots (the self-seeding emitFixedHeaderAndClearVectorSlots fall is
// unreachable). The idiomatic side dissolves the branch into a direct emitVectorHeaderAndClearSlots(m, 0x32, 0xb6). Live-out
// is memory only (the emit list + the cleared POKEY block), so the arms compare RAM (dumpState -stack).
// Run: node --test games/tempest/idiomatic/test/equivalence-db7e.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_db7e } from "../../translated/loc_db7e.js";
import { emitPrimedHeaderAndClearVectorSlots } from "../emitPrimedHeaderAndClearVectorSlots.js";
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

const TARGET = 0xdb7e;
const oracle = atEntry(loc_db7e);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xdb7e dispatches -- emitPrimedHeaderAndClearVectorSlots == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); emitPrimedHeaderAndClearVectorSlots(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Point the emit cursor into vector RAM so the df39 word lands in diffed memory.
function seedCursor(m) {
  m.mem.write8(0x74, 0x00); m.mem.write8(0x75, 0x20); // ($74) = 0x2000
  m.mem.write8(0x73, 0x00);
}

test("CRAFTED: fresh cursor -- both arms emit the same word and clear the same block", () => {
  const o = new Machine(ROM, OPTS); seedCursor(o);
  const c = new Machine(ROM, OPTS); seedCursor(c);
  oracle(o); emitPrimedHeaderAndClearVectorSlots(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the clear");
  assert.equal(c.mem.read8(0x2001), o.mem.read8(0x2001), "emitted high byte matches oracle");
  assert.notEqual(c.mem.read8(0x2001), 0x00, "the word was actually emitted into vector RAM");
});

test("TEETH: a twin that emits nothing diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seedCursor(o);
  const c = new Machine(ROM, OPTS); seedCursor(c);
  oracle(o);
  const brokenDb7e = (_m) => { /* BUG: never emits the word, never advances the cursor */ };
  brokenDb7e(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped emit");
});

test("SP-TOOTH: the omitted-ret tail-caller (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, emitPrimedHeaderAndClearVectorSlots, TARGET, m);
  assert.equal(r.placeable, true, `emitPrimedHeaderAndClearVectorSlots must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret tail-caller (moved 0) placeable");
});
