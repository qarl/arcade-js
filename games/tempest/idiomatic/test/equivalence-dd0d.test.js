// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for buildPotReadoutVectorList (ROM 0xdd0d-0xdd26) -- builds the spinner/pot readout vector list: a fixed
// header word, a zero-tagged word, an eight-digit run keyed by (DSW1_COINAGE), a second run keyed by (DSW2_OPTIONS),
// then assemblePotStatusByte (pulses the POKEY pot-scan trigger $60db -- DISCARDED by the board, so the A fed in is
// unobservable in RAM -- and returns the assembled pot-status byte from POKEY2_AUDCTL/POKEY1_AUDCTL), whose result
// keys a final eight-digit run via Y. buildPotReadoutVectorList is UNREACHED in the capture, so this is CRAFTED-only.
// Live-out is RAM (dumpState minus stack scratch below the entry SP) plus A/Y. Oracle is the frozen translated buildPotReadoutVectorList.
// Run: node --test games/tempest/idiomatic/test/equivalence-dd0d.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_dd0d } from "../../translated/loc_dd0d.js";
import { buildPotReadoutVectorList } from "../buildPotReadoutVectorList.js";
import { emitVectorHeaderWord } from "../emitVectorHeaderWord.js";
import { emitBlankVectorWordTag70 } from "../emitBlankVectorWordTag70.js";
import { emitByteBitsAsDigitsAtF8 } from "../emitByteBitsAsDigitsAtF8.js";
import { emitByteBitsAsDigitsFixed } from "../emitByteBitsAsDigitsFixed.js";
import { assemblePotStatusByte } from "../assemblePotStatusByte.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { DRAW_CURSOR_LO, DRAW_CURSOR_HI, DSW1_COINAGE, DSW2_OPTIONS, POKEY2_AUDCTL, POKEY1_AUDCTL } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xdd0d;
const oracle = atEntry(loc_dd0d);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(8, 3000) : [];

test("CAPTURE: real 0xdd0d dispatches (if any) -- buildPotReadoutVectorList == oracle in RAM (-stack), A/Y", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); buildPotReadoutVectorList(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.a, o.regs.a, "A live-out matches");
    // Y is not compared: buildPotReadoutVectorList tail-delegates to the final digit run, so its exit Y belongs to that
    // callee and is not a value buildPotReadoutVectorList itself produces (the idiomatic layer threads it by param, not m.regs).
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked (buildPotReadoutVectorList is deep-tail, 0 expected)`);
});

function seed(m) {
  m.mem.write8(DRAW_CURSOR_LO, 0x00); m.mem.write8(DRAW_CURSOR_HI, 0x20); // display-list cursor -> vector RAM 0x2000
  // DSW1_COINAGE (0x0d00) / DSW2_OPTIONS (0x0e00) are read-only DIP-switch input ports; both clones read the same
  // configured default through the port, so no seeding is needed (and write8 there would throw).
  m.mem.write8(POKEY2_AUDCTL, 0x05); m.mem.write8(POKEY1_AUDCTL, 0x20); // assemblePotStatusByte's pot-status inputs
}

test("CRAFTED: full readout build -- RAM and A/Y equal to the oracle", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); buildPotReadoutVectorList(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the readout build");
  assert.equal(c.regs.a, o.regs.a, "A live-out matches");
  assert.notEqual(c.mem.read8(DRAW_CURSOR_LO), 0x00, "the cursor advanced (words were emitted)");
});

test("TEETH: a twin that skips assemblePotStatusByte (its SLOT_LOOP_INDEX pot-status write) diverges from the oracle in RAM", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  const broken = (m) => {
    const { mem8 } = m;
    emitVectorHeaderWord(m);
    emitBlankVectorWordTag70(m, 0x00);
    emitByteBitsAsDigitsAtF8(m, mem8[DSW1_COINAGE], 0xe8);
    const a = emitByteBitsAsDigitsFixed(m, mem8[DSW2_OPTIONS]);
    // BUG: skips assemblePotStatusByte entirely, so its SLOT_LOOP_INDEX = (POKEY2_AUDCTL & 7) write never happens
    return emitByteBitsAsDigitsFixed(m, a);
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped assemblePotStatusByte write");
});
