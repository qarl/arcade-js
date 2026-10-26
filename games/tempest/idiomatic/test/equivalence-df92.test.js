// SPDX-License-Identifier: GPL-3.0-only
// also gates: 0xdfac emitRecordTailByte
// Memory-equivalence for emitCoordinateRecord (ROM 0xdf92) -- emits a 4-byte record through the ($74) cursor from four
// zeropage slots (packed y and a key-folded 5-bit last byte), then falls into emitRecordTailByte which stores the
// last byte and tail-branches to advanceDisplayCursor (advance cursor, y nonzero) or emitNibbleDigitRun (y wrapped to 0). The
// idiomatic side dissolves the two m.call tails into direct advanceDisplayCursor / emitNibbleDigitRun calls. Live-out is memory
// only (the record bytes + advanced cursor; A/X/Y at RTS are incidental), so each arm compares RAM
// (dumpState minus stack scratch below the entry SP). Run: node --test games/tempest/idiomatic/test/equivalence-df92.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_df92, loc_dfac } from "../../translated/loc_df92.js";
import { emitCoordinateRecord, emitRecordTailByte } from "../emitCoordinateRecord.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { GAME_MODE, MODE_DISPATCH_SEL, GAME_MODE_PENDING, FRAME_COUNTER, VG_RECORD_HEADER, DRAW_CURSOR_LO, DRAW_CURSOR_HI } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xdf92;
const oracle = atEntry(loc_df92);
const oracleDfac = atEntry(loc_dfac);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(addr, fn, K, maxFrames) {
  const caps = [];
  const snap = new Map([[addr, (mm) => { if (caps.length < K) caps.push(mm.clone()); return fn(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(TARGET, oracle, 16, 2000) : [];
const CAPS_DFAC = ROM_PRESENT ? captureDispatches(0xdfac, oracleDfac, 16, 2000) : [];

test("CAPTURE: real 0xdf92 dispatches -- emitCoordinateRecord == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); emitCoordinateRecord(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} 0xdf92 dispatch(es) checked`);
});

test("CAPTURE: real 0xdfac dispatches -- emitRecordTailByte == oracle in RAM (-stack)", () => {
  for (const cap of CAPS_DFAC) {
    const o = cap.clone(), c = cap.clone();
    oracleDfac(o); emitRecordTailByte(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS_DFAC.length} 0xdfac dispatch(es) checked`);
});

// Seed the cursor into vector RAM (0x2000, diffed) and four distinct zeropage slots so a swapped
// slot or a dropped key-fold would show in the record. x=0x10 spreads the slots across $10..$13.
function seedRecord(m) {
  m.regs.x = 0x10;
  m.mem.write8(DRAW_CURSOR_LO, 0x00); m.mem.write8(DRAW_CURSOR_HI, 0x20); // ($74) -> 0x2000
  m.mem.write8((GAME_MODE_PENDING + 0x10) & 0xff, 0x55); // $02,x
  m.mem.write8((FRAME_COUNTER + 0x10) & 0xff, 0xa3); // $03,x -> & 0x1f = 0x03
  m.mem.write8((GAME_MODE + 0x10) & 0xff, 0x77); // $00,x
  m.mem.write8((MODE_DISPATCH_SEL + 0x10) & 0xff, 0x99); // $01,x
  m.mem.write8(VG_RECORD_HEADER, 0x04); // key: ((0x99^0x04)&0x1f)^0x04 = 0x19
}

test("CRAFTED: 4-byte record emitted through ($74), bne taken -> advanceDisplayCursor advances cursor", () => {
  const o = new Machine(ROM, OPTS); seedRecord(o);
  const c = new Machine(ROM, OPTS); seedRecord(c);
  oracle(o); emitCoordinateRecord(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after record emit + cursor advance");
  assert.equal(c.mem.read8(0x2000), 0x55, "byte 0 = $02,x");
  assert.equal(c.mem.read8(0x2001), 0x03, "byte 1 = $03,x & 0x1f");
  assert.equal(c.mem.read8(0x2002), 0x77, "byte 2 = $00,x");
  assert.equal(c.mem.read8(0x2003), 0x19, "byte 3 = (($01,x ^ $73) & 0x1f) ^ $73");
  assert.equal(c.mem.read8(DRAW_CURSOR_LO), 0x04, "cursor advanced by y+1 = 4");
  assert.equal(c.mem.read8(DRAW_CURSOR_HI), 0x20, "cursor high unchanged");
});

test("TEETH: a twin that drops the key-fold on the last byte diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seedRecord(o); oracle(o);
  const c = new Machine(ROM, OPTS); seedRecord(c);
  const brokenDf92 = (m, x = m.regs.x) => {
    const { mem8, mem16 } = m;
    const base = mem16[DRAW_CURSOR_LO];
    mem8[(base + 0) & 0xffff] = mem8[(GAME_MODE_PENDING + x) & 0xff];
    mem8[(base + 1) & 0xffff] = mem8[(FRAME_COUNTER + x) & 0xff] & 0x1f;
    mem8[(base + 2) & 0xffff] = mem8[(GAME_MODE + x) & 0xff];
    mem8[(base + 3) & 0xffff] = mem8[(MODE_DISPATCH_SEL + x) & 0xff]; // BUG: raw byte, no key-fold/mask
  };
  brokenDf92(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the dropped key-fold");
});

// Direct emitRecordTailByte entry with y=0xff: the iny wraps to 0 -> bne not taken -> falls into emitNibbleDigitRun (the
// terminating byte run). Exercises the second dissolved tail. base -> 0x2000 so the run lands in diffed RAM.
function seedDfacWrap(m) {
  m.regs.a = 0x1f;
  m.regs.y = 0xff;
  m.regs.x = 0x00;
  m.mem.write8(DRAW_CURSOR_LO, 0x00); m.mem.write8(DRAW_CURSOR_HI, 0x20); // ($74) -> 0x2000
}

test("CRAFTED (dfac wrap): iny 0xff->0 -> falls into emitNibbleDigitRun -- emitRecordTailByte == oracle in RAM", () => {
  const o = new Machine(ROM, OPTS); seedDfacWrap(o);
  const c = new Machine(ROM, OPTS); seedDfacWrap(c);
  oracleDfac(o, o.regs.a, o.regs.y); emitRecordTailByte(c, c.regs.a, c.regs.y);
  assert.equal(ramDiff(o, c), null, "RAM equal after the dfb1 tail run");
});

test("TEETH (dfac wrap): a twin that runs advanceDisplayCursor instead of emitNibbleDigitRun diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seedDfacWrap(o); oracleDfac(o, o.regs.a, o.regs.y);
  const c = new Machine(ROM, OPTS); seedDfacWrap(c);
  const brokenDfac = (m, a = m.regs.a, y = m.regs.y) => {
    const { mem8, mem16 } = m;
    const yy = (y + 1) & 0xff;
    mem8[(mem16[DRAW_CURSOR_LO] + yy) & 0xffff] = a;
    // BUG: wrong branch -- never runs the dfb1 terminator run
  };
  brokenDfac(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the wrong tail branch");
});

test("SP-TOOTH: the omitted-ret caller (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, emitCoordinateRecord, TARGET, m);
  assert.equal(r.placeable, true, `emitCoordinateRecord must be seam-placeable; got: ${r.error}`);
});
