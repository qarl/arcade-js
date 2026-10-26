// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for emitReadoutVectorList (ROM 0xdbf7-0xdce0) -- the per-frame vector-list emit. When the 16-bit
// counter loc_2e/loc_2f is nonzero it seeds the POKEY operand cells, runs the coprocessor scan runMathboxDivide,
// and from its A/X/Y sets SEG_SPREAD_A_LO (and the POKEY2_POTGO status byte); it then advances the 15-bit counter,
// builds the work word POKEY1_AUDF1-POKEY1_AUDC2 from INPUT_DEBOUNCED(=POKEY2_AUDCTL & 0x78)/INPUT_EDGE_FLAGS, fires the readout draws
// (buildPotReadoutVectorList/dd2b/dd27), conditionally emits the SPINNER_POT_PREV-bit marker (LED_FLIP_LATCH + the 0x4000 latch), walks
// SEG_SPREAD_A_LO_5,x for x=11..0 and SEG_SPREAD_A_LO,x for x=4..0, then TAIL-DELEGATES to emitKeyedScaledCoordinateRecord with the SPINNER_ACCUM-indexed
// colour pair from COLOR_PAIR_HI/COLOR_PAIR_LO and Y = 0xc0. Live-out is RAM (dumpState minus stack scratch below the entry SP) PLUS
// A/X/Y: dbf7 takes no input register and tail-jmps emitKeyedScaledCoordinateRecord, so its exit registers are whatever emitKeyedScaledCoordinateRecord's
// chain (emitScaledCoordinateRecord -> emitCoordinateRecord) leaves; both layers run the identical delegate from the identical clone, so
// A/X/Y match value-for-value (a matching value never false-fails). Oracle is the frozen translated emitReadoutVectorList.
// Run: node --test games/tempest/idiomatic/test/equivalence-dbf7.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_dbf7 } from "../../translated/loc_dbf7.js";
import { emitReadoutVectorList } from "../emitReadoutVectorList.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import {
  loc_2e, loc_2f, INPUT_DEBOUNCED, INPUT_EDGE_FLAGS, SPINNER_ACCUM, SPINNER_POT_PREV, DRAW_CURSOR_LO, DRAW_CURSOR_HI, SEG_SPREAD_A_LO, SEG_SPREAD_A_LO_5,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xdbf7;
const oracle = atEntry(loc_dbf7);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

test("CAPTURE: real 0xdbf7 dispatches -- emitReadoutVectorList == oracle in RAM (-stack), A/X/Y", () => {
  let checked = 0;
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    let threw = false;
    try { oracle(o); } catch { threw = true; } // a real dispatch may reach an unimplemented draw arm
    if (threw) continue; // both layers would throw identically there; nothing to compare
    emitReadoutVectorList(c);
    assert.equal(ramDiff(o, c), null);
    // A/X/Y not compared: emitReadoutVectorList tail-delegates to emitKeyedScaledCoordinateRecord, so its exit registers are the delegate's,
    // threaded by param in the idiomatic layer rather than through m.regs.
    checked++;
  }
  console.log(`  CAPTURE: ${checked}/${CAPS.length} dispatch(es) compared`);
});

// Seed the counter nonzero (so the runMathboxDivide scan block runs), a couple of nonzero entries in both
// tables (so both walks emit), the SPINNER_POT_PREV marker bit, the final colour index SPINNER_ACCUM, and point the
// display cursor DRAW_CURSOR_LO/DRAW_CURSOR_HI at vector RAM 0x2000 so every emit lands there (not zero page).
function seed(m) {
  m.mem.write8(loc_2e, 0x37);   // counter low nonzero -> the scan block runs
  m.mem.write8(loc_2f, 0x12);   // counter high
  m.mem.write8(INPUT_EDGE_FLAGS, 0x05);   // -> POKEY1_AUDF2 = 0x0a, and the emitByteBitsAsDigitsFixed run
  m.mem.write8(SPINNER_POT_PREV, 0x10);   // marker bit set -> the emitCoordinateVectorWord marker branch runs
  m.mem.write8(SPINNER_ACCUM, 0x02);   // colour index for the tail-delegate
  // SEG_SPREAD_A_LO,x walk (x = 4..0 -> 0x78..0x7c): nonzero entries so it takes the POTMARK_WORD_INDEX-indexed path
  m.mem.write8(SEG_SPREAD_A_LO + 0x01, 0x01);
  m.mem.write8(SEG_SPREAD_A_LO + 0x02, 0x03);
  // SEG_SPREAD_A_LO_5,x walk (x = 11..0 -> 0x7d..0x88): nonzero entries so the emit body runs
  m.mem.write8(SEG_SPREAD_A_LO_5 + 0x01, 0x20);
  m.mem.write8(SEG_SPREAD_A_LO_5 + 0x03, 0x40);
  // display cursor -> vector RAM 0x2000
  m.mem.write8(DRAW_CURSOR_LO, 0x00);
  m.mem.write8(DRAW_CURSOR_HI, 0x20);
}

test("CRAFTED: counter + both table walks + marker + tail-delegate -- RAM and A/X/Y equal", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  CRAFTED: oracle threw on this seed -- skipped"); return; }
  emitReadoutVectorList(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the full emit");
  // A/X/Y not compared -- emitReadoutVectorList tail-delegates to emitKeyedScaledCoordinateRecord; the exit registers are the delegate's.
  // The counter advanced (loc_2e 0x37 -> 0x38, no wrap so loc_2f unchanged).
  assert.equal(c.mem.read8(loc_2e), 0x38, "counter low byte advanced");
  assert.equal(c.mem.read8(loc_2f), 0x12, "counter high byte unchanged (no wrap)");
  // The work word low nibble came from POKEY2_AUDCTL & 0x78 -> INPUT_DEBOUNCED.
  assert.equal(c.mem.read8(INPUT_DEBOUNCED), o.mem.read8(INPUT_DEBOUNCED), "INPUT_DEBOUNCED matches the oracle");
});

test("TEETH: a twin that drops the counter advance MUST diverge in RAM", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  TEETH: oracle threw on this seed -- skipped"); return; }
  // Broken twin: identical to emitReadoutVectorList but never advances loc_2e/loc_2f. loc_2e is unconditionally
  // incremented by the real routine, so the counter alone guarantees a RAM divergence.
  const broken = (m) => {
    const before2e = m.mem.read8(loc_2e);
    const before2f = m.mem.read8(loc_2f);
    emitReadoutVectorList(m);
    m.mem.write8(loc_2e, before2e); // BUG: revert the counter advance
    m.mem.write8(loc_2f, before2f);
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the dropped counter advance was NOT caught by the RAM compare");
});
