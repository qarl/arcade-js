// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for drawScoreDeltaPanel (ROM 0xadea-0xae1b) -- draws the fixed frame (buildTextOverlayList, several drawSlotShapeWithHeader/
// drawSlotShapeRecord vector draws, emitCountDigitRun), decrements $016e, computes A = $0602 - $0604 and tail-calls the row
// builder drawHighlightedGlyphRowList with that delta. Dissolves every m.call; the delta is threaded as drawHighlightedGlyphRowList's A input.
// All output is RAM (emitted words + $016e tick), so each arm compares the RAM diff (minus dead stack).
// Omitted-ret caller.
// Run: node --test games/tempest/idiomatic/test/equivalence-adea.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_adea } from "../../translated/loc_adea.js";
import { drawScoreDeltaPanel } from "../drawScoreDeltaPanel.js";
import { buildTextOverlayList } from "../buildTextOverlayList.js";
import { drawSlotShapeWithHeader } from "../drawSlotShapeWithHeader.js";
import { emitCountDigitRun } from "../emitCountDigitRun.js";
import { drawSlotShapeRecord } from "../drawSlotShapeRecord.js";
import { drawHighlightedGlyphRowList } from "../drawHighlightedGlyphRowList.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { u8 } from "../../../../core/int.js";
import { SCORE_DISPLAY_TIMER, ACTIVE_SLOT, REARM_COUNTER } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) { const u = new URL(name, ROM_DIR); return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined; }
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xadea;
const oracle = atEntry(loc_adea);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 4000) : [];

// Seed the two score cells so the threaded delta ($0602 - $0604) is a distinctive nonzero value, and $016e
// so the decrement is observable. Also stand up a minimal draw environment: the frame build (buildTextOverlayList and
// drawSlotShapeRecord) walks the ($ac) object-pointer table and emits through the ($74) cursor -- without them the
// emitted words corrupt zero page ($3b/$3c) and drawSlotShapeRecord dereferences a garbage pointer into a decode hole
// (unmapped read at 0x7100). Point $74 at vector RAM (0x2800), $ac at a table (0x2400) whose every even
// entry points to a one-pair, bit7-terminated list at 0x2500, and set $05 bit7 so buildTextOverlayList skips its own
// object-draw block (drawOverlayFrame would otherwise overwrite $016e -- that block has its own coverage in
// equivalence-a8b4). drawScoreDeltaPanel's own drawSlotShapeRecord(0x0a)/(0x2c) draws still run through the seeded table.
function seat(m, { c602 = 0x40, c604 = 0x07, c16e = 0x09 } = {}) {
  m.mem.write8(ACTIVE_SLOT, c602);
  m.mem.write8(REARM_COUNTER, c604);
  m.mem.write8(SCORE_DISPLAY_TIMER, c16e);
  m.mem.write8(0x05, 0x80);                                    // skip buildTextOverlayList's object-draw block
  m.mem.write8(0x74, 0x00); m.mem.write8(0x75, 0x28);          // ($74) cursor -> 0x2800 (vector RAM)
  m.mem.write8(0xac, 0x00); m.mem.write8(0xad, 0x24);          // ($ac) object table -> 0x2400 (vector RAM)
  for (let k = 0; k < 0x100; k += 2) { m.mem.write8(0x2400 + k, 0x00); m.mem.write8(0x2400 + k + 1, 0x25); }
  m.mem.write8(0x2500, 0x00); m.mem.write8(0x2501, 0x82);      // list: header byte, then a bit7 terminator
}

test("CAPTURE: real 0xadea dispatches -- drawScoreDeltaPanel == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); drawScoreDeltaPanel(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: frame draw + $016e-- + delta thread to drawHighlightedGlyphRowList == oracle (RAM)", () => {
  const o = new Machine(ROM, OPTS); seat(o);
  const c = new Machine(ROM, OPTS); seat(c);
  oracle(o); drawScoreDeltaPanel(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the frame build");
  assert.equal(c.mem.read8(SCORE_DISPLAY_TIMER), 0x08, "$016e decremented");
});

test("TEETH (delta thread): a twin that hands drawHighlightedGlyphRowList the wrong A (0x00) diverges", () => {
  const o = new Machine(ROM, OPTS); seat(o); oracle(o);
  const c = new Machine(ROM, OPTS); seat(c);
  // BUG: replays the same draws but threads a stale/zero delta into the row builder.
  const broken = (m) => {
    const { mem8 } = m;
    buildTextOverlayList(m);
    drawSlotShapeWithHeader(m, 0xc0, 0x02);
    mem8[SCORE_DISPLAY_TIMER] = u8(mem8[SCORE_DISPLAY_TIMER] - 1);
    emitCountDigitRun(m);
    drawSlotShapeRecord(m, 0x0a);
    drawSlotShapeWithHeader(m, 0xa6, 0x0c);
    drawSlotShapeWithHeader(m, 0x9c, 0x0e);
    drawSlotShapeRecord(m, 0x2c);
    drawHighlightedGlyphRowList(m, 0x00); // wrong delta
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the wrong threaded delta");
});

test("SP-TOOTH: the omitted-ret caller is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  seat(m, {});
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, drawScoreDeltaPanel, TARGET, m);
  assert.equal(r.placeable, true, `drawScoreDeltaPanel must be seam-placeable; got: ${r.error}`);
});
