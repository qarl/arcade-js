// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for emitTaggedVectorWord (ROM 0xdf4c-0xdf52) -- tags A with the 0x60 header bits, then emits the
// vector word {Y, tagged-A} at the cursor and advances it. The idiomatic side dissolves the jmp $df57 tail
// into a direct emitVectorWord(m, y, a|0x60) call. Live-out is memory only (the ROM tail leaves A = new cursor
// low, but this is a pure tail-caller that reads no register after), so each arm compares RAM (dumpState
// minus stack scratch below the entry SP). Run: node --test games/tempest/idiomatic/test/equivalence-df4c.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_df4c } from "../../translated/loc_df4c.js";
import { emitTaggedVectorWord } from "../emitTaggedVectorWord.js";
import { emitVectorWord } from "../emitVectorHeaderWord.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { DRAW_CURSOR_LO, DRAW_CURSOR_HI } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xdf4c;
const oracle = atEntry(loc_df4c);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

// Aim the cursor into diffed vector RAM and preset the A/Y payload.
function seed(m, a, y) {
  m.mem.write8(DRAW_CURSOR_LO, 0x00); m.mem.write8(DRAW_CURSOR_HI, 0x20); // cursor -> $2000
  m.regs.a = a; m.regs.y = y;
}

test("CAPTURE: real 0xdf4c dispatches -- emitTaggedVectorWord == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); emitTaggedVectorWord(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: word {Y, A|0x60} emitted at the cursor, cursor advanced", () => {
  const o = new Machine(ROM, OPTS); seed(o, 0x1c, 0x2a);
  const c = new Machine(ROM, OPTS); seed(c, 0x1c, 0x2a);
  oracle(o); emitTaggedVectorWord(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after emit");
  assert.equal(c.mem.read8(0x2000), 0x2a, "first byte = Y payload");
  assert.equal(c.mem.read8(0x2001), 0x7c, "second byte = A tagged with 0x60");
});

test("TEETH: a twin tagging with 0x50 instead of 0x60 diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seed(o, 0x1c, 0x2a); oracle(o);
  const c = new Machine(ROM, OPTS); seed(c, 0x1c, 0x2a);
  const brokenDf4c = (m, a = m.regs.a, y = m.regs.y) => emitVectorWord(m, y, a | 0x50); // BUG: wrong header bits
  brokenDf4c(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the wrong header tag");
});

test("SP-TOOTH: the omitted-ret tail-caller (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, emitTaggedVectorWord, TARGET, m);
  assert.equal(r.placeable, true, `emitTaggedVectorWord must be seam-placeable; got: ${r.error}`);
});
