// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for emitVectorHeaderAndClearSlots -- emits the A/X header word (dissolved emitCoordinateVectorWord) then blanks the four
// even slots of two output tables. Live-out is memory only (A/X/Y at RTS are incidental), so each arm runs
// on a clone and compares RAM (dumpState minus stack scratch below the entry SP). A/X are entry inputs threaded into emitCoordinateVectorWord,
// so the arms seed them and emitVectorHeaderAndClearSlots reads its defaults.
// Run: node --test games/tempest/idiomatic/test/equivalence-db88.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_db88 } from "../../translated/loc_db88.js";
import { emitVectorHeaderAndClearSlots } from "../emitVectorHeaderAndClearSlots.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { u16 } from "../../../../core/int.js";
import { POKEY1_AUDC1, POKEY2_AUDC1, DRAW_CURSOR_LO, DRAW_CURSOR_HI } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xdb88;
const oracle = atEntry(loc_db88);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xdb88 dispatches -- emitVectorHeaderAndClearSlots == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); emitVectorHeaderAndClearSlots(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

function seed(m) {
  m.regs.a = 0x5c; m.regs.x = 0x37;               // header pair into emitCoordinateVectorWord
  m.mem.write8(DRAW_CURSOR_LO, 0x00); m.mem.write8(DRAW_CURSOR_HI, 0x20); // cursor into vector RAM
  for (let i = 0; i <= 6; i += 2) {
    m.mem.write8(u16(POKEY1_AUDC1 + i), 0xa0 + i);     // dirty sentinels
    m.mem.write8(u16(POKEY2_AUDC1 + i), 0xb0 + i);
  }
}

test("CRAFTED: even slots of both tables clear to 0x00, header word emitted", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); emitVectorHeaderAndClearSlots(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after blank");
  for (let i = 0; i <= 6; i += 2) {
    assert.equal(c.mem.read8(u16(POKEY1_AUDC1 + i)), 0x00, `60c1 slot ${i} cleared`);
    assert.equal(c.mem.read8(u16(POKEY2_AUDC1 + i)), 0x00, `60d1 slot ${i} cleared`);
  }
});

test("TEETH: a twin that skips the table blanking diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  const broken = (m) => { emitVectorHeaderAndClearSlots; /* BUG: emits nothing, leaves the dirty sentinels */ void m; };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped blanking");
});

test("SP-TOOTH: the omitted-ret rewrite is seam-placeable", () => {
  const m = new Machine(ROM, OPTS); seed(m);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, emitVectorHeaderAndClearSlots, TARGET, m);
  assert.equal(r.placeable, true, `emitVectorHeaderAndClearSlots must be seam-placeable; got: ${r.error}`);
});
